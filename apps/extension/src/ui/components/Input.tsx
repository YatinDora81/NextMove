/**
 * ui/components/Input.tsx — text input, textarea and native select.
 *
 * All three share one visual language and one focus behaviour so a form built out of them reads as
 * a single control surface. `invalid` maps to `aria-invalid`, which is what assistive tech reads —
 * the red border is the sighted mirror of that, never the only signal.
 */

import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { cx } from './cx';

const CONTROL =
  'w-full rounded-[var(--jf-radius-sm)] border border-[var(--jf-border-strong)] ' +
  'bg-[var(--jf-surface)] text-[var(--jf-fg)] placeholder:text-[var(--jf-fg-subtle)] ' +
  'px-2.5 py-1.5 text-sm transition-colors ' +
  'hover:border-[var(--jf-fg-subtle)] disabled:opacity-60 disabled:cursor-not-allowed';

const INVALID = 'border-[var(--jf-danger)] hover:border-[var(--jf-danger)]';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid = false, className, ...rest }: InputProps): ReactElement {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, invalid && INVALID, className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid = false, className, rows = 4, ...rest }: TextareaProps): ReactElement {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'resize-y leading-relaxed', invalid && INVALID, className)}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  children?: ReactNode;
}

export function Select({ invalid = false, className, children, ...rest }: SelectProps): ReactElement {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'cursor-pointer pr-7', invalid && INVALID, className)}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * A checkbox rendered as a switch. Kept as a real `<input type="checkbox">` so it is reachable by
 * Tab, togglable with Space, and reported correctly by screen readers.
 */
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  id,
  className,
}: SwitchProps): ReactElement {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-2.5 py-1',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--jf-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm text-[var(--jf-fg)]">{label}</span>
        {hint === undefined ? null : (
          <span className="mt-0.5 block text-xs leading-snug text-[var(--jf-fg-muted)]">{hint}</span>
        )}
      </span>
    </label>
  );
}
