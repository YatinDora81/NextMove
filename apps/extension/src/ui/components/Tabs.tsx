/**
 * ui/components/Tabs.tsx — the WAI-ARIA tabs pattern, including roving-tabindex arrow keys.
 *
 * Used for the tracker's Table/Board switch (SEC 6.7) and the resume consent → diff flow. Only the
 * selected tab is in the tab order; ←/→/Home/End move between them, which is what a keyboard user
 * expects and what a plain row of buttons gets wrong.
 */

import { useCallback, useRef } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

import { cx } from './cx';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  /** Small trailing count, e.g. the number of rows in a kanban lane. */
  badge?: ReactNode;
}

export interface TabsProps<K extends string> {
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
  /** Accessible name for the tablist; required because these are never the only nav on a page. */
  label: string;
  className?: string;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: TabsProps<K>): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const index = items.findIndex((item) => item.key === value);
      if (index < 0) return;

      let nextIndex: number | null = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      const next = items[nextIndex];
      if (next === undefined) return;
      onChange(next.key);
      const node = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.key}"]`);
      node?.focus();
    },
    [items, onChange, value],
  );

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        'inline-flex items-center gap-1 rounded-[var(--jf-radius-md)] border border-[var(--jf-border)]',
        'bg-[var(--jf-bg-subtle)] p-1',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-tab={item.key}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cx(
              'inline-flex h-7 items-center gap-1.5 rounded-[var(--jf-radius-sm)] px-3 text-xs font-medium',
              'transition-[background-color,color,box-shadow] duration-[var(--jf-duration-fast)] ease-[var(--jf-ease)]',
              selected
                ? 'bg-[var(--jf-surface)] text-[var(--jf-fg)] shadow-[var(--jf-elevation-1)]'
                : 'text-[var(--jf-fg-muted)] hover:text-[var(--jf-fg)]',
            )}
          >
            {item.label}
            {item.badge === undefined ? null : (
              // A `--jf-bg-subtle` pill is invisible on the tablist's own `--jf-bg-subtle`
              // ground; `--jf-border` is the one neutral wash that reads on both tiers.
              <span className="rounded-full bg-[var(--jf-border)] px-1.5 text-[10px] tabular-nums text-[var(--jf-fg-muted)]">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Panel that belongs to a tab. Hidden panels are unmounted rather than `display:none`. */
export function TabPanel({
  active,
  children,
  className,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
}): ReactElement | null {
  if (!active) return null;
  return (
    <div role="tabpanel" tabIndex={-1} className={cx('jf-enter-fast outline-none', className)}>
      {children}
    </div>
  );
}
