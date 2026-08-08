/**
 * entrypoints/options/App.tsx — the Options app shell.
 *
 * SEC 4.2: "Options app owns profile vault CRUD, resume manager, key manager, mappings editor,
 * tracker dashboard, privacy controls" and "must never run page-fill logic". This shell is the
 * embodiment of that split — a left rail over ten panels, every one of which reaches the service
 * worker through `platform/bus`. There is no scanner, no matcher and no fill engine anywhere in
 * this bundle; the Options page could not fill a form if it tried.
 *
 * Navigation is hash-based (`options.html#tracker`) so the popup can deep-link into a section and
 * so the browser's Back button does something sensible. That contract is load-bearing — the popup
 * calls `openOptionsAt('keys')` — so the hash is written on every navigation and read back on
 * `hashchange`, never held only in React state.
 *
 * ── Two layout decisions worth the words ──────────────────────────────────────────────────────
 *
 * The rail wraps into a grid below `lg` rather than scrolling sideways. A horizontally scrolling
 * nav hides its own tail: on a 900px window the last four sections (including Privacy & data) sat
 * off-screen behind a scrollbar most people never noticed. Wrapping costs two rows of height and
 * makes every destination visible at every width.
 *
 * The reading column is capped at 720px, which is where a 14px paragraph stops needing eye travel.
 * Two panels opt out: the tracker draws a six-lane kanban and the mappings editor a wide table, and
 * squeezing either into 720px trades a real loss of function for a typographic nicety.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { Badge, Button, ToastHost, cx } from '@/ui/components';
import {
  Briefcase,
  Cloud,
  FileText,
  Key,
  Link,
  MessageSquare,
  Settings,
  ShieldCheck,
  User,
  Users,
} from '@/ui/icons';
import type { IconComponent } from '@/ui/icons';
import { AnswersPanel } from '@/ui/panels/AnswersPanel';
import { KeysPanel } from '@/ui/panels/KeysPanel';
import { MappingsPanel } from '@/ui/panels/MappingsPanel';
import { PreferencesPanel } from '@/ui/panels/PreferencesPanel';
import { PrivacyPanel } from '@/ui/panels/PrivacyPanel';
import { ProfilePanel } from '@/ui/panels/ProfilePanel';
import { ProfilesPanel } from '@/ui/panels/ProfilesPanel';
import { ResumesPanel } from '@/ui/panels/ResumesPanel';
import { SyncPanel } from '@/ui/panels/SyncPanel';
import {
  countPool,
  useAnswersStore,
  useKeysStore,
  useProfilesStore,
  useSettingsStore,
} from '@/ui/store';

interface SectionDef {
  id: string;
  label: string;
  hint: string;
  icon: IconComponent;
  /** Panels whose content is a board or a wide table, and which the 720px cap would break. */
  wide?: true;
}

const SECTIONS = [
  { id: 'profile', label: 'Profile vault', hint: 'Everything a form can ask for', icon: User },
  { id: 'profiles', label: 'Profiles', hint: 'Frontend, Fullstack, …', icon: Users },
  { id: 'resumes', label: 'Resumes', hint: 'Upload, attach, parse', icon: FileText },
  { id: 'keys', label: 'AI keys', hint: 'Your own Gemini keys', icon: Key },
  { id: 'answers', label: 'Answer Bank', hint: 'Ask once, reuse forever', icon: MessageSquare },
  { id: 'tracker', label: 'Tracker', hint: 'Every application you sent', icon: Briefcase, wide: true },
  { id: 'mappings', label: 'Mappings', hint: 'Corrections NextMove learned', icon: Link, wide: true },
  { id: 'sync', label: 'Sync', hint: 'Optional NextMove pairing', icon: Cloud },
  { id: 'preferences', label: 'Preferences', hint: 'Fill behaviour and AI defaults', icon: Settings },
  { id: 'privacy', label: 'Privacy & data', hint: 'Export, erase, telemetry', icon: ShieldCheck },
] as const satisfies readonly SectionDef[];

type SectionId = (typeof SECTIONS)[number]['id'];

const SECTION_IDS = SECTIONS.map((section) => section.id);

function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

function sectionFromHash(): SectionId {
  const raw = window.location.hash.replace(/^#/, '');
  return isSectionId(raw) ? raw : 'profile';
}

function isWide(id: SectionId): boolean {
  return SECTIONS.some((entry) => entry.id === id && 'wide' in entry);
}

export function App(): ReactElement {
  const [section, setSection] = useState<SectionId>(sectionFromHash);

  const loadProfiles = useProfilesStore((state) => state.load);
  const loadSettings = useSettingsStore((state) => state.load);
  const loadKeys = useKeysStore((state) => state.load);
  const keys = useKeysStore((state) => state.keys);
  const profiles = useProfilesStore((state) => state.profiles);
  const setAnswerSearch = useAnswersStore((state) => state.setSearch);

  // Shared state every panel reads. Panel-local data loads inside the panel itself.
  useEffect(() => {
    void loadProfiles();
    void loadSettings();
    void loadKeys();
  }, [loadProfiles, loadSettings, loadKeys]);

  useEffect(() => {
    const onHashChange = (): void => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = useCallback((next: SectionId) => {
    setSection(next);
    window.location.hash = next;
    window.scrollTo({ top: 0 });
  }, []);

  const openAnswersFor = useCallback(
    (search: string) => {
      void setAnswerSearch(search);
      go('answers');
    },
    [go, setAnswerSearch],
  );

  const counts = countPool(keys);
  const keysBadge =
    counts.total === 0
      ? { tone: 'warn' as const, text: 'none' }
      : counts.DEAD > 0
        ? { tone: 'danger' as const, text: `${counts.DEAD} dead` }
        : { tone: 'ok' as const, text: `${counts.total}` };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-0 px-4 lg:flex-row lg:gap-10 lg:px-6">
      <a
        href="#jf-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--jf-radius-sm)] focus:bg-[var(--jf-accent)] focus:px-3 focus:py-1.5 focus:text-[var(--jf-accent-contrast)]"
      >
        Skip to content
      </a>

      <header className="shrink-0 pt-6 lg:sticky lg:top-0 lg:h-screen lg:w-[220px] lg:overflow-y-auto lg:pb-8">
        <div className="flex items-center gap-2.5">
          {/* Same asset as the toolbar icon — see the note in popup/App.tsx. */}
          <img
            src="/icons/128.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-[var(--jf-radius-md)]"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--jf-fg)]">NextMove Autofill</p>
            {/* Wraps rather than truncates: at a 220px rail "never auto-submits" is exactly
                the half of this line that gets cut, and it is the half that matters (INV-1). */}
            <p className="text-[11px] leading-snug text-[var(--jf-fg-subtle)]">
              Local-first · your keys · never auto-submits
            </p>
          </div>
        </div>

        <nav aria-label="Settings sections" className="mt-5">
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
            {SECTIONS.map((entry) => {
              const active = entry.id === section;
              const Icon = entry.icon;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go(entry.id)}
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-[var(--jf-radius-md)] py-2 pr-2.5 pl-2 text-left text-sm',
                      // The bar is a left border rather than a trailing element so it stays welded
                      // to the item at the wide breakpoint, where a rail row is 300px+ and a
                      // right-hand marker floats free of the label it belongs to. Transparent when
                      // inactive keeps the text from shifting 2px on selection.
                      'border-l-2 transition-[background-color,border-color,color] duration-[var(--jf-duration-fast)] ease-[var(--jf-ease)]',
                      active
                        ? 'border-[var(--jf-accent)] bg-[var(--jf-accent-soft)] font-medium text-[var(--jf-accent)]'
                        : 'border-transparent text-[var(--jf-fg-muted)] hover:bg-[var(--jf-bg-subtle)] hover:text-[var(--jf-fg)]',
                    )}
                  >
                    <Icon
                      size={16}
                      className={cx(
                        'shrink-0',
                        // Colour is never the only carrier of "active": the left bar and
                        // `aria-current` both say it too.
                        active ? 'text-[var(--jf-accent)]' : 'text-[var(--jf-fg-subtle)]',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.label}</span>
                      <span className="hidden truncate text-[11px] font-normal text-[var(--jf-fg-subtle)] lg:block">
                        {entry.hint}
                      </span>
                    </span>
                    {entry.id === 'keys' ? (
                      <Badge tone={keysBadge.tone}>{keysBadge.text}</Badge>
                    ) : entry.id === 'profiles' && profiles.length > 1 ? (
                      <Badge tone="neutral">{profiles.length}</Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-6 hidden lg:block">
          <p className="text-[11px] leading-relaxed text-[var(--jf-fg-subtle)]">
            NextMove fills the application you are looking at. It never presses Submit — that stays
            your decision, on every form, forever.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => go('privacy')}>
            How your data is handled →
          </Button>
        </div>
      </header>

      <main id="jf-main" tabIndex={-1} className="min-w-0 flex-1 py-6 outline-none lg:py-8">
        {/* Keyed on the section so React remounts the wrapper and the enter animation replays on
            every navigation. app.css pins `.jf-enter` to its end state under reduced motion. */}
        <div
          key={section}
          className={cx('jf-enter w-full', isWide(section) ? 'max-w-[1100px]' : 'max-w-[720px]')}
        >
          {section === 'profile' ? <ProfilePanel /> : null}
          {section === 'profiles' ? <ProfilesPanel onEdit={() => go('profile')} /> : null}
          {section === 'resumes' ? <ResumesPanel /> : null}
          {section === 'keys' ? <KeysPanel /> : null}
          {section === 'answers' ? <AnswersPanel /> : null}
          {section === 'tracker' ? <TrackerSection onOpenAnswers={openAnswersFor} /> : null}
          {section === 'mappings' ? <MappingsPanel /> : null}
          {section === 'sync' ? <SyncPanel /> : null}
          {section === 'preferences' ? <PreferencesPanel /> : null}
          {section === 'privacy' ? <PrivacyPanel /> : null}
        </div>
      </main>

      <ToastHost />
    </div>
  );
}

/**
 * The tracker panel is the heaviest screen in the app (board view, CSV/JSON codecs, the whole
 * Dexie query surface), and most sessions never open it. Loading it on demand keeps the first
 * paint of the Options page — which is usually the vault — fast.
 */
function TrackerSection({
  onOpenAnswers,
}: {
  onOpenAnswers: (search: string) => void;
}): ReactElement {
  const [Panel, setPanel] = useState<null | ((props: {
    onOpenAnswers: (search: string) => void;
  }) => ReactElement)>(null);

  useEffect(() => {
    let cancelled = false;
    void import('@/ui/panels/TrackerPanel').then((module) => {
      if (!cancelled) setPanel(() => module.TrackerPanel);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Panel === null) return <TrackerSkeleton />;
  return <Panel onOpenAnswers={onOpenAnswers} />;
}

/** A neutral block that stands in for real content. Never carries text — see `TrackerSkeleton`. */
function Bar({ className }: { className?: string }): ReactElement {
  return (
    <div
      className={cx(
        'animate-pulse rounded-[var(--jf-radius-sm)] bg-[var(--jf-bg-subtle)] motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/**
 * The tracker's own furniture, greyed out: header, stats strip, filter row, table.
 *
 * A skeleton that matches the real layout means the panel arriving does not move anything the eye
 * has already locked onto. The whole thing is `aria-hidden` behind one polite live region, because
 * ten pulsing rectangles announced individually is noise — the single word "Loading" is the
 * information.
 */
function TrackerSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <p role="status" className="sr-only">
        Loading the tracker…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <Bar className="h-5 w-40" />
            <Bar className="h-3.5 w-72 max-w-full" />
          </div>
          <Bar className="h-9 w-28" />
        </div>

        {/* Five stats, one filter row, one view switch — the tracker's exact furniture, so the
            real panel lands on top of its own outline instead of shoving it aside. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] px-4 py-3"
            >
              <Bar className="h-2.5 w-16" />
              <Bar className="mt-2 h-5 w-10" />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Bar className="h-9 min-w-[200px] flex-1" />
          <Bar className="h-9 w-32" />
          <Bar className="h-9 w-32" />
          <Bar className="h-9 w-32" />
        </div>

        <Bar className="h-9 w-40" />

        <div className="overflow-hidden rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)]">
          <div className="border-b border-[var(--jf-border)] bg-[var(--jf-bg-subtle)] px-3 py-2.5">
            <Bar className="h-3 w-24" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              key={index}
              className="flex items-center gap-4 border-b border-[var(--jf-border)] px-3 py-3 last:border-b-0"
            >
              <Bar className="h-3.5 flex-[2]" />
              <Bar className="h-3.5 flex-[3]" />
              <Bar className="h-3.5 flex-1" />
              <Bar className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
