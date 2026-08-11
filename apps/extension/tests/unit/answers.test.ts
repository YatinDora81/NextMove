/**
 * tests/unit/answers.test.ts — JF-001 Rev 3.0 SEC 11 (Unit) · SEC 5.7 / F-17 Answer Memory.
 *
 * The Answer Bank's whole value proposition is "ask once, reuse forever, at zero API cost", and
 * that only holds if four things are true:
 *
 *   NORMALIZATION.  A question reduces to a stable key with the employer's name replaced by the
 *                   literal `{company}` token, so "Why do you want to work at Acme, Inc.?" asked
 *                   by Acme and "Why do you want to work at Globex?" asked by Globex share one key.
 *
 *   BANDS.          ≥ SAME_Q (0.92) ⇒ 'exact' · [SIMILAR_Q, SAME_Q) (0.75–0.92) ⇒ 'similar' ·
 *                   below ⇒ 'miss' and the question is treated as new.
 *
 *   NO LEAKAGE.     `templatize` must strip the employer out of the stored answer, and `rehydrate`
 *                   must put the CURRENT employer back. An answer banked while applying to Acme
 *                   must physically not contain "Acme" any more, so it cannot land in a Globex
 *                   form. This is the F-17 promise and it is asserted from both directions.
 *
 *   OFFLINE.        `lookup()` runs BEFORE any key is leased. It must open no socket, mint no
 *                   gesture nonce and lease no Gemini key. Asserted behaviourally (a `fetch` spy)
 *                   and structurally (the module graph under `src/answers/` may not reach
 *                   `src/ai/`).
 *
 * Dexie cannot run under happy-dom (no IndexedDB), so `@/platform/db` is replaced with the
 * in-memory stand-in from `tests/setup.ts`. See that file's header for why.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/db', async () => ({ db: (await import('../setup')).memoryDb }));

import {
  clear,
  exportAnswerBank,
  importAnswerBank,
  list,
  lookup,
  markUsed,
  pin,
  remove,
  save,
  scoreQuestion,
  setScope,
} from '@/answers/bank';
import {
  companyAliases,
  containsCompanyToken,
  mentionsCompany,
  normalizeQuestion,
  rehydrate,
  templatize,
} from '@/answers/normalize';
import { answerHandlers } from '@/background/handlers/answers';
import { requiresGesture } from '@/shared/messages';
import type { MessageContext, MessageType } from '@/shared/messages';
import { COMPANY_TOKEN, SAME_Q, SIMILAR_Q } from '@/shared/constants';

import { memoryDb, resetMemoryDb } from '../setup';

const PROFILE = 'prof_test_0001';

beforeEach(async () => {
  await resetMemoryDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 step 1 — normalization
 * ---------------------------------------------------------------------------------------------- */

describe('normalizeQuestion — the matching key', () => {
  it('lowercases, strips punctuation, collapses whitespace and tokenises the employer', () => {
    expect(normalizeQuestion('Why do you want to work at Acme, Inc.?', 'Acme, Inc.')).toBe(
      `why do you want to work at ${COMPANY_TOKEN}`,
    );
  });

  it('produces the SAME key for the same question asked by two different employers', () => {
    const acme = normalizeQuestion('Why do you want to work at Acme, Inc.?', 'Acme, Inc.');
    const globex = normalizeQuestion('Why do you want to work at Globex Corporation?', 'Globex Corporation');
    expect(acme).toBe(globex);
  });

  it('matches the employer through decoration ("Acme Technologies Inc." ⇒ "Acme")', () => {
    expect(companyAliases('Acme Technologies Inc.')).toContain('Acme');
    expect(normalizeQuestion('What excites you about Acme?', 'Acme Technologies Inc.')).toBe(
      `what excites you about ${COMPANY_TOKEN}`,
    );
  });

  it('collapses a repeated employer name into one token', () => {
    expect(normalizeQuestion('Why Acme? What draws you to Acme?', 'Acme')).toBe(
      `why ${COMPANY_TOKEN} what draws you to ${COMPANY_TOKEN}`,
    );
  });

  it('substitutes NOTHING when the employer is unknown — guessing would corrupt the key', () => {
    expect(normalizeQuestion('Why do you want to work at Acme?', null)).toBe(
      'why do you want to work at acme',
    );
  });

  it('is stable across casing, punctuation and whitespace noise', () => {
    const a = normalizeQuestion('  HOW   did you HEAR about us?!  ', 'Acme');
    const b = normalizeQuestion('How did you hear about us', 'Acme');
    expect(a).toBe(b);
  });

  it('returns "" for an empty question', () => {
    expect(normalizeQuestion('', 'Acme')).toBe('');
    expect(normalizeQuestion('   ', 'Acme')).toBe('');
  });
});

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 step 4 — templatize / rehydrate: the no-leak guarantee
 * ---------------------------------------------------------------------------------------------- */

describe('templatize / rehydrate — an Acme answer never lands in a Globex form (F-17)', () => {
  const written =
    "I've followed Acme's engineering blog for years, and Acme's approach to reliability is exactly " +
    'how I like to work.';

  it('templatize removes every occurrence of the employer, possessives included', () => {
    const stored = templatize(written, 'Acme');
    expect(stored).not.toMatch(/acme/i);
    expect(stored).toContain(`${COMPANY_TOKEN}'s`);
    expect(containsCompanyToken(stored)).toBe(true);
  });

  it('rehydrate substitutes the CURRENT employer, not the one it was written for', () => {
    const stored = templatize(written, 'Acme');
    const reused = rehydrate(stored, 'Globex');
    expect(reused).toContain('Globex');
    expect(reused).not.toMatch(/acme/i);
  });

  it('a round trip through the same employer is lossless', () => {
    expect(rehydrate(templatize(written, 'Acme'), 'Acme')).toBe(written);
  });

  it('substitutes a neutral phrase rather than leaving a visible {company} placeholder', () => {
    const stored = templatize('I admire Acme deeply.', 'Acme');
    expect(rehydrate(stored, null)).toBe('I admire your company deeply.');
    expect(rehydrate(stored, '')).not.toContain(COMPANY_TOKEN);
  });

  it('does not maul unrelated words that merely start with the employer name', () => {
    expect(templatize('Acmex is a different company entirely.', 'Acme')).toBe(
      'Acmex is a different company entirely.',
    );
  });

  it('a company name containing regex/replacement metacharacters is handled literally', () => {
    const stored = templatize('I want to join A$&B Corp.', 'A$&B Corp');
    expect(stored).toContain(COMPANY_TOKEN);
    expect(rehydrate(stored, 'C$1D')).toContain('C$1D');
  });

  it('mentionsCompany reports exactly when templatize would change the text', () => {
    expect(mentionsCompany(written, 'Acme')).toBe(true);
    expect(mentionsCompany(written, 'Globex')).toBe(false);
  });

  it('save() templatizes BEFORE storing — the row on disk cannot leak', async () => {
    await save({ qRaw: 'Why Acme?', answer: written, source: 'user', profileId: PROFILE, company: 'Acme' });
    const stored = memoryDb.answerBank.__rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.answer).not.toMatch(/acme/i);
    expect(stored[0]?.template).toBe(true);
  });

  it('a hit for a different employer comes back rehydrated for THAT employer', async () => {
    await save({
      qRaw: 'Why do you want to work at Acme?',
      answer: written,
      source: 'ai-edited',
      profileId: PROFILE,
      company: 'Acme',
    });

    const hit = await lookup('Why do you want to work at Globex?', {
      profileId: PROFILE,
      company: 'Globex',
    });

    expect(hit.kind).toBe('exact');
    expect(hit.hit?.answer).toContain('Globex');
    expect(hit.hit?.answer).not.toMatch(/acme/i);
  });
});

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 step 2 — the similarity bands
 * ---------------------------------------------------------------------------------------------- */

describe('lookup bands — exact ≥ 0.92 · similar [0.75, 0.92) · miss below', () => {
  const asked = 'Why do you want to work at {company}?';

  beforeEach(async () => {
    await save({
      qRaw: 'Why do you want to work at Acme?',
      answer: 'Because the problem space is one I have lived in for six years.',
      source: 'user',
      profileId: PROFILE,
      company: 'Acme',
    });
  });

  it('the identical question is an EXACT hit at similarity 1', async () => {
    const result = await lookup('Why do you want to work at Globex?', {
      profileId: PROFILE,
      company: 'Globex',
    });
    expect(result.kind).toBe('exact');
    expect(result.hit?.kind).toBe('same');
    expect(result.hit?.similarity).toBe(1);
    expect(result.hit?.similarity).toBeGreaterThanOrEqual(SAME_Q);
  });

  it('the same question with one extra word is a SIMILAR hit inside [0.75, 0.92)', async () => {
    const result = await lookup('Why do you want to work at Globex specifically?', {
      profileId: PROFILE,
      company: 'Globex',
    });
    expect(result.kind).toBe('similar');
    expect(result.hit?.kind).toBe('similar');
    expect(result.hit?.similarity).toBeGreaterThanOrEqual(SIMILAR_Q);
    expect(result.hit?.similarity).toBeLessThan(SAME_Q);
  });

  it('a question that drifts too far is a MISS — it becomes a new question', async () => {
    const result = await lookup('Why do you want to work at Globex in this particular role?', {
      profileId: PROFILE,
      company: 'Globex',
    });
    expect(result.kind).toBe('miss');
    expect(result.hit).toBeNull();
  });

  it('an unrelated question is a MISS with no candidates worth showing', async () => {
    const result = await lookup('Do you require visa sponsorship?', {
      profileId: PROFILE,
      company: 'Globex',
    });
    expect(result.kind).toBe('miss');
    expect(result.hit).toBeNull();
    expect(result.candidates.every((c) => c.similarity < SIMILAR_Q)).toBe(true);
  });

  it('an empty bank always misses', async () => {
    await clear();
    const result = await lookup(asked, { profileId: PROFILE, company: 'Globex' });
    expect(result).toEqual({ kind: 'miss', qNorm: expect.any(String), hit: null, candidates: [] });
  });

  it('scoreQuestion agrees with the bands the lookup applies', () => {
    expect(scoreQuestion('a b c', 'a b c').jaccard).toBe(1);
    expect(scoreQuestion('', 'a b c')).toEqual({ jaccard: 0, jw: 0 });
    const partial = scoreQuestion('why do you want to work at company', 'why do you want to work');
    expect(partial.jaccard).toBeGreaterThan(0);
    expect(partial.jaccard).toBeLessThan(1);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Scope
 * ---------------------------------------------------------------------------------------------- */

describe('scope', () => {
  it('a profile-scoped answer is invisible to another profile', async () => {
    await save({
      qRaw: 'How did you hear about us?',
      answer: 'A former colleague sent me the posting.',
      source: 'user',
      profileId: PROFILE,
      company: 'Acme',
    });

    const mine = await lookup('How did you hear about us?', { profileId: PROFILE, company: 'Acme' });
    expect(mine.kind).toBe('exact');

    const other = await lookup('How did you hear about us?', { profileId: 'prof_other', company: 'Acme' });
    expect(other.kind).toBe('miss');
  });

  it('a global answer is visible to every profile', async () => {
    const { record } = await save({
      qRaw: 'How did you hear about us?',
      answer: 'A former colleague sent me the posting.',
      source: 'user',
      profileId: PROFILE,
      company: 'Acme',
    });
    await setScope(record.id, 'global');

    const other = await lookup('How did you hear about us?', { profileId: 'prof_other', company: 'Acme' });
    expect(other.kind).toBe('exact');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Bank management (SEC 5.7 step 4 + the Options surface)
 * ---------------------------------------------------------------------------------------------- */

describe('save / markUsed / list / remove', () => {
  it('upserts on the normalized question rather than creating duplicates', async () => {
    const first = await save({
      qRaw: 'Why do you want to work at Acme?',
      answer: 'First attempt.',
      source: 'ai',
      profileId: PROFILE,
      company: 'Acme',
    });
    const second = await save({
      qRaw: 'Why do you want to work at Globex?',
      answer: 'Edited answer.',
      source: 'ai-edited',
      profileId: PROFILE,
      company: 'Globex',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.source).toBe('ai-edited');
    expect(second.record.timesUsed).toBe(2);
    expect(await memoryDb.answerBank.count()).toBe(1);
  });

  it('refuses to bank an empty answer or a question-less answer', async () => {
    await expect(
      save({ qRaw: 'Q?', answer: '   ', source: 'user', profileId: PROFILE }),
    ).rejects.toThrow(/empty answer/i);
    await expect(
      save({ qRaw: '  ', answer: 'A', source: 'user', profileId: PROFILE }),
    ).rejects.toThrow(/no question/i);
  });

  it('markUsed bumps the counter without rewriting the answer', async () => {
    const { record } = await save({
      qRaw: 'Q?',
      answer: 'A.',
      source: 'user',
      profileId: PROFILE,
      company: 'Acme',
    });
    const used = await markUsed(record.id);
    expect(used?.timesUsed).toBe(record.timesUsed + 1);
    expect(used?.answer).toBe(record.answer);
    expect(await markUsed('ans_missing')).toBeNull();
  });

  it('list() puts pinned rows first', async () => {
    const a = await save({ qRaw: 'Q one?', answer: 'A1', source: 'user', profileId: PROFILE });
    await save({ qRaw: 'Q two?', answer: 'A2', source: 'user', profileId: PROFILE });
    await pin(a.record.id, true);

    const { records, total } = await list({ profileId: PROFILE });
    expect(total).toBe(2);
    expect(records[0]?.id).toBe(a.record.id);
  });

  it('remove() deletes, and reports honestly when there was nothing to delete', async () => {
    const { record } = await save({ qRaw: 'Q?', answer: 'A', source: 'user', profileId: PROFILE });
    expect(await remove(record.id)).toBe(true);
    expect(await remove(record.id)).toBe(false);
    expect(await memoryDb.answerBank.count()).toBe(0);
  });

  it('export → clear → import restores the bank (SEC 7.4: exported, never synced)', async () => {
    await save({ qRaw: 'Q one?', answer: 'A1', source: 'user', profileId: PROFILE });
    await save({ qRaw: 'Q two?', answer: 'A2', source: 'ai', profileId: PROFILE });

    const backup = await exportAnswerBank();
    expect(backup.answers).toHaveLength(2);

    await clear();
    expect(await memoryDb.answerBank.count()).toBe(0);

    const result = await importAnswerBank(backup);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(await memoryDb.answerBank.count()).toBe(2);
  });

  it('import skips corrupt rows instead of failing the whole restore', async () => {
    const result = await importAnswerBank({ answers: [{ nonsense: true }, null, 'string'] });
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
  });
});

/* ------------------------------------------------------------------------------------------------
 * SEC 5.2 — the Options management surface
 *
 * Pin and clear are asserted through the BUS handlers rather than through `bank.ts`, because the
 * thing that was broken before was the contract, not the storage: the Options panel used to keep
 * pins in its own localStorage, where they reordered nothing and the popup could not see them.
 * ---------------------------------------------------------------------------------------------- */

function busCtx(type: MessageType): MessageContext {
  return {
    type,
    reqId: 'req_test_0001',
    gesture: null,
    tabId: null,
    frameId: null,
    url: null,
    origin: 'options',
  };
}

/** `pinned` rides on the record but is not part of the shared `AnswerRecord` type. */
function pinnedFlag(record: object): boolean {
  return (record as { pinned?: unknown }).pinned === true;
}

describe('ANSWERS_PIN / ANSWERS_CLEAR — managing what the bank remembers', () => {
  beforeEach(async () => {
    await save({ qRaw: 'Q one?', answer: 'A1', source: 'user', profileId: PROFILE });
    await save({ qRaw: 'Q two?', answer: 'A2', source: 'user', profileId: PROFILE });
    await save({ qRaw: 'Q three?', answer: 'A3', source: 'ai', profileId: PROFILE });
  });

  const listIds = async (): Promise<string[]> => {
    const reply = await answerHandlers.ANSWERS_LIST({ profileId: PROFILE }, busCtx('ANSWERS_LIST'));
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.data.records.map((record) => record.id);
  };

  it('a pinned answer is listed first, and unpinning restores the natural order', async () => {
    const before = await listIds();
    // Pin whatever the default order buried last — that is the only move the order can prove.
    const buried = before[before.length - 1] ?? '';

    const pinned = await answerHandlers.ANSWERS_PIN(
      { id: buried, pinned: true },
      busCtx('ANSWERS_PIN'),
    );
    expect(pinned.ok).toBe(true);
    expect(await listIds()).toEqual([buried, ...before.slice(0, -1)]);

    await answerHandlers.ANSWERS_PIN({ id: buried, pinned: false }, busCtx('ANSWERS_PIN'));
    expect(await listIds()).toEqual(before);
  });

  it('the reply carries the pin flag, so the UI never has to guess or refetch', async () => {
    const [first = ''] = await listIds();
    const reply = await answerHandlers.ANSWERS_PIN({ id: first, pinned: true }, busCtx('ANSWERS_PIN'));
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.data.record.id).toBe(first);
    expect(pinnedFlag(reply.data.record)).toBe(true);
  });

  it('pinning an answer that is already gone is NOT_FOUND, not a crash', async () => {
    const reply = await answerHandlers.ANSWERS_PIN(
      { id: 'ans_missing', pinned: true },
      busCtx('ANSWERS_PIN'),
    );
    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.code).toBe('NOT_FOUND');
  });

  it('ANSWERS_CLEAR empties the bank and reports how many answers it destroyed', async () => {
    const reply = await answerHandlers.ANSWERS_CLEAR({}, busCtx('ANSWERS_CLEAR'));
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.data.cleared).toBe(3);
    expect(await memoryDb.answerBank.count()).toBe(0);
    expect(await listIds()).toEqual([]);

    // Idempotent: a double-tap on an already empty bank reports the truth rather than failing.
    const again = await answerHandlers.ANSWERS_CLEAR({}, busCtx('ANSWERS_CLEAR'));
    expect(again.ok && again.data.cleared).toBe(0);
  });

  it('managing the bank stays offline: no gesture is demanded and no socket is opened', async () => {
    expect(requiresGesture('ANSWERS_PIN')).toBe(false);
    expect(requiresGesture('ANSWERS_CLEAR')).toBe(false);

    const fetchSpy = vi.fn(() => Promise.reject(new Error('managing the bank must not open a socket')));
    vi.stubGlobal('fetch', fetchSpy);

    const [first = ''] = await listIds();
    await answerHandlers.ANSWERS_PIN({ id: first, pinned: true }, busCtx('ANSWERS_PIN'));
    await answerHandlers.ANSWERS_CLEAR({}, busCtx('ANSWERS_CLEAR'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------------------------------
 * INV-2 / SEC 5.7 — the offline read
 * ---------------------------------------------------------------------------------------------- */

describe('INV-2 · lookup() performs NO network and leases NO key', () => {
  it('never calls fetch / XHR / WebSocket / sendBeacon', async () => {
    await save({
      qRaw: 'Why do you want to work at Acme?',
      answer: 'Because of the problem space.',
      source: 'user',
      profileId: PROFILE,
      company: 'Acme',
    });

    const fetchSpy = vi.fn(() => Promise.reject(new Error('lookup() must not open a socket')));
    const xhrSpy = vi.fn(() => {
      throw new Error('lookup() must not open a socket');
    });
    const wsSpy = vi.fn(() => {
      throw new Error('lookup() must not open a socket');
    });
    const beaconSpy = vi.fn(() => false);

    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubGlobal('navigator', { ...globalThis.navigator, sendBeacon: beaconSpy });

    const result = await lookup('Why do you want to work at Globex?', {
      profileId: PROFILE,
      company: 'Globex',
    });

    expect(result.kind).toBe('exact');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it('structurally: nothing under src/answers/ may reach the AI layer or the Gemini host', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const answersDir = join(here, '..', '..', 'src', 'answers');
    const files = ['bank.ts', 'normalize.ts', 'index.ts'];

    for (const file of files) {
      const source = readFileSync(join(answersDir, file), 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');

      expect(imports.filter((spec) => spec.startsWith('@/ai')), `${file} imports the AI layer`).toEqual([]);
      expect(source, `${file} references the Gemini host`).not.toContain('generativelanguage');
      expect(source, `${file} calls fetch()`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} mints a gesture`).not.toContain('mintGesture');
      expect(source, `${file} consumes a gesture`).not.toContain('consumeGesture');
      expect(source, `${file} leases a key`).not.toMatch(/selectKey|markLeased|keyLane/);
    }
  });
});
