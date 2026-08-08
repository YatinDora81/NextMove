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

export type ToastKind = 'cooldown' | 'daily' | 'no-keys' | 'error' | 'info' | 'success';

export interface ToastSpec {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  retryAt?: number | null;
  keyCount?: number | null;
  onRetry?: (() => void) | undefined;
  setupLink?: boolean;
  timeoutMs?: number | null;
}

export interface ToastStackProps {
  toasts: readonly ToastSpec[];
  onDismiss: (id: string) => void;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

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

export function openOptionsPage(): boolean {
  try {
    const url = browser.runtime.getURL('/options.html');
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    return opened !== null && opened !== undefined;
  } catch {
    return false;
  }
}

let toastSeq = 0;

export function nextToastId(prefix = 'toast'): string {
  toastSeq += 1;
  return `${prefix}-${toastSeq}`;
}

export interface ToastFromErrorOptions {
  onRetry?: (() => void) | undefined;
  keyCount?: number | null;
}

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
        message: 'Click Answer again — AI runs only on a fresh click, never in the background.',
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

interface ToastProps {
  spec: ToastSpec;
  onDismiss: (id: string) => void;
}

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

export function ToastStack({ toasts, onDismiss }: ToastStackProps): ReactElement | null {
  if (toasts.length === 0) return null;
  return h(
    'div',
    { className: 'jf-toasts' },
    toasts.map((spec) => h(Toast, { key: spec.id, spec, onDismiss })),
  );
}

export interface ToastController {
  push: (spec: ToastSpec) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_TOASTS = 3;

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
