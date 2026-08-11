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
import { getSettings, patchSettings, subscribeSlot } from '@/platform/storage';


import {
  FieldMatcher,
  FormScanner,
  buildFieldSignature,
  isFillableControl,
  knownProfilePaths,
  nodeElement,
} from '@/core';
import { resolveProfileValue } from '@/core/matcher';

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
  REASON,
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
import { detectConfirmation, looksLikeJobPage } from '@/tracker/detectors';
import { installSubmitWatch, type SubmitSignal, type SubmitWatchHandle } from '@/tracker/submit-watch';


import {
  FieldMarkers,
  FillPill,
  ReviewPanel,
  SparkleLayer,
  ToastHost,
  destroyOverlay,
  getOverlay,
  infoToast,
  installSuggest,
  isOpenTextQuestion,
  isPillDismissed,
  questionOf,
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

const NEXT_MARKER_ID = '__jf_next_step';

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

    let suggest: SuggestController | null = null;
    let submitWatch: SubmitWatchHandle | null = null;

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

    async function writeAnswer(el: HTMLElement, text: string): Promise<boolean> {
      const result = await fillText(
        el,
        text,
        contextOf({ quirks: readQuirks(config?.quirks ?? null) }),
        // The one gesture the overwrite escape hatch exists for: the user is looking at this field
        // and pressed "insert this answer". A half-typed draft in the box is what they are asking us
        // to replace, so refusing it the way a bulk fill does would break the ✨ flow outright.
        { overwrite: true },
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
        readValue: currentValue,
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
      const answer = (el === null ? row.value : currentValue(el) || row.value).trim();
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
      return true;
    }

    function nodeForElement(el: HTMLElement): FieldNode | null {
      for (const node of lastScan?.fields ?? []) {
        if (nodeElement(node) === el) return node;
      }
      return null;
    }

    function closePanel(): void {
      panelOpen = false;
      focusedHash = null;
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
          onSaveAnswer: saveAsAnswer,
          focusedHash,
          onRefill: () => void runFillFlow('pill', null),
          onClose: closePanel,
        }),
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
          panelOpen = true;
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
        pill?.setBusy(false);
        if (isTop) {
          renderPanel();
          renderSparkles();
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
      // open — Alt+Shift+N, the pill and the popup all write the settings slot, and the subscriber
      // below re-enters this function on every write.
      if (!settings.enabled) {
        applicationLike = false;
        sparkleTargets = [];
        pill?.hide();
        overlay?.clear('sparkles');
        markers?.clear();
        return;
      }

      try {

        adapterId = detectAts(location.href, document).id;
      } catch (error) {
        log.debug('ATS detection failed; using the generic adapter', error);
        adapterId = 'generic';
      }
      if (config === null || config.atsId !== adapterId) config = await loadConfig(adapterId);

      const scan = scanPage();
      lastScan = scan;

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
        pill?.hide();
        overlay?.clear('sparkles');
        return;
      }

      const matches = matcherFor(null, null).match(scan.fields);
      applicationLike = looksLikeApplication(scan, matches, adapterId, document);

      if (!applicationLike) {
        sparkleTargets = [];
        pill?.hide();
        overlay?.clear('sparkles');
        return;
      }

      if (!isTop) return;

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
            onTurnOff: () => {
              void patchSettings({ enabled: false }).then(() =>
                pushToast(
                  infoToast(
                    'NextMove is off',
                    'Nothing is filled or suggested on any site until you turn it back on with Alt+Shift+N.',
                  ),
                ),
              );
            },
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

      if (panelOpen) renderPanel();

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
      markers?.clear();
      overlay?.clear('sparkles');
      if (panelOpen) renderPanel();
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
        panelOpen = true;
      }

      if (panelOpen) renderPanel();
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
    if (isTop) document.addEventListener('focusin', onFocusIn, true);
    ctx.onInvalidated(teardown);

    async function boot(): Promise<void> {
      await refreshSettings();
      unsubscribeSettings = subscribeSlot('settings', (next) => {
        const wasEnabled = settings.enabled;
        settings = next;
        if (disposed) return;
        if (next.enabled !== wasEnabled) suggest?.setEnabled(next.enabled);
        scheduleEvaluate();
      });

      suggest = installSuggest({
        lookup: suggestLookup,
        remember: suggestRemember,
        onToast: (message) => pushToast(infoToast(message)),
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

      const observer = getPageObserver({
        confirmation: config.confirmation,
        debounceMs: OBSERVER_DEBOUNCE_MS,
      });
      observer.onPageChanged((event) => {
        if (event.reason !== 'mutation' && event.reason !== 'initial') resetStepState();
        scheduleEvaluate();
      });
      observer.onConfirmationLikely(() => handleConfirmation());

      if (isTop) void refreshKeyAvailability();

      await evaluate();
    }

    void boot().catch((error: unknown) => log.error('content script failed to start', error));
  },
});
