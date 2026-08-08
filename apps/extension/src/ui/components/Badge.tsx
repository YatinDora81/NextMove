import type { ReactElement, ReactNode } from 'react';

import type { KeyStatus } from '@repo/rotation';

import { cx } from './cx';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--jf-bg-subtle)] text-[var(--jf-fg-muted)] border-[var(--jf-border)]',
  accent:
    'bg-[var(--jf-accent-soft)] text-[var(--jf-accent)] ' +
    'border-[color-mix(in_srgb,var(--jf-accent)_35%,transparent)]',
  ok:
    'bg-[var(--jf-ok-soft)] text-[var(--jf-ok)] ' +
    'border-[color-mix(in_srgb,var(--jf-ok)_35%,transparent)]',
  warn:
    'bg-[var(--jf-warn-soft)] text-[var(--jf-warn)] ' +
    'border-[color-mix(in_srgb,var(--jf-warn)_35%,transparent)]',
  danger:
    'bg-[var(--jf-danger-soft)] text-[var(--jf-danger)] ' +
    'border-[color-mix(in_srgb,var(--jf-danger)_35%,transparent)]',
  muted: 'bg-transparent text-[var(--jf-fg-subtle)] border-[var(--jf-border)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}): ReactElement {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-px text-[12px] font-medium leading-[18px]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const KEY_STATUS_TONE: Record<KeyStatus, BadgeTone> = {
  ACTIVE: 'ok',
  COOLDOWN: 'warn',
  EXHAUSTED: 'muted',
  DEAD: 'danger',
};

const KEY_STATUS_VAR: Record<KeyStatus, string> = {
  ACTIVE: 'var(--jf-key-active)',
  COOLDOWN: 'var(--jf-key-cooldown)',
  EXHAUSTED: 'var(--jf-key-exhausted)',
  DEAD: 'var(--jf-key-dead)',
};

export const KEY_STATUS_LABEL: Record<KeyStatus, string> = {
  ACTIVE: 'Active',
  COOLDOWN: 'Cooling down',
  EXHAUSTED: 'Daily quota used',
  DEAD: 'Rejected by Google',
};

export function StatusDot({
  status,
  label,
  className,
}: {
  status: KeyStatus;
  label?: string;
  className?: string;
}): ReactElement {
  const name = label ?? KEY_STATUS_LABEL[status];
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cx('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: KEY_STATUS_VAR[status] }}
    />
  );
}

export function KeyStatusBadge({ status }: { status: KeyStatus }): ReactElement {
  return (
    <Badge tone={KEY_STATUS_TONE[status]}>
      <StatusDot status={status} />
      {KEY_STATUS_LABEL[status]}
    </Badge>
  );
}

export function Meter({
  value,
  label,
  className,
}: {
  value: number;
  label?: ReactNode;
  className?: string;
}): ReactElement {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone = pct >= 80 ? 'var(--jf-ok)' : pct >= 45 ? 'var(--jf-warn)' : 'var(--jf-danger)';
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label === undefined ? null : (
        <div className="flex items-baseline justify-between gap-2 text-[13px] text-[var(--jf-fg-muted)]">
          <span>{label}</span>
          <span className="font-semibold tabular-nums text-[var(--jf-fg)]">{pct}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : 'Profile completeness'}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--jf-bg-subtle)]"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, backgroundColor: tone }}
        />
      </div>
    </div>
  );
}
