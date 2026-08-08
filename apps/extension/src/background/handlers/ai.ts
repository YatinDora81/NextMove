/**
 * background/handlers/ai.ts — the four gesture-gated bus handlers (JF-001 Rev 3.0 SEC 4.2 / 5.5 / 5.6).
 *
 * SEC 4.2: the service worker owns ALL network I/O. These four handlers are the only place in the
 * extension where a user request turns into a Gemini call, and they run in the worker precisely so
 * that a page's CSP cannot block us and a page's JavaScript cannot see a key (SEC 4.4).
 *
 * ── INV-2 ───────────────────────────────────────────────────────────────────────────────────────
 * `AI_GENERATE_ANSWER`, `AI_GENERATE_COVER`, `AI_DISAMBIGUATE` and `RESUME_PARSE` are the entire
 * `GESTURE_REQUIRED` set. The nonce is verified and BURNED once, at the router boundary, before any
 * of these functions is entered; `src/ai/**` then enforces its own independent gate. Those two gates
 * are bridged below — see `admitVerifiedGesture` — rather than by consuming the nonce twice, which
 * would be a guaranteed false negative (the token no longer exists after the first burn).
 *
 * ── Answer Bank ─────────────────────────────────────────────────────────────────────────────────
 * SEC 5.7 / F-17: the bank lookup happens in the CONTENT SCRIPT, before any message is sent. A bank
 * hit never reaches this file — that is what makes it a zero-quota, fully offline path.
 * `AI_GENERATE_ANSWER` is therefore only ever the miss path or an explicit "Regenerate with AI".
 *
 * ── SEC 5.6 ─────────────────────────────────────────────────────────────────────────────────────
 * Every failure leaves here as a typed bus error with the copy the design doc specifies, carrying
 * `retryAt` for the two rows that have a countdown. `ai/errors.ts` owns that table; this file only
 * translates and repaints the badge.
 *
 * INV-5: no plaintext key is accepted, returned, logged, or even nameable here — `keyId` is a
 * record id, never key material.
 * INV-6: nothing in this file (or anything it reaches) knows the NextMove API exists.
 */

import {
  GestureRequiredError,
  configureGestureGate,
  disambiguateField,
  generateCoverLetter,
  generateScreeningAnswer,
  parseResume,
} from '@/ai';
import { failureToBusError, toAiFailure } from '@/ai/errors';
import { getDefaultResume, getParseCache, getResume, putParseCache } from '@/platform/db';
import { createLogger } from '@/platform/logger';
import { getActiveProfile, getProfileById } from '@/platform/storage';
import { GESTURE_TTL_MS, MAX_RESUME_CHARS } from '@/shared/constants';
import { errReply, okReply } from '@/shared/messages';
import type { BusError, MessageContext, MessageHandlers } from '@/shared/messages';
import type { ParseCacheRecord, Profile } from '@/shared/types';

import { refreshKeyBadge } from '@/background/badge';

const log = createLogger('bg:ai');

/* ------------------------------------------------------------------------------------------------
 * INV-2 — bridging the two gates
 * ---------------------------------------------------------------------------------------------- */

/**
 * Passes handed to `src/ai/**`, keyed by an opaque token, each valid for one call and for at most
 * `GESTURE_TTL_MS`. Memory only, exactly like `platform/gesture.ts`: a permission slip must not be
 * able to outlive the worker that was told about the click.
 */
const admitted = new Map<string, number>();

function sweep(now: number): void {
  for (const [token, expiresAt] of admitted) {
    if (expiresAt <= now) admitted.delete(token);
  }
}

/**
 * INV-2, the bridge.
 *
 * By the time a handler in this file runs, `platform/bus.ts` has already verified the envelope's
 * user-gesture nonce and BURNED it (single use, ≤5 s old, minted by trusted extension UI). The AI
 * layer enforces its own gate on top — belt and braces, so a future caller that bypasses the bus
 * still cannot reach Gemini quietly. Calling `consumeGesture` a second time here would always fail:
 * the nonce is gone. So instead we re-admit exactly one single-use pass, and ONLY when the router
 * actually proved a gesture (`ctx.gesture !== null`).
 *
 * Fails closed: with no proof we return `''`, which `src/ai/index.ts` rejects as GESTURE_REQUIRED.
 */
function admitVerifiedGesture(ctx: MessageContext): string {
  const now = Date.now();
  sweep(now);

  const verified = ctx.gesture;
  if (verified === null || verified.length === 0) {
    log.warn(`${ctx.type} reached the AI handler without a verified gesture — refusing (INV-2)`);
    return '';
  }

  const pass = `jfb.${ctx.reqId}.${String(now)}.${verified.slice(-8)}`;
  admitted.set(pass, now + GESTURE_TTL_MS);
  return pass;
}

let bridgeInstalled = false;

/**
 * Point `src/ai/**` at the bridge above. Called once from the handler barrel at service-worker
 * start-up; idempotent because the worker restarts constantly and re-runs its bootstrap.
 */
export function installAiGestureBridge(): void {
  if (bridgeInstalled) return;
  configureGestureGate({
    consume: (token: string): boolean => {
      const now = Date.now();
      sweep(now);
      const expiresAt = admitted.get(token);
      // Burn first — single use, whatever happens next.
      admitted.delete(token);
      return expiresAt !== undefined && expiresAt > now;
    },
  });
  bridgeInstalled = true;
}

/** Drop every outstanding pass. Used by tests and by a full local wipe. */
export function resetAiGestureBridge(): void {
  admitted.clear();
}

/* ------------------------------------------------------------------------------------------------
 * Failure translation (SEC 5.6)
 * ---------------------------------------------------------------------------------------------- */

/** The error half of a bus reply — identical for all four handlers, whatever their success shape. */
type ErrorReply = { ok: false; error: BusError };

/**
 * Translate anything thrown by `src/ai/**` into the `{ok:false, error}` reply every AI handler
 * shares.
 *
 * `ai/errors.describeFailure` is the single owner of the SEC 5.6 copy, so the popup, the options
 * page and the in-page overlay cannot disagree about what "all keys are rate-limited" says, and
 * `retryAt` survives for the two rows of that table that have a countdown.
 *
 * A `KeyInvalid` failure additionally repaints the toolbar badge — that is the other half of the
 * "Key revoked/invalid" row.
 */
async function aiError(type: string, error: unknown): Promise<ErrorReply> {
  if (error instanceof GestureRequiredError) {
    // INV-2: this only fires if something reached the AI layer without a router-verified gesture.
    log.warn(`${type} refused by the AI gate: ${error.code}`);
    return errReply(error.code, error.message);
  }

  const failure = toAiFailure(error);
  if (failure.kind === 'KeyInvalid') await refreshKeyBadge();

  const busError = failureToBusError(failure);
  log.warn(`${type} failed: ${failure.kind}`);
  return errReply(busError.code, busError.message, busError.retryAt);
}

/* ------------------------------------------------------------------------------------------------
 * Context assembly — all of it local, none of it billable
 * ---------------------------------------------------------------------------------------------- */

async function resolveProfile(profileId: string | null): Promise<Profile | null> {
  return profileId === null ? getActiveProfile() : getProfileById(profileId);
}

/**
 * The extracted text of the profile's default resume, if we already have it cached.
 *
 * Purely a local read: `parseCache` holds text that was extracted on device by pdf.js / mammoth
 * (SEC 03). We never extract here just to enrich a prompt — that would spend CPU on every ✨ click
 * for a marginal quality gain.
 */
async function cachedResumeText(profileId: string): Promise<string | undefined> {
  try {
    const resume = await getDefaultResume(profileId);
    if (resume === undefined) return undefined;
    const cache = await getParseCache(resume.id);
    const text = cache?.text.trim() ?? '';
    return text.length > 0 ? text : undefined;
  } catch (error) {
    log.debug('could not read cached resume text', error);
    return undefined;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Handlers
 * ---------------------------------------------------------------------------------------------- */

type AiHandlers = Pick<
  MessageHandlers,
  'AI_GENERATE_ANSWER' | 'AI_GENERATE_COVER' | 'AI_DISAMBIGUATE' | 'RESUME_PARSE'
>;

/**
 * F-09 screening answer (SEC 4.3 Flow B, steps 3-7).
 *
 * The Answer Bank has already been consulted by the content script (SEC 5.7); reaching this
 * handler means a miss, or the user explicitly asking to regenerate.
 */
const aiGenerateAnswer: AiHandlers['AI_GENERATE_ANSWER'] = async (payload, ctx) => {
  const question = payload.question.trim();
  if (question.length === 0) {
    return errReply('BAD_REQUEST', 'There is no question text to answer.');
  }

  const profile = await resolveProfile(payload.profileId);
  if (profile === null) {
    return errReply('NOT_FOUND', 'Create a profile before generating answers.');
  }

  // INV-2: gesture bridged from the router's verified, already-burned nonce.
  const gesture = admitVerifiedGesture(ctx);
  const resumeText = await cachedResumeText(profile.id);

  try {
    const result = await generateScreeningAnswer({
      gesture,
      question,
      jobCtx: payload.jobCtx,
      profile,
      tone: payload.tone,
      length: payload.length,
      ...(resumeText === undefined ? {} : { resumeText }),
    });
    await refreshKeyBadge();
    return okReply({ text: result.text, model: result.model, keyId: result.keyId });
  } catch (error) {
    return aiError('AI_GENERATE_ANSWER', error);
  }
};

/** F-10 cover letter (`cover_letter.v1`). */
const aiGenerateCover: AiHandlers['AI_GENERATE_COVER'] = async (payload, ctx) => {
  const profile = await resolveProfile(payload.profileId);
  if (profile === null) {
    return errReply('NOT_FOUND', 'Create a profile before generating a cover letter.');
  }

  // INV-2.
  const gesture = admitVerifiedGesture(ctx);
  const resumeText = await cachedResumeText(profile.id);

  try {
    const result = await generateCoverLetter({
      gesture,
      jobCtx: payload.jobCtx,
      profile,
      tone: payload.tone,
      preset: payload.preset,
      ...(resumeText === undefined ? {} : { resumeText }),
    });
    await refreshKeyBadge();
    return okReply({
      subject: result.subject,
      body: result.body,
      model: result.model,
      keyId: result.keyId,
    });
  } catch (error) {
    return aiError('AI_GENERATE_COVER', error);
  }
};

/**
 * The optional 50-69 gray-zone assist (`field_disambiguate.v1`).
 *
 * INV-4 stays intact either way: this only ever runs when the user clicks "Ask AI to resolve" on a
 * single field in the review overlay, never as part of a fill click, and a low-confidence answer
 * still lands in the `suggest` band for the user to accept.
 */
const aiDisambiguate: AiHandlers['AI_DISAMBIGUATE'] = async (payload, ctx) => {
  const candidates = payload.candidates.filter((path) => path.trim().length > 0);
  if (candidates.length === 0) {
    return errReply('BAD_REQUEST', 'No candidate profile paths were supplied.');
  }

  // INV-2.
  const gesture = admitVerifiedGesture(ctx);
  const profile = await getActiveProfile();

  try {
    const result = await disambiguateField({
      gesture,
      sig: payload.sig,
      candidates,
      ...(profile === null ? {} : { profile }),
    });
    await refreshKeyBadge();
    return okReply({ path: result.path, confidence: result.confidence, model: result.model });
  } catch (error) {
    return aiError('AI_DISAMBIGUATE', error);
  }
};

/**
 * F-02 / SEC 4.3 Flow C, step 4: resume TEXT → `ProfileDraft`.
 *
 * ── The worker holds no PDF/DOCX parser ─────────────────────────────────────────────────────────
 * Steps 2-3 of Flow C happen in the Options page: pdf.js / mammoth extract the text locally, and
 * the consent screen shows the user that exact text before the button that fires this message
 * becomes reachable. `payload.text` IS that string. The blob stays in IndexedDB and never crosses
 * the bus, so this file — and everything it can reach — is free of pdfjs-dist and mammoth. That is
 * load-bearing: the MV3 worker is bundled as a single file, and Chrome re-parses all of it on every
 * wake-up (SEC 11's bundle-size gate, SEC 13's store-review risk).
 *
 * What stays here is exactly what needs the worker: the gesture gate, the leased Gemini call, the
 * Zod validation, the one repair retry, and the F-02 regex fallback (which is plain string work).
 *
 * SEC 7.1's `parseCache` exists so that "re-parse without re-spend" is literally true: a cached AI
 * draft is returned without leasing a key at all. A cached *regex* draft is not treated as final —
 * the user asking again with a key configured should get the better parse.
 */
const resumeParse: AiHandlers['RESUME_PARSE'] = async (payload, ctx) => {
  const resume = await getResume(payload.resumeId);
  if (resume === undefined) {
    return errReply('NOT_FOUND', 'That resume is no longer stored on this device.');
  }

  /*
   * The router's payload gate only proves `text` is a string. Bound it here, at the one place that
   * can turn it into an outbound Gemini request: the extractor already clips to MAX_RESUME_CHARS,
   * so anything longer did not come from the consent screen and must not be forwarded.
   */
  const text = payload.text.trim();
  if (text.length === 0) {
    return errReply(
      'BAD_REQUEST',
      `No text was extracted from ${resume.name}. Scanned or image-only PDFs have no text layer — export a text PDF or a DOCX.`,
    );
  }
  if (text.length > MAX_RESUME_CHARS) {
    return errReply(
      'BAD_REQUEST',
      `That is more than ${MAX_RESUME_CHARS.toLocaleString()} characters of resume text; only the reviewed excerpt can be sent.`,
    );
  }

  const cached = await getParseCache(payload.resumeId);
  if (cached !== undefined && cached.draft !== null && cached.model !== null) {
    log.debug('serving RESUME_PARSE from parseCache — no key leased');
    return okReply({ draft: cached.draft, model: cached.model, source: 'ai' as const });
  }

  // INV-2.
  const gesture = admitVerifiedGesture(ctx);

  try {
    const result = await parseResume({ gesture, text });

    const record: ParseCacheRecord = {
      resumeId: payload.resumeId,
      text: result.text,
      draft: result.draft,
      model: result.model,
      parsedAt: Date.now(),
    };
    await putParseCache(record);

    await refreshKeyBadge();
    return okReply({ draft: result.draft, model: result.model, source: result.source });
  } catch (error) {
    return aiError('RESUME_PARSE', error);
  }
};

/**
 * The AI slice of the router's handler table.
 *
 * `settings.preferredModel` is applied by the prompt templates themselves (SEC 5.5 assigns a tier
 * per template) and the pool degrades down `settings.modelFallbackChain`, which
 * `background/config-sync.ts` pushes into the rotation store on every worker wake.
 */
export const aiHandlers: AiHandlers = {
  AI_GENERATE_ANSWER: aiGenerateAnswer,
  AI_GENERATE_COVER: aiGenerateCover,
  AI_DISAMBIGUATE: aiDisambiguate,
  RESUME_PARSE: resumeParse,
};
