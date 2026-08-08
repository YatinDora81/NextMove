/**
 * ai/gemini-client.ts — the whole Gemini transport, in one file.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 03   "Deliberate exclusions" — no Gemini SDK. A fetch wrapper is ~60 lines and keeps the
 *            store-review bundle small, so this module uses `fetch` and nothing else.
 *   SEC 2.3  POST /v1beta/models/{model}:generateContent, key in the `x-goog-api-key` HEADER.
 *   SEC 5.2  `validateKey` surfaces Google's rejection message verbatim — users migrating from
 *            unrestricted legacy keys must read Google's own wording, not our paraphrase.
 *   SEC 5.6  2 retries with jitter on network/5xx, then the caller rotates to the next key.
 *
 * INV-5: the plaintext key is a function argument, is used once, and is never logged, stored,
 *        serialised into an error, or placed in a URL.
 * INV-6: this file must not import `API_BASE_URL` and must not reference the NextMove API.
 *        The only origin it knows is `generativelanguage.googleapis.com`.
 */

import type { ModelId, Outcome } from '@repo/rotation';

import {
  GEMINI_API_BASE,
  GEMINI_API_KEY_HEADER,
  GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
  GEMINI_DEFAULT_TEMPERATURE,
  GEMINI_JSON_MIME,
  GEMINI_MODELS_LIST_URL,
  GEMINI_NET_RETRIES,
  GEMINI_RETRY_JITTER_MS,
  GEMINI_TIMEOUT_MS,
} from '@/shared/constants';

/* ------------------------------------------------------------------------------------------------
 * Public shapes
 * ---------------------------------------------------------------------------------------------- */

export interface GenerateOptions {
  model: ModelId;
  /** Plaintext key, borrowed from `vault.withDecryptedKey`. Dropped when this call returns. */
  apiKey: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** `true` ⇒ `responseMimeType: application/json` (resume-parse & matcher-assist paths). */
  json?: boolean;
  /** Overrides `GEMINI_TIMEOUT_MS` (25s). */
  timeoutMs?: number;
  /** Caller-side cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
  /** Overrides `GEMINI_NET_RETRIES` (2). Same key, jittered — SEC 5.6. */
  retries?: number;
}

export interface GeminiSuccess {
  ok: true;
  text: string;
  model: ModelId;
  finishReason: string | null;
  /** How many HTTP attempts this call cost (1 = no retry). */
  attempts: number;
}

export interface GeminiFailure {
  ok: false;
  /** Feed straight into `applyOutcome` / `reportOutcome`. */
  outcome: Outcome;
  /** HTTP status, or `null` for a transport-level failure (DNS, offline, timeout). */
  status: number | null;
  /** Google's own message when there is one, verbatim. Never contains key material. */
  message: string;
  /** `false` ⇒ trying another key cannot help (our bad request, or a safety block). */
  retriable: boolean;
  /** `true` ⇒ the model refused on safety grounds; the key itself is healthy. */
  blocked: boolean;
  attempts: number;
}

export type GeminiResult = GeminiSuccess | GeminiFailure;

export interface ValidateKeyResult {
  ok: boolean;
  /** On failure this is Google's error message VERBATIM (SEC 5.2). */
  message: string;
  outcome: Outcome;
  status: number | null;
}

/* ------------------------------------------------------------------------------------------------
 * Wire types (everything from the network is `unknown` until narrowed)
 * ---------------------------------------------------------------------------------------------- */

interface GeminiPart {
  text?: unknown;
}

interface GeminiCandidate {
  content?: { parts?: unknown } | null;
  finishReason?: unknown;
}

interface GeminiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    details?: unknown;
  };
}

interface GeminiGenerateBody extends GeminiErrorBody {
  candidates?: unknown;
  promptFeedback?: { blockReason?: unknown; blockReasonMessage?: unknown } | null;
}

/* ------------------------------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function jitter(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Read Google's error message out of a parsed body, without ever echoing the request. */
function googleMessage(body: unknown): string {
  if (!isRecord(body)) return '';
  const error = body['error'];
  if (!isRecord(error)) return '';
  const message = error['message'];
  return typeof message === 'string' ? message : '';
}

function googleStatus(body: unknown): string {
  if (!isRecord(body)) return '';
  const error = body['error'];
  if (!isRecord(error)) return '';
  const status = error['status'];
  return typeof status === 'string' ? status : '';
}

/**
 * Everything Google told us about the failure, flattened to one lowercase haystack. Used only for
 * substring classification (`API_KEY_INVALID`, per-day quota ids) — never shown to the user.
 */
function errorHaystack(body: unknown): string {
  if (!isRecord(body)) return '';
  const error = body['error'];
  if (!isRecord(error)) return '';
  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(googleMessage(body)).toLowerCase();
  }
}

/**
 * SEC 2.3 / SEC 5.6 HTTP → `Outcome` mapping, the single place it is decided:
 *   400 with `API_KEY_INVALID` (or an expired/invalid-key message) → `key_invalid`
 *   403 (revoked / permission denied / API disabled)               → `key_invalid`
 *   429                                                            → `http_429`,
 *       or `quota_daily` when the quota Google names is a per-day one
 *   5xx and transport failures                                     → `net_or_5xx`
 *
 * Any other 4xx is *our* bug (a malformed prompt, an unknown model). It is reported as
 * `net_or_5xx` so the optimistic daily unit is refunded and the key is left healthy, but the
 * caller is told `retriable: false` so it does not burn the rest of the pool on it.
 */
export function classifyError(status: number | null, body: unknown): Outcome {
  if (status === null) return { kind: 'net_or_5xx' };
  if (status >= 500) return { kind: 'net_or_5xx' };

  const haystack = errorHaystack(body);

  if (status === 429) {
    // "GenerateRequestsPerDay", "per day", "quota exceeded ... PerDay" → the RPD ledger is spent.
    if (/per\s*-?\s*day|perday|daily\s+quota|requests_per_day/.test(haystack)) {
      return { kind: 'quota_daily' };
    }
    return { kind: 'http_429' };
  }

  if (status === 403) return { kind: 'key_invalid' };

  if (status === 400) {
    // Google returns 400 both for our own malformed requests and for a key it will not honour
    // (invalid, expired, or carrying the referer/IP restrictions SEC 5.2 warns about). Only the
    // latter may quarantine the key, so the message has to name the key AND a key-level problem.
    const namesKey = /api[_ ]?keys?/.test(haystack);
    const namesKeyProblem = /invalid|expired|restrict|blocked|not valid|revoked|unregistered/.test(
      haystack,
    );
    if (namesKey && namesKeyProblem) return { kind: 'key_invalid' };
    return { kind: 'net_or_5xx' };
  }

  if (status === 401) return { kind: 'key_invalid' };

  return { kind: 'net_or_5xx' };
}

/** `true` when another key in the pool might succeed where this one failed. */
function outcomeIsRetriable(outcome: Outcome, status: number | null): boolean {
  switch (outcome.kind) {
    case 'key_invalid':
    case 'http_429':
    case 'quota_daily':
      return true;
    case 'net_or_5xx':
      // A 4xx that is not a key problem is our request's fault; another key cannot fix it.
      return status === null || status >= 500;
    case 'ok':
      return false;
    default: {
      const never: never = outcome;
      throw new TypeError('outcomeIsRetriable: unknown outcome ' + JSON.stringify(never));
    }
  }
}

/** Concatenate every text part of the first candidate — Gemini may split a long answer. */
function extractText(body: GeminiGenerateBody): string {
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0] as GeminiCandidate | undefined;
  if (first === undefined) return '';
  const content = first.content;
  if (!isRecord(content)) return '';
  const parts = content['parts'];
  if (!Array.isArray(parts)) return '';

  let text = '';
  for (const rawPart of parts) {
    const part = rawPart as GeminiPart | undefined;
    if (part !== undefined && typeof part.text === 'string') text += part.text;
  }
  return text;
}

function extractFinishReason(body: GeminiGenerateBody): string | null {
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as GeminiCandidate | undefined;
  if (first === undefined) return null;
  return typeof first.finishReason === 'string' ? first.finishReason : null;
}

function extractBlockReason(body: GeminiGenerateBody): string | null {
  const feedback = body.promptFeedback;
  if (!isRecord(feedback)) return null;
  const reason = feedback['blockReason'];
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

/**
 * One AbortSignal that fires on the 25s timeout, on caller cancellation, or on either.
 * Returns a `dispose` so the timer never outlives the request (service workers are short-lived).
 */
function withTimeout(
  timeoutMs: number,
  external: AbortSignal | undefined,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new DOMException('Gemini request timed out', 'TimeoutError'));
  }, timeoutMs);

  const onExternalAbort = (): void => {
    controller.abort(external?.reason);
  };

  if (external !== undefined) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timer);
      if (external !== undefined) external.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Non-JSON error pages (proxies, captive portals) still deserve a verbatim message.
    return { error: { message: raw.slice(0, 500) } };
  }
}

/* ------------------------------------------------------------------------------------------------
 * generateContent
 * ---------------------------------------------------------------------------------------------- */

/** SEC 2.3 request body — `responseMimeType` only on the JSON-constrained templates. */
interface GenerateRequestBody {
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType?: string;
  };
}

export function buildGenerateBody(options: GenerateOptions): GenerateRequestBody {
  const body: GenerateRequestBody = {
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
      maxOutputTokens: options.maxOutputTokens ?? GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
    },
  };
  if (options.json === true) body.generationConfig.responseMimeType = GEMINI_JSON_MIME;
  return body;
}

/** `.../v1beta/models/{model}:generateContent` — the key is never a query parameter. */
export function generateContentUrl(model: ModelId): string {
  return GEMINI_API_BASE + '/models/' + encodeURIComponent(model) + ':generateContent';
}

/**
 * One logical Gemini generation: up to `retries + 1` HTTP attempts against the *same* key, with
 * jittered backoff, aborting each attempt at 25s. Anything that is not a transport/5xx problem
 * returns immediately so the caller can rotate keys instead of hammering a dead one.
 */
export async function generateContent(options: GenerateOptions): Promise<GeminiResult> {
  const url = generateContentUrl(options.model);
  const payload = JSON.stringify(buildGenerateBody(options));
  const maxRetries = Math.max(0, options.retries ?? GEMINI_NET_RETRIES);
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;

  let attempts = 0;
  let last: GeminiFailure = {
    ok: false,
    outcome: { kind: 'net_or_5xx' },
    status: null,
    message: 'Gemini request was never attempted.',
    retriable: true,
    blocked: false,
    attempts: 0,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attempts += 1;
    const timeout = withTimeout(timeoutMs, options.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // INV-5 / SEC 2.3: header, never the query string — keeps keys out of URL logs.
          [GEMINI_API_KEY_HEADER]: options.apiKey,
        },
        body: payload,
        signal: timeout.signal,
        // No cookies, no credentials — this is a bearer-style API call to a third party.
        credentials: 'omit',
        cache: 'no-store',
      });

      const body = (await readJson(response)) as GeminiGenerateBody | null;

      if (response.ok) {
        const blockReason = extractBlockReason(body ?? {});
        const text = extractText(body ?? {});
        if (blockReason !== null && text.length === 0) {
          // The key worked; the *prompt* was refused. Reporting `ok` keeps the ledger honest.
          return {
            ok: false,
            outcome: { kind: 'ok' },
            status: response.status,
            message: 'Gemini blocked this request (' + blockReason + ').',
            retriable: false,
            blocked: true,
            attempts,
          };
        }
        return {
          ok: true,
          text,
          model: options.model,
          finishReason: extractFinishReason(body ?? {}),
          attempts,
        };
      }

      const outcome = classifyError(response.status, body);
      const verbatim = googleMessage(body);
      last = {
        ok: false,
        outcome,
        status: response.status,
        message:
          verbatim.length > 0
            ? verbatim
            : 'Gemini returned HTTP ' + String(response.status) + ' ' + googleStatus(body),
        retriable: outcomeIsRetriable(outcome, response.status),
        blocked: false,
        attempts,
      };

      // Only 5xx is worth a same-key retry; 429/400/403 need rotation or user action.
      if (response.status < 500 || attempt === maxRetries) return last;
    } catch (error) {
      const aborted =
        error instanceof DOMException &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');

      if (aborted && !timeout.timedOut()) {
        // Caller cancelled — do not retry, and do not blame the key.
        return {
          ok: false,
          outcome: { kind: 'net_or_5xx' },
          status: null,
          message: 'Request cancelled.',
          retriable: false,
          blocked: false,
          attempts,
        };
      }

      last = {
        ok: false,
        outcome: { kind: 'net_or_5xx' },
        status: null,
        message: aborted
          ? 'Gemini did not respond within ' + String(Math.round(timeoutMs / 1000)) + 's.'
          : error instanceof Error
            ? error.message
            : 'Network request failed.',
        retriable: true,
        blocked: false,
        attempts,
      };

      if (attempt === maxRetries) return last;
    } finally {
      timeout.dispose();
    }

    await sleep(jitter(GEMINI_RETRY_JITTER_MS.min, GEMINI_RETRY_JITTER_MS.max) * (attempt + 1));
  }

  return last;
}

/* ------------------------------------------------------------------------------------------------
 * validateKey
 * ---------------------------------------------------------------------------------------------- */

/**
 * The cheapest possible liveness check for a freshly pasted key (SEC 5.3): `GET /v1beta/models`
 * with `pageSize=1`. It costs no generation quota and tells us everything we need.
 *
 * SEC 5.2: on failure the message is Google's own, **verbatim**. Google is mid-migration from
 * unrestricted "standard" keys to restricted auth keys, and its rejection text is the only thing
 * that tells a user their legacy key needs the "Gemini API only" restriction. Paraphrasing it
 * would strand exactly the users who need help.
 */
export async function validateKey(
  apiKey: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ValidateKeyResult> {
  const timeout = withTimeout(options.timeoutMs ?? GEMINI_TIMEOUT_MS, options.signal);

  try {
    const response = await fetch(GEMINI_MODELS_LIST_URL + '?pageSize=1', {
      method: 'GET',
      headers: { [GEMINI_API_KEY_HEADER]: apiKey },
      signal: timeout.signal,
      credentials: 'omit',
      cache: 'no-store',
    });

    if (response.ok) {
      return { ok: true, message: 'Key is valid.', outcome: { kind: 'ok' }, status: response.status };
    }

    const body = await readJson(response);
    const outcome = classifyError(response.status, body);
    const verbatim = googleMessage(body);

    return {
      ok: false,
      // Verbatim, untouched. See SEC 5.2.
      message:
        verbatim.length > 0
          ? verbatim
          : 'Google rejected the key with HTTP ' + String(response.status) + '.',
      outcome,
      status: response.status,
    };
  } catch (error) {
    const aborted =
      error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
    return {
      ok: false,
      message: aborted
        ? 'Google did not respond in time — check your connection and try again.'
        : error instanceof Error
          ? error.message
          : 'Could not reach Google.',
      outcome: { kind: 'net_or_5xx' },
      status: null,
    };
  } finally {
    timeout.dispose();
  }
}
