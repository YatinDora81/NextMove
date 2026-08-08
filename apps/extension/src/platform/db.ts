/**
 * platform/db.ts — the IndexedDB layer (JF-001 Rev 3.0 SEC 7.1, SEC 7.3).
 *
 * Dexie 4 database `"jobfill"` with exactly the four tables the storage map names:
 *
 *   resumes      id, profileId, name, mime, size, blob, tags[], isDefault, addedAt   (MBs)
 *   applications tracker rows (SEC 7.3 / F-12)                                       (grows)
 *   parseCache   resumeId → extracted text + Gemini draft — re-parse without re-spend
 *   answerBank   Q→A memory (SEC 5.7 / F-17) — normalized question, answer, provenance
 *
 * Index notes worth knowing before you query:
 *   - IndexedDB cannot index booleans or nulls. `isDefault`, `template` and `current` are
 *     therefore NOT indexed — filter them in JS. `appliedAt` IS indexed, but rows still in
 *     `draft` (appliedAt === null) are absent from that index by definition; use the `status`
 *     index for them.
 *   - `answerBank` carries the SEC 5.7 lookup indexes: `qNorm`, `profileId`, `scope`, plus a
 *     compound `[scope+profileId]` for the "this profile, then global" fallback.
 *   - `applications` carries `status`, `appliedAt` and `company` per the design brief, plus
 *     `profileId`, `ats` and `updatedAt` for the dashboard filters (SEC 6.7).
 *
 * INV-3 (local-first): every table here works with the NextMove backend switched off. `syncedAt`
 * on a tracker row is advisory metadata for Phase-2 push, never a precondition for reading.
 *
 * Blobs never leave IndexedDB. Only text extracted from a resume can ever reach Gemini (SEC 03),
 * and only on an explicit gesture (INV-2).
 */

import Dexie, { type Table } from 'dexie';

import { DB_NAME, DB_TABLES, DB_VERSION } from '@/shared/constants';
import type {
  AnswerRecord,
  AnswerScope,
  ApplicationRow,
  AppStatus,
  ParseCacheRecord,
  ResumeRecord,
  TrackerQuery,
} from '@/shared/types';
import { createLogger } from '@/platform/logger';

const log = createLogger('db');

/* ------------------------------------------------------------------------------------------------
 * Database
 * ---------------------------------------------------------------------------------------------- */

export class NextMoveDatabase extends Dexie {
  readonly resumes: Table<ResumeRecord, string>;
  readonly applications: Table<ApplicationRow, string>;
  readonly parseCache: Table<ParseCacheRecord, string>;
  readonly answerBank: Table<AnswerRecord, string>;

  constructor(name: string = DB_NAME) {
    super(name);

    this.version(DB_VERSION).stores({
      [DB_TABLES.resumes]: 'id, profileId, name, addedAt, *tags',
      [DB_TABLES.applications]:
        'id, status, appliedAt, company, role, ats, profileId, updatedAt, [profileId+status]',
      [DB_TABLES.parseCache]: 'resumeId, parsedAt',
      [DB_TABLES.answerBank]: 'id, qNorm, profileId, scope, lastUsedAt, timesUsed, [scope+profileId]',
    });

    // Assigned explicitly rather than declared with `!`: with `useDefineForClassFields` (target
    // ESNext) an uninitialised field declaration would overwrite Dexie's own table properties.
    this.resumes = this.table<ResumeRecord, string>(DB_TABLES.resumes);
    this.applications = this.table<ApplicationRow, string>(DB_TABLES.applications);
    this.parseCache = this.table<ParseCacheRecord, string>(DB_TABLES.parseCache);
    this.answerBank = this.table<AnswerRecord, string>(DB_TABLES.answerBank);
  }
}

/** The singleton every other module uses. Dexie opens lazily on first access. */
export const db = new NextMoveDatabase();

/**
 * Open the database explicitly and report success. Dexie auto-opens, but the service worker
 * wants a definite answer at startup so a blocked/corrupt IndexedDB surfaces as a log line
 * instead of as a mysterious failure inside an unrelated feature.
 */
export async function openDatabase(): Promise<boolean> {
  try {
    if (!db.isOpen()) await db.open();
    return true;
  } catch (error) {
    log.error('failed to open IndexedDB', error);
    return false;
  }
}

/** Drop every row in every table, keeping the schema. */
export async function clearAllTables(): Promise<void> {
  await db.transaction('rw', db.resumes, db.applications, db.parseCache, db.answerBank, async () => {
    await Promise.all([
      db.resumes.clear(),
      db.applications.clear(),
      db.parseCache.clear(),
      db.answerBank.clear(),
    ]);
  });
  log.warn('cleared every jobfill table');
}

/** Delete the whole database — the IndexedDB half of a full local wipe (SEC 9.2). */
export async function deleteDatabase(): Promise<void> {
  await db.delete();
  log.warn('deleted the jobfill database');
}

/* ------------------------------------------------------------------------------------------------
 * resumes
 * ---------------------------------------------------------------------------------------------- */

export async function putResume(record: ResumeRecord): Promise<string> {
  return db.resumes.put(record);
}

export async function getResume(id: string): Promise<ResumeRecord | undefined> {
  return db.resumes.get(id);
}

/** Resumes for one profile plus the shared ones (`profileId === null`), newest first. */
export async function listResumes(profileId?: string | null): Promise<ResumeRecord[]> {
  const all = await db.resumes.toArray();
  const filtered =
    profileId === undefined
      ? all
      : all.filter((resume) => resume.profileId === profileId || resume.profileId === null);
  return filtered.sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteResume(id: string): Promise<void> {
  await db.transaction('rw', db.resumes, db.parseCache, async () => {
    await db.resumes.delete(id);
    await db.parseCache.delete(id);
  });
}

export async function countResumes(): Promise<number> {
  return db.resumes.count();
}

/**
 * Mark one resume as the default for its scope, clearing the flag on the others. `isDefault` is a
 * boolean and therefore unindexable, so the scan is explicit.
 */
export async function setDefaultResume(id: string): Promise<ResumeRecord | undefined> {
  return db.transaction('rw', db.resumes, async () => {
    const target = await db.resumes.get(id);
    if (!target) return undefined;
    const siblings = await db.resumes.toArray();
    const updates = siblings
      .filter((resume) => resume.isDefault !== (resume.id === id))
      .map((resume) => ({ ...resume, isDefault: resume.id === id }));
    if (updates.length > 0) await db.resumes.bulkPut(updates);
    return { ...target, isDefault: true };
  });
}

/** The resume a fill run should attach by default: profile-scoped first, then shared. */
export async function getDefaultResume(profileId: string | null): Promise<ResumeRecord | undefined> {
  const candidates = await listResumes(profileId);
  return (
    candidates.find((resume) => resume.isDefault && resume.profileId === profileId) ??
    candidates.find((resume) => resume.isDefault) ??
    candidates[0]
  );
}

/* ------------------------------------------------------------------------------------------------
 * applications (tracker — F-12 / SEC 6.7)
 * ---------------------------------------------------------------------------------------------- */

export async function putApplication(row: ApplicationRow): Promise<string> {
  return db.applications.put(row);
}

export async function getApplication(id: string): Promise<ApplicationRow | undefined> {
  return db.applications.get(id);
}

export async function deleteApplication(id: string): Promise<void> {
  await db.applications.delete(id);
}

export async function countApplications(): Promise<number> {
  return db.applications.count();
}

/** Most recent row for a posting URL — how a re-fill finds the draft it already opened. */
export async function findApplicationByUrl(url: string): Promise<ApplicationRow | undefined> {
  const rows = await db.applications.toArray();
  let best: ApplicationRow | undefined;
  for (const row of rows) {
    if (row.url !== url) continue;
    if (!best || (row.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = row;
  }
  return best;
}

/** Existing row for a company/role pair, used to keep auto-logging idempotent. */
export async function findApplication(
  company: string,
  role: string,
): Promise<ApplicationRow | undefined> {
  const wantedCompany = company.trim().toLowerCase();
  const wantedRole = role.trim().toLowerCase();
  const rows = await db.applications.where('company').equalsIgnoreCase(company).toArray();
  return rows.find(
    (row) =>
      row.company.trim().toLowerCase() === wantedCompany &&
      row.role.trim().toLowerCase() === wantedRole,
  );
}

export interface ApplicationPage {
  rows: ApplicationRow[];
  /** Total matches before `limit`/`offset` were applied. */
  total: number;
}

/**
 * Filtered, sorted, paginated tracker rows (SEC 6.7 quick filters). Sorted newest-activity first:
 * `appliedAt` when the row has one, otherwise `updatedAt` — so drafts stay visible at the top.
 */
export async function listApplications(query: TrackerQuery = {}): Promise<ApplicationPage> {
  const status = query.status ?? null;
  const ats = query.ats ?? null;
  const profileId = query.profileId ?? null;
  const from = query.from ?? null;
  const to = query.to ?? null;
  const search = query.search ? query.search.trim().toLowerCase() : null;

  // Narrow with the most selective available index before falling back to a table scan.
  let rows: ApplicationRow[];
  if (profileId !== null && status !== null) {
    rows = await db.applications.where('[profileId+status]').equals([profileId, status]).toArray();
  } else if (status !== null) {
    rows = await db.applications.where('status').equals(status).toArray();
  } else if (profileId !== null) {
    rows = await db.applications.where('profileId').equals(profileId).toArray();
  } else if (ats !== null) {
    rows = await db.applications.where('ats').equals(ats).toArray();
  } else {
    rows = await db.applications.toArray();
  }

  const matches = rows.filter((row) => {
    if (ats !== null && row.ats !== ats) return false;
    const at = row.appliedAt ?? row.updatedAt ?? 0;
    if (from !== null && at < from) return false;
    if (to !== null && at > to) return false;
    if (search !== null) {
      const haystack = `${row.company} ${row.role} ${row.notes}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  matches.sort((a, b) => {
    const aAt = a.appliedAt ?? a.updatedAt ?? 0;
    const bAt = b.appliedAt ?? b.updatedAt ?? 0;
    return bAt - aAt;
  });

  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit === undefined ? matches.length : Math.max(0, query.limit);
  return { rows: matches.slice(offset, offset + limit), total: matches.length };
}

/** Rows in one lifecycle state — the board view's lane query. */
export async function listApplicationsByStatus(status: AppStatus): Promise<ApplicationRow[]> {
  return db.applications.where('status').equals(status).toArray();
}

/** Rows changed since the last successful push — Phase-2 sync only (INV-3: optional). */
export async function listUnsyncedApplications(): Promise<ApplicationRow[]> {
  const rows = await db.applications.toArray();
  return rows.filter((row) => {
    const syncedAt = row.syncedAt ?? null;
    if (syncedAt === null) return true;
    return (row.updatedAt ?? 0) > syncedAt;
  });
}

/* ------------------------------------------------------------------------------------------------
 * parseCache
 * ---------------------------------------------------------------------------------------------- */

export async function getParseCache(resumeId: string): Promise<ParseCacheRecord | undefined> {
  return db.parseCache.get(resumeId);
}

export async function putParseCache(record: ParseCacheRecord): Promise<string> {
  return db.parseCache.put(record);
}

export async function deleteParseCache(resumeId: string): Promise<void> {
  await db.parseCache.delete(resumeId);
}

export async function clearParseCache(): Promise<void> {
  await db.parseCache.clear();
}

/* ------------------------------------------------------------------------------------------------
 * answerBank (SEC 5.7 / F-17) — offline reads, no gesture, no key lease
 * ---------------------------------------------------------------------------------------------- */

export async function putAnswer(record: AnswerRecord): Promise<string> {
  return db.answerBank.put(record);
}

export async function getAnswer(id: string): Promise<AnswerRecord | undefined> {
  return db.answerBank.get(id);
}

export async function deleteAnswer(id: string): Promise<void> {
  await db.answerBank.delete(id);
}

export async function countAnswers(): Promise<number> {
  return db.answerBank.count();
}

/** Exact normalized-question hit, honouring scope: this profile first, then global (SEC 5.7). */
export async function findAnswerByQNorm(
  qNorm: string,
  profileId: string | null,
): Promise<AnswerRecord | undefined> {
  const candidates = await db.answerBank.where('qNorm').equals(qNorm).toArray();
  if (candidates.length === 0) return undefined;
  return (
    candidates.find((record) => record.scope === 'profile' && record.profileId === profileId) ??
    candidates.find((record) => record.scope === 'global')
  );
}

/**
 * Every answer a lookup for `profileId` is allowed to consider: that profile's own answers plus
 * all global ones. This is the candidate set the similarity scorer runs over.
 */
export async function listAnswersForLookup(profileId: string | null): Promise<AnswerRecord[]> {
  const [scoped, global] = await Promise.all([
    profileId === null
      ? Promise.resolve<AnswerRecord[]>([])
      : db.answerBank.where('[scope+profileId]').equals(['profile', profileId]).toArray(),
    db.answerBank.where('scope').equals('global' satisfies AnswerScope).toArray(),
  ]);
  return [...scoped, ...global];
}

export interface AnswerPage {
  records: AnswerRecord[];
  total: number;
}

/** Options → Answer Bank list: substring search over the raw question and the answer text. */
export async function listAnswers(options: {
  search?: string | undefined;
  profileId?: string | null | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} = {}): Promise<AnswerPage> {
  const all = await db.answerBank.toArray();
  const search = options.search ? options.search.trim().toLowerCase() : null;
  const profileId = options.profileId;

  const matches = all.filter((record) => {
    if (profileId !== undefined && profileId !== null) {
      if (record.scope === 'profile' && record.profileId !== profileId) return false;
    }
    if (search === null) return true;
    return `${record.qRaw} ${record.qNorm} ${record.answer}`.toLowerCase().includes(search);
  });

  matches.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt);

  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit === undefined ? matches.length : Math.max(0, options.limit);
  return { records: matches.slice(offset, offset + limit), total: matches.length };
}

/** Reuse bookkeeping: `timesUsed++` and `lastUsedAt = now`. Returns the updated row. */
export async function touchAnswer(
  id: string,
  now: number = Date.now(),
): Promise<AnswerRecord | undefined> {
  return db.transaction('rw', db.answerBank, async () => {
    const record = await db.answerBank.get(id);
    if (!record) return undefined;
    const next: AnswerRecord = { ...record, timesUsed: record.timesUsed + 1, lastUsedAt: now };
    await db.answerBank.put(next);
    return next;
  });
}
