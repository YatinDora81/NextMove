/**
 * ui/components/Button.tsx — the only button in the extension UI.
 *
 * Keyboard-accessible by construction: it is a real `<button>`, it never removes the focus ring
 * (app.css owns `:focus-visible`), and `busy` disables it while announcing the wait to assistive
 * tech via `aria-busy` rather than swapping the label out from under a screen reader.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *   · The default variant is `secondary`, and stays that way — roughly forty call sites across the
 *     Options panels rely on it. What makes a primary action *read* as primary is therefore not the
 *     default but the distance between the tiers: `primary` is the only filled one, and it is the
 *     only one that carries elevation. A surface should show one at a time.
 *   · Every size clears 32px so a target never falls under the WCAG 2.2 (2.5.8) floor. `sm` used to
 *     be 28px, which is the size the popup's header and section links were being built at.
 */

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

import { Loader } from '@/ui/icons';

import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and blocks interaction without changing the accessible name. */
  busy?: boolean;
  block?: boolean;
  /**
   * Leading icon. Passed here rather than as a child so `busy` can *replace* it with the spinner —
   * a button showing both a spinner and its idle icon reads as two states at once.
   */
  icon?: ReactNode;
  children?: ReactNode;
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--jf-radius-md)] font-medium ' +
  'transition-[background-color,border-color,color,box-shadow] ' +
  'duration-[var(--jf-duration-fast)] ease-[var(--jf-ease)] ' +
  'select-none disabled:opacity-50 disabled:cursor-not-allowed ' +
  'border border-transparent whitespace-nowrap';

/**
 * Heights and type sizes are px, not Tailwind's `h-8`/`text-sm`, and that is not a style choice.
 * app.css sets the root font-size to `--jf-text-md` (14px), so every rem-based utility in this
 * codebase renders at 87.5% of its nominal value: `h-8` is 28px, not 32, and `text-xs` is 10.5px,
 * not 12. A 28px control fails the WCAG 2.2 target-size floor by exactly that rounding.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-[32px] px-2.5 text-[13px]',
  md: 'h-[36px] px-3.5 text-[14px]',
  lg: 'h-[44px] px-5 text-[15px]',
  // Square, for a button whose whole content is one icon. `aria-label` is not optional there.
  icon: 'h-[32px] w-[32px] p-0',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--jf-accent)] text-[var(--jf-accent-contrast)] shadow-[var(--jf-shadow-2)] ' +
    'hover:brightness-110 active:brightness-95',
  secondary:
    'bg-[var(--jf-surface)] text-[var(--jf-fg)] border-[var(--jf-border-strong)] ' +
    'hover:bg-[var(--jf-bg-subtle)]',
  ghost:
    'bg-transparent text-[var(--jf-fg-muted)] hover:bg-[var(--jf-bg-subtle)] ' +
    'hover:text-[var(--jf-fg)]',
  danger:
    'bg-transparent text-[var(--jf-danger)] border-[var(--jf-border-strong)] ' +
    'hover:bg-[var(--jf-danger-soft)]',
};

/**
 * The busy indicator. `jf-spin` (app.css) rather than Tailwind's `animate-spin` because that class
 * also carries the reduced-motion handling: slowed to 1.8s, never stopped, since a frozen spinner
 * reads as a hung UI.
 */
export function Spinner({ className }: { className?: string }): ReactElement {
  return <Loader size={16} className={cx('jf-spin shrink-0', className)} />;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  block = false,
  icon,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      // Never `type="submit"` by default: an extension page has no server form, and a stray
      // submit is exactly the muscle memory INV-1 exists to break.
      type={type}
      aria-busy={busy || undefined}
      disabled={disabled === true || busy}
      className={cx(BASE, SIZES[size], VARIANTS[variant], block && 'w-full', className)}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}
