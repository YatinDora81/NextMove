/**
 * ui/components/ListEditor.tsx — the two repeating-input patterns the vault editor needs.
 *
 * `ChipList` handles `skills[]`, `links.other[]` and `authorization.authorizedIn[]`.
 * `Repeater` handles `work[]`, `education[]` and the custom Q&A list, including reordering.
 *
 * Both are fully keyboard operable: chips are added with Enter or comma and removed with
 * Backspace on an empty input; every repeater control is a real button with an accessible name.
 */

import { useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

import { ChevronDown, ChevronUp, Close, Plus } from '@/ui/icons';

import { Button } from './Button';
import { Input } from './Input';
import { cx } from './cx';

export function ChipList({
  value,
  onChange,
  placeholder = 'Type and press Enter',
  id,
  describedBy,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  describedBy?: string;
}): ReactElement {
  const [pending, setPending] = useState('');

  const commit = (raw: string): void => {
    const additions = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !value.includes(part));
    if (additions.length > 0) onChange([...value, ...additions]);
    setPending('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(pending);
      return;
    }
    if (event.key === 'Backspace' && pending === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {value.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--jf-border)] bg-[var(--jf-bg-subtle)] py-0.5 pr-1 pl-2.5 text-xs text-[var(--jf-fg)]"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--jf-fg-subtle)] transition-colors hover:text-[var(--jf-danger)]"
              >
                <Close size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        aria-describedby={describedBy}
        value={pending}
        placeholder={placeholder}
        onChange={(event) => setPending(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(pending)}
      />
    </div>
  );
}

export interface RepeaterProps<T> {
  items: readonly T[];
  onChange: (next: T[]) => void;
  /** Factory for a blank entry. */
  create: () => T;
  addLabel: string;
  emptyLabel: string;
  /** Title shown in each entry's header, e.g. "Software Engineer · Acme". */
  title: (item: T, index: number) => ReactNode;
  children: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  className?: string;
}

/** An ordered list of editable records with add / remove / move-up / move-down. */
export function Repeater<T>({
  items,
  onChange,
  create,
  addLabel,
  emptyLabel,
  title,
  children,
  className,
}: RepeaterProps<T>): ReactElement {
  const replace = (index: number, patch: Partial<T>): void => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {items.length === 0 ? (
        <p className="rounded-[var(--jf-radius-sm)] border border-dashed border-[var(--jf-border-strong)] px-3 py-4 text-center text-xs text-[var(--jf-fg-subtle)]">
          {emptyLabel}
        </p>
      ) : (
        items.map((item, index) => (
          <div
            key={index}
            className="rounded-[var(--jf-radius-sm)] border border-[var(--jf-border)] bg-[var(--jf-bg-subtle)] p-3"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-[var(--jf-fg-muted)]">
                {title(item, index)}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove entry"
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                  className="hover:text-[var(--jf-danger)]"
                >
                  <Close size={14} />
                </Button>
              </div>
            </div>
            {children(item, (patch) => replace(index, patch), index)}
          </div>
        ))
      )}
      <div>
        <Button size="sm" onClick={() => onChange([...items, create()])}>
          <Plus size={14} />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
