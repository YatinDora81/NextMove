import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  SYNC_ALARM_PERIOD_MINUTES,
  WEB_APP_URL,
  WEB_CONNECT_PATH,
} from '@/shared/constants';
import type { SyncScope } from '@/shared/types';

import {
  Badge,
  Button,
  ConfirmModal,
  Field,
  Input,
  Notice,
  PanelHeader,
  toast,
} from '@/ui/components';
import { formatRelative } from '@/ui/format';
import {
  ChevronDown,
  ChevronRight,
  CloudCheck,
  CloudOff,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from '@/ui/icons';
import { useProfilesStore, useSyncStore } from '@/ui/store';

const ALL_SCOPES: readonly SyncScope[] = ['profile', 'mappings', 'applications'];

const CONNECT_URL = `${WEB_APP_URL}${WEB_CONNECT_PATH}`;

function defaultDeviceName(): string {
  const agent = navigator.userAgent;
  if (agent.includes('Mac')) return 'Chrome on macOS';
  if (agent.includes('Windows')) return 'Chrome on Windows';
  if (agent.includes('Linux')) return 'Chrome on Linux';
  return 'Chrome';
}

function sanitizeCode(raw: string): string {
  return [...raw.toUpperCase()]
    .filter((char) => PAIR_CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, PAIR_CODE_LENGTH);
}

export function SyncPanel(): ReactElement {
  const state = useSyncStore((store) => store.state);
  const busy = useSyncStore((store) => store.busy);
  const error = useSyncStore((store) => store.error);
  const lastPush = useSyncStore((store) => store.lastPush);
  const lastPull = useSyncStore((store) => store.lastPull);
  const load = useSyncStore((store) => store.load);
  const pair = useSyncStore((store) => store.pair);
  const unpair = useSyncStore((store) => store.unpair);
  const push = useSyncStore((store) => store.push);
  const pull = useSyncStore((store) => store.pull);
  const reloadProfiles = useProfilesStore((store) => store.load);

  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [manualOpen, setManualOpen] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const paired = state?.paired === true;

  useEffect(() => {
    if (paired) return;
    let last = 0;
    const recheck = (): void => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < 1_000) return;
      last = now;
      void load();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [load, paired]);

  const onConnect = useCallback((): void => {
    void browser.tabs.create({ url: CONNECT_URL });
  }, []);

  const onPair = async (): Promise<void> => {
    if (code.length < 6) return;
    const ok = await pair(code, deviceName.trim() === '' ? defaultDeviceName() : deviceName.trim());
    if (ok) {
      setCode('');
      toast.ok('This device is connected to your NextMove account.');
    } else {
      toast.error('That code did not work. Codes expire after five minutes and are single-use.');
    }
  };

  const onPush = async (): Promise<void> => {
    const ok = await push([...ALL_SCOPES]);
    if (ok) toast.ok('Pushed to your NextMove account.');
  };

  const onPull = async (): Promise<void> => {
    const ok = await pull();
    if (!ok) return;
    const result = useSyncStore.getState().lastPull;
    if (result === null || !result.found) {
      toast.info('Your account has no saved profile yet. Press “Sync now” to upload this one.');
      return;
    }
    await reloadProfiles();
    toast.ok(
      result.applied === 0
        ? 'Your cloud profile already matched this device — nothing changed.'
        : `Restored ${result.applied} profile${result.applied === 1 ? '' : 's'} from your account.`,
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Sync"
        description="Optional. Connect this browser to your NextMove account to back up your profile and carry your tracker between machines. NextMove is fully functional without it — this is the only feature in the whole extension that touches a network other than Google."
        actions={
          paired ? (
            <Badge tone="ok">
              <CloudCheck size={12} />
              Connected
            </Badge>
          ) : (
            <Badge tone="muted">
              <CloudOff size={12} />
              Not connected
            </Badge>
          )
        }
      />

      <Notice tone="warn" title="What is never synced">
        Your <strong>Gemini API keys</strong> and your <strong>Answer Bank</strong> never leave this
        device — not in a sync payload, not in a backup, not ever. Your profile travels as
        ciphertext the NextMove server cannot read; only your tracker rows and learned mappings are
        stored in a readable form, because they have to be to show up on the web dashboard.
      </Notice>

      {paired && state !== null ? (
        <ConnectedCard
          busy={busy}
          deviceName={state.deviceName}
          email={state.email}
          lastSyncAt={state.lastSyncAt}
          lastError={state.lastError}
          lastPush={lastPush}
          lastPull={lastPull}
          onPush={() => void onPush()}
          onPull={() => void onPull()}
          onRefresh={() => void load()}
          onDisconnect={() => setConfirmUnpair(true)}
        />
      ) : (
        <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-5">
          <h2 className="text-sm font-semibold text-[var(--jf-fg)]">Connect this device</h2>
          <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--jf-fg-muted)]">
            Your profile is end-to-end encrypted: the key is generated in your browser, stays on
            your devices, and never reaches the NextMove server — so we hold ciphertext we cannot
            open, and neither can anyone who takes our database.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" onClick={onConnect}>
              <ShieldCheck size={16} />
              Connect to NextMove
              <ExternalLink size={14} />
            </Button>
            <p className="text-xs text-[var(--jf-fg-muted)]">
              Opens NextMove in a new tab. Sign in, and the pairing happens by itself — there is
              nothing to copy or type.
            </p>
          </div>

          <div className="mt-5 border-t border-[var(--jf-border)] pt-3">
            <button
              type="button"
              aria-expanded={manualOpen}
              aria-controls="jf-sync-manual"
              onClick={() => setManualOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-[var(--jf-radius-sm)] text-xs font-medium text-[var(--jf-fg-muted)] transition-colors hover:text-[var(--jf-fg)]"
            >
              {manualOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Enter a code instead
            </button>

            {manualOpen ? (
              <div id="jf-sync-manual" className="jf-enter-fast mt-3">
                <p className="max-w-prose text-xs leading-relaxed text-[var(--jf-fg-muted)]">
                  For browsers where the one-click handshake is blocked. On the web, open Settings →
                  Connected devices and press &ldquo;Connect extension&rdquo; — you get an{' '}
                  {PAIR_CODE_LENGTH}-character code, good for five minutes and usable once.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="Pairing code"
                    hint="Letters and digits only — no O, 0, I, 1 or L to confuse."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={code}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="ABCD2345"
                        className="font-mono tracking-[0.2em] uppercase"
                        onChange={(event) => setCode(sanitizeCode(event.currentTarget.value))}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          void onPair();
                        }}
                      />
                    )}
                  </Field>
                  <Field label="Device name" hint="How this browser appears in your device list.">
                    {(props) => (
                      <Input
                        {...props}
                        value={deviceName}
                        onChange={(event) => setDeviceName(event.currentTarget.value)}
                      />
                    )}
                  </Field>
                </div>

                <Button
                  className="mt-3"
                  busy={busy}
                  disabled={code.length < 6}
                  onClick={() => {
                    void onPair();
                  }}
                >
                  Connect
                </Button>
              </div>
            ) : null}
          </div>

          {error === null ? null : (
            <p className="mt-3 text-xs text-[var(--jf-fg-muted)]">
              Not connected. {error}
            </p>
          )}
        </div>
      )}

      <Notice tone="info">
        Connecting adds no new browser permissions. The extension never sees your NextMove password
        and never reads your cookies — the exchange hands it a device-scoped token, stored
        encrypted, which you can revoke from the web at any time.
      </Notice>

      <ConfirmModal
        open={confirmUnpair}
        onClose={() => setConfirmUnpair(false)}
        onConfirm={() => {
          setConfirmUnpair(false);
          void unpair().then(() => toast.ok('Device disconnected.'));
        }}
        title="Disconnect this device?"
        description="Your local profile, tracker and mappings stay exactly as they are. Only the link to your NextMove account is removed."
        confirmLabel="Disconnect"
      />
    </div>
  );
}

function ConnectedCard({
  busy,
  deviceName,
  email,
  lastSyncAt,
  lastError,
  lastPush,
  lastPull,
  onPush,
  onPull,
  onRefresh,
  onDisconnect,
}: {
  busy: boolean;
  deviceName: string | null;
  email: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  lastPush: { profile: boolean; mappings: number; applications: number } | null;
  lastPull: { found: boolean; applied: number } | null;
  onPush: () => void;
  onPull: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}): ReactElement {
  return (
    <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--jf-fg)]">This device</h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[var(--jf-fg-muted)]">Name</dt>
          <dd className="truncate text-sm text-[var(--jf-fg)]">{deviceName ?? 'Unnamed device'}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--jf-fg-muted)]">Account</dt>
          <dd className="truncate text-sm text-[var(--jf-fg)]">{email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--jf-fg-muted)]">Last sync</dt>
          <dd className="text-sm text-[var(--jf-fg)]">{formatRelative(lastSyncAt)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
        NextMove syncs on its own every {SYNC_ALARM_PERIOD_MINUTES} minutes whenever something has
        changed. The buttons below are for when you do not want to wait.
      </p>

      {lastError === null ? null : (
        <Notice tone="warn" className="mt-3">
          Last attempt failed: {lastError}
        </Notice>
      )}

      {lastPush === null ? null : (
        <Notice tone="ok" className="mt-3">
          Pushed {lastPush.profile ? 'your profile, ' : ''}
          {lastPush.mappings} mappings and {lastPush.applications} applications.
        </Notice>
      )}

      {lastPull === null ? null : (
        <Notice tone={lastPull.found ? 'ok' : 'info'} className="mt-3">
          {!lastPull.found
            ? 'Nothing to restore: your account has no saved profile yet.'
            : lastPull.applied === 0
              ? 'Your cloud profile already matched this device — nothing changed.'
              : `Restored ${lastPull.applied} profile${lastPull.applied === 1 ? '' : 's'} from your account.`}
        </Notice>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" busy={busy} onClick={onPush}>
          <RefreshCw size={14} />
          Sync now
        </Button>
        <Button busy={busy} onClick={onPull}>
          <Download size={14} />
          Restore profile from cloud
        </Button>
        <Button variant="ghost" busy={busy} onClick={onRefresh}>
          Refresh status
        </Button>
        <Button variant="danger" className="ml-auto" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
