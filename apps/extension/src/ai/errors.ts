/**
 * ai/errors.ts — the SEC 5.6 failure matrix, made representable.
 *
 * Implements JF-001 Rev 3.0 SEC 5.6 ("Failure Matrix — user-visible behaviour"). Every row of
 * that table maps onto exactly one variant of `AiFailure`, and `describeFailure()` renders the
 * copy the design doc specifies, so the popup, the options page and the in-page overlay all say
 * the same thing without re-deriving it.
 *
 * INV-5: no variant of this union may carry key material. `KeyInvalid` carries the *record id*
 * and the label the user typed, never the key, never the ciphertext.
 * INV-6: this module does not know the NextMove API exists.
 */

import type { BusErrorCode } from '@/shared/messages';

/* ------------------------------------------------------------------------------------------------
 * The union
 * ---------------------------------------------------------------------------------------------- */

/**
 * `AllKeysBusy.scope` separates two rows of the SEC 5.6 table that share a detection path:
 *   - `cooldown` — every key is inside a 429 backoff or its 60s RPM window is full
 *   - `daily`    — every key has spent its RPD budget; nothing recovers before Pacific midnight
 */
export type BusyScope = 'cooldown' | 'daily';

export type AiFailure =
  /** Vault empty. AI affordances render disabled with a setup hint; nothing else is affected. */
  | { kind: 'NoKeysConfigured' }
  /**
   * Nothing in the pool can serve the request right now.
   * `retryAt` is epoch ms (Infinity ⇒ nothing recovers without user action).
   */
  | { kind: 'AllKeysBusy'; retryAt: number; scope: BusyScope; keyCount: number }
  /** Google rejected the key itself (400 API_KEY_INVALID / 403). The key is now DEAD. */
  | { kind: 'KeyInvalid'; keyId: string; label: string; detail: string }
  /** The model answered, but the answer failed Zod even after the one repair retry (SEC 5.6). */
  | { kind: 'OutputInvalid'; template: string; detail: string }
  /** 5xx, timeout, or a dropped socket — after the in-client retries and the key rotation. */
  | { kind: 'NetworkFailed'; status: number | null; detail: string };

export type AiFailureKind = AiFailure['kind'];

/* ------------------------------------------------------------------------------------------------
 * The error object
 * ---------------------------------------------------------------------------------------------- */

/** Thrown by every entry point in `ai/index.ts`. Always carries a `failure` from the union above. */
export class AiError extends Error {
  readonly failure: AiFailure;

  constructor(failure: AiFailure, cause?: unknown) {
    super(describeFailure(failure).message);
    this.name = 'AiError';
    this.failure = failure;
    if (cause !== undefined) this.cause = cause;
    // Keeps `instanceof` correct if a bundler downlevels `class extends Error`.
    Object.setPrototypeOf(this, AiError.prototype);
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}

/** Narrow an unknown thrown value to an `AiFailure`, defaulting to a network failure. */
export function toAiFailure(value: unknown): AiFailure {
  if (isAiError(value)) return value.failure;
  const detail = value instanceof Error ? value.message : String(value);
  return { kind: 'NetworkFailed', status: null, detail };
}

/* ------------------------------------------------------------------------------------------------
 * Constructors — used by vault / rotation-store / index so the shapes stay consistent
 * ---------------------------------------------------------------------------------------------- */

export const noKeysConfigured = (): AiFailure => ({ kind: 'NoKeysConfigured' });

export const allKeysBusy = (retryAt: number, scope: BusyScope, keyCount: number): AiFailure => ({
  kind: 'AllKeysBusy',
  retryAt,
  scope,
  keyCount,
});

export const keyInvalid = (keyId: string, label: string, detail: string): AiFailure => ({
  kind: 'KeyInvalid',
  keyId,
  label,
  detail,
});

export const outputInvalid = (template: string, detail: string): AiFailure => ({
  kind: 'OutputInvalid',
  template,
  detail,
});

export const networkFailed = (status: number | null, detail: string): AiFailure => ({
  kind: 'NetworkFailed',
  status,
  detail,
});

/* ------------------------------------------------------------------------------------------------
 * SEC 5.6 copy
 * ---------------------------------------------------------------------------------------------- */

export interface FailureAction {
  label: string;
  /** `options` ⇒ open the extension options page at the AI tab; `retry` ⇒ re-run the request. */
  target: 'options' | 'retry';
}

export interface FailureDescription {
  /** Bus code the background router should reply with. */
  code: BusErrorCode;
  /** Short headline for a toast/badge. */
  title: string;
  /** The sentence SEC 5.6 specifies. */
  message: string;
  /** epoch ms; `null` when there is nothing to count down to. */
  retryAt: number | null;
  action: FailureAction | null;
}

/**
 * `mm:ss` under an hour, `Hh MMm` above it. Used for the "ready again in 00:47" countdown.
 * Negative and non-finite inputs collapse to `00:00` so a stale ledger cannot render `NaN`.
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => (n < 10 ? '0' + String(n) : String(n));
  if (hours > 0) return String(hours) + 'h ' + pad(minutes) + 'm';
  return pad(minutes) + ':' + pad(seconds);
}

/**
 * Render one failure into the exact user-visible behaviour SEC 5.6 asks for.
 * `now` is injected so the countdown is testable and so this function stays pure.
 */
export function describeFailure(failure: AiFailure, now: number = Date.now()): FailureDescription {
  switch (failure.kind) {
    case 'NoKeysConfigured':
      return {
        code: 'NO_KEYS',
        title: 'No Gemini key yet',
        message:
          'AI features need one of your own Google AI Studio keys. Everything else in ' +
          'NextMove Autofill keeps working without it.',
        retryAt: null,
        action: { label: 'Add a free Gemini key (2 min)', target: 'options' },
      };

    case 'AllKeysBusy': {
      if (failure.scope === 'daily') {
        const keys = failure.keyCount === 1 ? '1 key' : String(failure.keyCount) + ' keys';
        return {
          code: 'QUOTA_EXHAUSTED',
          title: 'Daily free quota used',
          message:
            'Free daily quota used across ' +
            keys +
            ' — resets at midnight PT. Add another key to extend.',
          retryAt: Number.isFinite(failure.retryAt) ? failure.retryAt : null,
          action: { label: 'Add another key', target: 'options' },
        };
      }
      const remaining = Number.isFinite(failure.retryAt) ? failure.retryAt - now : Number.NaN;
      const countdown = formatCountdown(remaining);
      return {
        code: 'ALL_KEYS_BUSY',
        title: 'All keys are rate-limited',
        message: Number.isFinite(failure.retryAt)
          ? 'All keys are rate-limited — ready again in ' + countdown + '.'
          : 'All keys are unavailable — check your keys in Options.',
        retryAt: Number.isFinite(failure.retryAt) ? failure.retryAt : null,
        action: Number.isFinite(failure.retryAt)
          ? { label: 'Retry', target: 'retry' }
          : { label: 'Open key manager', target: 'options' },
      };
    }

    case 'KeyInvalid':
      return {
        code: 'KEY_INVALID',
        title: 'A key was rejected',
        message:
          'Google rejected the key "' +
          failure.label +
          '". It has been marked dead — fix or replace it in Options. ' +
          failure.detail,
        retryAt: null,
        action: { label: 'Open key manager', target: 'options' },
      };

    case 'OutputInvalid':
      return {
        code: 'AI_UNAVAILABLE',
        title: "Couldn't generate",
        message: "Couldn't generate a usable answer, try again.",
        retryAt: null,
        action: { label: 'Try again', target: 'retry' },
      };

    case 'NetworkFailed':
      return {
        code: failure.status === null ? 'NETWORK' : 'AI_UNAVAILABLE',
        title: 'Gemini is unreachable',
        message:
          failure.status === null
            ? 'Could not reach Gemini. Check your connection and try again.'
            : 'Gemini returned an error (' + String(failure.status) + '). Try again in a moment.',
        retryAt: null,
        action: { label: 'Try again', target: 'retry' },
      };

    default: {
      // Exhaustive: a new failure variant must come with its own SEC 5.6 row.
      const never: never = failure;
      throw new TypeError('describeFailure: unhandled failure ' + JSON.stringify(never));
    }
  }
}

/**
 * Convert a failure into the `{ ok:false, error }` payload the MessageBus speaks (SEC 6.6), so a
 * background handler can do `return errReply(...spread)` without re-deriving copy.
 */
export function failureToBusError(
  failure: AiFailure,
  now: number = Date.now(),
): { code: BusErrorCode; message: string; retryAt?: number } {
  const described = describeFailure(failure, now);
  if (described.retryAt !== null) {
    return { code: described.code, message: described.message, retryAt: described.retryAt };
  }
  return { code: described.code, message: described.message };
}
