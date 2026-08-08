import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

import { Loader } from '@/ui/icons';

import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  block?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--jf-radius-md)] font-medium ' +
  'transition-[background-color,border-color,color,box-shadow] ' +
  'duration-[var(--jf-duration-fast)] ease-[var(--jf-ease)] ' +
  'select-none disabled:opacity-50 disabled:cursor-not-allowed ' +
  'border border-transparent whitespace-nowrap';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-[32px] px-2.5 text-[13px]',
  md: 'h-[36px] px-3.5 text-[14px]',
  lg: 'h-[44px] px-5 text-[15px]',
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
