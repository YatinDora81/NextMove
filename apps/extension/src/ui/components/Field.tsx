/**
 * ui/components/Field.tsx — label + control + hint/error, with the ids wired correctly.
 *
 * The whole point of this component is that nobody has to remember `htmlFor` / `aria-describedby`
 * again: pass a render function and it hands you the id and the describedby to spread onto the
 * control. A vault form with ~60 inputs (SEC 7.2) cannot afford per-field accessibility bookkeeping.
 */

import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cx } from './cx';

export interface FieldRenderProps {
  id: string;
  'aria-describedby': string | undefined;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

export function Field({
  label,
  hint,
  error = null,
  required = false,
  className,
  children,
}: FieldProps): ReactElement {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  const described: string[] = [];
  if (hint !== undefined && hint !== null) described.push(hintId);
  if (error !== null && error !== '') described.push(errorId);

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={controlId} className="text-xs font-medium text-[var(--jf-fg-muted)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--jf-danger)]">*</span> : null}
      </label>
      {children({
        id: controlId,
        'aria-describedby': described.length > 0 ? described.join(' ') : undefined,
      })}
      {hint === undefined || hint === null ? null : (
        <p id={hintId} className="text-xs leading-snug text-[var(--jf-fg-subtle)]">
          {hint}
        </p>
      )}
      {error === null || error === '' ? null : (
        <p id={errorId} role="alert" className="text-xs leading-snug text-[var(--jf-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** A titled block of related fields — the vault editor's structural unit. */
export function FieldSet({
  legend,
  description,
  actions,
  children,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <fieldset
      className={cx(
        'rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4',
        className,
      )}
    >
      <legend className="px-1 text-sm font-semibold text-[var(--jf-fg)]">{legend}</legend>
      <div className="mb-3 flex items-start justify-between gap-3">
        {description === undefined ? (
          <span />
        ) : (
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--jf-fg-muted)]">{description}</p>
        )}
        {actions === undefined ? null : <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {children}
    </fieldset>
  );
}

/** Responsive grid used inside `FieldSet` — one column on narrow panes, `cols` on wide ones. */
export function FieldGrid({
  cols = 2,
  children,
  className,
}: {
  cols?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const template =
    cols === 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : cols === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : 'sm:grid-cols-2';
  return <div className={cx('grid grid-cols-1 gap-3', template, className)}>{children}</div>;
}
