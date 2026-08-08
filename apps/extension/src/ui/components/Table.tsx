import type { ReactElement, ReactNode } from 'react';

import { ChevronDown, ChevronUp } from '@/ui/icons';

import { cx } from './cx';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  field: K;
  direction: SortDirection;
}

export interface Column<T, K extends string = string> {
  key: K;
  header: ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render: (row: T) => ReactNode;
}

export interface TableProps<T, K extends string = string> {
  columns: ReadonlyArray<Column<T, K>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: SortState<K> | null;
  onSortChange?: (field: K) => void;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function Table<T, K extends string = string>({
  columns,
  rows,
  rowKey,
  sort = null,
  onSortChange,
  empty = 'Nothing here yet.',
  onRowClick,
  className,
}: TableProps<T, K>): ReactElement {
  return (
    <div
      className={cx(
        'overflow-x-auto rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)]',
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--jf-border)] bg-[var(--jf-bg-subtle)]">
            {columns.map((column) => {
              const active = sort !== null && sort.field === column.key;
              const ariaSort = active
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cx(
                    'px-3 py-2 text-xs font-semibold whitespace-nowrap text-[var(--jf-fg-muted)]',
                    ALIGN[column.align ?? 'left'],
                    column.className,
                  )}
                >
                  {column.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(column.key)}
                      className="inline-flex items-center gap-1 rounded-[var(--jf-radius-sm)] hover:text-[var(--jf-fg)]"
                    >
                      {column.header}
                      {active && sort.direction === 'asc' ? (
                        <ChevronUp size={12} className="shrink-0" />
                      ) : (
                        <ChevronDown size={12} className={cx('shrink-0', !active && 'opacity-40')} />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-10 text-center text-sm text-[var(--jf-fg-subtle)]"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                className={cx(
                  'border-b border-[var(--jf-border)] last:border-b-0',
                  onRowClick !== undefined && 'cursor-pointer hover:bg-[var(--jf-bg-subtle)]',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-3 py-2 align-middle text-[var(--jf-fg)]',
                      ALIGN[column.align ?? 'left'],
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function nextSort<K extends string>(current: SortState<K>, field: K): SortState<K> {
  if (current.field !== field) return { field, direction: 'desc' };
  return { field, direction: current.direction === 'desc' ? 'asc' : 'desc' };
}
