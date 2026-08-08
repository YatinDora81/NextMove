import type { ReactElement, ReactNode } from 'react';

import { AlertCircle, AlertTriangle, Check, Info } from '@/ui/icons';
import type { IconComponent } from '@/ui/icons';

import { cx } from './cx';

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li';
}): ReactElement {
  return (
    <Tag
      className={cx(
        'rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold tracking-tight text-[var(--jf-fg)]">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-[var(--jf-fg-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Glyph,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-2 rounded-[var(--jf-radius)] border border-dashed',
        'border-[var(--jf-border)] bg-[var(--jf-bg-subtle)] text-center',
        compact ? 'px-4 py-3' : 'px-6 py-10',
        className,
      )}
    >
      {Glyph === undefined ? null : (
        <span
          className={cx(
            'flex items-center justify-center rounded-full bg-[var(--jf-surface)]',
            'text-[var(--jf-fg-subtle)] ring-1 ring-[var(--jf-border)]',
            compact ? 'h-[36px] w-[36px]' : 'h-[48px] w-[48px]',
          )}
        >
          <Glyph size={compact ? 18 : 24} />
        </span>
      )}
      <p className={cx('font-semibold text-[var(--jf-fg)]', compact ? 'text-[13px]' : 'text-[14px]')}>
        {title}
      </p>
      {description === undefined ? null : (
        <p
          className={cx(
            'text-[13px] leading-snug text-[var(--jf-fg-muted)]',
            compact ? 'max-w-[264px]' : 'max-w-md',
          )}
        >
          {description}
        </p>
      )}
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </div>
  );
}

export type NoticeTone = 'info' | 'ok' | 'warn' | 'danger';

const NOTICE: Record<NoticeTone, { border: string; text: string; bg: string; icon: IconComponent }> =
  {
    info: {
      border: 'border-[color-mix(in_srgb,var(--jf-accent)_35%,transparent)]',
      text: 'text-[var(--jf-accent)]',
      bg: 'bg-[color-mix(in_srgb,var(--jf-accent)_8%,transparent)]',
      icon: Info,
    },
    ok: {
      border: 'border-[color-mix(in_srgb,var(--jf-ok)_35%,transparent)]',
      text: 'text-[var(--jf-ok)]',
      bg: 'bg-[color-mix(in_srgb,var(--jf-ok)_8%,transparent)]',
      icon: Check,
    },
    warn: {
      border: 'border-[color-mix(in_srgb,var(--jf-warn)_35%,transparent)]',
      text: 'text-[var(--jf-warn)]',
      bg: 'bg-[color-mix(in_srgb,var(--jf-warn)_8%,transparent)]',
      icon: AlertTriangle,
    },
    danger: {
      border: 'border-[color-mix(in_srgb,var(--jf-danger)_35%,transparent)]',
      text: 'text-[var(--jf-danger)]',
      bg: 'bg-[color-mix(in_srgb,var(--jf-danger)_8%,transparent)]',
      icon: AlertCircle,
    },
  };

export function Notice({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): ReactElement {
  const style = NOTICE[tone];
  const Glyph = style.icon;
  return (
    <div
      role={tone === 'warn' || tone === 'danger' ? 'alert' : undefined}
      className={cx(
        'flex items-start gap-2.5 rounded-[var(--jf-radius)] border px-3.5 py-2.5 text-[13px] leading-relaxed',
        style.border,
        style.bg,
        className,
      )}
    >
      <Glyph className={cx('mt-0.5 shrink-0', style.text)} />
      <div className="min-w-0 flex-1 text-[var(--jf-fg)]">
        {title === undefined ? null : <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cx(
        'rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] px-4 py-3',
        className,
      )}
    >
      <p className="text-[12px] font-medium tracking-wide text-[var(--jf-fg-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1 text-[20px] leading-none font-semibold tabular-nums text-[var(--jf-fg)]">
        {value}
      </p>
      {hint === undefined ? null : (
        <p className="mt-1 text-[12px] text-[var(--jf-fg-subtle)]">{hint}</p>
      )}
    </div>
  );
}
