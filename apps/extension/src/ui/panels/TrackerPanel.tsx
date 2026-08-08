import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactElement } from 'react';

import { exportCsv, exportJson, importJson, remove as removeApplication } from '@/tracker/service';
import type { ApplicationRow, AppStatus, AtsId } from '@/shared/types';

import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PanelHeader,
  Select,
  Stat,
  TabPanel,
  Table,
  Tabs,
  Textarea,
  cx,
  nextSort,
  toast,
  type Column,
  type SortState,
} from '@/ui/components';
import { datedFilename, downloadText, pickFile, readFileAsText } from '@/ui/download';
import { formatDate, formatRelative, percent, plural, ratio, titleCase, truncate } from '@/ui/format';
import {
  BOARD_LANES,
  STATUS_LABEL,
  describeError,
  useProfilesStore,
  useTrackerStore,
} from '@/ui/store';
import { useDebouncedValue } from '@/ui/useDebouncedValue';

const ATS_OPTIONS: readonly AtsId[] = [
  'greenhouse',
  'lever',
  'workday',
  'icims',
  'ashby',
  'smartrecruiters',
  'taleo',
  'generic',
];

const STATUS_TONE: Record<AppStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted'> = {
  draft: 'muted',
  applied: 'accent',
  interview: 'warn',
  offer: 'ok',
  rejected: 'danger',
  ghosted: 'neutral',
};

type SortField = 'date' | 'company' | 'role' | 'status' | 'ats' | 'fillScore';

function rowDate(row: ApplicationRow): number {
  return row.appliedAt ?? row.updatedAt ?? 0;
}

function sortRows(rows: readonly ApplicationRow[], sort: SortState<SortField>): ApplicationRow[] {
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case 'company':
        cmp = a.company.localeCompare(b.company);
        break;
      case 'role':
        cmp = a.role.localeCompare(b.role);
        break;
      case 'status':
        cmp = BOARD_LANES.indexOf(a.status) - BOARD_LANES.indexOf(b.status);
        break;
      case 'ats':
        cmp = a.ats.localeCompare(b.ats);
        break;
      case 'fillScore':
        cmp = ratio(a.fillStats.filled, a.fillStats.total) - ratio(b.fillStats.filled, b.fillStats.total);
        break;
      default:
        cmp = rowDate(a) - rowDate(b);
        break;
    }
    if (cmp !== 0) return cmp * dir;
    const byDate = rowDate(a) - rowDate(b);
    return byDate !== 0 ? byDate * dir : a.id.localeCompare(b.id);
  });
}

export function TrackerPanel({
  onOpenAnswers,
}: {
  onOpenAnswers: (search: string) => void;
}): ReactElement {
  const rows = useTrackerStore((state) => state.rows);
  const stats = useTrackerStore((state) => state.stats);
  const filters = useTrackerStore((state) => state.filters);
  const loading = useTrackerStore((state) => state.loading);
  const error = useTrackerStore((state) => state.error);
  const load = useTrackerStore((state) => state.load);
  const setFilters = useTrackerStore((state) => state.setFilters);
  const resetFilters = useTrackerStore((state) => state.resetFilters);
  const update = useTrackerStore((state) => state.update);
  const setStatus = useTrackerStore((state) => state.setStatus);

  const profiles = useProfilesStore((state) => state.profiles);

  const [view, setView] = useState<'table' | 'board'>('table');
  const [sort, setSort] = useState<SortState<SortField>>({ field: 'date', direction: 'desc' });
  const [editing, setEditing] = useState<ApplicationRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApplicationRow | null>(null);
  const [dragOver, setDragOver] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchInput);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (debouncedSearch === filters.search) return;
    void setFilters({ search: debouncedSearch });
  }, [debouncedSearch, filters.search, setFilters]);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  const profileName = (id: string): string => {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (profile === undefined) return '—';
    return profile.label === '' ? 'Untitled' : profile.label;
  };

  const onExportCsv = async (): Promise<void> => {
    setBusy(true);
    try {
      downloadText(datedFilename('jobfill-applications', 'csv'), 'text/csv', await exportCsv());
      toast.ok('CSV exported.');
    } catch (caught) {
      toast.error(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const onExportJson = async (): Promise<void> => {
    setBusy(true);
    try {
      downloadText(
        datedFilename('jobfill-applications', 'json'),
        'application/json',
        await exportJson(),
      );
      toast.ok('JSON backup exported.');
    } catch (caught) {
      toast.error(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (): Promise<void> => {
    const file = await pickFile('.json,application/json');
    if (file === null) return;
    setBusy(true);
    try {
      const result = await importJson(await readFileAsText(file));
      await load();
      toast.ok(
        `Imported ${result.imported} new and updated ${result.updated} existing ${plural(
          result.imported + result.updated,
          'row',
        )}${result.skipped > 0 ? `, skipped ${result.skipped} unreadable` : ''}.`,
      );
    } catch (caught) {
      toast.error(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (row: ApplicationRow): Promise<void> => {
    if (row.url === '') return;
    try {
      await navigator.clipboard.writeText(row.url);
      toast.ok('Link copied.');
    } catch {
      toast.error('The browser refused clipboard access — copy it from the row instead.');
    }
  };

  const saveEdit = async (): Promise<void> => {
    const row = editing;
    if (row === null) return;
    const saved = await update(row.id, {
      company: row.company,
      role: row.role,
      url: row.url,
      notes: row.notes,
      status: row.status,
    });
    setEditing(null);
    if (saved === null) toast.error('Could not save that row.');
    else {
      toast.ok('Application updated.');
      await load();
    }
  };

  type ColumnKey = SortField | 'profile' | 'link' | 'notes' | 'actions';

  const isSortField = (key: ColumnKey): key is SortField =>
    key === 'date' ||
    key === 'company' ||
    key === 'role' ||
    key === 'status' ||
    key === 'ats' ||
    key === 'fillScore';

  const columns: Array<Column<ApplicationRow, ColumnKey>> = [
    {
      key: 'company',
      header: 'Company',
      sortable: true,
      render: (row) => <span className="font-medium">{row.company || '—'}</span>,
    },
    { key: 'role', header: 'Role', sortable: true, render: (row) => row.role || '—' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => (
        <Select
          aria-label={`Status for ${row.company} ${row.role}`}
          className="max-w-36 text-xs"
          value={row.status}
          onChange={(event) => {
            void setStatus(row.id, event.currentTarget.value as AppStatus);
          }}
        >
          {BOARD_LANES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'ats',
      header: 'ATS',
      sortable: true,
      render: (row) => <Badge tone="muted">{row.ats}</Badge>,
    },
    {
      key: 'date',
      header: 'Applied',
      sortable: true,
      render: (row) => (
        <span className="text-xs whitespace-nowrap text-[var(--jf-fg-muted)]">
          {row.appliedAt === null ? 'not yet' : formatDate(row.appliedAt)}
        </span>
      ),
    },
    {
      key: 'profile',
      header: 'Profile',
      render: (row) => (
        <span className="text-xs text-[var(--jf-fg-muted)]">{profileName(row.profileId)}</span>
      ),
    },
    {
      key: 'fillScore',
      header: 'Fill',
      sortable: true,
      align: 'right',
      render: (row) =>
        row.fillStats.total === 0 ? (
          <span className="text-xs text-[var(--jf-fg-subtle)]">—</span>
        ) : (
          <span
            className="text-xs tabular-nums"
            title={`${row.fillStats.filled} of ${row.fillStats.total} fields`}
          >
            {percent(ratio(row.fillStats.filled, row.fillStats.total))}
          </span>
        ),
    },
    {
      key: 'link',
      header: 'Link',
      render: (row) =>
        row.url === '' ? (
          <span className="text-xs text-[var(--jf-fg-subtle)]">—</span>
        ) : (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-[var(--jf-accent)] underline underline-offset-2"
          >
            Open
          </a>
        ),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row) => (
        <span className="text-xs text-[var(--jf-fg-muted)]">
          {row.notes === '' ? '—' : truncate(row.notes, 40)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => setEditing({ ...row })}>
            Edit
          </Button>
          <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const lanes = useMemo(() => {
    const grouped = new Map<AppStatus, ApplicationRow[]>();
    for (const status of BOARD_LANES) grouped.set(status, []);
    for (const row of sorted) grouped.get(row.status)?.push(row);
    return grouped;
  }, [sorted]);

  const onDropInLane = (event: DragEvent<HTMLElement>, status: AppStatus): void => {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer?.getData('text/plain') ?? '';
    if (id === '') return;
    const row = rows.find((candidate) => candidate.id === id);
    if (row === undefined || row.status === status) return;
    void setStatus(id, status);
  };

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Tracker"
        description="Every application NextMove fills is logged here automatically, with the company, role and ATS captured from the posting. Nothing about it leaves this device."
        actions={
          <>
            <Button
              busy={busy}
              onClick={() => {
                void onExportCsv();
              }}
            >
              Export CSV
            </Button>
            <Button
              busy={busy}
              onClick={() => {
                void onExportJson();
              }}
            >
              Export JSON
            </Button>
            <Button
              busy={busy}
              onClick={() => {
                void onImport();
              }}
            >
              Import JSON
            </Button>
          </>
        }
      />

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Applied this week" value={stats?.appliedThisWeek ?? 0} />
        <Stat label="Total" value={stats?.total ?? 0} />
        <Stat label="Active interviews" value={stats?.activeInterviews ?? 0} />
        <Stat
          label="Response rate"
          value={stats === null ? '—' : percent(stats.responseRate)}
          hint="Reached interview or beyond"
        />
        <Stat
          label="Median reply"
          value={
            stats === null || stats.medianDaysToResponse === null
              ? '—'
              : `${stats.medianDaysToResponse}d`
          }
          hint="Days from applying"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-56 flex-1">
          {(props) => (
            <Input
              {...props}
              type="search"
              value={searchInput}
              placeholder="Company, role, notes…"
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Status" className="min-w-40">
          {(props) => (
            <Select
              {...props}
              value={filters.status ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value;
                void setFilters({ status: value === '' ? null : (value as AppStatus) });
              }}
            >
              <option value="">Any status</option>
              {BOARD_LANES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="ATS" className="min-w-40">
          {(props) => (
            <Select
              {...props}
              value={filters.ats ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value;
                void setFilters({ ats: value === '' ? null : (value as AtsId) });
              }}
            >
              <option value="">Any ATS</option>
              {ATS_OPTIONS.map((ats) => (
                <option key={ats} value={ats}>
                  {titleCase(ats)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Profile" className="min-w-40">
          {(props) => (
            <Select
              {...props}
              value={filters.profileId ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value;
                void setFilters({ profileId: value === '' ? null : value });
              }}
            >
              <option value="">Any profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label === '' ? 'Untitled profile' : profile.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          onClick={() => {
            setSearchInput('');
            void resetFilters();
          }}
        >
          Clear
        </Button>
      </div>

      <Tabs
        label="Tracker view"
        value={view}
        onChange={setView}
        items={[
          { key: 'table', label: 'Table', badge: rows.length },
          { key: 'board', label: 'Board' },
        ]}
      />

      {loading && rows.length === 0 ? (
        <p className="text-sm text-[var(--jf-fg-muted)]">Loading applications…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No applications logged yet"
          description="Fill your first application and it appears here as a draft, then flips to “applied” when NextMove sees the confirmation page."
        />
      ) : (
        <>
          <TabPanel active={view === 'table'}>
            <Table
              columns={columns}
              rows={sorted}
              rowKey={(row) => row.id}
              sort={sort}
              onSortChange={(field) => {
                if (!isSortField(field)) return;
                setSort((current) => nextSort(current, field));
              }}
            />
          </TabPanel>

          <TabPanel active={view === 'board'}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {BOARD_LANES.map((status) => {
                const laneRows = lanes.get(status) ?? [];
                return (
                  <section
                    key={status}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOver(status);
                    }}
                    onDragLeave={() => setDragOver((current) => (current === status ? null : current))}
                    onDrop={(event) => onDropInLane(event, status)}
                    className={cx(
                      'flex min-h-40 flex-col gap-2 rounded-[var(--jf-radius)] border p-2 transition-colors',
                      dragOver === status
                        ? 'border-[var(--jf-accent)] bg-[color-mix(in_srgb,var(--jf-accent)_8%,transparent)]'
                        : 'border-[var(--jf-border)] bg-[var(--jf-bg-subtle)]',
                    )}
                  >
                    <header className="flex items-center justify-between gap-2 px-1">
                      <h3 className="text-xs font-semibold text-[var(--jf-fg)]">
                        {STATUS_LABEL[status]}
                      </h3>
                      <Badge tone={STATUS_TONE[status]}>{laneRows.length}</Badge>
                    </header>
                    <ul className="flex flex-col gap-2">
                      {laneRows.map((row) => (
                        <li
                          key={row.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer?.setData('text/plain', row.id);
                          }}
                          className="cursor-grab rounded-[var(--jf-radius-sm)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-2.5 active:cursor-grabbing"
                        >
                          <p className="truncate text-xs font-semibold text-[var(--jf-fg)]">
                            {row.company || 'Unknown company'}
                          </p>
                          <p className="truncate text-xs text-[var(--jf-fg-muted)]">
                            {row.role || 'Unknown role'}
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--jf-fg-subtle)]">
                            {row.appliedAt === null
                              ? 'Draft'
                              : `Applied ${formatRelative(row.appliedAt)}`}
                          </p>
                          <div className="mt-2 flex items-center gap-1.5">
                            <Select
                              aria-label={`Move ${row.company} ${row.role} to another lane`}
                              className="text-[11px]"
                              value={row.status}
                              onChange={(event) => {
                                void setStatus(row.id, event.currentTarget.value as AppStatus);
                              }}
                            >
                              {BOARD_LANES.map((lane) => (
                                <option key={lane} value={lane}>
                                  {STATUS_LABEL[lane]}
                                </option>
                              ))}
                            </Select>
                            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...row })}>
                              Edit
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </TabPanel>
        </>
      )}

      <Notice tone="info">
        A row is created as a draft the first time NextMove fills a form, and flips to
        &ldquo;applied&rdquo; when the page shows a confirmation. That is observation only — NextMove
        never clicks Submit for you.
      </Notice>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit application"
        description={
          editing === null
            ? undefined
            : `Logged ${formatRelative(editing.history[0]?.at ?? editing.updatedAt ?? 0)} · ${editing.ats}`
        }
        footer={
          <>
            {editing !== null && editing.url !== '' ? (
              <>
                <Button
                  onClick={() => {
                    void copyLink(editing);
                  }}
                >
                  Copy link
                </Button>
                <Button
                  onClick={() => {
                    void browser.tabs.create({ url: editing.url });
                  }}
                >
                  Open posting
                </Button>
              </>
            ) : null}
            {editing === null || editing.company === '' ? null : (
              <Button
                onClick={() => {
                  onOpenAnswers(editing.company);
                  setEditing(null);
                }}
              >
                Answers used
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                void saveEdit();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editing === null ? null : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Company">
                {(props) => (
                  <Input
                    {...props}
                    value={editing.company}
                    onChange={(event) =>
                      setEditing({ ...editing, company: event.currentTarget.value })
                    }
                  />
                )}
              </Field>
              <Field label="Role">
                {(props) => (
                  <Input
                    {...props}
                    value={editing.role}
                    onChange={(event) => setEditing({ ...editing, role: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label="Status">
                {(props) => (
                  <Select
                    {...props}
                    value={editing.status}
                    onChange={(event) =>
                      setEditing({ ...editing, status: event.currentTarget.value as AppStatus })
                    }
                  >
                    {BOARD_LANES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Posting URL">
                {(props) => (
                  <Input
                    {...props}
                    type="url"
                    value={editing.url}
                    onChange={(event) => setEditing({ ...editing, url: event.currentTarget.value })}
                  />
                )}
              </Field>
            </div>
            <Field label="Notes">
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={editing.notes}
                  placeholder="Recruiter name, referral, follow-up date…"
                  onChange={(event) => setEditing({ ...editing, notes: event.currentTarget.value })}
                />
              )}
            </Field>
            {editing.history.length === 0 ? null : (
              <div>
                <p className="text-xs font-medium text-[var(--jf-fg-muted)]">History</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {[...editing.history].reverse().map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="text-xs text-[var(--jf-fg-subtle)]">
                      {formatDate(entry.at)} — {STATUS_LABEL[entry.to]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === null) return;
          void removeApplication(target.id).then(async (removed) => {
            if (removed) {
              await load();
              toast.ok('Application deleted.');
            }
          });
        }}
        title={`Delete ${pendingDelete?.company ?? 'this application'}?`}
        description="The row is removed from your tracker. Export a JSON backup first if you want to keep it."
        confirmLabel="Delete row"
      />
    </div>
  );
}
