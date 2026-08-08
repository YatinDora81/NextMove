import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { DEFAULT_MODEL_BUDGETS, MAX_KEYS_PER_REQUEST } from '@repo/rotation';

import type { GeminiKeyPublic } from '@/shared/types';

import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Field,
  Input,
  KeyStatusBadge,
  Notice,
  PanelHeader,
  Table,
  toast,
  type Column,
} from '@/ui/components';
import { formatCountdown, formatRelative } from '@/ui/format';
import { mintGesture } from '@/ui/gesture';
import { countPool, describeError, poolCondition, poolRetryAt, useKeysStore } from '@/ui/store';
import { useNow } from '@/ui/useNow';

const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';

export function KeysPanel(): ReactElement {
  const keys = useKeysStore((state) => state.keys);
  const model = useKeysStore((state) => state.model);
  const loading = useKeysStore((state) => state.loading);
  const busy = useKeysStore((state) => state.busy);
  const error = useKeysStore((state) => state.error);
  const lastTest = useKeysStore((state) => state.lastTest);
  const load = useKeysStore((state) => state.load);
  const add = useKeysStore((state) => state.add);
  const test = useKeysStore((state) => state.test);
  const remove = useKeysStore((state) => state.remove);

  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [pendingDelete, setPendingDelete] = useState<GeminiKeyPublic | null>(null);

  const counts = countPool(keys);
  const retryAt = poolRetryAt(keys);
  const condition = poolCondition(keys);
  const now = useNow(1_000, keys.some((key) => key.retryAt !== null));

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async (): Promise<void> => {
    const trimmedKey = secret.trim();
    const trimmedLabel = label.trim();
    if (trimmedKey === '' || trimmedLabel === '') return;
    try {
      const gesture = await mintGesture('validate a new Gemini key');
      const record = await add(trimmedKey, trimmedLabel, gesture);
      if (record === null) return;
      setSecret('');
      setLabel('');
      toast.ok(`“${record.label}” added and validated with Google.`);
    } catch (caught) {
      toast.error(describeError(caught));
    }
  };

  const onTest = async (key: GeminiKeyPublic): Promise<void> => {
    try {
      const gesture = await mintGesture('re-validate a Gemini key');
      const ok = await test(key.id, gesture);
      if (ok) toast.ok(`“${key.label}” is working.`);
    } catch (caught) {
      toast.error(describeError(caught));
    }
  };

  const columns: Array<Column<GeminiKeyPublic>> = [
    {
      key: 'label',
      header: 'Label',
      render: (key) => <span className="font-medium">{key.label}</span>,
    },
    {
      key: 'masked',
      header: 'Key',
      render: (key) => (
        <span className="jf-key-mask text-xs text-[var(--jf-fg-muted)]">{key.masked}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (key) => <KeyStatusBadge status={key.status} /> },
    {
      key: 'ready',
      header: 'Ready',
      render: (key) => {
        if (key.status === 'DEAD') {
          return <span className="text-xs text-[var(--jf-danger)]">Needs replacing</span>;
        }
        if (key.retryAt === null) {
          return <span className="text-xs text-[var(--jf-ok)]">Now</span>;
        }
        return (
          <span className="font-mono text-xs tabular-nums text-[var(--jf-warn)]">
            in {formatCountdown(key.retryAt - now)}
          </span>
        );
      },
    },
    {
      key: 'strikes',
      header: 'Strikes',
      align: 'right',
      render: (key) => <span className="tabular-nums">{key.strikes}</span>,
    },
    {
      key: 'lastUsedAt',
      header: 'Last used',
      render: (key) => (
        <span className="text-xs text-[var(--jf-fg-muted)]">{formatRelative(key.lastUsedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (key) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              void onTest(key);
            }}
          >
            Test
          </Button>
          <Button size="sm" variant="danger" onClick={() => setPendingDelete(key)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="AI keys"
        description="NextMove uses your own Google Gemini keys, on free-tier models, straight from this browser to Google. There is no NextMove server in that path and no AI cost to you."
      />

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      {keys.length > 0 && counts.DEAD > 0 ? (
        <Notice tone="danger" title="A key was rejected by Google">
          {counts.DEAD} {counts.DEAD === 1 ? 'key is' : 'keys are'} marked dead. Google refused it —
          the usual cause is an unrestricted legacy key (see the note below) or a key that was
          deleted in AI Studio. Fix it there and press Test, or delete it here.
        </Notice>
      ) : null}

      {condition === 'exhausted' ? (
        <Notice tone="warn" title="Free daily quota used">
          Free daily quota used across {counts.EXHAUSTED}{' '}
          {counts.EXHAUSTED === 1 ? 'key' : 'keys'}.{' '}
          {retryAt === null ? (
            <>Resets at midnight Pacific, which is when Google resets free-tier quotas.</>
          ) : (
            <>
              Resets in{' '}
              <span className="font-mono tabular-nums">{formatCountdown(retryAt - now)}</span> — at
              midnight Pacific, which is when Google resets free-tier quotas.
            </>
          )}{' '}
          Add another key to extend today.
        </Notice>
      ) : condition === 'cooling' && retryAt !== null ? (
        <Notice tone="warn" title="All keys are rate-limited">
          Ready again in{' '}
          <span className="font-mono tabular-nums">{formatCountdown(retryAt - now)}</span>. Adding a
          second key roughly doubles your free throughput — rotation is least-recently-used across
          the pool.
        </Notice>
      ) : null}

      <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--jf-fg)]">Add a key</h2>
        <p className="mt-1 text-xs text-[var(--jf-fg-muted)]">
          Create one free at{' '}
          <a
            href={AI_STUDIO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--jf-accent)] underline underline-offset-2"
          >
            Google AI Studio
          </a>{' '}
          — it takes about two minutes. NextMove validates it immediately with the cheapest possible
          call and tells you exactly what Google said.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
          <Field label="Label" hint="“personal”, “second account”…">
            {(props) => (
              <Input
                {...props}
                value={label}
                placeholder="personal"
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="API key" hint="Stored encrypted. Shown masked from the moment you add it.">
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                placeholder="AIza…"
                onChange={(event) => setSecret(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void onAdd();
                }}
              />
            )}
          </Field>
          <Button
            variant="primary"
            busy={busy}
            disabled={secret.trim() === '' || label.trim() === ''}
            onClick={() => {
              void onAdd();
            }}
          >
            Add &amp; validate
          </Button>
        </div>

        {lastTest === null ? null : (
          <Notice tone={lastTest.ok ? 'ok' : 'danger'} className="mt-3">
            {lastTest.message}
          </Notice>
        )}
      </div>

      {loading && keys.length === 0 ? (
        <p className="text-sm text-[var(--jf-fg-muted)]">Loading your key pool…</p>
      ) : keys.length === 0 ? (
        <EmptyState
          title="No keys yet"
          description="Every non-AI feature works without one — filling, the tracker, mappings, the Answer Bank. Keys only unlock generated answers, cover letters and resume parsing."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              {counts.total} {counts.total === 1 ? 'key' : 'keys'}
            </Badge>
            {counts.ACTIVE > 0 ? <Badge tone="ok">{counts.ACTIVE} active</Badge> : null}
            {counts.COOLDOWN > 0 ? <Badge tone="warn">{counts.COOLDOWN} cooling</Badge> : null}
            {counts.EXHAUSTED > 0 ? <Badge tone="muted">{counts.EXHAUSTED} spent today</Badge> : null}
            {counts.DEAD > 0 ? <Badge tone="danger">{counts.DEAD} dead</Badge> : null}
            {model === null ? null : (
              <span className="text-xs text-[var(--jf-fg-subtle)]">
                Rotation state shown for <span className="font-mono">{model}</span>
              </span>
            )}
          </div>
          <Table columns={columns} rows={keys} rowKey={(key) => key.id} />
        </>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Notice tone="info" title="Create restricted keys (Google is changing this)">
          Google is migrating the Gemini API from unrestricted &ldquo;standard&rdquo; keys to
          restricted auth keys. New keys made in AI Studio are already restricted by default;
          unrestricted legacy keys are being rejected now, with a full cutoff in September 2026. If
          you are reusing an old key, add the <strong>&ldquo;Gemini API only&rdquo;</strong>{' '}
          restriction to it. If you skip that, the validation call above will show you Google&apos;s
          rejection message word for word.
        </Notice>

        <Notice tone="warn" title="How your keys are stored — and what that does not protect against">
          Each key is encrypted with AES-256-GCM under a vault key derived with PBKDF2 (210,000
          iterations, SHA-256) from a random per-install secret, and decrypted only inside the
          service worker at the moment of a call.{' '}
          <strong>
            The install secret lives on the same device, so this defeats casual file-system snooping
            and backup leakage, not malware running as you.
          </strong>{' '}
          An optional passphrase mode upgrades this to real end-to-end strength and is required
          before any Phase-2 sync. Keys are never synced, never logged, and never sent anywhere
          except Google.
        </Notice>
      </div>

      <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--jf-fg)]">How rotation works</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
          Requests go to the least-recently-used healthy key. A 429 puts that key on a 60 s → 5 min
          → 30 min cooldown and the next key takes over silently; a request tries at most{' '}
          {MAX_KEYS_PER_REQUEST} keys before giving up. Daily budgets reset at midnight Pacific.
          With N keys you get roughly N× the free throughput.
        </p>
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--jf-fg-subtle)]">
              <th scope="col" className="py-1 font-medium">
                Model
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Requests / minute
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Requests / day
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(DEFAULT_MODEL_BUDGETS).map(([id, budget]) => (
              <tr key={id} className="border-t border-[var(--jf-border)]">
                <td className="py-1 font-mono text-[var(--jf-fg)]">{id}</td>
                <td className="py-1 text-right tabular-nums text-[var(--jf-fg-muted)]">
                  ~{budget.rpm}
                </td>
                <td className="py-1 text-right tabular-nums text-[var(--jf-fg-muted)]">
                  ~{budget.rpd}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-[var(--jf-fg-subtle)]">
          These figures are approximate and configuration-driven: Google revises free-tier limits
          without notice, so NextMove treats them as soft ceilings and updates them from remote
          config rather than shipping them as facts.
        </p>
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === null) return;
          void remove(target.id).then(() => toast.ok(`“${target.label}” deleted.`));
        }}
        title={`Delete “${pendingDelete?.label ?? ''}”?`}
        description="The stored ciphertext is shredded immediately. The key itself keeps working in Google AI Studio — revoke it there if you want it gone for good."
        confirmLabel="Delete key"
      />
    </div>
  );
}
