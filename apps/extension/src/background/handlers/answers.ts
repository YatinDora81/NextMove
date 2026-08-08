/**
 * background/handlers/answers.ts — the Answer Bank bus surface (F-17 / SEC 5.7).
 *
 * ── ANSWERS_LOOKUP is an OFFLINE READ. This is load-bearing. ────────────────────────────────────
 * SEC 5.7: *"the lookup runs before any key is leased — a bank hit is a fully offline path"*, and
 * the SEC 6.6 table spells it out again: *"offline read, no gesture token, no key lease"*.
 *
 * Concretely, in this file:
 *   - `ANSWERS_LOOKUP` is deliberately absent from `GESTURE_REQUIRED` in `shared/messages.ts`, so
 *     the router does not (and must not) demand a nonce for it;
 *   - nothing here imports `@/ai/**`, so there is no reachable path from a lookup to `leaseKey`,
 *     to `withDecryptedKey`, or to `fetch`;
 *   - the whole operation is IndexedDB plus string maths (Jaccard + Jaro-Winkler tiebreak).
 * Only "Regenerate with AI" enters the Gemini path, and that is `AI_GENERATE_ANSWER`, which IS
 * gesture-gated. Adding a network call to this file would break INV-2's economics and SEC 5.7's
 * central claim, so it must not happen.
 *
 * ── Scope and provenance ────────────────────────────────────────────────────────────────────────
 * SEC 5.7: per-profile by default (a "Frontend" answer differs from a "Fullstack" one), promotable
 * to global by the user. `ANSWERS_SAVE` records provenance (`ai` | `ai-edited` | `user`) and
 * templates the employer name out to `{company}` before writing, so reuse can never leak the wrong
 * company into a form.
 *
 * SEC 7.4: the bank is local-only and is NEVER synced. `handlers/sync.ts` does not know it exists.
 */

import { answerBank } from '@/answers';
import { createLogger } from '@/platform/logger';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';
import type { AnswerScope } from '@/shared/types';

const log = createLogger('bg:answers');

type AnswerHandlers = Pick<
  MessageHandlers,
  'ANSWERS_LOOKUP' | 'ANSWERS_SAVE' | 'ANSWERS_LIST' | 'ANSWERS_DELETE'
>;

/**
 * SEC 5.7 steps 1-3. Returns the winner or `null`; the content script renders the "You've answered
 * this before" chip from it. `{company}` is already re-substituted for the employer we are applying
 * to right now, so the answer can be inserted verbatim.
 *
 * Zero gesture. Zero key lease. Zero network. See the file header.
 */
const answersLookup: AnswerHandlers['ANSWERS_LOOKUP'] = async (payload) => {
  const qRaw = payload.qRaw.trim();
  if (qRaw.length === 0) return okReply({ hit: null });

  const result = await answerBank.lookup(qRaw, {
    profileId: payload.profileId,
    company: payload.company,
    ...(payload.qNorm !== undefined && payload.qNorm.length > 0 ? { qNorm: payload.qNorm } : {}),
  });

  return okReply({ hit: result.hit });
};

/**
 * SEC 5.7 step 4. Upsert whatever the user finally accepted — generated, edited, or typed from
 * scratch — with its provenance.
 */
const answersSave: AnswerHandlers['ANSWERS_SAVE'] = async (payload) => {
  const answer = payload.answer.trim();
  const qRaw = payload.qRaw.trim();
  if (answer.length === 0) {
    return errReply('BAD_REQUEST', 'There is nothing to save — the answer is empty.');
  }
  if (qRaw.length === 0) {
    return errReply('BAD_REQUEST', 'An answer needs the question it answers.');
  }

  const scope: AnswerScope = payload.scope ?? 'profile';
  try {
    const result = await answerBank.save({
      qRaw,
      answer,
      source: payload.source,
      profileId: payload.profileId,
      company: payload.company,
      scope,
    });
    log.debug(`${result.created ? 'banked' : 'updated'} an answer (${payload.source}, ${scope})`);
    return okReply({ record: result.record, created: result.created });
  } catch (error) {
    // `answerBank.save` throws only on empty input, which is already handled above; anything else
    // is a Dexie failure and belongs in the bus's INTERNAL bucket rather than as a silent no-op.
    log.error('could not bank an answer', error);
    return errReply('INTERNAL', 'That answer could not be saved to the bank.');
  }
};

/** Options → Answer Bank: search, paginate, show usage counts. Pinned first, then most recent. */
const answersList: AnswerHandlers['ANSWERS_LIST'] = async (payload) => {
  const result = await answerBank.list({
    ...(payload.search === undefined ? {} : { search: payload.search }),
    ...(payload.profileId === undefined ? {} : { profileId: payload.profileId }),
    ...(payload.limit === undefined ? {} : { limit: payload.limit }),
    ...(payload.offset === undefined ? {} : { offset: payload.offset }),
  });
  return okReply({ records: result.records, total: result.total });
};

const answersDelete: AnswerHandlers['ANSWERS_DELETE'] = async (payload) => {
  const removed = await answerBank.remove(payload.id);
  if (!removed) {
    return errReply('NOT_FOUND', 'That answer is no longer in the bank.');
  }
  return okReply({ deleted: true as const });
};

export const answerHandlers: AnswerHandlers = {
  ANSWERS_LOOKUP: answersLookup,
  ANSWERS_SAVE: answersSave,
  ANSWERS_LIST: answersList,
  ANSWERS_DELETE: answersDelete,
};
