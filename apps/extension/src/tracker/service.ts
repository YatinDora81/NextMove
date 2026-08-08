/**
 * tracker/service.ts — the Application Tracker (JF-001 Rev 3.0 SEC 6.7, F-12).
 *
 * Everything the tracker dashboard, the popup mini-tracker and the `TRACKER_*` bus handlers sit on
 * top of, stored in the Dexie `applications` table (SEC 7.1).
 *
 * Lifecycle (SEC 6.7 "Status flip"):
 *
 *   logFill()      first fill on a posting creates the row as `draft`
 *   markApplied()  flips `draft → applied` ONLY because a confirmation was OBSERVED
 *   setStatus()    the user moves the card between kanban lanes by hand
 *
 * ── INV-1 ────────────────────────────────────────────────────────────────────────────────────────
 * A row becomes `applied` because JobFill *saw* the user's own submission land, never because
 * JobFill submitted anything. `markApplied()` refuses a `ConfirmationSignal` that did not confirm;
 * the observation itself is produced by `./detectors`, which cannot touch the page at all.
 *
 * ── INV-3 ────────────────────────────────────────────────────────────────────────────────────────
 * Local-first. Every function here works with the NextMove backend switched off. `syncedAt` is
 * written by the Phase-2 sync client (`src/sync/**`) and is simply `null` until then.
 *
 * Every status transition appends `{ at, to }` to `history[]` — that array is the audit trail the
 * kanban board and the days-to-response statistic are both derived from.
 */

import { db } from '@/platform/db';
import { applicationRowSchema } from '@/shared/schema';
import type {
  AppStatus,
  ApplicationLogInput,
  ApplicationPatch,
  ApplicationRow,
  AtsId,
  FillReport,
  JobContext,
  TrackerQuery,
  TrackerStats,
} from '@/shared/types';

import type { ConfirmationSignal } from './detectors';

/* ------------------------------------------------------------------------------------------------
 * Constants & types
 * ---------------------------------------------------------------------------------------------- */

const ATS_IDS: readonly AtsId[] = [
  'greenhouse',
  'lever',
  'workday',
  'icims',
  'ashby',
  'smartrecruiters',
  'taleo',
  'generic',
];

const APP_STATUSES: readonly AppStatus[] = [
  'draft',
  'applied',
  'interview',
  'offer',
  'rejected',
  'ghosted',
];

/**
 * SEC 6.7 defines response rate as "% of applied that reached interview", and `TrackerStats`
 * documents it as "reached interview or beyond" — so a rejection, while colloquially a response,
 * is deliberately NOT counted here. The same set drives median days-to-response, so the two
 * numbers on the stats strip always describe the same event.
 */
export const RESPONSE_STATUSES: readonly AppStatus[] = ['interview', 'offer'];

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;

export type TrackerSortField = 'date' | 'company' | 'role' | 'status' | 'ats' | 'fillScore';

export interface TrackerSort {
  field: TrackerSortField;
  direction: 'asc' | 'desc';
}

/** Most-recent-first, which is what a job seeker wants to see when the dashboard opens. */
export const DEFAULT_TRACKER_SORT: TrackerSort = { field: 'date', direction: 'desc' };

export const TRACKER_EXPORT_KIND = 'jobfill.tracker.v1';

export interface TrackerExport {
  kind: typeof TRACKER_EXPORT_KIND;
  schemaVersion: number;
  exportedAt: number;
  applications: ApplicationRow[];
}

export interface TrackerImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

export interface TrackerLogResult {
  row: ApplicationRow;
  created: boolean;
}

export interface TrackerQueryResult {
  rows: ApplicationRow[];
  total: number;
  stats: TrackerStats;
}

/* ------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

function now(): number {
  return Date.now();
}

function newApplicationId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return `app_${c.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `app_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function toAtsId(value: string | null | undefined): AtsId {
  const candidate = (value ?? '').toLowerCase();
  return ATS_IDS.find((id) => id === candidate) ?? 'generic';
}

function toStatus(value: unknown): AppStatus {
  return APP_STATUSES.find((status) => status === value) ?? 'draft';
}

/** Tracking/campaign parameters that differ per visit and would defeat de-duplication. */
const TRACKING_PARAM = /^(utm_|gh_|mc_|_ga$|ref$|source$|src$|fbclid$|gclid$|msclkid$|trk$|trackingId$|lever-source|iis$|iisn$)/i;

/**
 * Stable identity for a posting. Two fills of the same application must land on the same row, so
 * the fragment and the campaign parameters are dropped and the host is lowercased.
 */
export function normalizeApplicationUrl(raw: string): string {
  const value = (raw ?? '').trim();
  if (value.length === 0) return '';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value.toLowerCase();
  }
  const kept = new URLSearchParams();
  const entries = Array.from(parsed.searchParams.entries());
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  for (const entry of entries) {
    const key = entry[0];
    if (TRACKING_PARAM.test(key)) continue;
    kept.append(key, entry[1]);
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
  const search = kept.toString();
  return `${parsed.protocol}//${host}${parsed.port.length > 0 ? `:${parsed.port}` : ''}${path}${
    search.length > 0 ? `?${search}` : ''
  }`;
}

function stripUndefined<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** The date a row is sorted and filtered by: when it was applied, else when it was created. */
export function rowDate(row: ApplicationRow): number {
  if (row.appliedAt !== null && row.appliedAt > 0) return row.appliedAt;
  const first = row.history[0];
  if (first !== undefined) return first.at;
  return row.updatedAt ?? 0;
}

/** 0–1. `filled / total` for the run that produced the row. */
export function fillScore(row: ApplicationRow): number {
  const total = row.fillStats.total;
  return total > 0 ? row.fillStats.filled / total : 0;
}

/** Earliest moment the employer responded, per `RESPONSE_STATUSES`; null when they never did. */
export function firstResponseAt(row: ApplicationRow): number | null {
  let earliest: number | null = null;
  for (const entry of row.history) {
    if (!RESPONSE_STATUSES.includes(entry.to)) continue;
    if (earliest === null || entry.at < earliest) earliest = entry.at;
  }
  if (earliest !== null) return earliest;
  // A row imported without a full history still counts if it is sitting in a response state.
  if (RESPONSE_STATUSES.includes(row.status)) return row.updatedAt ?? null;
  return null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/* ------------------------------------------------------------------------------------------------
 * Writes
 * ---------------------------------------------------------------------------------------------- */

async function findExisting(
  url: string,
  profileId: string,
): Promise<ApplicationRow | null> {
  const key = normalizeApplicationUrl(url);
  if (key.length === 0) return null;
  const rows = await db.applications.toArray();
  return (
    rows.find(
      (row) => row.profileId === profileId && normalizeApplicationUrl(row.url) === key,
    ) ?? null
  );
}

function betterStats(
  current: { filled: number; total: number },
  incoming: { filled: number; total: number } | undefined,
): { filled: number; total: number } {
  if (incoming === undefined) return current;
  if (incoming.filled > current.filled) return incoming;
  if (incoming.filled === current.filled && incoming.total > current.total) return incoming;
  return current;
}

/**
 * Create (or refresh) the tracker row for a posting. SEC 6.7: the row is created as `draft` on the
 * first fill — being present in a form is not the same as having applied.
 */
export async function logApplication(input: ApplicationLogInput): Promise<TrackerLogResult> {
  const at = now();
  const company = (input.company ?? '').trim();
  const role = (input.role ?? '').trim();
  const existing = await findExisting(input.url, input.profileId);

  if (existing !== null) {
    const merged: ApplicationRow = {
      ...existing,
      // Auto-capture may improve on a re-fill (a lazily rendered header, a better JSON-LD block),
      // but a value the user edited by hand is never overwritten.
      company: existing.company.length > 0 ? existing.company : company,
      role: existing.role.length > 0 ? existing.role : role,
      url: input.url.length > 0 ? input.url : existing.url,
      ats: input.ats !== 'generic' ? input.ats : existing.ats,
      fillStats: betterStats(existing.fillStats, input.fillStats),
      notes: input.notes !== undefined && input.notes.length > 0 ? input.notes : existing.notes,
      updatedAt: at,
    };
    await db.applications.put(merged);
    return { row: merged, created: false };
  }

  const status = input.status ?? 'draft';
  const row: ApplicationRow = {
    id: newApplicationId(),
    company,
    role,
    url: input.url,
    ats: input.ats,
    profileId: input.profileId,
    status,
    appliedAt: status === 'draft' ? null : at,
    fillStats: input.fillStats ?? { filled: 0, total: 0 },
    notes: input.notes ?? '',
    history: [{ at, to: status }],
    updatedAt: at,
    syncedAt: null,
  };
  await db.applications.put(row);
  return { row, created: true };
}

/**
 * F-12 entry point: called from the `FILL_REPORT` handler once a fill run finishes.
 *
 * INV-1: a finished fill is NOT an application. The row opens as `draft` and only
 * `markApplied()` — driven by an observed confirmation — can promote it.
 */
export async function logFill(
  report: FillReport,
  jobCtx: JobContext | null,
  profileId: string,
): Promise<TrackerLogResult> {
  const total =
    report.perField.length > 0
      ? report.perField.length
      : report.filled + report.suggested + report.skipped + report.errors;

  return logApplication({
    company: jobCtx?.company ?? '',
    role: jobCtx?.title ?? '',
    url: (jobCtx?.url ?? '').length > 0 ? (jobCtx?.url ?? report.url) : report.url,
    ats: toAtsId(report.atsId),
    profileId,
    status: 'draft',
    fillStats: { filled: report.filled, total },
  });
}

async function transition(row: ApplicationRow, to: AppStatus, at: number): Promise<ApplicationRow> {
  const next: ApplicationRow = {
    ...row,
    status: to,
    // `appliedAt` is stamped once, the first time the row leaves `draft`, and never re-stamped —
    // days-to-response is measured from it.
    appliedAt: to === 'draft' ? row.appliedAt : (row.appliedAt ?? at),
    history: [...row.history, { at, to }],
    updatedAt: at,
  };
  await db.applications.put(next);
  return next;
}

/**
 * SEC 6.7 "Status flip". Promote a `draft` row to `applied`.
 *
 * INV-1: the flip is caused by OBSERVATION, never by JobFill submitting anything. When the
 * PageObserver supplies the `ConfirmationSignal` from `./detectors`, a signal that did not confirm
 * is refused outright — the row stays `draft`. Calling this with no signal is the manual path
 * (the user ticking "I applied" in the dashboard), which is an observation of the user's own
 * statement rather than of the page.
 *
 * Returns `null` when the row does not exist or the flip was refused; returns the row unchanged
 * when it has already moved past `draft` (status is never walked backwards).
 */
export async function markApplied(
  id: string,
  signal?: ConfirmationSignal | null,
): Promise<ApplicationRow | null> {
  if (signal !== undefined && signal !== null && !signal.confirmed) return null;

  const row = await db.applications.get(id);
  if (row === undefined) return null;
  if (row.status !== 'draft') return row;

  return transition(row, 'applied', now());
}

/** Move a row to any status (kanban drag, row action). Appends to `history[]`. */
export async function setStatus(
  id: string,
  to: AppStatus,
  at: number = now(),
): Promise<ApplicationRow | null> {
  const row = await db.applications.get(id);
  if (row === undefined) return null;
  if (row.status === to) return row;
  return transition(row, to, at);
}

/**
 * Patch a row. `history` is managed by this module and is ignored if supplied; a `status` change in
 * the patch is routed through the same transition path as `setStatus`, so the audit trail can never
 * be bypassed by an editor screen.
 */
export async function update(id: string, patch: ApplicationPatch): Promise<ApplicationRow | null> {
  const row = await db.applications.get(id);
  if (row === undefined) return null;

  const at = now();
  const fields = stripUndefined(patch);
  const nextStatus = fields.status;
  delete fields.status;
  delete fields.history;

  let next: ApplicationRow = { ...row, ...fields, updatedAt: at };
  if (nextStatus !== undefined && nextStatus !== row.status) {
    next = {
      ...next,
      status: nextStatus,
      appliedAt: nextStatus === 'draft' ? next.appliedAt : (next.appliedAt ?? at),
      history: [...row.history, { at, to: nextStatus }],
    };
  }

  await db.applications.put(next);
  return next;
}

export async function remove(id: string): Promise<boolean> {
  const row = await db.applications.get(id);
  if (row === undefined) return false;
  await db.applications.delete(id);
  return true;
}

/** Privacy → wipe everything. Local data, so this is final. */
export async function clear(): Promise<number> {
  const rows = await db.applications.toArray();
  await db.applications.clear();
  return rows.length;
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------------- */

export async function get(id: string): Promise<ApplicationRow | null> {
  return (await db.applications.get(id)) ?? null;
}

export async function getAll(): Promise<ApplicationRow[]> {
  return db.applications.toArray();
}

/** Popup mini-tracker (SEC 6.7): the last N applications, most recent first. */
export async function recent(limit = 3): Promise<ApplicationRow[]> {
  const rows = await db.applications.toArray();
  rows.sort((a, b) => rowDate(b) - rowDate(a));
  return rows.slice(0, Math.max(0, limit));
}

function matchesQuery(row: ApplicationRow, q: TrackerQuery, term: string): boolean {
  if (q.status !== undefined && q.status !== null && row.status !== q.status) return false;
  if (q.ats !== undefined && q.ats !== null && row.ats !== q.ats) return false;
  if (q.profileId !== undefined && q.profileId !== null && row.profileId !== q.profileId) return false;

  const date = rowDate(row);
  if (q.from !== undefined && q.from !== null && date < q.from) return false;
  if (q.to !== undefined && q.to !== null && date > q.to) return false;

  if (term.length === 0) return true;
  return (
    row.company.toLowerCase().includes(term) ||
    row.role.toLowerCase().includes(term) ||
    row.url.toLowerCase().includes(term) ||
    row.notes.toLowerCase().includes(term)
  );
}

/** Stable ordering for the dashboard table. Ties always fall back to the date, then the id. */
export function sortRows(rows: ApplicationRow[], sort: TrackerSort = DEFAULT_TRACKER_SORT): ApplicationRow[] {
  const dir = sort.direction === 'asc' ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case 'company':
        cmp = a.company.localeCompare(b.company);
        break;
      case 'role':
        cmp = a.role.localeCompare(b.role);
        break;
      case 'status':
        cmp = APP_STATUSES.indexOf(a.status) - APP_STATUSES.indexOf(b.status);
        break;
      case 'ats':
        cmp = a.ats.localeCompare(b.ats);
        break;
      case 'fillScore':
        cmp = fillScore(a) - fillScore(b);
        break;
      case 'date':
      default:
        cmp = rowDate(a) - rowDate(b);
        break;
    }
    if (cmp !== 0) return cmp * dir;
    const byDate = rowDate(a) - rowDate(b);
    if (byDate !== 0) return byDate * dir;
    return a.id.localeCompare(b.id);
  });
  return sorted;
}

/**
 * The dashboard query (SEC 6.7 quick filters: status, ATS, date range, profile, plus free text).
 *
 * `total` is the number of matching rows BEFORE pagination. `stats` is deliberately computed over
 * the profile-scoped set rather than the fully filtered one: a strip that reads "applied this week:
 * 0" purely because the user clicked the "Interview" filter would be actively misleading.
 */
export async function query(
  q: TrackerQuery = {},
  sort: TrackerSort = DEFAULT_TRACKER_SORT,
): Promise<TrackerQueryResult> {
  const all = await db.applications.toArray();
  const term = (q.search ?? '').trim().toLowerCase();

  const scoped =
    q.profileId !== undefined && q.profileId !== null
      ? all.filter((row) => row.profileId === q.profileId)
      : all;

  const matched = all.filter((row) => matchesQuery(row, q, term));
  const sorted = sortRows(matched, sort);

  const offset = q.offset !== undefined && q.offset > 0 ? Math.floor(q.offset) : 0;
  const limit = q.limit !== undefined && q.limit > 0 ? Math.floor(q.limit) : sorted.length;

  return {
    rows: sorted.slice(offset, offset + limit),
    total: matched.length,
    stats: computeStats(scoped, now()),
  };
}

/** SEC 6.7 stats strip, computed over a set of rows. Exported so the UI can recompute locally. */
export function computeStats(rows: readonly ApplicationRow[], at: number = Date.now()): TrackerStats {
  let appliedThisWeek = 0;
  let activeInterviews = 0;
  let appliedTotal = 0;
  let responded = 0;
  const responseDays: number[] = [];

  for (const row of rows) {
    if (row.status === 'interview') activeInterviews += 1;

    const appliedAt = row.appliedAt;
    if (appliedAt === null || appliedAt <= 0) continue;

    appliedTotal += 1;
    // Rolling 7-day window rather than a calendar week: a counter that silently resets to zero
    // every Monday reads as data loss on a dashboard.
    if (at - appliedAt <= WEEK_MS) appliedThisWeek += 1;

    const respondedAt = firstResponseAt(row);
    if (respondedAt !== null) {
      responded += 1;
      responseDays.push(Math.max(0, (respondedAt - appliedAt) / DAY_MS));
    }
  }

  return {
    appliedThisWeek,
    total: rows.length,
    activeInterviews,
    responseRate: appliedTotal > 0 ? responded / appliedTotal : 0,
    medianDaysToResponse:
      responseDays.length > 0 ? Math.round(median(responseDays) * 10) / 10 : null,
  };
}

/** SEC 6.7 stats strip over the whole table, or over one profile. */
export async function stats(profileId?: string | null): Promise<TrackerStats> {
  const rows = await db.applications.toArray();
  const scoped =
    profileId !== undefined && profileId !== null
      ? rows.filter((row) => row.profileId === profileId)
      : rows;
  return computeStats(scoped, now());
}

/* ------------------------------------------------------------------------------------------------
 * Export / import (SEC 6.7 "One-click CSV (full) and JSON (backup/restore)")
 * ---------------------------------------------------------------------------------------------- */

const CSV_COLUMNS = [
  'id',
  'company',
  'role',
  'status',
  'ats',
  'appliedAt',
  'profileId',
  'fieldsFilled',
  'fieldsTotal',
  'fillScorePct',
  'url',
  'notes',
  'createdAt',
  'updatedAt',
  'history',
] as const;

function isoOrEmpty(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return '';
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/**
 * RFC 4180 cell. `company`, `role` and `notes` are page-derived and therefore untrusted (SEC 9.2):
 * a leading `=`/`+`/`-`/`@` is neutralised so the export cannot become a live formula when the user
 * opens it in a spreadsheet.
 */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\n\r,]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Full CSV export (SEC 6.7). Pass a `TrackerQuery` to export exactly what the table shows. */
export async function exportCsv(
  q: TrackerQuery = {},
  sort: TrackerSort = DEFAULT_TRACKER_SORT,
): Promise<string> {
  const all = await db.applications.toArray();
  const term = (q.search ?? '').trim().toLowerCase();
  const rows = sortRows(all.filter((row) => matchesQuery(row, q, term)), sort);

  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.id),
        csvCell(row.company),
        csvCell(row.role),
        csvCell(row.status),
        csvCell(row.ats),
        csvCell(isoOrEmpty(row.appliedAt)),
        csvCell(row.profileId),
        csvCell(row.fillStats.filled),
        csvCell(row.fillStats.total),
        csvCell(Math.round(fillScore(row) * 100)),
        csvCell(row.url),
        csvCell(row.notes),
        csvCell(isoOrEmpty(row.history[0]?.at ?? null)),
        csvCell(isoOrEmpty(row.updatedAt ?? null)),
        csvCell(JSON.stringify(row.history)),
      ].join(','),
    );
  }
  // CRLF per RFC 4180 — Excel is the primary consumer of this file.
  return `${lines.join('\r\n')}\r\n`;
}

/** The structured backup payload. */
export async function exportRows(): Promise<TrackerExport> {
  const applications = await db.applications.toArray();
  applications.sort((a, b) => rowDate(a) - rowDate(b));
  return {
    kind: TRACKER_EXPORT_KIND,
    schemaVersion: 1,
    exportedAt: now(),
    applications,
  };
}

/** The same payload, pretty-printed for a download (SEC 6.7 "JSON (backup/restore)"). */
export async function exportJson(): Promise<string> {
  return JSON.stringify(await exportRows(), null, 2);
}

function coerceFillStats(value: unknown): { filled: number; total: number } {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const filled = typeof record.filled === 'number' && record.filled >= 0 ? Math.floor(record.filled) : 0;
  const total = typeof record.total === 'number' && record.total >= 0 ? Math.floor(record.total) : 0;
  return { filled, total: Math.max(filled, total) };
}

function coerceHistory(value: unknown, fallback: { at: number; to: AppStatus }): Array<{ at: number; to: AppStatus }> {
  if (!Array.isArray(value)) return [fallback];
  const out: Array<{ at: number; to: AppStatus }> = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const at = typeof record.at === 'number' && record.at >= 0 ? Math.floor(record.at) : 0;
    out.push({ at, to: toStatus(record.to) });
  }
  return out.length > 0 ? out : [fallback];
}

/**
 * Coerce one untrusted row into the shape `applicationRowSchema` accepts, then validate. Coercing
 * first means a hand-edited or older backup still restores instead of being rejected wholesale;
 * anything that still fails validation is counted as skipped rather than written.
 */
function coerceRow(value: unknown): ApplicationRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  const status = toStatus(v.status);
  const updatedAt = typeof v.updatedAt === 'number' && v.updatedAt >= 0 ? Math.floor(v.updatedAt) : 0;
  const appliedAt =
    typeof v.appliedAt === 'number' && v.appliedAt >= 0 ? Math.floor(v.appliedAt) : null;

  const candidate = {
    id: typeof v.id === 'string' && v.id.length > 0 ? v.id : newApplicationId(),
    company: typeof v.company === 'string' ? v.company : '',
    role: typeof v.role === 'string' ? v.role : '',
    url: typeof v.url === 'string' ? v.url : '',
    ats: toAtsId(typeof v.ats === 'string' ? v.ats : null),
    profileId: typeof v.profileId === 'string' ? v.profileId : '',
    status,
    appliedAt: status === 'draft' ? appliedAt : (appliedAt ?? updatedAt),
    fillStats: coerceFillStats(v.fillStats),
    notes: typeof v.notes === 'string' ? v.notes : '',
    history: coerceHistory(v.history, { at: appliedAt ?? updatedAt, to: status }),
    updatedAt,
    syncedAt: typeof v.syncedAt === 'number' && v.syncedAt >= 0 ? Math.floor(v.syncedAt) : null,
  };

  const parsed = applicationRowSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Restore or merge a `exportJson()` payload. Accepts the envelope, a bare array of rows, or any
 * object carrying an `applications` array (i.e. a full profile export). Rows are merged by id and
 * the newer `updatedAt` wins, so re-importing an older backup can never roll the tracker back.
 */
export async function importJson(input: string | unknown): Promise<TrackerImportResult> {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as unknown;
    } catch {
      return { imported: 0, updated: 0, skipped: 0 };
    }
  }

  let incoming: unknown[] = [];
  if (Array.isArray(raw)) {
    incoming = raw;
  } else if (typeof raw === 'object' && raw !== null) {
    const envelope = raw as Record<string, unknown>;
    const applications = envelope.applications ?? envelope.rows;
    if (Array.isArray(applications)) incoming = applications;
  }
  if (incoming.length === 0) return { imported: 0, updated: 0, skipped: 0 };

  const existing = await db.applications.toArray();
  const byId = new Map<string, ApplicationRow>();
  for (const row of existing) byId.set(row.id, row);

  const writes: ApplicationRow[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const value of incoming) {
    const row = coerceRow(value);
    if (row === null) {
      skipped += 1;
      continue;
    }
    const current = byId.get(row.id);
    if (current === undefined) {
      writes.push(row);
      byId.set(row.id, row);
      imported += 1;
      continue;
    }
    if ((row.updatedAt ?? 0) < (current.updatedAt ?? 0)) {
      skipped += 1;
      continue;
    }
    writes.push(row);
    byId.set(row.id, row);
    updated += 1;
  }

  if (writes.length > 0) await db.applications.bulkPut(writes);
  return { imported, updated, skipped };
}
