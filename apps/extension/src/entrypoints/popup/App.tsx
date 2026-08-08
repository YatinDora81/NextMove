/**
 * entrypoints/popup/App.tsx — the quick-action surface.
 *
 * SEC 4.2 gives the popup exactly four jobs and forbids the fifth:
 *   owns → one-click fill trigger · profile switcher · key-pool health at a glance
 *   plus → the SEC 6.7 popup mini-tracker (count this week, last 3 applications, open dashboard)
 *   never → heavy editors. Those are the Options app, one click away at the bottom.
 *
 * INV-1 is visible here, not just enforced: the primary button says "Fill this application", the
 * footer says NextMove never presses Submit, and there is no code path in this bundle that could.
 * The fill itself is a `FILL_REQUEST` to the active tab's content script — the popup never touches
 * page DOM.
 *
 * ── The shell, and why it is built this way ─────────────────────────────────────────────────────
 *
 * Chrome sizes a browser-action popup to its document and then clips at ~600px *without giving it a
 * scrollbar*. Four stacked sections at their fullest (a four-state key pool plus three tracker rows)
 * cleared that, so the bottom of the sheet — including the INV-1 promise — could silently vanish.
 * The fix is a three-band layout: header and footer are `shrink-0`, and exactly one band scrolls,
 * bounded by `--jf-popup-max-height` (560px, deliberately short of Chrome's cap so the scroll reads
 * as ours). The primary action sits in the fixed band above the scroller: the one thing this surface
 * exists for must never be something you have to scroll to find.
 *
 * Everything below the header waits for one `Promise.allSettled` over the four loads. Four
 * independent gates would each flash their own empty state ("No profile yet", "No AI key yet",
 * "Nothing logged yet", "Not connected") for as long as the service worker takes to wake — which is
 * the exact moment a user is most likely to believe them.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { WEB_APP_URL, WEB_CONNECT_PATH } from '@/shared/constants';
import type { AppStatus, ApplicationRow, FillReport, TrackerStats } from '@/shared/types';

import { Badge, Button, EmptyState, Select, StatusDot, cx } from '@/ui/components';
import type { BadgeTone } from '@/ui/components';
import { formatCountdown, formatRelative, plural } from '@/ui/format';
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Check,
  ChevronRight,
  CloudCheck,
  CloudOff,
  ExternalLink,
  Key,
  Plus,
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

/** The SEC 6.7 mini-tracker slice. One state, so "loaded but empty" is distinguishable from "not
 *  loaded yet" without a second boolean. */
interface TrackerSlice {
  rows: ApplicationRow[];
  stats: TrackerStats | null;
}

/** Mirrors the tracker dashboard's lane colours so a row means the same thing in both places. */
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

  const [fill, setFill] = useState<FillState>(IDLE);
  const [tracker, setTracker] = useState<TrackerSlice>({ rows: [], stats: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const trackerLoad = call('TRACKER_QUERY', { limit: 3 })
      .then((data) => setTracker({ rows: data.rows, stats: data.stats }))
      // A tracker that cannot answer must not stop the popup from filling (INV-3).
      .catch(() => setTracker({ rows: [], stats: null }));

    // The three store loads swallow their own failures and settle as "empty" — INV-3 again, and
    // the reason `allSettled` here is about timing rather than about error handling.
    void Promise.allSettled([loadProfiles(), loadKeys(), loadSync(), trackerLoad]).then(() => {
      setReady(true);
    });
  }, [loadProfiles, loadKeys, loadSync]);

  const counts = countPool(keys);
  const retryAt = poolRetryAt(keys);
  const condition = poolCondition(keys);
  const now = useNow(1_000, condition === 'cooling' || condition === 'exhausted');
  const hasProfile = profiles.length > 0;

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
        {/* The brand mark itself, not a redrawn approximation of it. `icons/128.png` is generated
            from apps/web/public/logo.png by scripts/make-icons.mjs and is the very file Chrome
            shows in the toolbar, so the header and the toolbar can never disagree. */}
        <img
          src="/icons/128.png"
          alt=""
          width={28}
          height={28}
          className="h-[28px] w-[28px] shrink-0 rounded-[var(--jf-radius-md)]"
        />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">NextMove Autofill</p>
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
          {/* -- the fixed action band ------------------------------------------------------- */}
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
                  // The shared control is sized in rem against a 14px root, which lands at
                  // 12.25px — under the 13px floor for something carrying a profile's name.
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

            {/* The one accent-filled control on the sheet. Without a profile there is nothing to
                fill *with*, so the primary action becomes the step that unblocks it rather than a
                disabled button the user is left to interpret. */}
            {hasProfile ? (
              <Button
                variant="primary"
                size="lg"
                block
                busy={fill.busy}
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
              {fill.report !== null ? (
                <FillSummary report={fill.report} />
              ) : fill.error !== null ? (
                <FillFailure message={fill.error} unreachable={fill.unreachable} />
              ) : hasProfile ? (
                <p className="text-center text-[12px] text-[var(--jf-fg-subtle)]">
                  Shortcut: <Kbd>Alt</Kbd> + <Kbd>J</Kbd> on any application page.
                </p>
              ) : null}
            </div>
          </div>

          {/* -- the only band that scrolls --------------------------------------------------- */}
          <div className="min-h-0 flex-1 divide-y divide-[var(--jf-border)] overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
            <ConnectionStrip
              paired={syncState?.paired === true}
              lastSyncAt={syncState?.lastSyncAt ?? null}
              deviceName={syncState?.deviceName ?? null}
            />

            {/* -- key-pool health at a glance (SEC 5.4 / 5.6) ------------------------------- */}
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

            {/* -- mini tracker (SEC 6.7) ----------------------------------------------------- */}
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

      {/* INV-1, in the user's words. It was 10px on a subtle grey — a promise nobody can read is not
          a promise, so it carries the same 13px as the rest of the body copy. Two deliberate lines,
          because at 13px the sentence pair is ~8px wider than the sheet and an automatic wrap
          strands "— always." on a line of its own. */}
      <footer className="flex shrink-0 flex-col items-center border-t border-[var(--jf-border)] bg-[var(--jf-surface)] px-4 py-2 text-center">
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

/* ------------------------------------------------------------------------------------------------
 * Furniture
 * ---------------------------------------------------------------------------------------------- */

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

/**
 * The "go to Options for the full thing" affordance. A real 32px button rather than the 11px text
 * link it replaces: this is the second most-clicked thing in each section and it was a 14px-tall
 * target.
 */
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

/** A keyboard cap. The shortcut is the popup's own alternative, so it should look pressable. */
function Kbd({ children }: { children: ReactNode }): ReactElement {
  return (
    <kbd className="rounded-[var(--jf-radius-sm)] border border-[var(--jf-border)] bg-[var(--jf-surface)] px-1 py-px font-[var(--jf-font-mono)] text-[11px] text-[var(--jf-fg-muted)]">
      {children}
    </kbd>
  );
}

/**
 * SEC 8.2 pairing, surfaced where a user actually notices it. Unpaired is an invitation with a way
 * to act on it; paired is one quiet line, because a working sync is not news.
 */
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
            // The web app owns the handshake (SEC 8.5): the page talks to the background over
            // `externally_connectable`, so all the popup has to do is get the user there.
            void browser.tabs.create({ url: `${WEB_APP_URL}${WEB_CONNECT_PATH}` });
          }}
        >
          Connect to NextMove
        </Button>
      </div>
    </section>
  );
}

/**
 * Shown for exactly as long as the four loads take. Sized to roughly the height of a loaded sheet
 * so a slow service-worker wake-up grows the popup a little instead of snapping it open.
 */
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

/* ------------------------------------------------------------------------------------------------
 * Fill result
 *
 * These two render inside the popup's `aria-live="polite"` region, which is why neither carries a
 * `role` of its own: a `role="alert"` here would announce the same sentence twice, once assertively
 * and once politely.
 * ---------------------------------------------------------------------------------------------- */

const RESULT_TONE = {
  ok: 'border-[color-mix(in_srgb,var(--jf-ok)_35%,transparent)] bg-[var(--jf-ok-soft)]',
  warn: 'border-[color-mix(in_srgb,var(--jf-warn)_35%,transparent)] bg-[var(--jf-warn-soft)]',
  danger: 'border-[color-mix(in_srgb,var(--jf-danger)_35%,transparent)] bg-[var(--jf-danger-soft)]',
} as const;

/** SEC 4.3 Flow A step 6, condensed to two lines: what was filled, and what still needs you. */
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
