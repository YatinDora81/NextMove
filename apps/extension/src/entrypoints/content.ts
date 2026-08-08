/**
 * entrypoints/content.ts — the ISOLATED-world content script: JobFill's whole in-page brain.
 *
 * JF-001 Rev 3.0 · SEC 4.1 (content-script layer) · SEC 4.3 Flow A and Flow B · SEC 6.7 (tracker
 * auto-capture) · SEC 9.2 · INV-1 · INV-2 · INV-4.
 *
 * ── Flow A, one-click fill (SEC 4.3) ─────────────────────────────────────────────────────────────
 *   1. Trigger      FILL_REQUEST arrives from the popup or the Alt+J command, or the floating pill
 *                   fires locally.
 *   2. Detect ATS   `detectAts(url, document)` → a dedicated adapter or the generic fallback.
 *   3. Scan         `FormScanner` walks the document, same-origin iframes and open shadow roots.
 *   4. Match        `FieldMatcher` scores each signature (user mapping → adapter → autocomplete →
 *                   heuristics), honouring the INV-4 thresholds from settings.
 *   5. Fill         `runFill` drives each strategy with human-ish pacing.
 *   6. Report       markers + the review panel; `FILL_REPORT` hands the run to the tracker.
 *   7. **Human submits. JobFill stops.** (INV-1)
 *
 * ── Flow B, AI screening answers ─────────────────────────────────────────────────────────────────
 * Owned by `content/overlay/SparkleButton.tsx`; this file only decides which fields deserve a ✨
 * and supplies the job context, the tone/length presets and a framework-safe writer.
 *
 * ── INV-1, stated as code ────────────────────────────────────────────────────────────────────────
 * There is no `.click()`, `.submit()` or `.requestSubmit()` call in this file. The only control we
 * ever *locate* is the wizard's next-step (or the submit) button, and the only thing we do with it
 * is draw a green outline around it so a human can find it. `core/fill` refuses submit controls,
 * the bridge refuses them again, and the MAIN-world script refuses them a third time.
 *
 * ── INV-2 ────────────────────────────────────────────────────────────────────────────────────────
 * Every AI request originates in a ✨ click inside the overlay's shadow DOM, which mints a
 * single-use 5 s gesture nonce over `GESTURE_MINT`. Nothing in the fill path, the observer, or the
 * auto-capture path can reach Gemini.
 *
 * ── SEC 9.2, no fingerprinting ───────────────────────────────────────────────────────────────────
 * The script runs on `<all_urls>` because career pages live everywhere, but it renders **nothing**
 * and stores **nothing** until a scan finds application-shaped fields (`looksLikeApplication`).
 * On an ordinary page it costs one `querySelectorAll` at `document_idle` and then goes quiet.
 * Page text — labels, headings, job descriptions — is read with `textContent` and rendered as text.
 *
 * ── Frames (SEC 4.4) ─────────────────────────────────────────────────────────────────────────────
 * The script is injected with `all_frames: true`. The TOP frame owns all UI and answers
 * `FILL_REQUEST`; child frames fill their own document and post a count-only summary up, never
 * drawing anything. Frames this scanner could not traverse are listed honestly in the panel.
 */

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
import { getSettings, subscribeSlot } from '@/platform/storage';

import { FieldMatcher, FormScanner, knownProfilePaths, nodeElement } from '@/core';
import type { ScanResult } from '@/core/scanner';
import {
  SUBMIT_TEXT_PATTERN,
  controlLabel,
  detectAts,
  findControlByText,
  resolveAdapterConfig,
} from '@/core/adapters';
import { disposePageObserver, getPageObserver } from '@/core/observer';
import {
  emptyReport,
  fillText,
  readQuirks,
  runFill,
  unstampAll,
  contextOf,
  type FillFieldEvent,
  type ResumeAttachment,
} from '@/core/fill';
import { buildJobContext } from '@/tracker/capture';
import { detectConfirmation } from '@/tracker/detectors';

import {
  FieldMarkers,
  FillPill,
  ReviewPanel,
  SparkleLayer,
  ToastHost,
  destroyOverlay,
  getOverlay,
  infoToast,
  isOpenTextQuestion,
  isPillDismissed,
  questionOf,
  type FrameContribution,
  type MarkerSpec,
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

/* ------------------------------------------------------------------------------------------------
 * Frame channel — child frame → top frame (untrusted, display-only)
 * ---------------------------------------------------------------------------------------------- */

const FRAME_KEY = '__jobfillFrame';

interface FrameReportMessage {
  __jobfillFrame: 'report';
  v: 1;
  filled: number;
  suggested: number;
  skipped: number;
  errors: number;
}

/**
 * "This frame is showing a confirmation state" (SEC 6.7 step 4). iCIMS and Taleo run the whole
 * application — including the thank-you page — inside an iframe, so the top frame would otherwise
 * never see the submission land.
 */
interface FrameConfirmedMessage {
  __jobfillFrame: 'confirmed';
  v: 1;
}

function isFrameConfirmation(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message[FRAME_KEY] === 'confirmed' && message['v'] === 1;
}

/**
 * Nothing that arrives on this channel is trusted: a hostile page can post the same shape. It is
 * therefore used for **display only** — counts shown in the review panel — and never to trigger a
 * fill, reveal profile data, or unlock anything. The reporting origin is taken from the browser's
 * own `event.origin`, never from the payload.
 */
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

/* ------------------------------------------------------------------------------------------------
 * SEC 9.2 — is this an application, or just a page the user is reading?
 * ---------------------------------------------------------------------------------------------- */

const APPLICATION_TEXT_RE =
  /\b(apply|application|applicant|candidate|resume|r[ée]sum[ée]|cv|cover letter|job|position|opening|vacancy|career)\b/i;

/** Paths whose presence means "somebody is being asked who they are". */
const IDENTITY_PATHS: ReadonlySet<ProfilePath> = new Set<ProfilePath>([
  'personal.email',
  'personal.firstName',
  'personal.lastName',
  'personal.fullName',
  'personal.phone',
]);

/** Headings and the title, read with `textContent` only — never `innerHTML` (SEC 9.2). */
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

/**
 * "JobFill activates its UI only when a form scan finds application-shaped fields; it stores
 * nothing about pages that aren't applications" (SEC 9.2).
 *
 * A dedicated ATS adapter matching is evidence in itself — its `detect()` is a URL pattern plus a
 * DOM fingerprint (SEC 6.5). On the generic long tail we demand real evidence: somebody is being
 * asked who they are, plus either a file upload, a broad spread of matched profile paths, or
 * application vocabulary in the page's own headings. A login form (email + password) never
 * qualifies: the scanner refuses password inputs outright, leaving a single field.
 */
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

/* ------------------------------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------------------------- */

/** A stable, non-negative id for this frame. Never hashed into a signature (see core/signature). */
function frameIdOf(isTop: boolean, href: string): number {
  if (isTop) return 0;
  let hash = 2_166_136_261;
  for (let i = 0; i < href.length; i += 1) {
    hash ^= href.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 1_000_000 || 1;
}

/** HTML documents only: SVG, XML and PDF viewers have no application forms. */
function isSupportedDocument(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (document.contentType !== 'text/html' && document.contentType !== 'application/xhtml+xml') {
    return false;
  }
  return document.documentElement !== null;
}

function currentValue(el: HTMLElement): string {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value;
  }
  if (el.isContentEditable) return el.textContent ?? '';
  return '';
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

/** Marker id reserved for the located next-step / submit control (INV-1: outlined, never clicked). */
const NEXT_MARKER_ID = '__jf_next_step';

/* ------------------------------------------------------------------------------------------------
 * F-05 — turning a RESUME_GET reply back into a real File
 * ---------------------------------------------------------------------------------------------- */

/**
 * `chrome.runtime` messaging is JSON, so the worker sends the resume bytes as base64 and this side
 * rebuilds them. `atob` exists in every content-script realm (it is a `WindowOrWorkerGlobalScope`
 * member), and the decode happens in the ISOLATED world — the host page can neither see nor reach
 * the resulting `Blob`.
 */
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

/** `ResumeBytes` (wire) → `ResumeAttachment` (what `core/fill/strategies/file.ts` consumes). */
function attachmentFromBytes(resume: ResumeBytes): ResumeAttachment | null {
  const decoded = bytesFromBase64(resume.bytes);
  if (decoded === null || decoded.byteLength === 0) return null;
  // A truncated transfer would attach a corrupt PDF, which is worse than attaching nothing.
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
  return 'unmatched';
}

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

/* ------------------------------------------------------------------------------------------------
 * The content script
 * ---------------------------------------------------------------------------------------------- */

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  world: 'ISOLATED',
  // Do not announce ourselves to the host page with WXT's legacy start-up postMessage (SEC 9.2).
  noScriptStartedPostMessage: true,

  main(ctx) {
    if (!isSupportedDocument()) return;

    const isTop = window.top === window;
    const frameId = frameIdOf(isTop, location.href);
    const domain = location.hostname;

    /* ---- mutable page state ---------------------------------------------------------------- */

    let settings: Settings = DEFAULT_SETTINGS;
    let adapterId: AtsId = 'generic';
    let config: ResolvedAdapterConfig | null = null;
    let job: JobContext | null = null;
    let applicationLike = false;
    let filling = false;
    let disposed = false;
    let aiAvailable = false;
    let keyCount = 0;

    /** Tracker row opened by the last `FILL_REPORT` — the target of the SEC 6.7 status flip. */
    let applicationId: string | null = null;
    let confirmationHandled = false;
    let autoFilledUrl: string | null = null;

    let overlay: OverlayHandle | null = null;
    let markers: FieldMarkers | null = null;
    let pill: FillPill | null = null;
    let toasts: ToastController | null = null;
    const pendingToasts: ToastSpec[] = [];

    let panelOpen = false;
    let lastRows: ReviewRow[] = [];
    let lastReport: FillReport | null = null;
    let lastScan: ScanResult | null = null;
    let nextStep: NextStepInfo | null = null;
    let sparkleTargets: SparkleTarget[] = [];
    const frameReports = new Map<string, FrameContribution>();

    let evaluateTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeSettings: (() => void) | null = null;

    /* ---- overlay plumbing ------------------------------------------------------------------ */

    /** Lazily create the overlay. Never called before `looksLikeApplication` says yes (SEC 9.2). */
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

    /* ---- configuration --------------------------------------------------------------------- */

    /**
     * `CONFIG_GET` (seed ⊕ remote, F-14). INV-3: when the service worker is unreachable we resolve
     * the shipped seed locally instead of failing — the extension must work with the backend and
     * even its own worker asleep.
     */
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

    /**
     * SEC 5.6: with an empty vault the ✨ AI actions render disabled with the setup hint, while the
     * offline Answer-Bank path keeps working. INV-5: the reply is masked metadata — this content
     * script never sees, and never asks for, a key.
     */
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

    /* ---- scanning + the SEC 9.2 activation gate -------------------------------------------- */

    function scanPage(): ScanResult {
      return new FormScanner({ frameId }).scan();
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

    /** SEC 6.7 steps 1-3 — JSON-LD → adapter selectors → og:/title heuristics, plus the JD. */
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

    /**
     * SEC 6.5 `steps.nextButton` — "located, highlighted, NEVER auto-clicked (INV-1)".
     *
     * Returns the element *and* its description in one pass so the outline and the panel copy can
     * never disagree about which control they are talking about. When the adapter declares no step
     * navigator we fall back to locating the submit control, for the same reason: the most useful
     * thing JobFill can do with the button it must never press is show the user where it is.
     */
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

    /* ---- ✨ targets (F-09) ------------------------------------------------------------------ */

    function collectSparkleTargets(fields: readonly FieldNode[], matches: readonly MatchResult[]): SparkleTarget[] {
      const filledPaths = new Map<string, number>();
      for (const match of matches) filledPaths.set(match.node.sig.hash, match.score);

      const targets: SparkleTarget[] = [];
      const seen = new Set<string>();

      for (const node of fields) {
        if (!isOpenTextQuestion(node)) continue;
        // A field the matcher can answer from the vault does not need a generated answer.
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

    async function writeAnswer(el: HTMLElement, text: string): Promise<boolean> {
      const result = await fillText(el, text, contextOf({ quirks: readQuirks(config?.quirks ?? null) }));
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
        readValue: currentValue,
      };
      ui().render('sparkles', h(SparkleLayer, { targets: sparkleTargets, ctx: context }));
    }

    /* ---- the review panel (F-06) ----------------------------------------------------------- */

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
      return true;
    }

    function closePanel(): void {
      panelOpen = false;
      overlay?.clear('panel');
      markers?.clear();
    }

    function renderPanel(): void {
      if (!isTop || disposed || !panelOpen) return;
      const report = lastReport ?? emptyReport(adapterId, location.href);
      const contributions = [...frameReports.values()];

      ui().render(
        'panel',
        h(ReviewPanel, {
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
          rows: lastRows,
          profilePaths: knownProfilePaths(),
          unreachableFrames: unreachableNotes(lastScan),
          frameContributions: contributions,
          truncated: lastScan?.truncated ?? false,
          nextStep,
          busy: filling,
          onRevealRow: (id: string) => fieldMarkers().reveal(id),
          onRevealNextStep: () => fieldMarkers().reveal(NEXT_MARKER_ID),
          onMapField: saveMapping,
          onRefill: () => void runFillFlow('pill', null),
          onClose: closePanel,
        }),
      );
    }

    /* ---- F-05 · resume auto-attach ---------------------------------------------------------- */

    /**
     * Fetch the file a `file` field should receive (F-05 · SEC 6.4 · SEC 4.3 Flow A step 5).
     *
     * Why over the bus: `platform/db` evaluated *here* is the HOST PAGE's IndexedDB, not the
     * extension's, so the `resumes` table is simply not readable from a content script. The service
     * worker is the only realm that owns our database, hence `RESUME_GET`.
     *
     * Handed to the engine as `resolveResume` rather than as `resume`, so it runs **only when a
     * file field is actually reached** — the overwhelmingly common form with no attachment control
     * never sends this message at all, and never moves a megabyte across the bus for nothing.
     *
     * INV-2 is untouched: this reads local IndexedDB, leases no key and contacts no network, so it
     * carries no gesture nonce and is deliberately absent from `GESTURE_REQUIRED`.
     */
    async function resolveResume(
      activeProfileId: string,
      path: ProfilePath | null,
    ): Promise<ResumeAttachment | null> {
      const reply = await sendMessage('RESUME_GET', { profileId: activeProfileId, path });

      if (!reply.ok) {
        // Oversize file, unreadable blob, broken IndexedDB — all things the user can act on, and
        // none of them something to swallow: the field is about to be reported as "attach this
        // yourself" and they deserve to know why.
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

      // F-05, "picker if ambiguous". Several stored files could have applied and none is marked
      // default, so recency decided it. That is a guess, and INV-4's spirit says name it out loud
      // rather than let the user assume they chose this file.
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

    /* ---- Flow A ---------------------------------------------------------------------------- */

    async function runFillFlow(trigger: FillTrigger, profileId: string | null): Promise<FillReport> {
      if (disposed) return emptyReport(adapterId, location.href);
      if (filling) {
        log.debug('fill already in flight; ignoring the duplicate trigger');
        return lastReport ?? emptyReport(adapterId, location.href);
      }

      filling = true;
      pill?.setBusy(true);
      if (isTop) renderPanel();

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

        // The engine's per-field event carries the signature but not `FieldNode.required`; the
        // panel marks required fields with a `*`, which is exactly where the user should look first.
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
          if (tone === 'filled' && !settings.highlightFilled) return;
          if (!(event.el instanceof HTMLElement)) return;

          const spec: MarkerSpec = {
            id,
            el: event.el,
            tone,
            badge:
              tone === 'filled'
                ? 'Filled'
                : tone === 'suggested'
                  ? 'Check this'
                  : 'Needs you',
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
          resolveResume: (path) => resolveResume(profile.id, path),
          onField,
        });

        lastReport = report;
        lastRows = rows;

        // Leave the page exactly as we found it: the bridge's addressing attribute goes away.
        try {
          unstampAll(document);
        } catch (error) {
          log.debug('could not unstamp bridge ids', error);
        }

        if (!isTop) {
          reportUpward(report);
          return report;
        }

        // INV-1 — locate the control that moves the application forward and OUTLINE it. The green
        // marker and the panel's "Show me" are the only things JobFill does with that button.
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
          panelOpen = true;
        } else {
          // The user turned the review panel off; they still get the honest headline number and
          // the reminder that pressing Submit is theirs (F-06 / INV-1).
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
        pill?.setBusy(false);
        if (isTop) {
          renderPanel();
          renderSparkles();
        }
      }
    }

    /** SEC 4.3 Flow A step 6 — "Fill stats sent to TrackerService" (F-12). */
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

    /* ---- evaluation (runs on load and on every SPA/step change) ---------------------------- */

    async function evaluate(): Promise<void> {
      if (disposed) return;

      try {
        adapterId = detectAts(location.href, document).id;
      } catch (error) {
        log.debug('ATS detection failed; using the generic adapter', error);
        adapterId = 'generic';
      }
      if (config === null || config.atsId !== adapterId) config = await loadConfig(adapterId);

      const scan = scanPage();
      lastScan = scan;

      if (scan.fields.length === 0) {
        applicationLike = false;
        sparkleTargets = [];
        pill?.hide();
        overlay?.clear('sparkles');
        return;
      }

      const matches = matcherFor(null, null).match(scan.fields);
      applicationLike = looksLikeApplication(scan, matches, adapterId, document);

      if (!applicationLike) {
        // SEC 9.2 — no UI, no storage, no trace on a page that is not an application.
        sparkleTargets = [];
        pill?.hide();
        overlay?.clear('sparkles');
        return;
      }

      if (!isTop) return; // child frames never draw (SEC 4.4)

      job = captureJob();

      sparkleTargets = collectSparkleTargets(scan.fields, matches);
      renderSparkles();

      if (settings.showFloatingPill) {
        if (pill === null) {
          const dismissed = await isPillDismissed(domain);
          if (dismissed || disposed) return;
          pill = new FillPill({
            overlay: ui(),
            domain,
            onFill: () => void runFillFlow('pill', null),
            onDismiss: () =>
              pushToast(
                infoToast(
                  'NextMove hidden on this site',
                  'Alt+J and the toolbar button still work here.',
                ),
              ),
          });
        }
        pill.show();
      } else {
        pill?.hide();
      }

      // Opt-in only, and it still never touches a submit control (INV-1).
      if (settings.autoFillOnLoad && autoFilledUrl !== location.href && !filling) {
        autoFilledUrl = location.href;
        void runFillFlow('auto', null);
      }
    }

    function scheduleEvaluate(): void {
      if (evaluateTimer !== null) clearTimeout(evaluateTimer);
      evaluateTimer = setTimeout(() => {
        evaluateTimer = null;
        void evaluate();
      }, OBSERVER_DEBOUNCE_MS);
    }

    /* ---- SEC 6.7 step 4 — status flip on an OBSERVED confirmation -------------------------- */

    function handleConfirmation(): void {
      if (disposed || confirmationHandled) return;

      const signal = detectConfirmation(document, location.href, config?.confirmation ?? null);
      if (!signal.confirmed) return;
      confirmationHandled = true;

      // iCIMS / Taleo put the whole flow — thank-you page included — inside an iframe. A child
      // frame therefore reports what it saw upward instead of writing to the tracker itself, which
      // would open a second row keyed on the frame's own URL.
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

    /* ---- inbound bus traffic --------------------------------------------------------------- */

    type RuntimeListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void;

    /**
     * The content script owns exactly one inbound message type. Everything else — including our own
     * outbound replies — is left alone so other listeners in this context are not answered with
     * `undefined`.
     *
     * SEC 4.4 frame model: `tabs.sendMessage` without a `frameId` reaches every frame, and only one
     * response can win. The TOP frame therefore claims the channel and answers with the merged
     * report; child frames do their own work and return `false`, which keeps the popup's promise
     * deterministic instead of racing.
     */
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
      if (event.source === window) return; // our own bridge traffic

      if (isFrameConfirmation(event.data)) {
        // Deliberately UPGRADE-ONLY. A page could forge this message, so it may only flip a row
        // JobFill itself opened on this page; it can never create one. The worst a forgery can do
        // is mark the user's own draft as applied, which they can edit back.
        if (applicationId !== null && !confirmationHandled) {
          confirmationHandled = true;
          void sendMessage('TRACKER_UPDATE', {
            id: applicationId,
            patch: { status: 'applied', appliedAt: Date.now() },
          });
        }
        return;
      }

      const report = parseFrameReport(event.data);
      if (report === null) return;

      // `event.origin` is browser-supplied; the payload's own claims about itself are ignored.
      frameReports.set(event.origin || 'an embedded frame', {
        origin: event.origin || 'an embedded frame',
        filled: report.filled,
        suggested: report.suggested,
        skipped: report.skipped,
      });
      renderPanel();
    };

    /* ---- lifecycle ------------------------------------------------------------------------- */

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
      unsubscribeSettings?.();
      disposePageObserver();
      markers?.dispose();
      markers = null;
      pill?.dispose();
      pill = null;
      destroyOverlay();
      overlay = null;
      toasts = null;
    }

    browser.runtime.onMessage.addListener(
      onRuntimeMessage as unknown as Parameters<typeof browser.runtime.onMessage.addListener>[0],
    );
    if (isTop) window.addEventListener('message', onWindowMessage);
    ctx.onInvalidated(teardown);

    async function boot(): Promise<void> {
      await refreshSettings();
      unsubscribeSettings = subscribeSlot('settings', (next) => {
        settings = next;
        if (!disposed) scheduleEvaluate();
      });

      try {
        adapterId = detectAts(location.href, document).id;
      } catch {
        adapterId = 'generic';
      }
      config = await loadConfig(adapterId);
      if (disposed) return;

      // The observer is armed for every frame: a child frame still needs to re-scan when its own
      // wizard advances. Confirmation handling is gated to the top frame inside the callback.
      const observer = getPageObserver({
        confirmation: config.confirmation,
        debounceMs: OBSERVER_DEBOUNCE_MS,
      });
      observer.onPageChanged(() => scheduleEvaluate());
      observer.onConfirmationLikely(() => handleConfirmation());

      if (isTop) void refreshKeyAvailability();

      await evaluate();
    }

    void boot().catch((error: unknown) => log.error('content script failed to start', error));
  },
});
