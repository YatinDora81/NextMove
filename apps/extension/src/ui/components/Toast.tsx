/**
 * ui/components/Toast.tsx — transient confirmations and the SEC 5.6 "all keys are cooling" toast.
 *
 * Self-contained on purpose (the primitives folder owns no bus traffic): it carries its own tiny
 * Zustand store so any panel can call `toast.error(...)` without threading a callback down five
 * levels. Rendered into an `aria-live` region so the message is announced, not just shown.
 */

import { useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { create } from 'zustand';

import { Button } from './Button';
import { cx } from './cx';
import type { NoticeTone } from './Layout';

export interface ToastRecord {
  id: string;
  tone: NoticeTone;
  message: ReactNode;
  /** ms before auto-dismiss; `0` pins the toast until the user closes it. */
  ttl: number;
}

interface ToastState {
  toasts: ToastRecord[];
  push: (tone: NoticeTone, message: ReactNode, ttl?: number) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message, ttl = 4_000) => {
    seq += 1;
    const id = `toast_${seq}`;
    set((state) => ({ toasts: [...state.toasts, { id, tone, message, ttl }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative façade — `toast.ok('Saved')` from anywhere, including non-React helpers. */
export const toast = {
  info: (message: ReactNode, ttl?: number) => useToastStore.getState().push('info', message, ttl),
  ok: (message: ReactNode, ttl?: number) => useToastStore.getState().push('ok', message, ttl),
  warn: (message: ReactNode, ttl?: number) => useToastStore.getState().push('warn', message, ttl),
  /** Errors are pinned by default: a failure the user did not read is a failure they will repeat. */
  error: (message: ReactNode, ttl = 0) => useToastStore.getState().push('danger', message, ttl),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

const TONE_CLASS: Record<NoticeTone, string> = {
  info: 'border-[var(--jf-border-strong)]',
  ok: 'border-[color-mix(in_srgb,var(--jf-ok)_45%,transparent)]',
  warn: 'border-[color-mix(in_srgb,var(--jf-warn)_45%,transparent)]',
  danger: 'border-[color-mix(in_srgb,var(--jf-danger)_45%,transparent)]',
};

const TONE_BAR: Record<NoticeTone, string> = {
  info: 'bg-[var(--jf-accent)]',
  ok: 'bg-[var(--jf-ok)]',
  warn: 'bg-[var(--jf-warn)]',
  danger: 'bg-[var(--jf-danger)]',
};

function ToastItem({ record }: { record: ToastRecord }): ReactElement {
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    if (record.ttl <= 0) return;
    const timer = window.setTimeout(() => dismiss(record.id), record.ttl);
    return () => window.clearTimeout(timer);
  }, [dismiss, record.id, record.ttl]);

  return (
    <div
      className={cx(
        'pointer-events-auto flex items-start gap-2 overflow-hidden rounded-[var(--jf-radius)] border bg-[var(--jf-surface)] pr-1 text-xs shadow-[var(--jf-shadow)]',
        TONE_CLASS[record.tone],
      )}
    >
      <span aria-hidden="true" className={cx('w-1 self-stretch', TONE_BAR[record.tone])} />
      <p className="min-w-0 flex-1 py-2.5 leading-relaxed text-[var(--jf-fg)]">{record.message}</p>
      <Button
        variant="ghost"
        size="sm"
        className="my-1.5"
        onClick={() => dismiss(record.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </Button>
    </div>
  );
}

export function ToastHost({ className }: { className?: string }): ReactElement {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cx(
        'pointer-events-none fixed right-3 bottom-3 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2',
        className,
      )}
    >
      {toasts.map((record) => (
        <ToastItem key={record.id} record={record} />
      ))}
    </div>
  );
}
