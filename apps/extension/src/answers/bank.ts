/**
 * answers/bank.ts — steps 2–4 of the Answer Bank (JF-001 Rev 3.0 SEC 5.7, F-17).
 *
 *   step 2  MATCH   the normalized question is scored against every banked `qNorm` with token-set
 *                   similarity (Jaccard on word sets) and a Jaro-Winkler tiebreak.
 *                   ≥ SAME_Q (0.92) ⇒ 'exact' · [SIMILAR_Q, SAME_Q) (0.75–0.92) ⇒ 'similar' ·
 *                   < SIMILAR_Q ⇒ 'miss' (treated as a new question).
 *   step 3  OFFER   `lookup()` hands the caller a ready-to-insert `AnswerHit` whose text has already
 *                   had `{company}` swapped for the employer currently being applied to.
 *   step 4  BANK    `save()` upserts whatever the user finally accepted, with provenance
 *                   (ai | ai-edited | user), the company templated back out, and usage counters bumped.
 *
 * ── INV-2 / SEC 5.7 · THE OFFLINE READ ────────────────────────────────────────────────────────────
 * `lookup()` is a FULLY OFFLINE read. It does not mint a user-gesture nonce, it does not lease a
 * Gemini key, it does not open a socket, and it must never be made to. It runs BEFORE any key is
 * leased — that is the whole point of the feature: a bank hit costs zero free-tier quota. Only the
 * user pressing "Regenerate with AI" enters the gesture-gated Gemini path (SEC 6.6 GESTURE_REQUIRED
 * deliberately does not contain ANSWERS_LOOKUP).
 *
 * ── SEC 7.4 · SYNC ────────────────────────────────────────────────────────────────────────────────
 * The answer bank is local-only and is NEVER synced (`src/sync/guard.ts` throws if a record reaches
 * a sync payload). It IS however part of the user's own profile export/import — see
 * `exportAnswerBank()` / `importAnswerBank()` below.
 */

import { jaccardTokenSet, jaroWinkler } from '@/core/similarity';
import { db } from '@/platform/db';
import { SAME_Q, SIMILAR_Q } from '@/shared/constants';
import { answerRecordSchema } from '@/shared/schema';
import type {
  AnswerHit,
  AnswerRecord,
  AnswerScope,
  AnswerSource,
} from '@/shared/types';

import { containsCompanyToken, normalizeQuestion, rehydrate, templatize } from './normalize';

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

/**
 * The Options → Answer Bank UI needs a "pin favourites" flag (SEC 5.7 management UI) and the
 * shared `AnswerRecord` (owned by the foundation agent) has no field for one. Rather than fork the
 * contract, the bank persists `pinned` as an additive optional column: Dexie stores it, the shared
 * Zod mirror simply ignores it, and structurally a `BankedAnswer` IS an `AnswerRecord`, so every
 * bus reply typed as `AnswerRecord[]` keeps type-checking.
 */
export interface BankedAnswer extends AnswerRecord {
  pinned?: boolean;
}

/** One scored bank row. `similarity` is the value the SEC 5.7 thresholds are applied to. */
export interface AnswerCandidate {
  record: BankedAnswer;
  /** Jaccard over the normalized question's word set — the primary score (SEC 5.7 step 2). */
  jaccard: number;
  /** Jaro-Winkler over the same two strings — ordering tiebreak only, never thresholded. */
  jaroWinkler: number;
  /** Thresholded score. Equal to `jaccard`; kept separate so callers never depend on that. */
  similarity: number;
}

export type AnswerLookupKind = 'exact' | 'similar' | 'miss';

export interface AnswerLookupOptions {
  profileId: string | null;
  company: string | null;
  /** Pre-computed key, when the caller already normalized the question. */
  qNorm?: string;
  /** How many ranked candidates to return alongside the winner. Default 5. */
  limit?: number;
}

export type AnswerLookupResult =
  | { kind: 'exact'; qNorm: string; hit: AnswerHit; candidates: AnswerCandidate[] }
  | { kind: 'similar'; qNorm: string; hit: AnswerHit; candidates: AnswerCandidate[] }
  | { kind: 'miss'; qNorm: string; hit: null; candidates: AnswerCandidate[] };

export interface AnswerSaveInput {
  qRaw: string;
  answer: string;
  source: AnswerSource;
  profileId: string | null;
  /** Employer this answer was written for; its name is templated out before storage (F-17). */
  company?: string | null;
  /** Defaults to 'profile' (SEC 5.7: per-profile by default; the user may promote to 'global'). */
  scope?: AnswerScope;
  /** Update this exact record instead of matching on `qNorm` (Options → Answer Bank edit). */
  id?: string;
}

export interface AnswerListOptions {
  search?: string;
  profileId?: string | null;
  scope?: AnswerScope | null;
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const ANSWER_BANK_EXPORT_KIND = 'jobfill.answers.v1';

export interface AnswerBankExport {
  kind: typeof ANSWER_BANK_EXPORT_KIND;
  schemaVersion: number;
  exportedAt: number;
  answers: BankedAnswer[];
}

export interface AnswerImportResult {
  imported: number;
  merged: number;
  skipped: number;
}

/* ------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

const DEFAULT_CANDIDATE_LIMIT = 5;

function now(): number {
  return Date.now();
}

function newAnswerId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return `ans_${c.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `ans_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * `db.answerBank` is typed with the shared `AnswerRecord`; the bank's additive `pinned` column is
 * invisible to that type. Narrowing here is sound because `BankedAnswer` only adds an optional
 * property — it is the single place the widening happens.
 */
function asBanked(row: AnswerRecord | undefined): BankedAnswer | null {
  return row === undefined ? null : (row as BankedAnswer);
}

async function allRows(): Promise<BankedAnswer[]> {
  const rows = await db.answerBank.toArray();
  return rows as BankedAnswer[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Records this lookup is allowed to see: global answers plus this profile's own. */
function inScope(record: BankedAnswer, profileId: string | null): boolean {
  if (record.scope === 'global') return true;
  if (record.profileId === null) return true;
  return record.profileId === profileId;
}

/** A profile-scoped answer for the active profile beats a global one at equal similarity. */
function scopeRank(record: BankedAnswer, profileId: string | null): number {
  if (record.scope === 'profile' && record.profileId !== null && record.profileId === profileId) return 2;
  if (record.scope === 'global') return 1;
  return 0;
}

/**
 * SEC 5.7 step 2. Jaccard is the score the thresholds are applied to; Jaro-Winkler only breaks
 * ties between candidates that score identically on token overlap (e.g. two phrasings that share
 * the same word set but not the same word order).
 */
export function scoreQuestion(qNorm: string, candidate: string): { jaccard: number; jw: number } {
  if (qNorm === candidate) return { jaccard: 1, jw: 1 };
  if (qNorm.length === 0 || candidate.length === 0) return { jaccard: 0, jw: 0 };
  return {
    jaccard: clamp01(jaccardTokenSet(qNorm, candidate)),
    jw: clamp01(jaroWinkler(qNorm, candidate)),
  };
}

function compareCandidates(
  a: AnswerCandidate,
  b: AnswerCandidate,
  profileId: string | null,
): number {
  if (b.similarity !== a.similarity) return b.similarity - a.similarity;
  if (b.jaroWinkler !== a.jaroWinkler) return b.jaroWinkler - a.jaroWinkler;
  const scope = scopeRank(b.record, profileId) - scopeRank(a.record, profileId);
  if (scope !== 0) return scope;
  const pinned = (b.record.pinned === true ? 1 : 0) - (a.record.pinned === true ? 1 : 0);
  if (pinned !== 0) return pinned;
  if (b.record.timesUsed !== a.record.timesUsed) return b.record.timesUsed - a.record.timesUsed;
  return b.record.lastUsedAt - a.record.lastUsedAt;
}

function bankKey(record: Pick<BankedAnswer, 'qNorm' | 'scope' | 'profileId'>): string {
  return `${record.scope}|${record.profileId ?? ''}|${record.qNorm}`;
}

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 steps 2–3 — match & offer  (OFFLINE READ — see the file header)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Score the question against the bank and return the best offer.
 *
 * INV-2 / SEC 5.7: this is the pre-AI path. It reads IndexedDB and does string math. It does not
 * require (and must never be given) a gesture nonce, it leases no key, and it opens no socket.
 * The caller runs it FIRST; only a `miss` — or an explicit "Regenerate with AI" click — is allowed
 * to continue into `AI_GENERATE_ANSWER`.
 */
export async function lookup(qRaw: string, opts: AnswerLookupOptions): Promise<AnswerLookupResult> {
  const qNorm = opts.qNorm !== undefined && opts.qNorm.length > 0
    ? opts.qNorm
    : normalizeQuestion(qRaw, opts.company);

  const limit = opts.limit !== undefined && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_CANDIDATE_LIMIT;

  if (qNorm.length === 0) return { kind: 'miss', qNorm, hit: null, candidates: [] };

  const rows = await allRows();
  const candidates: AnswerCandidate[] = [];
  for (const record of rows) {
    if (!inScope(record, opts.profileId)) continue;
    const { jaccard, jw } = scoreQuestion(qNorm, record.qNorm);
    if (jaccard <= 0) continue;
    candidates.push({ record, jaccard, jaroWinkler: jw, similarity: jaccard });
  }
  candidates.sort((a, b) => compareCandidates(a, b, opts.profileId));

  const ranked = candidates.slice(0, limit);
  const best = candidates[0];

  if (best === undefined || best.similarity < SIMILAR_Q) {
    return { kind: 'miss', qNorm, hit: null, candidates: ranked };
  }

  const exact = best.similarity >= SAME_Q;
  const hit: AnswerHit = {
    id: best.record.id,
    // `{company}` is re-substituted for the employer we are applying to right now (SEC 5.7 step 3).
    answer: rehydrate(best.record.answer, opts.company),
    similarity: best.similarity,
    kind: exact ? 'same' : 'similar',
    record: best.record,
  };

  return exact
    ? { kind: 'exact', qNorm, hit, candidates: ranked }
    : { kind: 'similar', qNorm, hit, candidates: ranked };
}

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 step 4 — bank
 * ---------------------------------------------------------------------------------------------- */

/**
 * Upsert whatever the user finally accepted — generated, edited, or typed from scratch — with its
 * provenance, and bump the usage counters (SEC 5.7 step 4).
 *
 * The company name is templated out of the answer before it is written, so the row on disk cannot
 * leak the wrong employer on reuse (F-17).
 */
export async function save(input: AnswerSaveInput): Promise<{ record: BankedAnswer; created: boolean }> {
  const answerText = (input.answer ?? '').trim();
  if (answerText.length === 0) {
    throw new Error('answers/bank: refusing to bank an empty answer');
  }
  const qRaw = (input.qRaw ?? '').trim();
  if (qRaw.length === 0) {
    throw new Error('answers/bank: refusing to bank an answer with no question');
  }

  const company = input.company ?? null;
  const scope: AnswerScope = input.scope ?? 'profile';
  const profileId = scope === 'global' ? null : input.profileId;
  const qNorm = normalizeQuestion(qRaw, company);
  const stored = templatize(answerText, company);
  const template = containsCompanyToken(stored);
  const at = now();

  const rows = await allRows();

  let existing: BankedAnswer | null = null;
  if (input.id !== undefined && input.id.length > 0) {
    existing = rows.find((r) => r.id === input.id) ?? null;
  }
  if (existing === null) {
    existing =
      rows.find((r) => r.qNorm === qNorm && r.scope === scope && r.profileId === profileId) ?? null;
  }

  if (existing !== null) {
    const updated: BankedAnswer = {
      ...existing,
      qRaw,
      qNorm,
      answer: stored,
      template,
      source: input.source,
      scope,
      profileId,
      timesUsed: existing.timesUsed + 1,
      lastUsedAt: at,
    };
    await db.answerBank.put(updated);
    return { record: updated, created: false };
  }

  const record: BankedAnswer = {
    id: newAnswerId(),
    qNorm,
    qRaw,
    answer: stored,
    template,
    source: input.source,
    scope,
    profileId,
    timesUsed: 1,
    lastUsedAt: at,
    createdAt: at,
  };
  await db.answerBank.put(record);
  return { record, created: true };
}

/**
 * Record that a banked answer was actually inserted into a form ("Use saved"). Kept separate from
 * `save()` so that merely *looking* at an offer never inflates the "used on N applications" trace.
 */
export async function markUsed(id: string): Promise<BankedAnswer | null> {
  const record = asBanked(await db.answerBank.get(id));
  if (record === null) return null;
  const updated: BankedAnswer = { ...record, timesUsed: record.timesUsed + 1, lastUsedAt: now() };
  await db.answerBank.put(updated);
  return updated;
}

/* ------------------------------------------------------------------------------------------------
 * Options → Answer Bank management surface
 * ---------------------------------------------------------------------------------------------- */

export async function get(id: string): Promise<BankedAnswer | null> {
  return asBanked(await db.answerBank.get(id));
}

/** Pinned first, then most recently used. `total` is the count before pagination. */
export async function list(opts: AnswerListOptions = {}): Promise<{ records: BankedAnswer[]; total: number }> {
  const rows = await allRows();
  const term = (opts.search ?? '').trim().toLowerCase();

  const filtered = rows.filter((record) => {
    if (opts.pinnedOnly === true && record.pinned !== true) return false;
    if (opts.scope !== undefined && opts.scope !== null && record.scope !== opts.scope) return false;
    if (opts.profileId !== undefined && opts.profileId !== null && !inScope(record, opts.profileId)) {
      return false;
    }
    if (term.length === 0) return true;
    return (
      record.qRaw.toLowerCase().includes(term) ||
      record.qNorm.toLowerCase().includes(term) ||
      record.answer.toLowerCase().includes(term)
    );
  });

  filtered.sort((a, b) => {
    const pinned = (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0);
    if (pinned !== 0) return pinned;
    if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return a.qNorm.localeCompare(b.qNorm);
  });

  const offset = opts.offset !== undefined && opts.offset > 0 ? Math.floor(opts.offset) : 0;
  const limit = opts.limit !== undefined && opts.limit > 0 ? Math.floor(opts.limit) : filtered.length;
  return { records: filtered.slice(offset, offset + limit), total: filtered.length };
}

/** Free-text search across question and answer text. */
export async function search(
  term: string,
  opts: Omit<AnswerListOptions, 'search'> = {},
): Promise<{ records: BankedAnswer[]; total: number }> {
  return list({ ...opts, search: term });
}

export async function remove(id: string): Promise<boolean> {
  const record = await db.answerBank.get(id);
  if (record === undefined) return false;
  await db.answerBank.delete(id);
  return true;
}

/** Pin / unpin a favourite (SEC 5.7 management UI). */
export async function pin(id: string, pinned = true): Promise<BankedAnswer | null> {
  const record = asBanked(await db.answerBank.get(id));
  if (record === null) return null;
  const updated: BankedAnswer = { ...record, pinned };
  await db.answerBank.put(updated);
  return updated;
}

/** Promote a per-profile answer to `global`, or demote it back onto a profile. */
export async function setScope(
  id: string,
  scope: AnswerScope,
  profileId: string | null = null,
): Promise<BankedAnswer | null> {
  const record = asBanked(await db.answerBank.get(id));
  if (record === null) return null;
  const updated: BankedAnswer = {
    ...record,
    scope,
    profileId: scope === 'global' ? null : profileId,
  };
  await db.answerBank.put(updated);
  return updated;
}

/** Privacy → wipe everything. Local-only data, so this is genuinely destructive and final. */
export async function clear(): Promise<number> {
  const rows = await db.answerBank.toArray();
  await db.answerBank.clear();
  return rows.length;
}

/* ------------------------------------------------------------------------------------------------
 * Export / import
 *
 * SEC 7.4: the answer bank is never SYNCED — but it is part of the user's own profile
 * export/import, so a device migration keeps the voice the user has built up (SEC 5.7 storage row:
 * "local-only, included in profile export"). These two functions are what the Options
 * "export everything / import" screens must call.
 * ---------------------------------------------------------------------------------------------- */

function coerceAnswer(value: unknown): BankedAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  const qRaw = typeof v.qRaw === 'string' ? v.qRaw : '';
  const answer = typeof v.answer === 'string' ? v.answer : '';
  if (answer.trim().length === 0) return null;

  const scope: AnswerScope = v.scope === 'global' ? 'global' : 'profile';
  const source: AnswerSource =
    v.source === 'ai' || v.source === 'ai-edited' || v.source === 'user' ? v.source : 'user';
  const createdAt = typeof v.createdAt === 'number' && v.createdAt >= 0 ? Math.floor(v.createdAt) : 0;

  const candidate = {
    id: typeof v.id === 'string' && v.id.length > 0 ? v.id : newAnswerId(),
    qNorm: typeof v.qNorm === 'string' && v.qNorm.length > 0 ? v.qNorm : normalizeQuestion(qRaw, null),
    qRaw,
    answer,
    template: typeof v.template === 'boolean' ? v.template : containsCompanyToken(answer),
    source,
    scope,
    profileId: scope === 'global' ? null : typeof v.profileId === 'string' ? v.profileId : null,
    timesUsed: typeof v.timesUsed === 'number' && v.timesUsed >= 0 ? Math.floor(v.timesUsed) : 0,
    lastUsedAt: typeof v.lastUsedAt === 'number' && v.lastUsedAt >= 0 ? Math.floor(v.lastUsedAt) : createdAt,
    createdAt,
  };

  const parsed = answerRecordSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const record: BankedAnswer = parsed.data;
  if (v.pinned === true) record.pinned = true;
  return record;
}

function mergeAnswers(mine: BankedAnswer, theirs: BankedAnswer): BankedAnswer {
  const newer = theirs.lastUsedAt > mine.lastUsedAt ? theirs : mine;
  return {
    ...mine,
    qRaw: newer.qRaw,
    qNorm: newer.qNorm,
    answer: newer.answer,
    template: newer.template,
    source: newer.source,
    timesUsed: Math.max(mine.timesUsed, theirs.timesUsed),
    lastUsedAt: Math.max(mine.lastUsedAt, theirs.lastUsedAt),
    createdAt: Math.min(mine.createdAt || theirs.createdAt, theirs.createdAt || mine.createdAt),
    pinned: mine.pinned === true || theirs.pinned === true ? true : undefined,
  };
}

/** The structured backup payload (also embedded in the full profile export). */
export async function exportAnswerBank(): Promise<AnswerBankExport> {
  const rows = await allRows();
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return {
    kind: ANSWER_BANK_EXPORT_KIND,
    schemaVersion: 1,
    exportedAt: now(),
    answers: rows,
  };
}

/** The same payload, pretty-printed for a download. */
export async function exportAnswerBankJson(): Promise<string> {
  return JSON.stringify(await exportAnswerBank(), null, 2);
}

/**
 * Restore or merge a previously exported bank. Accepts the `AnswerBankExport` envelope, a bare
 * array of records, or a full profile export that carries an `answers` array. Invalid rows are
 * skipped rather than failing the whole import — a partially corrupt backup is still worth most of
 * its contents.
 */
export async function importAnswerBank(input: string | unknown): Promise<AnswerImportResult> {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as unknown;
    } catch {
      return { imported: 0, merged: 0, skipped: 0 };
    }
  }

  let incoming: unknown[] = [];
  if (Array.isArray(raw)) {
    incoming = raw;
  } else if (typeof raw === 'object' && raw !== null) {
    const envelope = raw as Record<string, unknown>;
    const answers = envelope.answers ?? envelope.answerBank;
    if (Array.isArray(answers)) incoming = answers;
  }
  if (incoming.length === 0) return { imported: 0, merged: 0, skipped: 0 };

  const existing = await allRows();
  const byId = new Map<string, BankedAnswer>();
  const byKey = new Map<string, BankedAnswer>();
  for (const record of existing) {
    byId.set(record.id, record);
    byKey.set(bankKey(record), record);
  }

  const writes: BankedAnswer[] = [];
  let imported = 0;
  let merged = 0;
  let skipped = 0;

  for (const value of incoming) {
    const record = coerceAnswer(value);
    if (record === null) {
      skipped += 1;
      continue;
    }
    const target = byId.get(record.id) ?? byKey.get(bankKey(record)) ?? null;
    if (target === null) {
      writes.push(record);
      byId.set(record.id, record);
      byKey.set(bankKey(record), record);
      imported += 1;
      continue;
    }
    const next = mergeAnswers(target, record);
    writes.push(next);
    byId.set(next.id, next);
    byKey.set(bankKey(next), next);
    merged += 1;
  }

  if (writes.length > 0) await db.answerBank.bulkPut(writes);
  return { imported, merged, skipped };
}
