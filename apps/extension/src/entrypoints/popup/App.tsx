import { useCallback, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  BACKUP_NUDGE_DISMISSED_KEY,
  MODE_KEY,
  WEB_APP_URL,
  WEB_CONNECT_PATH,
} from '@/shared/constants';
import type { AppStatus, ApplicationRow, FillReport, TrackerStats } from '@/shared/types';

import { Badge, Button, EmptyState, Select, StatusDot, cx } from '@/ui/components';
import type { BadgeTone } from '@/ui/components';
import { toggleEnabled } from '@/platform/storage';
import { formatCountdown, formatRelative, plural } from '@/ui/format';
import {
  FILL_SHORTCUT,
  TOGGLE_SHORTCUT,
  openShortcutsPage,
  shortcutKeys,
  shortcutText,
  type ShortcutSpec,
} from '@/ui/shortcuts';
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Check,
  ChevronRight,
  Close,
  CloudCheck,
  CloudOff,
  ExternalLink,
  Key,
  Plus,
  Power,
  Settings,
  ShieldCheck,
  User,
  Zap,
} from '@/ui/icons';

import type { IconComponent } from '@/ui/icons';
import {
  STATUS_LABEL,
  call,
  countPool,
  describeError,
  fillActiveTab,
  openOptions,
  openOptionsAt,
  poolCondition,
  poolRetryAt,
  useKeysStore,
  useProfilesStore,
  useSettingsStore,
  useSyncStore,
} from '@/ui/store';

import { useNow } from '@/ui/useNow';

interface FillState {
  busy: boolean;
  report: FillReport | null;
  error: string | null;
  unreachable: boolean;
}

const IDLE: FillState = { busy: false, report: null, error: null, unreachable: false };

interface TrackerSlice {
  rows: ApplicationRow[];
  stats: TrackerStats | null;
}

const STATUS_TONE: Record<AppStatus, BadgeTone> = {
  draft: 'muted',
  applied: 'accent',
  interview: 'warn',
  offer: 'ok',
  rejected: 'danger',
  ghosted: 'neutral',
};

export function App(): ReactElement {
  const profiles = useProfilesStore((state) => state.profiles);
  const activeProfileId = useProfilesStore((state) => state.activeProfileId);
  const loadProfiles = useProfilesStore((state) => state.load);
  const setActive = useProfilesStore((state) => state.setActive);

  const keys = useKeysStore((state) => state.keys);
  const loadKeys = useKeysStore((state) => state.load);

  const syncState = useSyncStore((state) => state.state);
  const loadSync = useSyncStore((state) => state.load);

  const settings = useSettingsStore((state) => state.settings);
  const loadSettings = useSettingsStore((state) => state.load);


  const [fill, setFill] = useState<FillState>(IDLE);
  const [tracker, setTracker] = useState<TrackerSlice>({ rows: [], stats: null });
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(true);

  useEffect(() => {
    const trackerLoad = call('TRACKER_QUERY', { limit: 3 })
      .then((data) => setTracker({ rows: data.rows, stats: data.stats }))
      .catch(() => setTracker({ rows: [], stats: null }));

    void Promise.allSettled([
      loadProfiles(),
      loadKeys(),
      loadSync(),
      loadSettings(),
      trackerLoad,
    ]).then(() => {
      setReady(true);
    });
  }, [loadProfiles, loadKeys, loadSync, loadSettings]);

  // Alt+Shift+N, the in-page panel header and the bubble's power dot all write the same settings
  // slot, so the popup has to follow the storage rather than only its own click.
  useEffect(() => {
    const onChanged = (_changes: unknown, area: string): void => {
      if (area !== 'local') return;
      void loadSettings();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [loadSettings]);


  useEffect(() => {
    void browser.storage.local
      .get([MODE_KEY, BACKUP_NUDGE_DISMISSED_KEY])
      .then((bag) => {
        const stored = bag as Record<string, unknown>;
        const storedMode = stored[MODE_KEY];
        setMode(typeof storedMode === 'string' ? storedMode : null);
        setNudgeDismissed(stored[BACKUP_NUDGE_DISMISSED_KEY] === true);
      })
      .catch(() => undefined);
  }, []);

  const dismissNudge = useCallback(() => {
    setNudgeDismissed(true);
    void browser.storage.local
      .set({ [BACKUP_NUDGE_DISMISSED_KEY]: true })
      .catch(() => undefined);
  }, []);

  const paired = syncState?.paired === true;
  const guest = mode === 'guest' && !paired;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const guestInitial =
    (activeProfile?.personal.firstName.trim().charAt(0) ||
      activeProfile?.label.trim().charAt(0) ||
      'G').toUpperCase();

  const counts = countPool(keys);
  const retryAt = poolRetryAt(keys);
  const condition = poolCondition(keys);
  const now = useNow(1_000, condition === 'cooling' || condition === 'exhausted');
  const hasProfile = profiles.length > 0;
  // Absent settings means "still loading"; the switch reads as on so the popup never flashes an
  // "off" state it is about to contradict.
  const enabled = settings?.enabled !== false;

  // One writer for the power switch, shared with the panel header, the bubble's dot and the
  // shortcut: it reads the stored value under the slot's own lock rather than flipping this
  // component's snapshot, which the shortcut may already have moved (SEC 5.1).
  const onToggleEnabled = useCallback(() => {
    void toggleEnabled();
  }, []);


  const onFill = useCallback(async () => {
    setFill({ ...IDLE, busy: true });
    try {
      const outcome = await fillActiveTab(activeProfileId, 'popup');
      setFill({
        busy: false,
        report: outcome.report,
        error: outcome.error,
        unreachable: outcome.unreachable,
      });
    } catch (error) {
      setFill({ busy: false, report: null, error: describeError(error), unreachable: false });
    }
  }, [activeProfileId]);

  return (
    <div className="flex max-h-[var(--jf-popup-max-height)] flex-col bg-[var(--jf-bg)] text-[var(--jf-fg)]">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--jf-border)] bg-[var(--jf-surface)] px-4 py-2.5">
        {guest ? (
          <span
            aria-hidden
            className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[var(--jf-radius-full)] bg-[var(--jf-surface-sunken-strong)] text-[12px] font-semibold text-[var(--jf-fg-muted)]"
          >
            {guestInitial}
          </span>
        ) : (
          <img
            src="/icons/128.png"
            alt=""
            width={28}
            height={28}
            className="h-[28px] w-[28px] shrink-0 rounded-[var(--jf-radius-md)]"
          />
        )}
        {guest ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">Guest on this device</p>
            <p className="truncate text-[11.5px] leading-snug text-[var(--jf-fg-muted)]">
              Not backed up
            </p>
          </div>
        ) : (
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">NextMove Autofill</p>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleEnabled}
          aria-pressed={enabled}
          aria-label={enabled ? 'Turn NextMove off' : 'Turn NextMove on'}
          title={`${enabled ? 'Turn off' : 'Turn on'} — ${shortcutText(TOGGLE_SHORTCUT)}`}
          className={enabled ? 'text-[var(--jf-ok)]' : 'text-[var(--jf-fg-subtle)]'}
          icon={<Power size={18} />}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={openOptions}
          aria-label="Open settings"
          icon={<Settings size={18} />}
        />
      </header>


      {ready ? (
        <>
          <div className="jf-enter flex shrink-0 flex-col gap-2.5 border-b border-[var(--jf-border)] px-4 py-3">
            {hasProfile ? (
              <label className="flex items-center gap-2.5">
                <span className="shrink-0 text-[12px] font-medium text-[var(--jf-fg-muted)]">
                  Fill using
                </span>
                <Select
                  value={activeProfileId ?? ''}
                  onChange={(event) => {
                    void setActive(event.currentTarget.value);
                  }}
                  className="h-[32px] min-w-0 flex-1 text-[14px]"
                >
                  {activeProfileId === null ? <option value="">Choose a profile…</option> : null}
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label === '' ? 'Untitled profile' : profile.label}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="text-[13px] leading-snug text-[var(--jf-fg-muted)]">
                No profile yet — NextMove needs your name, contact details and work history before
                it can fill anything.
              </p>
            )}

            {hasProfile ? (
              <Button
                variant="primary"
                size="lg"
                block
                busy={fill.busy}
                disabled={!enabled}
                icon={<Zap size={18} />}
                onClick={() => {
                  void onFill();
                }}
              >
                Fill this application
              </Button>

            ) : (
              <Button
                variant="primary"
                size="lg"
                block
                icon={<User size={18} />}
                onClick={openOptions}
              >
                Set up your profile
              </Button>
            )}

            <div role="status" aria-live="polite">
              {!enabled ? (
                <p className="text-center text-[12px] text-[var(--jf-fg-subtle)]">
                  NextMove is off — no suggestions, no filling, on any page. Your saved data is
                  untouched. <ShortcutKeys shortcut={TOGGLE_SHORTCUT} /> turns it back on.
                </p>
              ) : fill.report !== null ? (
                <FillSummary report={fill.report} />
              ) : fill.error !== null ? (
                <FillFailure message={fill.error} unreachable={fill.unreachable} />
              ) : hasProfile ? (
                <p className="text-center text-[12px] text-[var(--jf-fg-subtle)]">
                  Shortcut: <ShortcutKeys shortcut={FILL_SHORTCUT} /> on any application page.
                </p>
              ) : null}
            </div>

          </div>

          <div className="min-h-0 flex-1 divide-y divide-[var(--jf-border)] overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
            {guest ? (
              nudgeDismissed ? null : <BackupNudge onDismiss={dismissNudge} />
            ) : (
              <ConnectionStrip
                paired={paired}
                lastSyncAt={syncState?.lastSyncAt ?? null}
                deviceName={syncState?.deviceName ?? null}
              />
            )}

            <Section
              icon={Key}
              title="AI keys"
              className="jf-enter jf-delay-1"
              action={
                counts.total === 0 ? undefined : (
                  <SectionLink onClick={() => openOptionsAt('keys')}>Manage</SectionLink>
                )
              }
            >
              {counts.total === 0 ? (
                <EmptyState
                  compact
                  icon={Key}
                  title="No AI key yet"
                  description="Filling works fully without one — add a free Gemini key and NextMove can draft the long answers too."
                  action={
                    <Button
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() => openOptionsAt('keys')}
                    >
                      Add a Gemini key
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--jf-fg-muted)]">
                    <span className="font-medium text-[var(--jf-fg)]">
                      {counts.total} {plural(counts.total, 'key')}
                    </span>
                    {counts.ACTIVE > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status="ACTIVE" />
                        {counts.ACTIVE} active
                      </span>
                    ) : null}
                    {counts.COOLDOWN > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status="COOLDOWN" />
                        {counts.COOLDOWN} cooling
                      </span>
                    ) : null}
                    {counts.EXHAUSTED > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status="EXHAUSTED" />
                        {counts.EXHAUSTED} spent
                      </span>
                    ) : null}
                    {counts.DEAD > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status="DEAD" />
                        {counts.DEAD} dead
                      </span>
                    ) : null}
                  </div>

                  {condition === 'exhausted' ? (
                    <p className="mt-1.5 text-[13px] leading-snug text-[var(--jf-fg-muted)]">
                      Free daily quota used across {counts.EXHAUSTED}{' '}
                      {plural(counts.EXHAUSTED, 'key')} — resets at midnight Pacific.
                    </p>
                  ) : condition === 'cooling' && retryAt !== null ? (
                    <p className="mt-1.5 text-[13px] leading-snug text-[var(--jf-warn)]">
                      All keys are rate-limited — ready again in{' '}
                      <span className="font-mono tabular-nums">
                        {formatCountdown(retryAt - now)}
                      </span>
                      .
                    </p>
                  ) : counts.DEAD > 0 ? (
                    <p className="mt-1.5 text-[13px] leading-snug text-[var(--jf-danger)]">
                      {counts.DEAD} {plural(counts.DEAD, 'key')} rejected by Google — fix or replace{' '}
                      {counts.DEAD === 1 ? 'it' : 'them'} in Options.
                    </p>
                  ) : null}
                </>
              )}
            </Section>

            <Section
              icon={Briefcase}
              title="Applications"
              className="jf-enter jf-delay-2"
              action={
                tracker.rows.length === 0 ? undefined : (
                  <SectionLink onClick={() => openOptionsAt('tracker')}>Dashboard</SectionLink>
                )
              }
            >
              {tracker.rows.length === 0 ? (
                <EmptyState
                  compact
                  icon={Briefcase}
                  title="Nothing logged yet"
                  description="Every application you fill is logged here with its company, role and status."
                  action={
                    <Button
                      size="sm"
                      icon={<ChevronRight size={14} />}
                      onClick={() => openOptionsAt('tracker')}
                    >
                      Open dashboard
                    </Button>
                  }
                />
              ) : (
                <>
                  <p className="text-[13px] text-[var(--jf-fg-muted)]">
                    <span className="font-semibold text-[var(--jf-fg)] tabular-nums">
                      {tracker.stats?.appliedThisWeek ?? 0}
                    </span>{' '}
                    this week
                    {tracker.stats === null || tracker.stats.total === 0
                      ? ''
                      : ` · ${tracker.stats.total} in total`}
                  </p>

                  <ul className="mt-1.5 flex flex-col">
                    {tracker.rows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-2 rounded-[var(--jf-radius-md)] py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--jf-fg)]">
                            {row.company === '' ? 'Unknown company' : row.company}
                          </p>
                          <p className="truncate text-[12px] text-[var(--jf-fg-muted)]">
                            {row.role === '' ? row.ats : row.role} ·{' '}
                            {formatRelative(row.appliedAt ?? row.updatedAt ?? 0)}
                          </p>
                        </div>
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          </div>
        </>
      ) : (
        <BootPlaceholder />
      )}

      <footer className="flex shrink-0 flex-col items-center gap-1.5 border-t border-[var(--jf-border)] bg-[var(--jf-surface)] px-4 py-2 text-center">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11.5px] leading-snug text-[var(--jf-fg-subtle)]">
          <span className="flex items-center gap-1">
            <ShortcutKeys shortcut={FILL_SHORTCUT} /> fill
          </span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1">
            <ShortcutKeys shortcut={TOGGLE_SHORTCUT} /> on / off
          </span>
          <button
            type="button"
            onClick={openShortcutsPage}
            className="underline decoration-dotted underline-offset-2 hover:text-[var(--jf-fg)]"
          >
            Change
          </button>
        </p>
        <p className="flex items-center gap-1.5 text-[13px] leading-snug text-[var(--jf-fg-muted)]">
          <ShieldCheck size={14} className="shrink-0 text-[var(--jf-ok)]" />
          NextMove fills the form.
        </p>
        <p className="text-[13px] leading-snug font-medium text-[var(--jf-fg)]">
          You press Submit — always.
        </p>
      </footer>
    </div>
  );
}

function Section({
  icon: Glyph,
  title,
  action,
  className,
  children,
}: {
  icon: IconComponent;
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className={cx('px-4 py-2.5', className)}>
      <div className="flex min-h-[32px] items-center gap-2">
        <Glyph size={14} className="shrink-0 text-[var(--jf-fg-subtle)]" />
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-wide text-[var(--jf-fg-muted)] uppercase">
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function SectionLink({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Button variant="ghost" size="sm" className="-mr-1.5 gap-1 px-1.5" onClick={onClick}>
      {children}
      <ChevronRight size={14} />
    </Button>
  );
}

/**
 * The keys of one shortcut, drawn as they appear on this user's keyboard — `⌥ ⇧ N` on a Mac, joined
 * by `+` everywhere else, because the symbols already read as a chord and "⌥+⇧+N" does not.
 */
function ShortcutKeys({ shortcut }: { shortcut: ShortcutSpec }): ReactElement {
  const keys = shortcutKeys(shortcut);
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap" aria-label={shortcutText(shortcut)}>
      {keys.map((key, index) => (
        <span key={key} className="inline-flex items-center gap-0.5">
          {index > 0 && !isMacKey(keys[0] ?? '') ? <span aria-hidden>+</span> : null}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  );
}

/** A Mac chord is drawn as adjacent symbols; a Windows one needs its plus signs. */
function isMacKey(first: string): boolean {
  return first === '⌥' || first === '⇧' || first === '⌃';
}

function Kbd({ children }: { children: ReactNode }): ReactElement {
  return (
    <kbd className="rounded-[var(--jf-radius-sm)] border border-[var(--jf-border)] bg-[var(--jf-surface)] px-1 py-px font-[var(--jf-font-mono)] text-[11px] text-[var(--jf-fg-muted)]">
      {children}
    </kbd>
  );
}

function BackupNudge({ onDismiss }: { onDismiss: () => void }): ReactElement {
  return (
    <div className="jf-enter px-4 py-2">
      <div className="flex items-start gap-2.5 rounded-[var(--jf-radius-inset)] bg-[var(--jf-bg-subtle)] px-3 py-2.5">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--jf-fg-subtle)]" />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--jf-fg-muted)]">
          Back up your data —{' '}
          <button
            type="button"
            className="text-[var(--jf-accent)] underline-offset-2 hover:underline"
            onClick={() => {
              void browser.tabs.create({ url: `${WEB_APP_URL}${WEB_CONNECT_PATH}` });
            }}
          >
            add an account
          </button>
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss"
          className="-mt-0.5 -mr-1 h-6 w-6"
          icon={<Close size={12} />}
          onClick={onDismiss}
        />
      </div>
    </div>
  );
}

function ConnectionStrip({
  paired,
  lastSyncAt,
  deviceName,
}: {
  paired: boolean;
  lastSyncAt: number | null;
  deviceName: string | null;
}): ReactElement {
  if (paired) {
    return (
      <div className="jf-enter flex items-center gap-2 px-4 py-2 text-[12px] text-[var(--jf-fg-muted)]">
        <CloudCheck size={14} className="shrink-0 text-[var(--jf-ok)]" />
        <span className="min-w-0 flex-1 truncate">
          {lastSyncAt === null ? 'Connected — not synced yet' : `Synced ${formatRelative(lastSyncAt)}`}
          {deviceName === null || deviceName === '' ? '' : ` · ${deviceName}`}
        </span>
      </div>
    );
  }

  return (
    <section className="jf-enter flex items-start gap-2.5 px-4 py-3">
      <CloudOff size={16} className="mt-0.5 shrink-0 text-[var(--jf-fg-subtle)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[var(--jf-fg)]">Not connected</p>
        <p className="mt-0.5 text-[13px] leading-snug text-[var(--jf-fg-muted)]">
          Carry your profile between devices, sealed with a key that never leaves this one.
        </p>
        <Button
          size="sm"
          className="mt-2"
          icon={<ExternalLink size={14} />}
          onClick={() => {
            void browser.tabs.create({ url: `${WEB_APP_URL}${WEB_CONNECT_PATH}` });
          }}
        >
          Connect to NextMove
        </Button>
      </div>
    </section>
  );
}

function BootPlaceholder(): ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-[288px] shrink-0 animate-pulse flex-col gap-2.5 px-4 py-3"
    >
      <div className="h-[32px] rounded-[var(--jf-radius-md)] bg-[var(--jf-bg-subtle)]" />
      <div className="h-[44px] rounded-[var(--jf-radius-md)] bg-[var(--jf-bg-subtle)]" />
      <div className="mt-2 h-4 w-24 rounded-[var(--jf-radius-sm)] bg-[var(--jf-bg-subtle)]" />
      <div className="h-4 w-2/3 rounded-[var(--jf-radius-sm)] bg-[var(--jf-bg-subtle)]" />
      <div className="mt-2 h-4 w-28 rounded-[var(--jf-radius-sm)] bg-[var(--jf-bg-subtle)]" />
      <div className="h-4 w-1/2 rounded-[var(--jf-radius-sm)] bg-[var(--jf-bg-subtle)]" />
    </div>
  );
}

const RESULT_TONE = {
  ok: 'border-[color-mix(in_srgb,var(--jf-ok)_35%,transparent)] bg-[var(--jf-ok-soft)]',
  warn: 'border-[color-mix(in_srgb,var(--jf-warn)_35%,transparent)] bg-[var(--jf-warn-soft)]',
  danger: 'border-[color-mix(in_srgb,var(--jf-danger)_35%,transparent)] bg-[var(--jf-danger-soft)]',
} as const;

function FillSummary({ report }: { report: FillReport }): ReactElement {
  const attention = report.suggested + report.skipped + report.errors;
  const tone = report.errors > 0 ? 'danger' : attention > 0 ? 'warn' : 'ok';
  const Glyph = tone === 'ok' ? Check : tone === 'warn' ? AlertTriangle : AlertCircle;
  const accent =
    tone === 'ok'
      ? 'text-[var(--jf-ok)]'
      : tone === 'warn'
        ? 'text-[var(--jf-warn)]'
        : 'text-[var(--jf-danger)]';

  return (
    <div
      className={cx(
        'jf-enter-fast flex items-start gap-2 rounded-[var(--jf-radius-md)] border px-3 py-2',
        RESULT_TONE[tone],
      )}
    >
      <Glyph size={14} className={cx('mt-0.5 shrink-0', accent)} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-[var(--jf-fg)]">
          Filled <span className="font-semibold">{report.filled}</span>{' '}
          {plural(report.filled, 'field')}
          {report.atsId === '' ? '' : ` on ${report.atsId}`}.
        </p>
        {attention > 0 ? (
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--jf-fg-muted)]">
            {report.suggested > 0 ? `${report.suggested} low-confidence` : ''}
            {report.suggested > 0 && report.skipped > 0 ? ' · ' : ''}
            {report.skipped > 0 ? `${report.skipped} unmatched` : ''}
            {(report.suggested > 0 || report.skipped > 0) && report.errors > 0 ? ' · ' : ''}
            {report.errors > 0 ? `${report.errors} failed` : ''} — check the page before submitting.
          </p>
        ) : (
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--jf-fg-muted)]">
            Everything matched. Review the page, then submit it yourself.
          </p>
        )}
      </div>
    </div>
  );
}

function FillFailure({
  message,
  unreachable,
}: {
  message: string;
  unreachable: boolean;
}): ReactElement {
  return (
    <div
      className={cx(
        'jf-enter-fast flex items-start gap-2 rounded-[var(--jf-radius-md)] border px-3 py-2',
        RESULT_TONE.warn,
      )}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--jf-warn)]" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--jf-fg)]">
        {unreachable
          ? 'NextMove is not running on this tab. Open a job application page and try again — it does not attach to browser or extension pages.'
          : message}
      </p>
    </div>
  );
}
