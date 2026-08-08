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

    this.resumes = this.table<ResumeRecord, string>(DB_TABLES.resumes);
    this.applications = this.table<ApplicationRow, string>(DB_TABLES.applications);
    this.parseCache = this.table<ParseCacheRecord, string>(DB_TABLES.parseCache);
    this.answerBank = this.table<AnswerRecord, string>(DB_TABLES.answerBank);
  }
}

export const db = new NextMoveDatabase();

export async function openDatabase(): Promise<boolean> {
  try {
    if (!db.isOpen()) await db.open();
    return true;
  } catch (error) {
    log.error('failed to open IndexedDB', error);
    return false;
  }
}

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

export async function deleteDatabase(): Promise<void> {
  await db.delete();
  log.warn('deleted the jobfill database');
}

export async function putResume(record: ResumeRecord): Promise<string> {
  return db.resumes.put(record);
}

export async function getResume(id: string): Promise<ResumeRecord | undefined> {
  return db.resumes.get(id);
}

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

export async function getDefaultResume(profileId: string | null): Promise<ResumeRecord | undefined> {
  const candidates = await listResumes(profileId);
  return (
    candidates.find((resume) => resume.isDefault && resume.profileId === profileId) ??
    candidates.find((resume) => resume.isDefault) ??
    candidates[0]
  );
}

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

export async function findApplicationByUrl(url: string): Promise<ApplicationRow | undefined> {
  const rows = await db.applications.toArray();
  let best: ApplicationRow | undefined;
  for (const row of rows) {
    if (row.url !== url) continue;
    if (!best || (row.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = row;
  }
  return best;
}

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
  total: number;
}

export async function listApplications(query: TrackerQuery = {}): Promise<ApplicationPage> {
  const status = query.status ?? null;
  const ats = query.ats ?? null;
  const profileId = query.profileId ?? null;
  const from = query.from ?? null;
  const to = query.to ?? null;
  const search = query.search ? query.search.trim().toLowerCase() : null;

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

export async function listApplicationsByStatus(status: AppStatus): Promise<ApplicationRow[]> {
  return db.applications.where('status').equals(status).toArray();
}

export async function listUnsyncedApplications(): Promise<ApplicationRow[]> {
  const rows = await db.applications.toArray();
  return rows.filter((row) => {
    const syncedAt = row.syncedAt ?? null;
    if (syncedAt === null) return true;
    return (row.updatedAt ?? 0) > syncedAt;
  });
}

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
