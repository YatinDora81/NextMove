/**
 * ai/index.ts — the four gesture-gated entry points, and the public surface of the AI layer.
 *
 * Implements JF-001 Rev 3.0 SEC 4.3 Flow B/C and SEC 5.5. Everything a caller outside `src/ai/**`
 * needs is re-exported from here, so `src/background/**` and the UI import exactly one module.
 *
 * INV-2 is enforced at the top of every entry point: each one consumes a single-use, 5-second
 * gesture nonce before it does anything at all. There is no code path in this folder that reaches
 * Gemini without one — no prefetch, no warm-up, no speculative generation.
 * INV-5: no entry point accepts, returns or logs a plaintext key.
 * INV-6: nothing in this folder imports `API_BASE_URL`; the extension's AI lane talks to Google and
 *        to nobody else.
 */

import type { ModelId } from '@repo/rotation';
import { z } from 'zod';

import { DEFAULT_SETTINGS, GESTURE_NONCE_BYTES, GESTURE_TTL_MS } from '@/shared/constants';
import {
  coverLetterOutputSchema,
  disambiguateOutputSchema,
  resumeExtractOutputSchema,
} from '@/shared/schema';
import type {
  AnswerLength,
  AnswerTone,
  CoverLetterPreset,
  FieldSignature,
  JobContext,
  Profile,
  ProfileDraft,
  ProfilePath,
} from '@/shared/types';

import { AiError, outputInvalid } from './errors';
import { generateContent } from './gemini-client';
import { detectAiTells, humanizeAnswer } from './humanize';
import type { AiTell } from './humanize';
import {
  LENGTH_PRESETS,
  buildCoverLetterPrompt,
  buildCoverLetterRepairPrompt,
  buildFieldDisambiguatePrompt,
  buildResumeExtractPrompt,
  buildResumeExtractRepairPrompt,
  buildScreeningAnswerPrompt,
  buildScreeningRewritePrompt,
  parseJsonLoosely,
} from './prompts';
import type { PromptSpec, ScreeningAnswerInput } from './prompts';
import { parseProfileFromText } from './resume-text';
import { runWithRotation } from './rotation-store';
import { hasKeys } from './vault';

/* ------------------------------------------------------------------------------------------------
 * INV-2 — the gesture gate
 * ---------------------------------------------------------------------------------------------- */

/** Thrown when an entry point is called without a fresh, unused gesture nonce. */
export class GestureRequiredError extends Error {
  readonly code: 'GESTURE_REQUIRED' | 'GESTURE_EXPIRED';

  constructor(code: 'GESTURE_REQUIRED' | 'GESTURE_EXPIRED', reason: string) {
    super(
      code === 'GESTURE_REQUIRED'
        ? 'AI requests require a user gesture (' + reason + ').'
        : 'That gesture has expired — click again (' + reason + ').',
    );
    this.name = 'GestureRequiredError';
    this.code = code;
    Object.setPrototypeOf(this, GestureRequiredError.prototype);
  }
}

/**
 * Pluggable so the MessageBus router can be the single authority on gesture nonces once it is
 * wired. Until something is injected, the built-in registry below is used — and either way, an
 * unrecognised token fails closed.
 */
export interface GestureGate {
  consume(token: string, reason: string): boolean | Promise<boolean>;
}

interface MintedGesture {
  reason: string;
  expiresAt: number;
}

const mintedGestures = new Map<string, MintedGesture>();
let gestureGate: GestureGate | null = null;

export function configureGestureGate(gate: GestureGate | null): void {
  gestureGate = gate;
}

function pruneGestures(now: number): void {
  for (const [token, minted] of mintedGestures) {
    if (minted.expiresAt <= now) mintedGestures.delete(token);
  }
}

/**
 * Mint a nonce from inside a real user-gesture handler (the ✨ button, "Build profile with
 * Gemini", the context-menu item, the key "Test" button). Valid for `GESTURE_TTL_MS` (5s) and
 * for exactly one use.
 */
export function mintGesture(reason: string, now: number = Date.now()): {
  gesture: string;
  expiresAt: number;
} {
  pruneGestures(now);
  const bytes = new Uint8Array(GESTURE_NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let token = '';
  for (const byte of bytes) token += byte.toString(16).padStart(2, '0');

  const expiresAt = now + GESTURE_TTL_MS;
  mintedGestures.set(token, { reason, expiresAt });
  return { gesture: token, expiresAt };
}

/** Number of live nonces — exposed for tests only; it can never leak one. */
export function pendingGestureCount(now: number = Date.now()): number {
  pruneGestures(now);
  return mintedGestures.size;
}

async function assertGesture(token: string | undefined, reason: string): Promise<void> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new GestureRequiredError('GESTURE_REQUIRED', reason);
  }

  if (gestureGate !== null) {
    const accepted = await gestureGate.consume(token, reason);
    if (!accepted) throw new GestureRequiredError('GESTURE_EXPIRED', reason);
    return;
  }

  const now = Date.now();
  pruneGestures(now);
  const minted = mintedGestures.get(token);
  // Single use: the nonce is burned whether or not the request that follows succeeds.
  mintedGestures.delete(token);
  if (minted === undefined || minted.expiresAt <= now) {
    throw new GestureRequiredError('GESTURE_EXPIRED', reason);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Shared execution helpers
 * ---------------------------------------------------------------------------------------------- */

interface RunResult {
  text: string;
  model: ModelId;
  keyId: string;
  attempts: number;
}

/** One prompt across the pool: lease → call → classify → persist, all inside `runWithRotation`. */
async function runPrompt(spec: PromptSpec, signal: AbortSignal | undefined): Promise<RunResult> {
  return runWithRotation({
    preferredModel: spec.preferredModel,
    call: (apiKey, ctx) =>
      generateContent({
        model: ctx.model,
        apiKey,
        prompt: spec.prompt,
        temperature: spec.temperature,
        maxOutputTokens: spec.maxOutputTokens,
        json: spec.json,
        signal,
      }),
  });
}

function describeZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => (issue.path.length > 0 ? issue.path.join('.') : '<root>') + ': ' + issue.message)
    .join('; ');
}

interface JsonRunResult<T> {
  value: T;
  model: ModelId;
  keyId: string;
  /** `true` when the repair prompt had to be spent (SEC 5.6). */
  repaired: boolean;
}

/**
 * Run a JSON-constrained template, validate it with Zod, and — per SEC 5.6 — spend at most ONE
 * repair prompt when validation fails. `repair` returning `null` means the template has no repair
 * path and a bad output is terminal.
 */
interface JsonPromptHooks<T> {
  /**
   * Repairs a value is trivially wrong about — a confidence of 1.4, a `null` where the schema
   * wants an absent key. Spending a whole free-tier request on that would be absurd; spending a
   * pure function on it is free. Runs before Zod, which stays the authority on shape.
   */
  preprocess?: (parsed: unknown) => unknown;
  /** Extra semantic check beyond the schema; return a complaint string to force a repair. */
  audit?: (value: T) => string | null;
}

async function runJsonPrompt<T>(
  spec: PromptSpec,
  schema: z.ZodType<T>,
  repair: ((raw: string, problem: string) => PromptSpec) | null,
  signal: AbortSignal | undefined,
  hooks: JsonPromptHooks<T> = {},
): Promise<JsonRunResult<T>> {
  const { preprocess, audit } = hooks;
  const first = await runPrompt(spec, signal);

  const validate = (raw: string): { ok: true; value: T } | { ok: false; problem: string } => {
    const parsedRaw = parseJsonLoosely(raw);
    if (parsedRaw === null) return { ok: false, problem: 'The output was not parseable JSON.' };
    const parsed = preprocess === undefined ? parsedRaw : preprocess(parsedRaw);
    const result = schema.safeParse(parsed);
    if (!result.success) return { ok: false, problem: describeZodIssues(result.error) };
    const complaint = audit === undefined ? null : audit(result.data);
    if (complaint !== null) return { ok: false, problem: complaint };
    return { ok: true, value: result.data };
  };

  const firstCheck = validate(first.text);
  if (firstCheck.ok) {
    return { value: firstCheck.value, model: first.model, keyId: first.keyId, repaired: false };
  }

  if (repair === null) {
    throw new AiError(outputInvalid(spec.template, firstCheck.problem));
  }

  const second = await runPrompt(repair(first.text, firstCheck.problem), signal);
  const secondCheck = validate(second.text);
  if (secondCheck.ok) {
    return { value: secondCheck.value, model: second.model, keyId: second.keyId, repaired: true };
  }

  throw new AiError(outputInvalid(spec.template, secondCheck.problem));
}

/* ------------------------------------------------------------------------------------------------
 * 1. Screening answer (SEC 4.3 Flow B · screening_answer.v1)
 * ---------------------------------------------------------------------------------------------- */

export interface ScreeningAnswerRequest {
  /** Single-use nonce minted inside the ✨ click handler (INV-2). */
  gesture: string;
  question: string;
  jobCtx: JobContext;
  profile: Profile;
  /** Text of the currently-attached resume, already extracted locally. */
  resumeText?: string;
  tone?: AnswerTone;
  length?: AnswerLength;
  signal?: AbortSignal;
}

export interface ScreeningAnswerResult {
  text: string;
  model: ModelId;
  keyId: string;
  /** `true` when the SEC 5.5 post-pass spent a second generation and kept its output. */
  rewritten: boolean;
  /** Human-readable AI-tell labels still present in `text` (usually empty). */
  tells: string[];
  /** Keys consumed across both passes. */
  attempts: number;
}

/**
 * Flow B step 3-7: package context → lease a key → generate → humanize post-pass → hand back a
 * draft for the user to review. The Answer Bank lookup (F-17 / SEC 5.7) happens *before* this
 * function is ever called; a bank hit never reaches here, which is what makes it a zero-quota path.
 */
export async function generateScreeningAnswer(
  request: ScreeningAnswerRequest,
): Promise<ScreeningAnswerResult> {
  await assertGesture(request.gesture, 'generate screening answer');

  const question = request.question.trim();
  if (question.length === 0) {
    throw new AiError(outputInvalid('screening_answer.v1', 'No question text was supplied.'));
  }

  const input: ScreeningAnswerInput = {
    question,
    job: request.jobCtx,
    profile: request.profile,
    tone: request.tone ?? DEFAULT_SETTINGS.tone,
    length: request.length ?? DEFAULT_SETTINGS.answerLength,
  };
  if (request.resumeText !== undefined) input.resumeText = request.resumeText;

  const preset = LENGTH_PRESETS[input.length];
  const detectOptions = {
    maxWords: preset.maxWords,
    minSentences: preset.minSentences,
    maxSentences: preset.maxSentences,
  };

  const first = await runPrompt(buildScreeningAnswerPrompt(input), request.signal);
  const draft = first.text.trim();
  if (draft.length === 0) {
    throw new AiError(outputInvalid('screening_answer.v1', 'The model returned an empty answer.'));
  }

  let rewriteAttempts = 0;
  let model = first.model;
  let keyId = first.keyId;

  // SEC 5.5: exactly one automatic rewrite, and only when the detector actually trips.
  const humanized = await humanizeAnswer(
    draft,
    async (current: string, tells: readonly AiTell[]): Promise<string | null> => {
      try {
        const rewrite = await runPrompt(
          buildScreeningRewritePrompt(input, current, tells),
          request.signal,
        );
        rewriteAttempts = rewrite.attempts;
        const text = rewrite.text.trim();
        if (text.length === 0) return null;
        model = rewrite.model;
        keyId = rewrite.keyId;
        return text;
      } catch {
        // A busy pool must not lose the draft we already paid for — keep it and move on.
        return null;
      }
    },
    detectOptions,
  );

  if (!humanized.rewritten) {
    model = first.model;
    keyId = first.keyId;
  }

  return {
    text: humanized.text,
    model,
    keyId,
    rewritten: humanized.rewritten,
    tells: humanized.tells.map((tell) => tell.label),
    attempts: first.attempts + rewriteAttempts,
  };
}

/* ------------------------------------------------------------------------------------------------
 * 2. Cover letter (cover_letter.v1)
 * ---------------------------------------------------------------------------------------------- */

export interface CoverLetterRequest {
  gesture: string;
  jobCtx: JobContext;
  profile: Profile;
  resumeText?: string;
  tone?: AnswerTone;
  preset?: CoverLetterPreset;
  signal?: AbortSignal;
}

export interface CoverLetterResult {
  subject: string | null;
  body: string;
  model: ModelId;
  keyId: string;
  repaired: boolean;
}

/** 3-5 paragraphs, no placeholder brackets, JSON `{subject?, body}` (SEC 5.5). */
export async function generateCoverLetter(
  request: CoverLetterRequest,
): Promise<CoverLetterResult> {
  await assertGesture(request.gesture, 'generate cover letter');

  const input = {
    job: request.jobCtx,
    profile: request.profile,
    tone: request.tone ?? DEFAULT_SETTINGS.tone,
    preset: request.preset ?? 'standard',
    ...(request.resumeText !== undefined ? { resumeText: request.resumeText } : {}),
  } as const;

  const run = await runJsonPrompt(
    buildCoverLetterPrompt(input),
    coverLetterOutputSchema,
    buildCoverLetterRepairPrompt,
    request.signal,
    {
      // `"subject": null` is the schema's only common near-miss; the key is optional, not nullable.
      preprocess: (parsed) => {
        if (typeof parsed !== 'object' || parsed === null) return parsed;
        const record = { ...(parsed as Record<string, unknown>) };
        if (record['subject'] === null) delete record['subject'];
        return record;
      },
      // A letter with "[Company Name]" in it is worse than no letter — force the repair pass.
      audit: (value) => {
        const placeholder = detectAiTells(value.body, { checkRhythm: false }).find(
          (tell) => tell.id === 'placeholder-bracket',
        );
        return placeholder === undefined
          ? null
          : 'The letter still contains an unfilled placeholder: ' + placeholder.sample;
      },
    },
  );

  const subject = run.value.subject?.trim();

  return {
    subject: subject !== undefined && subject.length > 0 ? subject : null,
    body: run.value.body.trim(),
    model: run.model,
    keyId: run.keyId,
    repaired: run.repaired,
  };
}

/* ------------------------------------------------------------------------------------------------
 * 3. Resume → profile (SEC 4.3 Flow C · resume_extract.v1)
 * ---------------------------------------------------------------------------------------------- */

export interface ParseResumeRequest {
  gesture: string;
  /**
   * The resume text, already extracted **on the device, in a page context** by
   * `ai/resume-extract.ts` (SEC 4.3 Flow C step 2) and shown to the user verbatim on the consent
   * screen (step 3).
   *
   * This layer deliberately cannot open a PDF or a DOCX: it runs inside the MV3 service worker,
   * which is bundled as a single file, so importing pdfjs-dist/mammoth from anywhere reachable
   * here would add ~2 MB to every worker wake-up. Extraction is a local, user-context operation;
   * the Gemini call is the only thing the worker contributes.
   */
  text: string;
  /** Skip Gemini entirely and use the F-02 regex parser (used when no key is configured). */
  localOnly?: boolean;
  signal?: AbortSignal;
}

export interface ParseResumeResult {
  draft: ProfileDraft;
  /** `null` when the regex fallback produced the draft. */
  model: ModelId | null;
  source: 'ai' | 'regex';
  /** The extracted text, so the caller can cache it (SEC 7.1 `parseCache`). */
  text: string;
  repaired: boolean;
}

/**
 * Flow C step 4. Extraction already happened locally (pdf.js / mammoth, in the Options page); only
 * the extracted text arrives here, and only because the user clicked "Build profile with Gemini"
 * on the consent screen that showed them that exact text.
 *
 * Degradation is exactly the SEC 5.6 ladder: strict JSON → one repair prompt → the F-02 regex
 * parser. An empty vault also lands on the regex parser, because a user with no key must still be
 * able to build a profile (INV-3).
 */
export async function parseResume(request: ParseResumeRequest): Promise<ParseResumeResult> {
  await assertGesture(request.gesture, 'parse resume');

  const text = request.text.trim();
  if (text.length === 0) {
    throw new AiError(
      outputInvalid('resume_extract.v1', 'No text could be extracted from that file.'),
    );
  }

  const localResult = (): ParseResumeResult => ({
    draft: parseProfileFromText(text),
    model: null,
    source: 'regex',
    text,
    repaired: false,
  });

  if (request.localOnly === true) return localResult();
  if (!(await hasKeys())) return localResult();

  try {
    const run = await runJsonPrompt(
      buildResumeExtractPrompt({ text }),
      resumeExtractOutputSchema,
      buildResumeExtractRepairPrompt,
      request.signal,
    );
    return {
      draft: run.value,
      model: run.model,
      source: 'ai',
      text,
      repaired: run.repaired,
    };
  } catch (error) {
    // SEC 5.6: a generation that cannot be made valid falls back to the regex parser rather than
    // leaving the user with nothing. Rate limits and dead keys still surface — those are fixable.
    if (error instanceof AiError && error.failure.kind === 'OutputInvalid') return localResult();
    if (error instanceof AiError && error.failure.kind === 'NoKeysConfigured') return localResult();
    throw error;
  }
}

/** F-02 without a gesture, a key or a network: the offline path used when no key is configured. */
export function parseResumeLocally(text: string): ProfileDraft {
  return parseProfileFromText(text);
}

/* ------------------------------------------------------------------------------------------------
 * 4. Field disambiguation (field_disambiguate.v1)
 * ---------------------------------------------------------------------------------------------- */

export interface DisambiguateRequest {
  gesture: string;
  sig: FieldSignature;
  candidates: ProfilePath[];
  profile?: Profile;
  signal?: AbortSignal;
}

export interface DisambiguateResult {
  path: ProfilePath;
  confidence: number;
  model: ModelId;
  keyId: string;
}

/**
 * The optional 50-69 gray-zone assist.
 *
 * INV-2, restated by SEC 5.5 for this template specifically: it runs only when the user clicks
 * "Ask AI to resolve" on that field in the review overlay, never as part of the fill click. The
 * gesture assertion below is that rule in code.
 *
 * There is no repair pass here on purpose: the fallback for a bad disambiguation is the user
 * picking the field themselves, which costs them one click and costs the pool nothing.
 */
export async function disambiguateField(
  request: DisambiguateRequest,
): Promise<DisambiguateResult> {
  // INV-2: gesture first, before a key is even looked at.
  await assertGesture(request.gesture, 'disambiguate field');

  const candidates = request.candidates.filter((path) => path.trim().length > 0);
  if (candidates.length === 0) {
    throw new AiError(
      outputInvalid('field_disambiguate.v1', 'No candidate profile paths were supplied.'),
    );
  }

  const input = {
    sig: request.sig,
    candidates,
    ...(request.profile !== undefined ? { profile: request.profile } : {}),
  };

  const run = await runJsonPrompt(
    buildFieldDisambiguatePrompt(input),
    disambiguateOutputSchema,
    null,
    request.signal,
    {
      // Models routinely answer 1.4 or "0.85". Clamp and coerce rather than burning a request.
      preprocess: (parsed) => {
        if (typeof parsed !== 'object' || parsed === null) return parsed;
        const record = { ...(parsed as Record<string, unknown>) };
        const raw = record['confidence'];
        const numeric = typeof raw === 'string' ? Number(raw) : raw;
        if (typeof numeric === 'number' && Number.isFinite(numeric)) {
          record['confidence'] = Math.min(1, Math.max(0, numeric));
        }
        return record;
      },
      // The model may only answer with a path we offered — anything else is a hallucination.
      audit: (value) =>
        candidates.includes(value.path)
          ? null
          : 'The path "' + value.path + '" was not one of the candidates.',
    },
  );

  return {
    path: run.value.path,
    confidence: Math.min(1, Math.max(0, run.value.confidence)),
    model: run.model,
    keyId: run.keyId,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Readiness
 * ---------------------------------------------------------------------------------------------- */

/** `false` ⇒ render the ✨ affordances disabled with the "Add a free Gemini key" hint (SEC 5.6). */
export async function isAiConfigured(): Promise<boolean> {
  return hasKeys();
}

/* ------------------------------------------------------------------------------------------------
 * Public surface
 * ---------------------------------------------------------------------------------------------- */

export {
  AiError,
  allKeysBusy,
  describeFailure,
  failureToBusError,
  formatCountdown,
  isAiError,
  keyInvalid,
  networkFailed,
  noKeysConfigured,
  outputInvalid,
  toAiFailure,
} from './errors';
export type { AiFailure, AiFailureKind, BusyScope, FailureDescription } from './errors';

export {
  buildGenerateBody,
  classifyError,
  generateContent,
  generateContentUrl,
  validateKey,
} from './gemini-client';
export type {
  GenerateOptions,
  GeminiFailure,
  GeminiResult,
  GeminiSuccess,
  ValidateKeyResult,
} from './gemini-client';

export {
  addKey,
  configureVaultPorts,
  countKeys,
  deleteKey,
  getKeyLabel,
  hasKeys,
  listKeys,
  loadKeyStates,
  maskKey,
  saveKeyStates,
  testKey,
  withDecryptedKey,
} from './vault';
export type { AddKeyResult, StoredKeyRecord, VaultCrypto, VaultStorage } from './vault';

export {
  getModelBudgets,
  getModelChain,
  hasUsableVault,
  leaseKey,
  poolStatus,
  reportOutcome,
  resetDailyLedgers,
  runWithRotation,
  setModelBudgets,
  setModelChain,
} from './rotation-store';
export type { Lease, PoolStatus, RotationOptions, RotationSuccess } from './rotation-store';

export {
  BOILERPLATE_OPENERS,
  BUZZWORDS,
  containsPlaceholderBrackets,
  countSentences,
  countWords,
  detectAiTells,
  findPlaceholderBrackets,
  hasAiTells,
  humanizeAnswer,
  sentenceLengthSpread,
  shouldRewrite,
  splitSentences,
} from './humanize';
export type { AiTell, AiTellSeverity, DetectOptions, HumanizeResult } from './humanize';

/**
 * The text→profile half of resume handling. Safe for every context, including the service worker:
 * `./resume-text` is plain string work with no vendor dependency.
 *
 * The file→text half (`./resume-extract`, pdfjs-dist + mammoth) is deliberately NOT re-exported
 * here and must never be. The MV3 worker imports this barrel, and the worker is bundled as one
 * file — a single re-export from this line would drag ~2 MB of PDF/DOCX parser into every worker
 * wake-up. The Options page imports `@/ai/resume-extract` directly instead (SEC 4.3 Flow C).
 */
export {
  draftCompleteness,
  normalizeExtractedText,
  parseProfileFromText,
  toYearMonth,
} from './resume-text';

export * from './prompts';
