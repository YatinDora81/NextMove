import {
  DEFAULT_SETTINGS,
  FILL_THRESHOLD,
  OBSERVER_DEBOUNCE_MS,
  SUGGEST_THRESHOLD,
} from '@/shared/constants';
import {
  errReply,
  looksLikeEnvelope,
  okReply,
  type MessageReply,
  type ResumeBytes,
} from '@/shared/messages';
import { messageEnvelopeSchema } from '@/shared/schema';
import type {
  AtsId,
  FieldNode,
  FieldSignature,
  FillReport,
  FillTrigger,
  JobContext,
  MatchResult,
  Profile,
  ProfilePath,
  ResolvedAdapterConfig,
  Settings,
} from '@/shared/types';

import { sendMessage } from '@/platform/bus';
import { createLogger } from '@/platform/logger';
import { getSettings, subscribeSlot, toggleEnabled } from '@/platform/storage';
import { normalizeQuestion, rehydrate } from '@/answers/normalize';


import {
  FieldMatcher,
  FormScanner,
  buildFieldSignature,
  isFillableControl,
  knownProfilePaths,
  nodeElement,
} from '@/core';
import { formatValueForField, isEmptyValue, resolveProfileValue } from '@/core/matcher';

import type { ScanResult } from '@/core/scanner';
import {
  SUBMIT_TEXT_PATTERN,
  controlLabel,
  detectAts,
  findControlByText,
  resolveAdapterConfig,
} from '@/core/adapters';
import { disposePageObserver, getPageObserver, type PageObserver } from '@/core/observer';
import {
  REASON,
  emptyReport,
  fillText,
  isAlreadyAnswered,
  readQuirks,
  resolveValue,
  runFill,
  toDisplayString,
  unstampAll,
  contextOf,
  type FillFieldEvent,
  type ResumeAttachment,
} from '@/core/fill';
import { buildJobContext } from '@/tracker/capture';
import { detectConfirmation, looksLikeJobPage } from '@/tracker/detectors';
import { installSubmitWatch, type SubmitSignal, type SubmitWatchHandle } from '@/tracker/submit-watch';


import {
  DEFAULT_UI_STATE,
  FieldControls,
  FieldMarkers,
  PanelBubble,
  PanelChrome,
  PanelShell,
  ReviewPanel,
  SparkleLayer,
  ToastHost,
  canGhostControl,
  destroyOverlay,
  dismissField,
  getOverlay,
  infoToast,
  installSuggest,
  isBlockedControl,
  isChoiceControl,
  isOpenTextQuestion,
  questionOf,
  readAnswerValue,
  readControlValue,
  readDismissedHashes,
  readUiState,
  restoreField,
  setPanelCollapsed,
  type FieldControlSpec,
  type SuggestController,

  type FrameContribution,
  type MarkerSpec,
  type MarkerTone,
  type NextStepInfo,
  type OverlayHandle,
  type ReviewRow,
  type ReviewTone,
  type SparkleContext,
  type SparkleTarget,
  type ToastController,
  type ToastSpec,
  type UnreachableFrameNote,
} from '@/content';

import { createElement as h } from 'react';

const log = createLogger('content');

const FRAME_KEY = '__jobfillFrame';

/**
 * One control the proactive layer drew on.
 *
 * `kind` is how ✓ would write the value, and the distinction is load-bearing:
 *
 *   match   the matcher placed this field on a profile path, so the write goes through the real fill
 *           engine — one match, one `runFill` — and inherits its strategies, its submit guard and
 *           its verification. Selects, radios, dates, typeaheads and files all work because of this.
 *   answer  the value came from the Answer Bank, which has a string and no profile path, so there is
 *           nothing for the engine to resolve. Offered on text-shaped controls only (see
 *           `renderFieldControls`); a banked answer for a dropdown stays with `Suggest.ts`, which
 *           can fuzzy-match it against the option list on focus.
 */
interface FieldContext {
  node: FieldNode;
  el: HTMLElement;
  match: MatchResult | null;
  kind: 'match' | 'answer';
  /** The value on offer, formatted the way it would be written. Empty when nothing is offered. */
  value: string;
}

interface FrameReportMessage {
  __jobfillFrame: 'report';
  v: 1;
  filled: number;
  suggested: number;
  skipped: number;
  errors: number;
}

interface FrameConfirmedMessage {
  __jobfillFrame: 'confirmed';
  v: 1;
}

function isFrameConfirmation(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message[FRAME_KEY] === 'confirmed' && message['v'] === 1;
}

function parseFrameReport(data: unknown): FrameReportMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message[FRAME_KEY] !== 'report' || message['v'] !== 1) return null;

  const clamp = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(10_000, Math.floor(value)));
  };

  return {
    __jobfillFrame: 'report',
    v: 1,
    filled: clamp(message['filled']),
    suggested: clamp(message['suggested']),
    skipped: clamp(message['skipped']),
    errors: clamp(message['errors']),
  };
}

const APPLICATION_TEXT_RE =
  /\b(apply|application|applicant|candidate|resume|r[ée]sum[ée]|cv|cover letter|job|position|opening|vacancy|career)\b/i;

const IDENTITY_PATHS: ReadonlySet<ProfilePath> = new Set<ProfilePath>([
  'personal.email',
  'personal.firstName',
  'personal.lastName',
  'personal.fullName',
  'personal.phone',
]);

function pageSignalText(doc: Document): string {
  const parts: string[] = [doc.title ?? ''];
  let seen = 0;
  for (const el of Array.from(doc.querySelectorAll('h1, h2, legend, [role="heading"]'))) {
    if (seen >= 12) break;
    seen += 1;
    parts.push(el.textContent ?? '');
  }
  return parts.join(' ').slice(0, 2_000);
}

function looksLikeApplication(
  scan: ScanResult,
  matches: readonly MatchResult[],
  atsId: AtsId,
  doc: Document,
): boolean {
  const visible = scan.fields.filter((field) => field.visible);
  if (visible.length < 2) return false;
  if (atsId !== 'generic') return true;

  const paths = new Set<ProfilePath>();
  for (const match of matches) {
    if (match.path !== null && match.score >= SUGGEST_THRESHOLD) paths.add(match.path);
  }

  let hasIdentity = false;
  for (const path of paths) {
    if (IDENTITY_PATHS.has(path)) {
      hasIdentity = true;
      break;
    }
  }
  if (!hasIdentity) return false;

  if (visible.some((field) => field.sig.inputType === 'file')) return true;
  if (paths.size >= 4) return true;
  return APPLICATION_TEXT_RE.test(pageSignalText(doc));
}

function frameIdOf(isTop: boolean, href: string): number {
  if (isTop) return 0;
  let hash = 2_166_136_261;
  for (let i = 0; i < href.length; i += 1) {
    hash ^= href.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 1_000_000 || 1;
}

function isSupportedDocument(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (document.contentType !== 'text/html' && document.contentType !== 'application/xhtml+xml') {
    return false;
  }
  return document.documentElement !== null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ATS_LABEL: Readonly<Record<AtsId, string>> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  icims: 'iCIMS',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  taleo: 'Taleo',
  generic: 'This site',
};

const NEXT_MARKER_ID = '__jf_next_step';

/**
 * How much of the Answer Bank the in-page layer holds while a page is open.
 *
 * Proactive suggestions need the bank *before* anything is focused, for every field at once, which
 * rules out the per-field `ANSWERS_LOOKUP` round trip the ✨ and focused-ghost paths use — a
 * 60-field Workday step would be 60 messages and 60 IndexedDB scans per scan, several times per
 * application. One `ANSWERS_LIST` gives the same answers as one message, indexed by the normalised
 * question the bank itself keys on. The cap is a memory bound, and the list arrives pinned-first
 * then most-recently-used, so what falls off the end is what the user has not touched in longest.
 */
const BANK_INDEX_LIMIT = 400;

/**
 * Shortest value 💾 will turn into a field→path mapping.
 *
 * Below this a value is a token, not an identity: "Yes", "No", "IN", "EU" and "1" are each the
 * formatted value of several profile paths at once, and a mapping made from one of them would be a
 * confident, permanent, wrong answer. Those go to the Answer Bank, which keys on the question.
 */
const MIN_MAPPABLE_VALUE_CHARS = 4;

/**
 * Controls the engine fills by writing text into them, as opposed to the shapes it fills by matching
 * a value against a set of options. See `proposalFor`.
 */
const TEXT_SHAPED_INPUTS: ReadonlySet<string> = new Set(['text', 'email', 'tel', 'url', 'textarea']);

/**
 * Every profile path the "map this field" picker can offer.
 *
 * Computed once: it is derived from the synonym table and cannot change while a page is open, and a
 * fresh array on every render is a fresh 46-option `<select>` per unmatched row — now that the panel
 * re-renders on every scan rather than only after a fill, that is worth not doing.
 */
const PROFILE_PATHS: readonly string[] = knownProfilePaths();

/** Marker id for a field the user accepted from the page, kept apart from a fill run's own ids. */
function acceptedMarkerId(hash: string): string {
  return `${hash}-accepted`;
}

function bytesFromBase64(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
    return out;
  } catch {
    return null;
  }
}

function attachmentFromBytes(resume: ResumeBytes): ResumeAttachment | null {
  const decoded = bytesFromBase64(resume.bytes);
  if (decoded === null || decoded.byteLength === 0) return null;
  if (resume.size > 0 && decoded.byteLength !== resume.size) return null;

  const name = resume.name.trim().length > 0 ? resume.name.trim() : 'resume.pdf';
  const mime = resume.mime.trim();
  return {
    name,
    mime,
    blob: new Blob([decoded as unknown as BlobPart], mime.length > 0 ? { type: mime } : {}),
  };
}

function toneOf(event: FillFieldEvent): ReviewTone {
  if (event.action === 'fill' && event.ok) return 'filled';
  if (event.action === 'suggest') return 'suggested';
  // A field we recognised and refused to overwrite is finished, not broken. Falling through to
  // 'unmatched' painted the one case where NextMove behaved best as the one that needs the user.
  if (event.reason === REASON.alreadyAnswered) return 'answered';
  return 'unmatched';
}

/**
 * The marker layer has no outline of its own for `answered`, and inventing one would put a fourth
 * colour on the page for a field that needs nothing. It borrows the `filled` outline — the field is
 * complete either way — and the badge says who completed it.
 */
const MARKER_TONE: Readonly<Record<ReviewTone, MarkerTone>> = {
  filled: 'filled',
  answered: 'filled',
  suggested: 'suggested',
  unmatched: 'unmatched',
};

const MARKER_BADGE: Readonly<Record<ReviewTone, string>> = {
  filled: 'Filled',
  answered: 'You answered this',
  suggested: 'Check this',
  unmatched: 'Needs you',
};

function readFillPayload(raw: unknown): { profileId: string | null; trigger: FillTrigger } {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const profileId = typeof record['profileId'] === 'string' ? record['profileId'] : null;
  const trigger = record['trigger'];
  const known: readonly FillTrigger[] = ['popup', 'shortcut', 'pill', 'context-menu', 'auto'];
  return {
    profileId,
    trigger: known.includes(trigger as FillTrigger) ? (trigger as FillTrigger) : 'popup',
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  world: 'ISOLATED',
  noScriptStartedPostMessage: true,

  main(ctx) {
    if (!isSupportedDocument()) return;

    const isTop = window.top === window;
    const frameId = frameIdOf(isTop, location.href);
    const domain = location.hostname;

    let settings: Settings = DEFAULT_SETTINGS;
    let adapterId: AtsId = 'generic';
    let config: ResolvedAdapterConfig | null = null;
    let job: JobContext | null = null;
    let applicationLike = false;
    let filling = false;
    let disposed = false;
    let aiAvailable = false;
    let keyCount = 0;

    let applicationId: string | null = null;
    let confirmationHandled = false;
    let stepKey = '';
    const filledStepKeys = new Set<string>();
    let chainActive = false;
    let stepDirty = true;
    let lastFieldHashes: Set<string> | null = null;
    let focusedHash: string | null = null;
    let lastFocusScanAt = 0;

    let overlay: OverlayHandle | null = null;
    let markers: FieldMarkers | null = null;
    let toasts: ToastController | null = null;
    const pendingToasts: ToastSpec[] = [];

    let lastRows: ReviewRow[] = [];
    let lastReport: FillReport | null = null;
    let lastScan: ScanResult | null = null;
    let nextStep: NextStepInfo | null = null;
    let sparkleTargets: SparkleTarget[] = [];
    const frameReports = new Map<string, FrameContribution>();

    let evaluateTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeSettings: (() => void) | null = null;

    let suggest: SuggestController | null = null;
    let submitWatch: SubmitWatchHandle | null = null;
    let controls: FieldControls | null = null;
    let observer: PageObserver | null = null;

    /**
     * Whether the corner is a 48px bubble or the whole panel. Read from `jf.ui` at boot and written
     * back on every deliberate collapse/expand, so the choice survives a reload and travels to the
     * next tab. Default is collapsed: NextMove has to earn the screen real estate.
     */
    let panelCollapsed = DEFAULT_UI_STATE.panelCollapsed;
    /** A finished fill run pops the panel open once per page, then the user's choice rules again. */
    let autoExpanded = false;
    /** What the bubble's count badge says. */
    let pending = 0;

    /**
     * Everything the proactive layer knows about the controls it drew on, by field hash. Rebuilt on
     * every scan; the source of truth for what ✓, ✗ and 💾 act on.
     */
    const fields = new Map<string, FieldContext>();
    /** Accepted on this page. A re-scan must not offer back what the user has already taken. */
    const acceptedHashes = new Set<string>();
    /** Rows the proactive layer contributes: one per field accepted or waved off on this page. */
    const settledRows = new Map<string, ReviewRow>();

    let dismissedHashes: Set<string> | null = null;
    let userMappings: Record<string, ProfilePath> | null = null;
    /**
     * The Answer Bank snapshot, held as the in-flight promise rather than the map.
     *
     * Caching the map and publishing it before it was populated meant a second pass — and there is
     * always a second pass, the observer fires several times per step — read an empty bank and
     * silently offered nothing for every banked answer on the page.
     */
    let bankIndex: Promise<Map<string, string>> | null = null;
    /** Cancels the fill in flight, so the power switch can stop one mid-form. */
    let fillAbort: AbortController | null = null;

    /**
     * The ghost-text layer knows a field only by its label text, so the profile side of a
     * suggestion is precomputed here: label → the value the matcher would have filled. Rebuilt
     * lazily, and thrown away whenever the page's field set changes underneath it.
     */
    let suggestIndex: Map<string, string> | null = null;
    let suggestProfile: Profile | null = null;
    let suggestProfileLoaded = false;


    function ui(): OverlayHandle {
      if (overlay === null) {
        overlay = getOverlay();
        overlay.render(
          'toasts',
          h(ToastHost, {
            bind: (api: ToastController) => {
              toasts = api;
              while (pendingToasts.length > 0) {
                const spec = pendingToasts.shift();
                if (spec) api.push(spec);
              }
            },
          }),
        );
      }
      return overlay;
    }

    function pushToast(spec: ToastSpec): void {
      if (!isTop || disposed) return;
      ui();
      if (toasts === null) pendingToasts.push(spec);
      else toasts.push(spec);
    }

    function fieldMarkers(): FieldMarkers {
      if (markers === null) markers = new FieldMarkers(ui());
      return markers;
    }

    /** Drop the proactive layer without touching the page it was drawn over. */
    function clearFieldControls(): void {
      fields.clear();
      settledRows.clear();
      pending = 0;
      controls?.clear();
    }

    /**
     * Off, live, in every open tab.
     *
     * `Settings.enabled === false` is documented as "the in-page layer draws nothing, suggests
     * nothing and fills nothing" (SEC 5.1), and that has to be true of a page that was already open
     * when the switch flipped — not just of the next one. So every drawn thing goes, and so does the
     * `MutationObserver`: on a single-page ATS it is what would otherwise keep waking this file up to
     * scan a page we have been told to leave alone. The bubble is the one survivor, because the way
     * back on has to be reachable from where the user is.
     *
     * Nothing stored is touched. This is "stop touching pages", not "forget me".
     */
    function teardownInPageUi(): void {
      applicationLike = false;
      sparkleTargets = [];
      clearFieldControls();
      overlay?.clear('sparkles');
      overlay?.clear('panel');
      markers?.clear();
      observer?.stop();
      // A run already walking the form has to stop too, or "off" would finish filling the application
      // the user just told us to leave alone. The engine checks the signal before every field and
      // reports the rest as skipped.
      fillAbort?.abort();
      // Whatever the user had open, they get the smallest possible footprint back when they return.
      panelCollapsed = true;
    }

    async function loadConfig(id: AtsId): Promise<ResolvedAdapterConfig> {
      const reply = await sendMessage('CONFIG_GET', { atsId: id });
      if (reply.ok) return reply.data;
      log.debug(`CONFIG_GET failed (${reply.error.code}); falling back to the shipped seed`);
      return resolveAdapterConfig(id, { url: location.href });
    }

    async function refreshSettings(): Promise<void> {
      try {
        settings = await getSettings();
      } catch (error) {
        log.debug('could not read settings; using shipped defaults', error);
        settings = DEFAULT_SETTINGS;
      }
    }

    async function refreshKeyAvailability(): Promise<void> {
      const reply = await sendMessage('KEYS_STATUS', {});
      if (!reply.ok) {
        aiAvailable = false;
        keyCount = 0;
        return;
      }
      keyCount = reply.data.keys.length;
      aiAvailable = reply.data.keys.some((key) => key.status !== 'DEAD');
    }

    function scanPage(): ScanResult {
      return new FormScanner({ frameId }).scan();
    }

    /** The key both sides of the suggestion index agree on — v2.2's `normalize`. */
    function labelKey(text: string): string {
      return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, 60);
    }

    /** A profile value is only ghost-text material once it reads as something a human would type. */
    function displayValue(value: unknown): string | null {
      if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null;
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      return null;
    }

    async function ensureSuggestProfile(): Promise<Profile | null> {
      if (suggestProfileLoaded) return suggestProfile;
      suggestProfileLoaded = true;
      const reply = await sendMessage('PROFILE_GET', { profileId: null });
      suggestProfile = reply.ok ? reply.data.profile : null;
      return suggestProfile;
    }

    async function ensureSuggestIndex(): Promise<Map<string, string>> {
      if (suggestIndex !== null) return suggestIndex;

      const index = new Map<string, string>();
      suggestIndex = index;

      const profile = await ensureSuggestProfile();
      if (profile === null) return index;

      const scan = lastScan ?? scanPage();
      for (const match of matcherFor(profile, null).match(scan.fields)) {
        if (match.path === null || match.action === 'skip') continue;
        const value = displayValue(resolveProfileValue(profile, match.path));
        if (value === null) continue;
        const key = labelKey(match.node.sig.label);
        if (key.length > 0 && !index.has(key)) index.set(key, value);
      }
      return index;
    }

    /**
     * What to offer for a field, in v2.2's order: something the user explicitly taught us beats
     * anything derived from the profile, because they taught it on a form like this one.
     */
    async function suggestLookup(labelText: string): Promise<string | null> {
      const qRaw = labelText.trim();
      if (qRaw.length === 0) return null;

      const banked = await sendMessage('ANSWERS_LOOKUP', {
        qRaw,
        company: job?.company ?? null,
        profileId: settings.activeProfileId,
      });
      if (banked.ok && banked.data.hit !== null) return banked.data.hit.answer;

      return (await ensureSuggestIndex()).get(labelKey(qRaw)) ?? null;
    }

    async function suggestRemember(labelText: string, value: string): Promise<void> {
      const reply = await sendMessage('ANSWERS_SAVE', {
        qRaw: labelText,
        answer: value,
        source: 'user',
        profileId: settings.activeProfileId,
        company: job?.company ?? null,
      });
      if (!reply.ok) throw new Error(reply.error.message);
    }


    function matcherFor(profile: Profile | null, mappings: Record<string, ProfilePath> | null): FieldMatcher {
      return new FieldMatcher({
        profile,
        userMappings: mappings,
        adapterFieldMap: config?.fieldMap ?? null,
        remoteSynonyms: config?.synonyms ?? null,
        remoteSynonymsVersion: config?.version ?? null,
        fillThreshold: settings.fillThreshold,
        suggestThreshold: settings.suggestThreshold,
        requireValue: profile !== null,
      });
    }

    function captureJob(): JobContext | null {
      if (!settings.autoCaptureJobContext) {
        return { title: '', company: '', jd: '', url: location.href };
      }
      try {
        return buildJobContext(document, location.href, config?.capture ?? null);
      } catch (error) {
        log.debug('job auto-capture failed', error);
        return null;
      }
    }

    function locateNextStep(): { info: NextStepInfo; el: Element } | null {
      try {
        const adapter = detectAts(location.href, document);
        const control = adapter.steps?.nextButton?.(document) ?? null;
        if (control !== null) return { info: { kind: 'next', label: controlLabel(control) }, el: control };

        const submit = findControlByText(document, SUBMIT_TEXT_PATTERN);
        if (submit !== null) return { info: { kind: 'submit', label: controlLabel(submit) }, el: submit };
      } catch (error) {
        log.debug('next-step lookup failed', error);
      }
      return null;
    }

    function collectSparkleTargets(fields: readonly FieldNode[], matches: readonly MatchResult[]): SparkleTarget[] {
      const filledPaths = new Map<string, number>();
      for (const match of matches) filledPaths.set(match.node.sig.hash, match.score);

      const targets: SparkleTarget[] = [];
      const seen = new Set<string>();

      for (const node of fields) {
        if (!isOpenTextQuestion(node)) continue;
        if ((filledPaths.get(node.sig.hash) ?? 0) >= FILL_THRESHOLD) continue;

        const el = nodeElement(node);
        if (!(el instanceof HTMLElement)) continue;

        const question = questionOf(node);
        if (question.length === 0) continue;

        const id = seen.has(node.sig.hash) ? `${node.sig.hash}-${targets.length}` : node.sig.hash;
        seen.add(id);
        targets.push({ id, el, question });
      }
      return targets;
    }

    async function writeAnswer(el: HTMLElement, text: string, overwrite = true): Promise<boolean> {
      const result = await fillText(
        el,
        text,
        contextOf({ quirks: readQuirks(config?.quirks ?? null) }),
        // `overwrite` defaults to on for the one gesture the escape hatch exists for: the user is
        // looking at this field and pressed "insert this answer" in the ✨ panel. A half-typed draft
        // in the box is what they are asking us to replace, so refusing it the way a bulk fill does
        // would break that flow outright. The ✓ on a proactive suggestion passes `false` — it is only
        // ever offered on an empty control, so overwriting is never the thing it needs to do.
        { overwrite },
      );
      return result.ok;
    }

    function renderSparkles(): void {
      if (!isTop || disposed) return;
      if (sparkleTargets.length === 0) {
        overlay?.clear('sparkles');
        return;
      }
      const context: SparkleContext = {
        job: job ?? { title: '', company: '', jd: '', url: location.href },
        profileId: settings.activeProfileId,
        tone: settings.tone,
        length: settings.answerLength,
        reuseBanked: settings.reuseBankedAnswers,
        aiAvailable,
        keyCount,
        pushToast,
        writeValue: writeAnswer,
        readValue: readControlValue,
      };
      ui().render('sparkles', h(SparkleLayer, { targets: sparkleTargets, ctx: context }));
    }

    function unreachableNotes(scan: ScanResult | null): UnreachableFrameNote[] {
      if (scan === null) return [];
      return scan.unreachableFrames.map((frame) => ({
        description: frame.description,
        origin: frame.origin,
        reason: frame.reason,
      }));
    }

    async function saveMapping(row: ReviewRow, path: ProfilePath): Promise<boolean> {
      const reply = await sendMessage('FIELD_MAP_SAVE', { domain, sigHash: row.hash, path });
      if (!reply.ok) {
        log.warn(`FIELD_MAP_SAVE failed: ${reply.error.message}`);
        return false;
      }
      // The panel and the page draw from the same caches. Teaching a mapping here and leaving the
      // page's copy stale is how "map this field" came to look like it had done nothing.
      userMappings = { ...(userMappings ?? {}), [row.hash]: path };
      void refreshFieldControls();
      return true;
    }

    function elementByHash(hash: string): HTMLElement | null {
      for (const node of lastScan?.fields ?? []) {
        if (node.sig.hash !== hash) continue;
        const el = nodeElement(node);
        if (el instanceof HTMLElement) return el;
      }
      return null;
    }

    async function saveAsAnswer(row: ReviewRow): Promise<boolean> {
      const el = elementByHash(row.hash);
      const answer = (el === null ? row.value : readControlValue(el) || row.value).trim();
      const qRaw = row.label.trim();
      if (answer.length === 0 || qRaw.length === 0) return false;

      const company = job !== null && job.company.length > 0 ? job.company : null;
      const reply = await sendMessage('ANSWERS_SAVE', {
        qRaw,
        answer,
        source: 'user',
        profileId: settings.activeProfileId,
        company,
      });
      if (!reply.ok) {
        log.warn(`ANSWERS_SAVE failed: ${reply.error.message}`);
        return false;
      }
      bankIndex = null;
      void refreshFieldControls();
      return true;
    }

    function nodeForElement(el: HTMLElement): FieldNode | null {
      for (const node of lastScan?.fields ?? []) {
        if (nodeElement(node) === el) return node;
      }
      return null;
    }

    /* -------------------------------------------------------------------------------------------
     * F-06 proactive suggestions — what each control is offered, before anything is written
     * ----------------------------------------------------------------------------------------- */

    function fieldControls(): FieldControls {
      if (controls === null) {
        controls = new FieldControls(ui(), {
          onAccept: (hash) => void acceptOffer(hash),
          onDismiss: (hash) => dismissOffer(hash),
          onSave: (hash) => void saveFieldValue(hash),
          onPendingChange: (count) => {
            pending = count;
            // The count badge belongs to the bubble, and the bubble is its own root — repainting the
            // whole shell for it would re-render the review panel (and its per-row profile-path
            // pickers) on every keystroke that retires a suggestion.
            renderBubble();
          },
        });
      }
      return controls;
    }

    /** The per-domain mappings the user has taught us (SEC 6.3 — the matcher scores these at 100). */
    async function ensureMappings(): Promise<Record<string, ProfilePath>> {
      if (userMappings !== null) return userMappings;
      const reply = await sendMessage('FIELD_MAP_GET', { domain });
      userMappings = reply.ok ? reply.data.mappings : {};
      return userMappings;
    }

    async function ensureDismissals(): Promise<Set<string>> {
      if (dismissedHashes !== null) return dismissedHashes;
      dismissedHashes = await readDismissedHashes(domain);
      return dismissedHashes;
    }

    /**
     * The Answer Bank, indexed by the normalised question it is keyed on, so a proactive pass can ask
     * it about sixty fields without sixty messages (see `BANK_INDEX_LIMIT`).
     *
     * `{company}` is rehydrated on the way in, exactly as `ANSWERS_LOOKUP` does it, so a stored
     * answer can never show this employer the last one's name.
     */
    function ensureBankIndex(): Promise<Map<string, string>> {
      const inFlight = bankIndex;
      if (inFlight !== null) return inFlight;

      const loading = (async (): Promise<Map<string, string>> => {
        const index = new Map<string, string>();
        const reply = await sendMessage('ANSWERS_LIST', {
          profileId: settings.activeProfileId,
          limit: BANK_INDEX_LIMIT,
        });
        if (!reply.ok) return index;

        const company = job !== null && job.company.length > 0 ? job.company : null;
        for (const record of reply.data.records) {
          // `list` returns pinned rows first, then most-recently-used, so the first answer seen for a
          // question is the one the bank's own ranking would have put in front of the user.
          if (record.qNorm.length === 0 || index.has(record.qNorm)) continue;
          const answer = rehydrate(record.answer, company).trim();
          if (answer.length > 0) index.set(record.qNorm, answer);
        }
        return index;
      })();

      bankIndex = loading;
      return loading;
    }

    /** The bank's key for a field: the question as this page asks it, normalised the bank's way. */
    function bankKeyFor(node: FieldNode): string {
      const question = questionOf(node) || node.sig.label;
      if (question.trim().length === 0) return '';
      return normalizeQuestion(question, job !== null && job.company.length > 0 ? job.company : null);
    }

    /**
     * What the fill engine would write for this match.
     *
     * The distinction matters because the ghost is a promise. For a text-shaped control the engine
     * writes `toDisplayString(value)` verbatim, so the ghost has to be exactly that — going through
     * `formatValueForField` instead would show "India" on a field the engine then fills with "IN",
     * which reads as NextMove having ignored what it had just offered. The candidate list *is* right
     * for the shapes that match against a set of options (selects, radios, typeaheads), where the
     * first candidate is what the strategy tries first.
     */
    function proposalFor(profile: Profile, match: MatchResult): string {
      if (match.path === null) return '';
      const raw = resolveProfileValue(profile, match.path);
      if (isEmptyValue(raw)) return '';
      if (TEXT_SHAPED_INPUTS.has(match.node.sig.inputType)) {
        return toDisplayString(resolveValue(profile, match.path));
      }
      return formatValueForField(raw, match.node.sig, match.path);
    }

    /**
     * Is this control still unanswered — that is, would a suggestion here be an offer rather than a
     * proposal to overwrite something?
     *
     * `isAlreadyAnswered` is the fill engine's own definition and the right one for text, dropdowns
     * and typeaheads. It deliberately says `false` for radios and checkboxes, whose `value` is the
     * option's own label and reads non-blank whether or not the box is ticked — so those are asked a
     * different question, and `readAnswerValue` is what knows how to ask it.
     */
    function isUnanswered(el: HTMLElement, sig: FieldSignature): boolean {
      if (isChoiceControl(el)) return readAnswerValue(el).trim().length === 0;
      return !isAlreadyAnswered(el, sig) && readAnswerValue(el).trim().length === 0;
    }

    /**
     * Draw the proactive layer for the current scan: a ghost of the proposed value inside every
     * recognised empty control, and the ✓ / ✗ / 💾 cluster beside it.
     *
     * INV-4 in its strongest form: this function *proposes*. Nothing here writes to the page, and
     * `autoFillOnLoad` keeps its own, separate meaning — a user who never turns that on will never
     * have a value written without pressing something.
     */
    async function renderFieldControls(scan: ScanResult): Promise<void> {
      if (!isTop || disposed || !settings.enabled) return;

      const profile = await ensureSuggestProfile();
      const [mappings, dismissed, bank] = await Promise.all([
        ensureMappings(),
        ensureDismissals(),
        ensureBankIndex(),
      ]);
      // Four awaits is plenty of time for the step to change or the switch to flip underneath us.
      if (disposed || !settings.enabled || lastScan !== scan) return;

      const byHash = new Map<string, MatchResult>();
      if (profile !== null) {
        for (const match of matcherFor(profile, mappings).match(scan.fields)) {
          const hash = match.node.sig.hash;
          if (!byHash.has(hash)) byHash.set(hash, match);
        }
      }

      fields.clear();
      settledRows.clear();

      // The ✨ button owns the top-right corner of the open-text questions it appears on; the cluster
      // steps aside rather than stacking on top of it.
      const crowded = new Set(sparkleTargets.map((target) => target.id));
      const specs: FieldControlSpec[] = [];
      const seen = new Set<string>();

      for (const node of scan.fields) {
        const hash = node.sig.hash;
        // Two controls with one signature are the same question asked twice; the first one speaks,
        // and a dismissal keyed by that hash covers both.
        if (hash.length === 0 || seen.has(hash)) continue;
        seen.add(hash);
        if (!node.visible) continue;

        const el = nodeElement(node);
        if (!(el instanceof HTMLElement) || !el.isConnected) continue;
        // Credentials, one-time codes and payment cards get no ghost, no ✓, no ✗ and no 💾.
        // Remembering a CVV would be worse than proposing one.
        if (isBlockedControl(el)) continue;

        const match = byHash.get(hash) ?? null;
        let kind: FieldContext['kind'] = 'match';
        let value = match === null || profile === null ? '' : proposalFor(profile, match);

        if (value.length === 0 && canGhostControl(el)) {
          const key = bankKeyFor(node);
          const banked = key.length === 0 ? undefined : bank.get(key);
          if (banked !== undefined) {
            kind = 'answer';
            value = banked;
          }
        }

        const scored =
          kind === 'answer' || (match !== null && match.score >= settings.suggestThreshold);
        const unanswered = isUnanswered(el, node.sig);
        const offered =
          value.length > 0 &&
          scored &&
          unanswered &&
          !dismissed.has(hash) &&
          !acceptedHashes.has(hash);

        fields.set(hash, { node, el, match, kind, value: offered ? value : '' });

        if (dismissed.has(hash)) settledRows.set(hash, settledRow(node, 'dismissed'));
        else if (acceptedHashes.has(hash)) settledRows.set(hash, settledRow(node, 'accepted'));

        // Every eligible control gets an entry; whether its cluster is actually on screen is a live
        // question the layer answers for itself (`FieldControls.wanted`), because "the user just
        // typed something worth keeping" happens between scans and 💾 has to appear then.
        specs.push({
          id: hash,
          el,
          label: node.sig.label,
          suggestion: offered ? value : '',
          ghost: offered && canGhostControl(el),
          crowded: crowded.has(hash),
        });
      }

      fieldControls().set(specs);
    }

    /**
     * Has the user waved a suggestion off for this control?
     *
     * Answered from the ledger rather than from the layer's own entry state, because a re-scan rebuilds
     * a dismissed control with no suggestion at all — so the entry forgets, while the ledger does not.
     */
    function isRefused(el: Element): boolean {
      const dismissed = dismissedHashes;
      if (dismissed === null || dismissed.size === 0) return false;
      for (const [hash, context] of fields) {
        if (context.el === el) return dismissed.has(hash);
      }
      return false;
    }

    /** Re-run the proactive pass against whatever is on screen now. */
    async function refreshFieldControls(): Promise<void> {
      const scan = lastScan;
      if (scan === null) return;
      await renderFieldControls(scan);
    }

    /** The panel row for a field the user has settled, so ✗ is recoverable and ✓ is visible. */
    function settledRow(node: FieldNode, how: 'accepted' | 'dismissed'): ReviewRow {
      const context = fields.get(node.sig.hash);
      return {
        id: `${node.sig.hash}-${how}`,
        hash: node.sig.hash,
        tone: how === 'accepted' ? 'filled' : 'unmatched',
        label: node.sig.label,
        section: node.sig.sectionHeading,
        path: context?.match?.path ?? null,
        value: how === 'accepted' && context !== undefined ? readAnswerValue(context.el) : '',
        score: context?.match?.score ?? 0,
        required: node.required,
        reason: how,
      };
    }

    /**
     * ✓ — write the value the user just looked at.
     *
     * A `match` goes through `runFill` with its action forced to `fill`, and that force is the whole
     * point: INV-4 forbids *guessing*, and 50-to-69 is a guess when a bulk run makes it. It is not a
     * guess when the user is looking at the proposed value on their own screen and presses ✓ on that
     * one field. Everything else about the write is the engine's — the submit guard (INV-1), the
     * framework-safe setter, the strategy for this control's shape, and the verification that decides
     * whether we may claim it worked.
     *
     * `overwrite` is deliberately NOT set: the offer only exists on an unanswered control, and if the
     * page put something there in the meantime the engine's refusal to overwrite is the correct
     * answer, not an obstacle.
     */
    async function acceptOffer(hash: string): Promise<void> {
      const context = fields.get(hash);
      if (context === undefined || disposed || !settings.enabled) return;
      if (context.value.length === 0) return;

      if (!context.el.isConnected) {
        controls?.remove(hash);
        return;
      }

      let ok = false;
      let reason: string | null = null;

      try {
        if (context.kind === 'answer') {
          ok = await writeAnswer(context.el, context.value, false);
        } else if (context.match !== null) {
          const profile = await ensureSuggestProfile();
          if (profile !== null) {
            const report = await runFill([{ ...context.match, action: 'fill' }], {
              profile,
              atsId: adapterId,
              url: location.href,
              quirks: config?.quirks ?? null,
              humanPacing: false,
              resolveResume: (path) => resolveResume(profile.id, path),
              onField: (event) => {
                if (event.reason !== undefined) reason = event.reason;
              },
            });
            ok = report.filled > 0;
          }
        }
      } catch (error) {
        reason = describe(error);
      }

      // The field already carries an answer. Nothing was written and nothing needed to be, so the
      // offer is spent rather than failed — telling the user off for that would be nonsense.
      if (!ok && reason === REASON.alreadyAnswered) ok = true;

      if (!ok) {
        pushToast({
          id: `jf-accept-failed-${hash}`,
          kind: 'error',
          title: 'That value did not stick',
          message:
            'The site rejected it, so NextMove left the suggestion up. Try typing it, or use ⚡ Fill.',
          timeoutMs: 8_000,
        });
        log.debug(`accepting ${hash} failed${reason === null ? '' : `: ${reason}`}`);
        return;
      }

      acceptedHashes.add(hash);
      controls?.settle(hash, 'accepted');
      dismissedHashes?.delete(hash);
      markFilled(context);
      if (retoneRow(hash, 'filled')) settledRows.delete(hash);
      else settledRows.set(hash, settledRow(context.node, 'accepted'));
      renderShell();
    }

    /** Flash the F-06 outline on a field the user just accepted, on the same setting as a fill run. */
    function markFilled(context: FieldContext): void {
      if (!settings.highlightFilled) return;
      fieldMarkers().add({
        id: acceptedMarkerId(context.node.sig.hash),
        el: context.el,
        tone: 'filled',
        badge: MARKER_BADGE.filled,
        tooltip: context.node.sig.label,
      });
    }

    /**
     * Re-tone a run's own row for this field, if there is one, and report whether there was.
     *
     * `panelRows()` drops a settled row whose hash a run row already covers, so without this a ✗ on a
     * field the last fill run reported would leave the run's row exactly as it was — no tone change
     * and, worse, no "suggest this again" affordance anywhere. The only way back from a mis-clicked ✗
     * would have been to wait 30 days for the ledger to prune.
     */
    function retoneRow(hash: string, tone: ReviewTone, reason?: string): boolean {
      let found = false;
      lastRows = lastRows.map((row) => {
        if (row.hash !== hash) return row;
        found = true;
        const next: ReviewRow = { ...row, tone };
        if (reason === undefined) delete next.reason;
        else next.reason = reason;
        return next;
      });
      return found;
    }

    /**
     * ✗ — and it has to mean something durable. The proactive layer repaints on every SPA mutation,
     * several times per application, so a refusal that lived only in memory would be a flicker: the
     * same wrong guess would be back 250ms later.
     */
    function dismissOffer(hash: string): void {
      const context = fields.get(hash);
      controls?.settle(hash, 'dismissed');
      acceptedHashes.delete(hash);
      dismissedHashes?.add(hash);
      markers?.remove(acceptedMarkerId(hash));
      void dismissField(domain, hash);
      if (context !== undefined) {
        if (retoneRow(hash, 'unmatched', 'dismissed')) settledRows.delete(hash);
        else settledRows.set(hash, settledRow(context.node, 'dismissed'));
        fields.set(hash, { ...context, value: '' });
      }
      renderShell();
    }

    /** The panel's "suggest this again" — ✗ is one 18px button away from ✓ and must be undoable. */
    async function restoreRow(row: ReviewRow): Promise<boolean> {
      await restoreField(domain, row.hash);
      dismissedHashes?.delete(row.hash);
      acceptedHashes.delete(row.hash);
      settledRows.delete(row.hash);
      retoneRow(row.hash, 'suggested');
      await refreshFieldControls();
      renderShell();
      return true;
    }

    /**
     * The profile path whose value is exactly what the user typed, or null.
     *
     * This is what turns 💾 on a structured field into a *mapping* rather than a stored string: if
     * the box holds their email, what is worth remembering is not the text but "this field wants
     * `personal.email`" — which the matcher then scores at 100 on this domain for every form, and
     * which keeps working after they change their email address.
     */
    function profilePathForValue(profile: Profile, sig: FieldSignature, value: string): ProfilePath | null {
      const wanted = value.trim().toLowerCase();
      // A mapping is a claim that this box wants that part of the profile, and it outranks everything
      // the matcher knows (score 100, on this domain, for every form). So it is only made when the
      // value names exactly ONE path: "Yes" is the formatted value of every boolean in the profile, so
      // a Yes/No radio would otherwise teach the first one the loop happened to reach —
      // `authorization.authorizedIn` — and then answer an unrelated question with it forever.
      if (wanted.length < MIN_MAPPABLE_VALUE_CHARS) return null;

      let hit: ProfilePath | null = null;
      for (const path of knownProfilePaths()) {
        const resolved = resolveProfileValue(profile, path);
        if (isEmptyValue(resolved)) continue;
        if (formatValueForField(resolved, sig, path).trim().toLowerCase() !== wanted) continue;
        if (hit !== null) return null; // ambiguous: two paths hold this value, so it names neither
        hit = path;
      }
      return hit;
    }

    /**
     * 💾 — remember what is in this control, so the next form offers it without being asked.
     *
     * Two stores, and which one is right depends on what the value *is*. A value that is already
     * somewhere in the profile becomes a field→path mapping (see `profilePathForValue`). Anything
     * else — a screening answer, a notice period, "how did you hear about us" — is a string only the
     * Answer Bank can hold, keyed by the question as this page asked it.
     */
    async function saveFieldValue(hash: string): Promise<void> {
      const context = fields.get(hash);
      if (context === undefined || disposed) return;

      const value = readAnswerValue(context.el).trim();
      if (value.length === 0) {
        pushToast(infoToast('Nothing to remember here yet', 'Type your answer first, then press 💾.'));
        return;
      }

      const node = context.node;
      const question = questionOf(node) || node.sig.label;
      if (question.trim().length === 0) {
        pushToast(
          infoToast(
            'NextMove cannot identify this field',
            'The page gives it no label, so there is no question to remember an answer against.',
          ),
        );
        return;
      }

      const profile = await ensureSuggestProfile();
      // A choice group's answer is the option's own text, which has to fuzzy-match a differently
      // worded option list on the next employer's form — that is the Answer Bank's job, not a
      // profile path's.
      const mappable = profile !== null && !isOpenTextQuestion(node) && !isChoiceControl(context.el);
      const path = mappable ? profilePathForValue(profile, node.sig, value) : null;

      let ok = false;
      if (path !== null) {
        const reply = await sendMessage('FIELD_MAP_SAVE', { domain, sigHash: hash, path });
        ok = reply.ok;
        if (ok) userMappings = { ...(userMappings ?? {}), [hash]: path };
      } else {
        const reply = await sendMessage('ANSWERS_SAVE', {
          qRaw: question,
          answer: value,
          source: 'user',
          profileId: settings.activeProfileId,
          company: job !== null && job.company.length > 0 ? job.company : null,
        });
        ok = reply.ok;
        // The bank has a new row; the page's index is a snapshot and is now one row out of date.
        if (ok) bankIndex = null;
      }

      if (!ok) {
        pushToast({
          id: `jf-save-failed-${hash}`,
          kind: 'error',
          title: 'NextMove could not save that',
          message: 'Nothing was lost — the value is still in the field. Try again.',
          timeoutMs: 7_000,
        });
        return;
      }

      pushToast(
        infoToast(
          'Saved — NextMove will suggest this next time',
          path !== null
            ? `This field on ${domain} is now mapped to your profile, so it fills itself from here on.`
            : 'It is in your Answer Bank, and the same question on any form will offer it.',
        ),
      );

      // "Next time" includes the rest of this page: the same question often appears twice in one
      // application, and re-running the pass promotes those to a 100-score suggestion immediately.
      await refreshFieldControls();
      renderShell();
    }

    /**
     * ✕ / Done. Review mode is over: the outlines go and the corner folds back into its bubble.
     *
     * Distinct from the minimise button and Esc, which only fold the panel — a user tidying the
     * screen mid-application has not asked to lose the outlines telling them which fields to check.
     */
    function closePanel(): void {
      focusedHash = null;
      markers?.clear();
      setPanelExpanded(false);
    }

    /**
     * Expand or fold the panel.
     *
     * `remember` is false for the one-shot expand after a fill run: showing someone their results is
     * not them telling us they want the panel open from now on, and persisting it made every page in
     * every tab open with a 392px panel over it for the rest of the session.
     */
    function setPanelExpanded(expanded: boolean, remember = true): void {
      if (panelCollapsed === !expanded) return;
      panelCollapsed = !expanded;
      if (remember) void setPanelCollapsed(panelCollapsed);
      renderShell();
    }

    /**
     * The global power switch, from the one surface in the page that offers it.
     *
     * Four surfaces flip this bit — this one, the panel header, the popup and Alt+Shift+N — and all
     * four write it through `platform/storage.setEnabled`. Nothing is applied locally here: the
     * settings subscriber in `boot()` hears the write back and drives the teardown or the re-scan,
     * so the tab that flipped it and the tab next to it take exactly the same path (SEC 5.1).
     */
    function flipPower(): void {
      // `toggleEnabled` reads the slot under its own lock. Flipping `!settings.enabled` instead would
      // be a read-modify-write off a snapshot that the popup or the shortcut may already have moved.
      void toggleEnabled().catch((error: unknown) => {
        log.debug('could not flip the power switch', error);
      });
    }

    /**
     * Paint the corner: the bubble in the `pill` layer, the panel in the `panel` layer.
     *
     * The two are separate roots on purpose: they sit at different depths (a panel must be able to
     * cover a floating widget), and with the power switch off the bubble is the only thing NextMove
     * leaves on the page — the panel layer is cleared outright.
     *
     * `showFloatingPill === false` means the user asked for nothing in the corner of their pages, and
     * that is honoured literally: no bubble, and so no in-page way back on. The popup's toggle and
     * Alt+Shift+N are unaffected, and the review panel still opens itself after a fill run.
     */
    function renderBubble(): void {
      if (!isTop || disposed) return;
      if (!settings.showFloatingPill) {
        overlay?.clear('pill');
        return;
      }
      ui().render(
        'pill',
        h(PanelBubble, {
          enabled: settings.enabled,
          pending,
          busy: filling,
          hidden: !panelCollapsed && settings.enabled,
          onExpand: () => setPanelExpanded(true),
          onToggleEnabled: flipPower,
        }),
      );
    }

    function renderShell(): void {
      renderBubble();
      renderPanel();
    }

    /**
     * What the panel lists. A run's own rows are the subject when there has been a run; the rows the
     * proactive layer contributes are the fields the user has accepted or waved off, which the run
     * knows nothing about and which carry the only way back from a mis-clicked ✗.
     */
    function panelRows(): readonly ReviewRow[] {
      if (settledRows.size === 0) return lastRows;
      const known = new Set(lastRows.map((row) => row.hash));
      const extra = [...settledRows.values()].filter((row) => !known.has(row.hash));
      return extra.length === 0 ? lastRows : [...extra, ...lastRows];
    }

    function renderPanel(): void {
      if (!isTop || disposed) return;
      // Off means off: no panel in the page at all, only the grey bubble above.
      if (!settings.enabled) {
        overlay?.clear('panel');
        return;
      }
      const report = lastReport ?? emptyReport(adapterId, location.href);
      const contributions = [...frameReports.values()];

      const panel = h(ReviewPanel, {
          atsLabel: ATS_LABEL[adapterId],
          domain,
          stats: {
            filled: report.filled + contributions.reduce((sum, f) => sum + f.filled, 0),
            suggested: report.suggested + contributions.reduce((sum, f) => sum + f.suggested, 0),
            skipped: report.skipped + contributions.reduce((sum, f) => sum + f.skipped, 0),
            errors: report.errors,
            total:
              report.perField.length +
              contributions.reduce((sum, f) => sum + f.filled + f.suggested + f.skipped, 0),
          },
          rows: panelRows(),
          profilePaths: PROFILE_PATHS,
          unreachableFrames: unreachableNotes(lastScan),
          frameContributions: contributions,
          truncated: lastScan?.truncated ?? false,
          nextStep,
          busy: filling,
          onRevealRow: (id: string) => fieldMarkers().reveal(id),
          onRevealNextStep: () => fieldMarkers().reveal(NEXT_MARKER_ID),
          onMapField: saveMapping,
          onSaveAnswer: saveAsAnswer,
          onRestoreRow: restoreRow,
          focusedHash,
          chrome: h(PanelChrome, {
            enabled: settings.enabled,
            onToggleEnabled: flipPower,
            onCollapse: () => setPanelExpanded(false),
          }),
          onRefill: () => void runFillFlow('pill', null),
          onClose: closePanel,
        });

      ui().render(
        'panel',
        h(
          PanelShell,
          { collapsed: panelCollapsed, onCollapse: () => setPanelExpanded(false) },
          panel,
        ),
      );
    }

    async function resolveResume(
      activeProfileId: string,
      path: ProfilePath | null,
    ): Promise<ResumeAttachment | null> {
      const reply = await sendMessage('RESUME_GET', { profileId: activeProfileId, path });

      if (!reply.ok) {
        log.warn(`RESUME_GET failed for ${path ?? 'resume'}: ${reply.error.code}`);
        pushToast({
          id: 'jf-resume-unavailable',
          kind: 'error',
          title: 'NextMove could not attach your file',
          message: reply.error.message,
        });
        return null;
      }

      const { resume, how, alternatives } = reply.data;
      if (resume === null) {
        log.debug(`no stored file for ${path ?? 'resume'} — the field will be flagged for the user`);
        return null;
      }

      const attachment = attachmentFromBytes(resume);
      if (attachment === null) {
        log.warn(`the bytes of "${resume.name}" did not survive the bus; not attaching`);
        return null;
      }

      if (how === 'most-recent' && alternatives.length > 0) {
        pushToast({
          id: `jf-resume-ambiguous-${resume.id}`,
          kind: 'info',
          title: `Attached your most recent file — “${resume.name}”`,
          message:
            `You have ${String(alternatives.length + 1)} stored and none is marked as the default ` +
            `for this profile. Set one in Options, or replace the attachment yourself.`,
          timeoutMs: 9_000,
        });
      }

      return attachment;
    }

    async function runFillFlow(trigger: FillTrigger, profileId: string | null): Promise<FillReport> {
      if (disposed) return emptyReport(adapterId, location.href);
      if (filling) {
        log.debug('fill already in flight; ignoring the duplicate trigger');
        return lastReport ?? emptyReport(adapterId, location.href);
      }

      filling = true;
      const abort = new AbortController();
      fillAbort = abort;
      if (isTop) renderShell();

      try {
        await refreshSettings();
        if (config === null) config = await loadConfig(adapterId);

        const profileReply = await sendMessage('PROFILE_GET', { profileId });
        const profile = profileReply.ok ? profileReply.data.profile : null;
        if (profile === null) {
          pushToast({
            id: 'jf-no-profile',
            kind: 'info',
            title: 'Set up your NextMove profile first',
            message: 'Open the extension’s Options page and fill in your details once.',
            setupLink: true,
          });
          return emptyReport(adapterId, location.href);
        }

        const mappingReply = await sendMessage('FIELD_MAP_GET', { domain });
        const mappings = mappingReply.ok ? mappingReply.data.mappings : {};

        const scan = scanPage();
        lastScan = scan;
        const matches = matcherFor(profile, mappings).match(scan.fields);

        const requiredByHash = new Map<string, boolean>();
        for (const node of scan.fields) {
          if (node.required) requiredByHash.set(node.sig.hash, true);
        }

        const rows: ReviewRow[] = [];
        const specs: MarkerSpec[] = [];
        let index = 0;

        const onField = (event: FillFieldEvent): void => {
          index += 1;
          const tone = toneOf(event);
          const id = `${event.hash}-${index}`;

          const row: ReviewRow = {
            id,
            hash: event.hash,
            tone,
            label: event.sig.label,
            section: event.sig.sectionHeading,
            path: event.path,
            value: event.value,
            score: event.score,
            required: requiredByHash.get(event.hash) === true,
          };
          if (event.reason !== undefined) row.reason = event.reason;
          rows.push(row);

          if (!isTop) return;
          // An already-answered field is as "done" as a filled one, so it follows the same setting:
          // someone who does not want their finished fields outlined does not want these either.
          if ((tone === 'filled' || tone === 'answered') && !settings.highlightFilled) return;
          if (!(event.el instanceof HTMLElement)) return;

          const spec: MarkerSpec = {
            id,
            el: event.el,
            tone: MARKER_TONE[tone],
            badge: MARKER_BADGE[tone],
            tooltip: event.sig.label,
          };
          specs.push(spec);
        };

        const report = await runFill(matches, {
          profile,
          atsId: adapterId,
          url: location.href,
          quirks: config?.quirks ?? null,
          humanPacing: settings.humanPacing,
          signal: abort.signal,
          resolveResume: (path) => resolveResume(profile.id, path),
          onField,
        });

        lastReport = report;
        lastRows = rows;

        // What arms the wizard chain is "this run belongs to an application we understand", not
        // "this run wrote something". A first step whose fields are all already answered writes
        // nothing and reports 0 filled / 0 suggested — the same numbers as a page we matched
        // nothing on — and gating on those numbers alone left the chain disarmed, so the later,
        // genuinely empty steps were never filled. A respected field is proof of recognition: the
        // matcher found a profile path for it and the engine deliberately declined to overwrite.
        const respected = rows.some((row) => row.tone === 'answered');
        if (report.filled > 0 || report.suggested > 0 || respected) {
          chainActive = true;
          if (scan.fields.length > 0) filledStepKeys.add(scanKey(scan.fields));
        }

        try {
          unstampAll(document);
        } catch (error) {
          log.debug('could not unstamp bridge ids', error);
        }

        if (!isTop) {
          reportUpward(report);
          return report;
        }

        const located = locateNextStep();
        nextStep = located?.info ?? null;
        if (located !== null) {
          specs.push({
            id: NEXT_MARKER_ID,
            el: located.el,
            tone: 'next',
            badge: located.info.kind === 'next' ? 'Next step — you press it' : 'Submit — you press it',
            tooltip: 'NextMove never clicks this.',
          });
        }

        if (settings.reviewOverlay) {
          fieldMarkers().set(specs);
          // The results are the one thing worth interrupting for, and exactly once: a five-step
          // Workday wizard that reopened the panel on every step would be a nuisance, and a user who
          // folded it away has said what they want.
          if (!autoExpanded) {
            autoExpanded = true;
            setPanelExpanded(true, false);
          }
        } else {
          pushToast(
            infoToast(
              `Filled ${report.filled} of ${report.perField.length} fields`,
              'Review before you submit — NextMove never presses Submit.',
            ),
          );
        }

        void logFillToTracker(report, profile.id);
        return report;
      } catch (error) {
        log.error('fill run failed', error);
        pushToast({
          id: `jf-fill-error-${Date.now()}`,
          kind: 'error',
          title: 'NextMove could not finish this form',
          message: describe(error),
          timeoutMs: 9_000,
        });
        return lastReport ?? emptyReport(adapterId, location.href);
      } finally {
        filling = false;
        if (fillAbort === abort) fillAbort = null;
        if (isTop) {
          renderShell();
          renderSparkles();
          // The run answered some of the fields the proactive layer was offering; those offers are
          // spent, and the ones it could not fill are exactly the ones still worth showing.
          void refreshFieldControls();
        }
      }
    }

    async function logFillToTracker(report: FillReport, profileId: string): Promise<void> {
      if (!settings.autoLogApplications) return;
      const reply = await sendMessage('FILL_REPORT', {
        report,
        job: job ?? captureJob(),
        profileId,
      });
      if (reply.ok) applicationId = reply.data.applicationId;
      else log.debug(`FILL_REPORT failed: ${reply.error.message}`);
    }

    function reportUpward(report: FillReport): void {
      const top = window.top;
      if (top === null || top === window) return;
      const message: FrameReportMessage = {
        __jobfillFrame: 'report',
        v: 1,
        filled: report.filled,
        suggested: report.suggested,
        skipped: report.skipped,
        errors: report.errors,
      };
      try {
        top.postMessage(message, '*');
      } catch (error) {
        log.debug('could not report up to the top frame', error);
      }
    }

    async function evaluate(): Promise<void> {
      if (disposed) return;

      // The power switch is checked here rather than at boot because it can flip while the page is
      // open — Alt+Shift+N, the bubble, the panel header and the popup all write the settings slot,
      // and the subscriber below re-enters this function on every write.
      if (!settings.enabled) {
        teardownInPageUi();
        renderShell();
        return;
      }
      // Back on: the observer is what keeps this function running on a single-page ATS, and `off`
      // stopped it.
      observer?.start();

      try {

        adapterId = detectAts(location.href, document).id;
      } catch (error) {
        log.debug('ATS detection failed; using the generic adapter', error);
        adapterId = 'generic';
      }
      if (config === null || config.atsId !== adapterId) config = await loadConfig(adapterId);

      const scan = scanPage();
      lastScan = scan;

      // The corner exists from here on, on every page NextMove runs on and whatever the scan found:
      // it is where the power switch lives, and a switch you can only reach on pages we already
      // decided to act on is not a switch (Feature A / SEC 5.1).
      if (isTop) renderShell();

      if (scan.fields.length > 0) {
        const hashes = new Set(scan.fields.map((field) => field.sig.hash));
        if (lastFieldHashes !== null && overlapRatio(hashes, lastFieldHashes) < 0.4) {
          resetStepState();
          // A different field set answers different questions; the label → value index built for
          // the previous step would suggest the wrong things on this one.
          suggestIndex = null;
        }
        lastFieldHashes = hashes;
        stepKey = scanKey(scan.fields);
      }


      if (scan.fields.length === 0) {
        applicationLike = false;
        sparkleTargets = [];
        clearFieldControls();
        overlay?.clear('sparkles');
        return;
      }

      const matches = matcherFor(null, null).match(scan.fields);
      applicationLike = looksLikeApplication(scan, matches, adapterId, document);

      if (!applicationLike) {
        sparkleTargets = [];
        clearFieldControls();
        overlay?.clear('sparkles');
        return;
      }

      if (!isTop) return;

      job = captureJob();

      sparkleTargets = collectSparkleTargets(scan.fields, matches);
      renderSparkles();

      // Feature C: every recognised control says what it would receive, now, before the user has
      // typed a character or asked for anything.
      //
      // Deliberately NOT awaited. This pass makes four round trips to the service worker, and
      // awaiting it put all of that latency in front of the auto-fill decision below — long enough,
      // on a busy machine, for the observer's 400ms step poll to fire a re-scan into the middle of
      // it. The step then marked itself filled and found a run already in flight, so it was skipped
      // and never came back. The pass re-checks `lastScan` after its awaits and drops itself if the
      // page moved on, and `runFillFlow` re-runs it when a fill finishes, so nothing here needs to
      // wait for it.
      void renderFieldControls(scan);

      renderShell();

      const wantsAuto = settings.autoFillOnLoad || (chainActive && settings.autoFillNextSteps);
      if (wantsAuto && stepDirty && !filling && !filledStepKeys.has(stepKey)) {
        stepDirty = false;
        filledStepKeys.add(stepKey);

        await waitForFormSettle();
        if (disposed || filling) return;

        const settled = scanPage().fields;
        if (settled.length > 0) filledStepKeys.add(scanKey(settled));
        void runFillFlow('auto', null);
      }
    }

    function scanKey(fields: readonly FieldNode[]): string {
      const hashes = fields.map((field) => field.sig.hash).sort();
      const first = hashes[0] ?? '';
      const last = hashes[hashes.length - 1] ?? '';
      return `${location.href}::${String(hashes.length)}:${first}:${last}`;
    }

    function overlapRatio(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
      if (a.size === 0 || b.size === 0) return 1;
      let shared = 0;
      for (const value of a) {
        if (b.has(value)) shared += 1;
      }
      return shared / Math.min(a.size, b.size);
    }

    function resetStepState(): void {
      lastRows = [];
      lastReport = null;
      nextStep = null;
      focusedHash = null;
      frameReports.clear();
      sparkleTargets = [];
      stepDirty = true;
      // A different field set answers different questions; the clusters drawn for the old one point
      // at controls that are already gone. `acceptedHashes` goes with them: a signature is derived
      // from a field's label, name and section, so two applications can genuinely produce the same
      // hash for "Email" — and carrying the flag across would suppress the offer on the next form and
      // show a row claiming NextMove had filled a field it never touched.
      acceptedHashes.clear();
      clearFieldControls();
      markers?.clear();
      overlay?.clear('sparkles');
      renderPanel();
    }

    async function waitForFormSettle(maxMs = 3_000, pollMs = 200): Promise<void> {
      const deadline = Date.now() + maxMs;
      let previous: string | null = null;

      while (!disposed && Date.now() < deadline) {
        const fields = scanPage().fields;
        const key = fields.length > 0 ? scanKey(fields) : '';
        if (key.length > 0 && key === previous) return;
        previous = key;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, pollMs);
        });
      }
    }

    function scheduleEvaluate(): void {
      if (evaluateTimer !== null) clearTimeout(evaluateTimer);
      evaluateTimer = setTimeout(() => {
        evaluateTimer = null;
        void evaluate();
      }, OBSERVER_DEBOUNCE_MS);
    }

    function handleConfirmation(): void {
      if (disposed || confirmationHandled) return;

      const signal = detectConfirmation(document, location.href, config?.confirmation ?? null);
      if (!signal.confirmed) return;
      confirmationHandled = true;
      chainActive = false;

      if (!isTop) {
        const top = window.top;
        if (top !== null && top !== window) {
          const message: FrameConfirmedMessage = { __jobfillFrame: 'confirmed', v: 1 };
          try {
            top.postMessage(message, '*');
          } catch (error) {
            log.debug('could not report a confirmation up to the top frame', error);
          }
        }
        return;
      }

      log.info(`confirmation observed (${signal.source}: ${signal.evidence})`);
      recordApplied(`${signal.source}: ${signal.evidence}`);
    }

    /**
     * Mark this posting as applied, from whichever signal noticed first — a confirmation page in
     * this frame, a confirmation relayed up from an iframe, or the submit press itself.
     *
     * A row we already own is patched rather than duplicated; only a page with no row yet logs a
     * new one. Callers are responsible for their own gating (job-looking page, power switch); this
     * function's only job is "same posting, one row".
     */
    function recordApplied(reason: string): void {
      if (disposed || !isTop) return;

      if (applicationId !== null) {
        void sendMessage('TRACKER_UPDATE', {
          id: applicationId,
          patch: { status: 'applied', appliedAt: Date.now() },
        });
        return;
      }

      if (!settings.autoLogApplications) return;
      const captured = job ?? captureJob();
      if (captured === null) return;
      if (captured.company.length === 0 && captured.title.length === 0) return;

      log.info(`logging an application (${reason})`);
      void sendMessage('TRACKER_LOG', {
        entry: {
          company: captured.company,
          role: captured.title,
          url: location.href,
          ats: adapterId,
          profileId: settings.activeProfileId ?? '',
          status: 'applied',
        },
      }).then((reply) => {
        if (reply.ok) applicationId = reply.data.row.id;
      });
    }

    /**
     * The submit press itself, from `tracker/submit-watch`. This is the signal v2.2 had and this
     * codebase did not: a posting that navigates straight to the employer's own "thanks" page —
     * or to nothing at all — never produces a confirmation cue for the observer to find.
     *
     * Three gates before anything is written, because a false positive here invents an application
     * the user never made: the power switch, a job-looking URL, and this page actually having had
     * application-shaped fields on it.
     */
    function handleSubmitSignal(signal: SubmitSignal): void {
      if (disposed || !settings.enabled || confirmationHandled) return;
      if (!applicationLike) return;
      if (!looksLikeJobPage(location.href, adapterId)) return;

      confirmationHandled = true;
      chainActive = false;

      if (!isTop) {
        const top = window.top;
        if (top !== null && top !== window) {
          const message: FrameConfirmedMessage = { __jobfillFrame: 'confirmed', v: 1 };
          try {
            top.postMessage(message, '*');
          } catch (error) {
            log.debug('could not report a submit up to the top frame', error);
          }
        }
        return;
      }

      recordApplied(`submit (${signal.reason}${signal.label === '' ? '' : `: ${signal.label}`})`);
    }


    type RuntimeListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void;

    const onRuntimeMessage: RuntimeListener = (message, _sender, sendResponse) => {
      if (!looksLikeEnvelope(message)) return false;

      const parsed = messageEnvelopeSchema.safeParse(message);
      if (!parsed.success) return false;
      if (parsed.data.type !== 'FILL_REQUEST') return false;

      const payload = readFillPayload(parsed.data.payload);

      if (!isTop) {
        void runFillFlow(payload.trigger, payload.profileId);
        return false;
      }

      void runFillFlow(payload.trigger, payload.profileId).then(
        (report) => sendResponse(okReply(report) satisfies MessageReply<FillReport>),
        (error: unknown) => sendResponse(errReply('INTERNAL', describe(error))),
      );
      return true;
    };

    const onWindowMessage = (event: MessageEvent<unknown>): void => {
      if (!isTop || disposed) return;
      if (event.source === window) return;

      if (isFrameConfirmation(event.data)) {
        // The form lived in an iframe, so the sub-frame is the only one that saw the submit or the
        // thank-you page. Previously this was dropped unless the top frame already owned a row,
        // which is exactly backwards for Greenhouse/Lever: the top frame is the job ad, and it has
        // no row until something logs one.
        if (!confirmationHandled) {
          confirmationHandled = true;
          chainActive = false;
          recordApplied('relayed from a sub-frame');
        }
        return;
      }


      const report = parseFrameReport(event.data);
      if (report === null) return;

      frameReports.set(event.origin || 'an embedded frame', {
        origin: event.origin || 'an embedded frame',
        filled: report.filled,
        suggested: report.suggested,
        skipped: report.skipped,
      });
      renderPanel();
    };

    const onFocusIn = (event: FocusEvent): void => {
      if (!isTop || disposed || filling || !applicationLike) return;

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (overlay !== null && overlay.host.contains(target)) return;
      if (!isFillableControl(target)) return;

      let node = nodeForElement(target);
      if (node === null) {
        const now = Date.now();
        if (now - lastFocusScanAt >= 1_000) {
          lastFocusScanAt = now;
          lastScan = scanPage();
          node = nodeForElement(target);
        }
      }

      const sig = node?.sig ?? buildFieldSignature(target, frameId);
      focusedHash = sig.hash;

      if (!lastRows.some((row) => row.hash === sig.hash)) {
        const synthetic: ReviewRow = {
          id: `${sig.hash}-focus`,
          hash: sig.hash,
          tone: 'unmatched',
          label: sig.label,
          section: sig.sectionHeading,
          path: null,
          value: '',
          score: 0,
          required: node?.required ?? target.hasAttribute('required'),
          reason: 'new-field',
        };
        lastRows = [synthetic, ...lastRows];
      }

      renderPanel();
    };

    function teardown(): void {
      if (disposed) return;
      disposed = true;
      if (evaluateTimer !== null) clearTimeout(evaluateTimer);
      try {
        browser.runtime.onMessage.removeListener(
          onRuntimeMessage as unknown as Parameters<
            typeof browser.runtime.onMessage.removeListener
          >[0],
        );
      } catch {
        // The extension context is already gone; nothing left to detach from.
      }
      window.removeEventListener('message', onWindowMessage);
      document.removeEventListener('focusin', onFocusIn, true);
      unsubscribeSettings?.();
      suggest?.destroy();
      suggest = null;
      submitWatch?.destroy();
      submitWatch = null;
      disposePageObserver();

      controls?.dispose();
      controls = null;
      observer = null;
      markers?.dispose();
      markers = null;
      destroyOverlay();
      overlay = null;
      toasts = null;
    }

    browser.runtime.onMessage.addListener(
      onRuntimeMessage as unknown as Parameters<typeof browser.runtime.onMessage.addListener>[0],
    );
    if (isTop) window.addEventListener('message', onWindowMessage);
    if (isTop) document.addEventListener('focusin', onFocusIn, true);
    ctx.onInvalidated(teardown);

    /**
     * Say out loud what just happened, in the tab the user is looking at and in every other one.
     *
     * The switch can be flipped from four places and two of them are invisible from here (the popup,
     * and Alt+Shift+N with nothing open) — so the confirmation is driven off the storage change
     * rather than off the click, which is the only way a keyboard shortcut can be trusted to have
     * done anything at all.
     */
    function announcePower(enabled: boolean): void {
      if (enabled) {
        pushToast(
          infoToast(
            'NextMove is on (Alt+Shift+N)',
            'Suggestions are back on the fields NextMove recognises. Nothing is filled until you say so.',
          ),
        );
        return;
      }
      pushToast(
        infoToast(
          'NextMove is off (Alt+Shift+N)',
          'Nothing is drawn, suggested or filled on any site until you turn it back on. Your saved data is untouched.',
        ),
      );
    }

    async function boot(): Promise<void> {
      await refreshSettings();
      panelCollapsed = (await readUiState()).panelCollapsed;
      if (disposed) return;

      unsubscribeSettings = subscribeSlot('settings', (next) => {
        const wasEnabled = settings.enabled;
        const wasProfile = settings.activeProfileId;
        settings = next;
        if (disposed) return;

        // Everything the suggestion layers hold is derived from one profile: the label→value index,
        // the resolved profile itself, and the Answer Bank snapshot (which is scoped by profile id).
        // Switching profiles in the popup has to invalidate all three, or the page keeps offering — and
        // ✓ keeps writing — values from the profile the user just switched away from.
        if (next.activeProfileId !== wasProfile) {
          suggestProfile = null;
          suggestProfileLoaded = false;
          suggestIndex = null;
          bankIndex = null;
          void refreshFieldControls();
        }

        if (next.enabled === wasEnabled) {
          scheduleEvaluate();
          return;
        }
        // The switch moved. `Suggest.ts` owns its own host and takes itself down; everything else is
        // `evaluate()`'s job, and it runs now rather than on the 250ms debounce — a power switch that
        // takes a quarter of a second to visibly do anything reads as broken.
        suggest?.setEnabled(next.enabled);
        announcePower(next.enabled);
        void evaluate();
      });

      suggest = installSuggest({
        lookup: suggestLookup,
        remember: suggestRemember,
        onToast: (message) => pushToast(infoToast(message)),
        // The proactive layer speaks for the controls it has an offer on — and for the ones the user
        // has explicitly refused, which is the subtler half. `Suggest.ts` knows nothing about the ✗
        // ledger and resolves its values from the same profile and the same Answer Bank, so handing a
        // refused field back to it would put the refused value under the cursor again and let Tab
        // write it. A refusal is a refusal whichever layer would have made the offer.
        owns: (el) => controls?.hasOffer(el) === true || isRefused(el),
      });
      suggest.setEnabled(settings.enabled);

      submitWatch = installSubmitWatch({ onSubmit: handleSubmitSignal });


      try {
        adapterId = detectAts(location.href, document).id;
      } catch {
        adapterId = 'generic';
      }
      config = await loadConfig(adapterId);
      if (disposed) return;

      // Held so the power switch can stop it: while NextMove is off, nothing about this page should
      // keep waking us up (see `teardownInPageUi`).
      observer = getPageObserver({
        confirmation: config.confirmation,
        debounceMs: OBSERVER_DEBOUNCE_MS,
      });
      observer.onPageChanged((event) => {
        // A URL change is a new page, and whatever the panel is showing belongs to the last one.
        //
        // A *step* signal is not the same thing. It means the wizard's own progress marker moved,
        // which is a hint that the form may now be a different one — and `evaluate()` is what
        // actually knows, because it compares the scanned field set against the previous one and
        // resets on its own. Resetting here as well double-counts a single step change: the mutation
        // that carries the new step and the 400ms poll that notices the same thing can arrive up to
        // half a second apart, and whichever lands second throws away the rows of the fill the first
        // one had already triggered. On a Workday wizard that read as the review panel emptying
        // itself a moment after the step was filled.
        if (event.url !== event.previousUrl) resetStepState();
        scheduleEvaluate();
      });
      observer.onConfirmationLikely(() => handleConfirmation());

      if (isTop) void refreshKeyAvailability();

      await evaluate();
    }

    void boot().catch((error: unknown) => log.error('content script failed to start', error));
  },
});
