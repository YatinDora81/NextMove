/**
 * content/overlay/Toast.tsx — the SEC 5.6 failure surface, rendered in the overlay's shadow root.
 *
 * JF-001 Rev 3.0 · SEC 5.6 "Failure Matrix (user-visible behaviour)":
 *
 *   | All keys cooling        | Toast: "All keys are rate-limited — ready again in 00:47."      |
 *   |                         | Countdown, retry button.                                        |
 *   | All keys daily-exhausted| "Free daily quota used across N keys — resets at midnight PT.    |
 *   |                         |  Add another key to extend."                                    |
 *   | No keys configured      | ✨ affordances render disabled + "Add a free Gemini key (2 min) →"|
 *   | Key revoked/invalid     | Key marked DEAD, badge on the extension icon, row flagged.      |
 *
 * The countdown is live: it ticks once a second off `retryAt` and re-enables Retry the moment the
 * pool is expected to recover, so the user never has to guess whether it is worth trying again.
 * "Never a silent hang" (SEC 5.1) is the whole point of this file.
 *
 * No JSX in this file — `apps/extension/tsconfig.json` does not set a `jsx` factory, so components
 * are written with `createElement`. Behaviour and typing are identical; only the syntax differs.
 *
 * SEC 9.2: every string that could have come from a page (an error message echoed back from a
 * site, a job title) is passed to React as a text child, which sets `textContent`. There is no
 * `dangerouslySetInnerHTML` anywhere in the overlay.
 */

import {
  createElement as h,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { BusError } from '@/shared/messages';

/* ------------------------------------------------------------------------------------------------
 * Shapes
 * ---------------------------------------------------------------------------------------------- */

export type ToastKind = 'cooldown' | 'daily' | 'no-keys' | 'error' | 'info' | 'success';

export interface ToastSpec {
  id: string;
  kind: ToastKind;
  title: string;
  /** Secondary line. Optional — the title alone is often the whole message. */
  message?: string;
  /** epoch ms the pool is expected to recover; drives the live countdown (SEC 5.6). */
  retryAt?: number | null;
  /** Shown in the daily-exhaustion copy: "…across N keys…". */
  keyCount?: number | null;
  /** Retry handler. Rendered only when supplied. */
  onRetry?: (() => void) | undefined;
  /** Offer the "Add a free Gemini key (2 min) →" setup action. */
  setupLink?: boolean;
  /** Auto-dismiss after this many ms. `null`/omitted ⇒ sticky until dismissed. */
  timeoutMs?: number | null;
}

export interface ToastStackProps {
  toasts: readonly ToastSpec[];
  onDismiss: (id: string) => void;
}

/* ------------------------------------------------------------------------------------------------
 * Time formatting
 * ---------------------------------------------------------------------------------------------- */

/** `47_000 → "00:47"`, `3_723_000 → "1:02:03"`. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Ticks once a second while `active`; returns `Date.now()`. */
function useClock(active: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/* ------------------------------------------------------------------------------------------------
 * Options-page link
 * ---------------------------------------------------------------------------------------------- */

/**
 * Try to open the extension's Options page from the content script.
 *
 * Honest limitation: Chrome refuses navigations to `chrome-extension://` pages that originate in a
 * tab's own frame tree unless the target is a web-accessible resource, and JobFill deliberately
 * declares **no** web-accessible resources (SEC 10). So this succeeds on Firefox and fails on
 * Chrome, and callers must render the fallback instruction when it returns false rather than
 * leaving the user staring at a dead link.
 */
export function openOptionsPage(): boolean {
  try {
    const url = browser.runtime.getURL('/options.html');
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    return opened !== null && opened !== undefined;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Bus errors → SEC 5.6 copy
 * ---------------------------------------------------------------------------------------------- */

let toastSeq = 0;

/** Monotonic id so two identical failures still stack rather than replacing each other. */
export function nextToastId(prefix = 'toast'): string {
  toastSeq += 1;
  return `${prefix}-${toastSeq}`;
}

export interface ToastFromErrorOptions {
  onRetry?: (() => void) | undefined;
  /** How many keys are in the vault — fills the "…across N keys…" slot in the SEC 5.6 copy. */
  keyCount?: number | null;
}

/**
 * Map a `BusError` to the exact user-visible behaviour SEC 5.6 prescribes. Anything not in the
 * matrix degrades to a plain error toast carrying the router's own message — which is written for
 * humans, never for a stack trace.
 */
export function toastFromBusError(error: BusError, options: ToastFromErrorOptions = {}): ToastSpec {
  const retryAt = typeof error.retryAt === 'number' ? error.retryAt : null;

  switch (error.code) {
    case 'NO_KEYS':
      return {
        id: nextToastId('no-keys'),
        kind: 'no-keys',
        title: 'AI answers need one of your own Gemini keys',
        message: 'Everything else in NextMove keeps working without it.',
        setupLink: true,
      };

    case 'ALL_KEYS_BUSY':
      // The title is composed live in `toastTitle` so the countdown ticks inside the sentence.
      return {
        id: nextToastId('cooldown'),
        kind: 'cooldown',
        title: 'All keys are rate-limited',
        retryAt,
        onRetry: options.onRetry,
      };

    case 'QUOTA_EXHAUSTED':
      return {
        id: nextToastId('daily'),
        kind: 'daily',
        title: 'Free daily quota used',
        message: 'Resets at midnight PT. Add another key to extend.',
        keyCount: options.keyCount ?? null,
        retryAt,
        setupLink: true,
      };

    case 'KEY_INVALID':
      return {
        id: nextToastId('key'),
        kind: 'error',
        title: 'Google rejected one of your keys',
        message: `${error.message} It is now flagged in Options → AI so you can fix or replace it.`,
        setupLink: true,
      };

    case 'GESTURE_REQUIRED':
    case 'GESTURE_EXPIRED':
      return {
        id: nextToastId('gesture'),
        kind: 'info',
        title: 'That confirmation expired',
        message: 'Click ✨ again — AI runs only on a fresh click, never in the background.',
        timeoutMs: 6_000,
      };

    case 'TIMEOUT':
    case 'NETWORK':
      return {
        id: nextToastId('net'),
        kind: 'error',
        title: 'Could not reach Gemini',
        message: error.message,
        onRetry: options.onRetry,
        timeoutMs: 10_000,
      };

    default:
      return {
        id: nextToastId('err'),
        kind: 'error',
        title: 'NextMove hit a problem',
        message: error.message,
        onRetry: options.onRetry,
        timeoutMs: 10_000,
      };
  }
}

/** A plain informational toast (fill finished, mapping saved, …). */
export function infoToast(title: string, message?: string, timeoutMs: number | null = 5_000): ToastSpec {
  const spec: ToastSpec = { id: nextToastId('info'), kind: 'info', title, timeoutMs };
  if (message !== undefined) spec.message = message;
  return spec;
}

export function successToast(title: string, message?: string): ToastSpec {
  const spec: ToastSpec = { id: nextToastId('ok'), kind: 'success', title, timeoutMs: 4_000 };
  if (message !== undefined) spec.message = message;
  return spec;
}

/* ------------------------------------------------------------------------------------------------
 * Components
 * ---------------------------------------------------------------------------------------------- */

interface ToastProps {
  spec: ToastSpec;
  onDismiss: (id: string) => void;
}

/**
 * SEC 5.6, verbatim where the matrix specifies the wording:
 *   "All keys are rate-limited — ready again in 00:47."
 *   "Free daily quota used across N keys — resets at midnight PT. Add another key to extend."
 * The countdown lives inside the sentence and ticks once a second.
 */
function toastTitle(spec: ToastSpec, now: number): ReactNode {
  if (spec.kind === 'cooldown') {
    const remaining = spec.retryAt === null || spec.retryAt === undefined ? 0 : spec.retryAt - now;
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return 'All keys are rate-limited — ready to try again now.';
    }
    return [
      'All keys are rate-limited — ready again in ',
      h('span', { key: 'c', className: 'jf-toast__countdown' }, formatCountdown(remaining)),
      '.',
    ];
  }

  if (spec.kind === 'daily') {
    const count = spec.keyCount ?? null;
    const across =
      count === null || count <= 0 ? 'across your keys' : `across ${count} ${count === 1 ? 'key' : 'keys'}`;
    return `Free daily quota used ${across}.`;
  }

  return spec.title;
}

export function Toast({ spec, onDismiss }: ToastProps): ReactElement {
  const hasCountdown = spec.kind === 'cooldown' || (spec.retryAt !== null && spec.retryAt !== undefined);
  const now = useClock(hasCountdown);
  const dismiss = useCallback(() => onDismiss(spec.id), [onDismiss, spec.id]);

  const timeout = spec.timeoutMs;
  useEffect(() => {
    if (timeout === null || timeout === undefined || timeout <= 0) return;
    const timer = setTimeout(dismiss, timeout);
    return () => clearTimeout(timer);
  }, [timeout, dismiss]);

  const [setupFailed, setSetupFailed] = useState(false);
  const onSetup = useCallback(() => {
    if (!openOptionsPage()) setSetupFailed(true);
  }, []);

  const retryReady =
    spec.retryAt === null || spec.retryAt === undefined || !Number.isFinite(spec.retryAt)
      ? true
      : now >= spec.retryAt;

  const actions: ReactNode[] = [];
  if (spec.onRetry) {
    actions.push(
      h(
        'button',
        {
          key: 'retry',
          type: 'button',
          className: 'jf-btn jf-btn--tiny jf-btn--primary',
          disabled: !retryReady,
          onClick: () => {
            spec.onRetry?.();
            dismiss();
          },
        },
        retryReady ? 'Retry' : 'Retry when ready',
      ),
    );
  }
  if (spec.setupLink === true) {
    actions.push(
      h(
        'button',
        { key: 'setup', type: 'button', className: 'jf-btn jf-btn--tiny', onClick: onSetup },
        'Add a free Gemini key (2 min) →',
      ),
    );
  }

  const title = toastTitle(spec, now);
  const body = spec.message ?? null;

  return h(
    'div',
    { className: `jf-card jf-toast jf-toast--${spec.kind}`, role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'jf-toast__mark' }),
    h(
      'div',
      { className: 'jf-toast__main' },
      h('div', { className: 'jf-toast__title' }, title),
      body === null ? null : h('div', { className: 'jf-toast__msg' }, body),
      setupFailed
        ? h(
            'div',
            { className: 'jf-toast__msg' },
            'Open the NextMove toolbar icon → Options → AI to add a key.',
          )
        : null,
      actions.length > 0 ? h('div', { className: 'jf-toast__actions' }, actions) : null,
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'jf-btn jf-btn--ghost jf-btn--tiny',
        onClick: dismiss,
        'aria-label': 'Dismiss',
        title: 'Dismiss',
      },
      '✕',
    ),
  );
}

/** Bottom-right stack. Newest sits closest to the corner (the layer is `column-reverse`). */
export function ToastStack({ toasts, onDismiss }: ToastStackProps): ReactElement | null {
  if (toasts.length === 0) return null;
  return h(
    'div',
    { className: 'jf-toasts' },
    toasts.map((spec) => h(Toast, { key: spec.id, spec, onDismiss })),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Imperative controller
 * ---------------------------------------------------------------------------------------------- */

export interface ToastController {
  push: (spec: ToastSpec) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Hard cap so a misbehaving page (or a burst of 429s) cannot paper over the whole viewport. */
const MAX_TOASTS = 3;

/**
 * Owns toast state and hands an imperative `push`/`dismiss` pair back to the caller — the fill
 * orchestrator lives outside React and needs to raise a toast from a plain callback.
 */
export function ToastHost({ bind }: { bind: (api: ToastController) => void }): ReactElement | null {
  const [toasts, setToasts] = useState<ToastSpec[]>([]);
  const bindRef = useRef(bind);
  bindRef.current = bind;

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((spec: ToastSpec) => {
    setToasts((current) => [...current.filter((t) => t.id !== spec.id), spec].slice(-MAX_TOASTS));
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  useEffect(() => {
    bindRef.current({ push, dismiss, clear });
  }, [push, dismiss, clear]);

  return h(ToastStack, { toasts, onDismiss: dismiss });
}
