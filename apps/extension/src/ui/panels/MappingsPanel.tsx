import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { mappingStoreSchema } from '@/shared/schema';
import type { MappingStore } from '@/shared/types';

import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Field,
  Input,
  Notice,
  PanelHeader,
  Select,
  Table,
  toast,
  type Column,
} from '@/ui/components';
import { datedFilename, downloadJson, pickFile, readFileAsText } from '@/ui/download';
import { plural, truncate } from '@/ui/format';
import { PROFILE_PATH_OPTIONS, describeProfilePath } from '@/ui/profilePaths';
import { flattenMappings, useMappingsStore, type MappingRow } from '@/ui/store';

export function MappingsPanel(): ReactElement {
  const mappings = useMappingsStore((state) => state.mappings);
  const loading = useMappingsStore((state) => state.loading);
  const error = useMappingsStore((state) => state.error);
  const load = useMappingsStore((state) => state.load);
  const edit = useMappingsStore((state) => state.edit);
  const remove = useMappingsStore((state) => state.remove);
  const replaceAll = useMappingsStore((state) => state.replaceAll);

  const [domainFilter, setDomainFilter] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MappingRow | null>(null);
  const [pendingWipe, setPendingWipe] = useState(false);
  const datalistId = useId();

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flattenMappings(mappings), [mappings]);

  const domains = useMemo(
    () => [...new Set(rows.map((row) => row.domain))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (domainFilter !== '' && row.domain !== domainFilter) return false;
      if (term === '') return true;
      return (
        row.domain.toLowerCase().includes(term) ||
        row.path.toLowerCase().includes(term) ||
        row.sigHash.toLowerCase().includes(term)
      );
    });
  }, [rows, domainFilter, search]);

  const onExport = (): void => {
    downloadJson(datedFilename('jobfill-mappings', 'json'), mappings);
    toast.ok('Mappings exported.');
  };

  const onImport = async (): Promise<void> => {
    const file = await pickFile('.json,application/json');
    if (file === null) return;
    try {
      const parsed: unknown = JSON.parse(await readFileAsText(file));
      const result = mappingStoreSchema.safeParse(parsed);
      if (!result.success) {
        toast.error('That file is not a NextMove mappings export.');
        return;
      }
      const merged: MappingStore = { ...mappings };
      let added = 0;
      for (const [domain, byHash] of Object.entries(result.data)) {
        const existing = { ...(merged[domain] ?? {}) };
        for (const [hash, path] of Object.entries(byHash)) {
          if (existing[hash] !== path) added += 1;
          existing[hash] = path;
        }
        merged[domain] = existing;
      }
      await replaceAll(merged);
      toast.ok(`${added} ${plural(added, 'mapping')} imported.`);
    } catch {
      toast.error('Could not read that file.');
    }
  };

  const columns: Array<Column<MappingRow>> = [
    {
      key: 'domain',
      header: 'Site',
      render: (row) => <span className="font-medium">{row.domain}</span>,
    },
    {
      key: 'sigHash',
      header: 'Field signature',
      render: (row) => (
        <span className="font-mono text-[11px] text-[var(--jf-fg-subtle)]" title={row.sigHash}>
          {truncate(row.sigHash, 16)}
        </span>
      ),
    },
    {
      key: 'path',
      header: 'Fills from',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Profile path for ${row.domain} field ${row.sigHash}`}
            list={datalistId}
            className="max-w-72 font-mono text-xs"
            defaultValue={row.path}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value === '' || value === row.path) return;
              void edit(row.domain, row.sigHash, value).then(() => toast.ok('Mapping updated.'));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.currentTarget.blur();
            }}
          />
          <Badge tone="muted">{describeProfilePath(row.path)}</Badge>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
          Forget
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Learned mappings"
        description="Every time you correct a field on a site, NextMove remembers the fix for that exact field and replays it forever. These corrections outrank everything else the matcher knows, which is why they live here where you can audit them."
        actions={
          <>
            <Button disabled={rows.length === 0} onClick={onExport}>
              Export
            </Button>
            <Button
              onClick={() => {
                void onImport();
              }}
            >
              Import
            </Button>
            <Button variant="danger" disabled={rows.length === 0} onClick={() => setPendingWipe(true)}>
              Forget all
            </Button>
          </>
        }
      />

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <datalist id={datalistId}>
        {PROFILE_PATH_OPTIONS.map((option) => (
          <option key={option.path} value={option.path}>
            {option.group} — {option.label}
          </option>
        ))}
      </datalist>

      {loading && rows.length === 0 ? (
        <p className="text-sm text-[var(--jf-fg-muted)]">Loading mappings…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing learned yet"
          description="On any application, click a red “unmatched” field in the review overlay and pick what should go in it. That correction lands here."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Site" className="min-w-56">
              {(props) => (
                <Select
                  {...props}
                  value={domainFilter}
                  onChange={(event) => setDomainFilter(event.currentTarget.value)}
                >
                  <option value="">
                    Every site ({domains.length} {plural(domains.length, 'site')})
                  </option>
                  {domains.map((domain) => (
                    <option key={domain} value={domain}>
                      {domain}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Search" className="min-w-56 flex-1">
              {(props) => (
                <Input
                  {...props}
                  type="search"
                  value={search}
                  placeholder="personal.email, greenhouse…"
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              )}
            </Field>
            <p className="pb-2 text-xs text-[var(--jf-fg-muted)]">
              {visible.length} of {rows.length} {plural(rows.length, 'mapping')}
            </p>
          </div>

          <Table
            columns={columns}
            rows={visible}
            rowKey={(row) => `${row.domain}::${row.sigHash}`}
            empty="No mappings match that filter."
          />
        </>
      )}

      <Notice tone="info">
        The signature hash is a fingerprint of the field&apos;s label, name, id, placeholder and
        section heading — not of anything you typed. If a site redesigns its form the hash changes
        and the old mapping simply stops matching; forget it here to keep this list tidy.
      </Notice>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === null) return;
          void remove(target.domain, target.sigHash).then(() => toast.ok('Mapping forgotten.'));
        }}
        title="Forget this mapping?"
        description="The field goes back to being scored by the normal matcher on that site."
        confirmLabel="Forget mapping"
      />

      <ConfirmModal
        open={pendingWipe}
        onClose={() => setPendingWipe(false)}
        onConfirm={() => {
          setPendingWipe(false);
          void replaceAll({}).then(() => toast.ok('All mappings forgotten.'));
        }}
        title="Forget every learned mapping?"
        description="All of your per-site corrections are deleted. Export them first if you might want them back."
        confirmLabel="Forget all"
        confirmWord="FORGET"
      />
    </div>
  );
}
