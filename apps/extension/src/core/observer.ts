/**
 * core/observer.ts — PageObserver.
 *
 * JF-001 Rev 3.0 · SEC 4.1 (content-script layer: "PageObserver — SPA/mutation watch, step
 * detection") · SEC 6.5 (multi-step wizards: Workday / iCIMS / Taleo) · SEC 6.7 step 4 (status
 * flip on an *observed* confirmation) · INV-1.
 *
 * Job applications are not static pages. They are SPAs that swap the whole form on a route change,
 * wizards that replace step 2 with step 3 in place, and — on Taleo — legacy stacks that do a full
 * document reload between steps. This module turns all of that into two callbacks:
 *
 *   onPageChanged(cb)         "the form may be different now; re-scan"
 *   onConfirmationLikely(cb)  "this looks like a confirmation page"
 *
 * INV-1 in this file: `onConfirmationLikely` is **pure observation**. It reads the URL and the DOM
 * and reports what it sees so the tracker can flip a row from `draft` to `applied` (SEC 6.7). It
 * never clicks, never focuses, never submits, and never touches a control of any kind. Nothing in
 * this file writes to the host page except removing its own listeners.
 *
 * Detecting page-script `pushState` from the ISOLATED world is not possible by patching `history`
 * (content scripts get their own realm), so the URL is *also* polled on a cheap interval. That is
 * the only mechanism that actually catches a React-router navigation from a content script.
 */

import { OBSERVER_DEBOUNCE_MS } from '@/shared/constants';

/* ------------------------------------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------------------------------------- */

export type PageChangeReason =
  | 'initial'
  | 'mutation'
  | 'route'
  | 'hash'
  | 'popstate'
  | 'load'
  | 'step'
  | 'manual';

export interface PageChangeEvent {
  reason: PageChangeReason;
  url: string;
  previousUrl: string;
  /** Cheap fingerprint of the wizard's current step; changes drive `reason: 'step'`. */
  stepSignature: string;
  previousStepSignature: string;
  at: number;
}

export type ConfirmationSource = 'url' | 'selector' | 'text';

export interface ConfirmationEvent {
  url: string;
  source: ConfirmationSource;
  /** The pattern, selector or sentence that matched — surfaced in the tracker's audit trail. */
  evidence: string;
  at: number;
}

export type PageChangeListener = (event: PageChangeEvent) => void;
export type ConfirmationListener = (event: ConfirmationEvent) => void;
export type Unsubscribe = () => void;

/* ------------------------------------------------------------------------------------------------
 * Detection vocabulary
 * ---------------------------------------------------------------------------------------------- */

/** URL shapes that almost always mean "we are past the submit button". */
const DEFAULT_CONFIRMATION_URL_PATTERNS: readonly RegExp[] = [
  /thank[-_]?you/i,
  /\/confirmation\b/i,
  /\bconfirmed\b/i,
  /application[-_]?(received|submitted|complete|success)/i,
  /\/(submitted|success)\b/i,
  /applicationsubmitted/i,
];

const DEFAULT_CONFIRMATION_SELECTORS: readonly string[] = [
  '[data-automation-id="confirmationPage"]',
  '[data-automation-id="applicationSubmitted"]',
  '#application_confirmation',
  '.application-confirmation',
  '[data-qa="confirmation"]',
  '[data-testid*="confirmation" i]',
  '.post-apply-confirmation',
];

/** Sentences a confirmation screen actually contains. Read-only — nothing is ever clicked. */
const CONFIRMATION_TEXT_RE =
  /thank you for (applying|your application|your interest)|your application (has been|was) (submitted|received)|application (submitted|received|complete)|we (have )?received your application|successfully submitted/i;

/** Where a confirmation message lives: headings and live regions, never the whole body. */
const CONFIRMATION_TEXT_SCOPES = 'h1, h2, h3, [role="alert"], [role="status"], [aria-live]';
const MAX_TEXT_NODES_SCANNED = 40;

/** Elements whose state identifies the current wizard step. */
const DEFAULT_STEP_SELECTORS: readonly string[] = [
  '[aria-current="step"]',
  '[role="tab"][aria-selected="true"]',
  '[data-automation-id="progressBar"] [aria-current]',
  '[data-automation-id="jobApplicationStep"]',
  '.progress-bar .active',
  '[class*="step" i][class*="active" i]',
  '[class*="step" i][class*="current" i]',
];

/** Form controls whose appearance/disappearance is worth a re-scan. */
const FORM_CONTROL_SELECTOR =
  'input, select, textarea, form, fieldset, [role="combobox"], [role="radiogroup"], [contenteditable="true"]';

/* ------------------------------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------------------------------- */

export interface PageObserverOptions {
  /** Coalescing window for mutation storms (SEC 6.4 default: 250 ms). */
  debounceMs?: number;
  /** How often to compare `location.href` — the only way to catch a page-script pushState. */
  urlPollMs?: number;
  /** Adapter-declared confirmation cues (`ResolvedAdapterConfig.confirmation`). */
  confirmation?: { urlPatterns?: readonly string[]; selectors?: readonly string[] };
  /** Adapter-declared step markers, merged with the defaults. */
  stepSelectors?: readonly string[];
  /** Injection points for tests. */
  win?: Window;
  doc?: Document;
}

const DEFAULT_URL_POLL_MS = 400;
/** Floor between two confirmation sweeps; DOM queries are cheap but not free. */
const CONFIRMATION_CHECK_INTERVAL_MS = 300;

function compilePatterns(patterns: readonly string[] | undefined): RegExp[] {
  if (!patterns) return [];
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.length === 0) continue;
    try {
      out.push(new RegExp(pattern, 'i'));
    } catch {
      // Remote config (F-14) is untrusted data; a bad pattern is ignored, never thrown.
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * PageObserver
 * ---------------------------------------------------------------------------------------------- */

export class PageObserver {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly debounceMs: number;
  private readonly urlPollMs: number;
  private readonly confirmationUrlPatterns: RegExp[];
  private readonly confirmationSelectors: string[];
  private readonly stepSelectors: string[];

  private readonly pageListeners = new Set<PageChangeListener>();
  private readonly confirmationListeners = new Set<ConfirmationListener>();
  private readonly firedConfirmations = new Set<string>();

  private observer: MutationObserver | null = null;
  private observedRoot: Element | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReason: PageChangeReason | null = null;

  private currentUrl = '';
  private currentStep = '';
  private started = false;
  private lastConfirmationCheck = 0;
  private confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set while we are patched over `history` so `stop()` can restore the originals. */
  private historyPatch: { pushState: History['pushState']; replaceState: History['replaceState'] } | null =
    null;

  constructor(options: PageObserverOptions = {}) {
    const win = options.win ?? (typeof window === 'undefined' ? undefined : window);
    if (!win) throw new Error('PageObserver requires a window (content-script context only)');
    this.win = win;
    this.doc = options.doc ?? win.document;
    this.debounceMs = options.debounceMs ?? OBSERVER_DEBOUNCE_MS;
    this.urlPollMs = options.urlPollMs ?? DEFAULT_URL_POLL_MS;
    this.confirmationUrlPatterns = [
      ...compilePatterns(options.confirmation?.urlPatterns),
      ...DEFAULT_CONFIRMATION_URL_PATTERNS,
    ];
    this.confirmationSelectors = [
      ...(options.confirmation?.selectors ?? []),
      ...DEFAULT_CONFIRMATION_SELECTORS,
    ];
    this.stepSelectors = [...(options.stepSelectors ?? []), ...DEFAULT_STEP_SELECTORS];
  }

  get running(): boolean {
    return this.started;
  }

  /* ---------------------------------------------------------------------------------------------
   * Subscription
   * ------------------------------------------------------------------------------------------- */

  /** "The form may be different now; re-scan." Auto-starts the observer. */
  onPageChanged(listener: PageChangeListener): Unsubscribe {
    const wasStarted = this.started;
    this.pageListeners.add(listener);
    this.start();
    // `start()` emits `initial` to everyone; a listener that arrives later still needs its own
    // first event, otherwise it would sit idle until the page happens to mutate.
    if (wasStarted) {
      try {
        listener({
          reason: 'initial',
          url: this.win.location.href,
          previousUrl: this.currentUrl,
          stepSignature: this.currentStep,
          previousStepSignature: this.currentStep,
          at: Date.now(),
        });
      } catch {
        // A bad subscriber must never break subscription.
      }
    }
    return () => {
      this.pageListeners.delete(listener);
    };
  }

  /**
   * "This looks like a confirmation page." Pure observation — the tracker uses it to flip a row to
   * `applied` (SEC 6.7 step 4). Nothing is ever clicked (INV-1).
   */
  onConfirmationLikely(listener: ConfirmationListener): Unsubscribe {
    this.confirmationListeners.add(listener);
    this.start();
    // A content script injected *onto* the confirmation page must still report it.
    this.checkConfirmation();
    return () => {
      this.confirmationListeners.delete(listener);
    };
  }

  /* ---------------------------------------------------------------------------------------------
   * Lifecycle
   * ------------------------------------------------------------------------------------------- */

  start(): void {
    if (this.started) return;
    this.started = true;

    this.currentUrl = this.win.location.href;
    this.currentStep = this.readStepSignature();

    this.arm();

    this.win.addEventListener('popstate', this.onPopState);
    this.win.addEventListener('hashchange', this.onHashChange);
    // Taleo posts a full reload between steps; `pageshow` also covers bfcache restores.
    this.win.addEventListener('pageshow', this.onPageShow);
    this.doc.addEventListener('readystatechange', this.onReadyStateChange);

    this.patchHistory();

    this.pollTimer = setInterval(this.onPoll, this.urlPollMs);

    this.checkConfirmation();
    this.emitPageChange('initial');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = null;

    this.win.removeEventListener('popstate', this.onPopState);
    this.win.removeEventListener('hashchange', this.onHashChange);
    this.win.removeEventListener('pageshow', this.onPageShow);
    this.doc.removeEventListener('readystatechange', this.onReadyStateChange);

    this.unpatchHistory();

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.confirmationTimer !== null) {
      clearTimeout(this.confirmationTimer);
      this.confirmationTimer = null;
    }
    this.pendingReason = null;
  }

  /** Drop every listener and detach. */
  dispose(): void {
    this.stop();
    this.pageListeners.clear();
    this.confirmationListeners.clear();
    this.firedConfirmations.clear();
  }

  /** Force a re-scan notification (used after a fill run, or by the popup's "rescan"). */
  notify(reason: PageChangeReason = 'manual'): void {
    this.schedule(reason);
  }

  /* ---------------------------------------------------------------------------------------------
   * Mutation watching — re-arms after a full document swap (Taleo, document.write)
   * ------------------------------------------------------------------------------------------- */

  private arm(): void {
    const root = this.doc.documentElement;
    if (!root) return;
    if (this.observer && this.observedRoot === root && root.isConnected) return;

    this.observer?.disconnect();
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-current', 'aria-selected', 'aria-expanded', 'class', 'hidden', 'style'],
    });
    this.observedRoot = root;
  }

  private readonly onMutations = (records: MutationRecord[]): void => {
    if (!this.started) return;
    if (this.isMeaningful(records)) this.schedule('mutation');
    // Confirmation cues arrive as DOM, not as navigation, on SPA ATS.
    this.checkConfirmation();
  };

  /**
   * A chatty page mutates constantly. Only structural changes involving form controls (or the step
   * markers) are worth a re-scan; everything else is noise.
   */
  private isMeaningful(records: readonly MutationRecord[]): boolean {
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target instanceof Element && this.matchesAnyStepSelector(target)) return true;
        continue;
      }
      if (containsFormControl(record.addedNodes)) return true;
      if (containsFormControl(record.removedNodes)) return true;
    }
    return false;
  }

  private matchesAnyStepSelector(el: Element): boolean {
    for (const selector of this.stepSelectors) {
      try {
        if (el.matches(selector)) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------------------------------------
   * Navigation watching
   * ------------------------------------------------------------------------------------------- */

  private readonly onPopState = (): void => this.schedule('popstate');
  private readonly onHashChange = (): void => this.schedule('hash');

  private readonly onPageShow = (): void => {
    // Full reload or bfcache restore: the old MutationObserver is pointed at a dead documentElement.
    this.arm();
    this.currentUrl = this.win.location.href;
    this.schedule('load');
    this.lastConfirmationCheck = 0; // a navigation always deserves a fresh look
    this.checkConfirmation();
  };

  private readonly onReadyStateChange = (): void => {
    if (this.doc.readyState === 'complete' || this.doc.readyState === 'interactive') {
      this.arm();
      this.schedule('load');
      this.checkConfirmation();
    }
  };

  private readonly onPoll = (): void => {
    if (!this.started) return;
    // Re-arm if the document element was replaced under us.
    if (this.observedRoot === null || !this.observedRoot.isConnected) this.arm();

    if (this.win.location.href !== this.currentUrl) {
      this.schedule('route');
      this.lastConfirmationCheck = 0;
      this.checkConfirmation();
      return;
    }

    const step = this.readStepSignature();
    if (step !== this.currentStep) this.schedule('step');
  };

  /**
   * Patching `history` catches navigations made from *this* realm. Page-script `pushState` calls
   * are invisible from an isolated world — that is what `onPoll` is for. Both are cheap; together
   * they are reliable.
   */
  private patchHistory(): void {
    const history = this.win.history;
    if (!history || this.historyPatch !== null) return;

    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    if (typeof originalPush !== 'function' || typeof originalReplace !== 'function') return;

    const notifyRoute = (): void => this.schedule('route');

    try {
      history.pushState = function patchedPushState(this: History, ...args) {
        const result = originalPush.apply(this, args);
        notifyRoute();
        return result;
      } as History['pushState'];
      history.replaceState = function patchedReplaceState(this: History, ...args) {
        const result = originalReplace.apply(this, args);
        notifyRoute();
        return result;
      } as History['replaceState'];
      this.historyPatch = { pushState: originalPush, replaceState: originalReplace };
    } catch {
      this.historyPatch = null; // a frozen History object is fine; the poll still covers us
    }
  }

  private unpatchHistory(): void {
    const patch = this.historyPatch;
    if (!patch) return;
    try {
      this.win.history.pushState = patch.pushState;
      this.win.history.replaceState = patch.replaceState;
    } catch {
      // ignore — we are tearing down anyway
    }
    this.historyPatch = null;
  }

  /* ---------------------------------------------------------------------------------------------
   * Debounced emission
   * ------------------------------------------------------------------------------------------- */

  private schedule(reason: PageChangeReason): void {
    if (!this.started) return;
    // A navigation outranks a mutation when both land in the same window.
    if (this.pendingReason === null || rank(reason) > rank(this.pendingReason)) {
      this.pendingReason = reason;
    }
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(this.flush, this.debounceMs);
  }

  private readonly flush = (): void => {
    this.debounceTimer = null;
    const reason = this.pendingReason ?? 'mutation';
    this.pendingReason = null;
    this.emitPageChange(reason);
  };

  private emitPageChange(reason: PageChangeReason): void {
    const url = this.win.location.href;
    const step = this.readStepSignature();
    const previousUrl = this.currentUrl;
    const previousStep = this.currentStep;

    // A step transition is more informative than the mutation that produced it.
    const resolved: PageChangeReason =
      reason === 'mutation' && step !== previousStep ? 'step' : reason;

    this.currentUrl = url;
    this.currentStep = step;

    const event: PageChangeEvent = {
      reason: resolved,
      url,
      previousUrl,
      stepSignature: step,
      previousStepSignature: previousStep,
      at: Date.now(),
    };

    for (const listener of [...this.pageListeners]) {
      try {
        listener(event);
      } catch {
        // One bad subscriber must never take the observer down.
      }
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * Step fingerprint
   * ------------------------------------------------------------------------------------------- */

  /** Cheap, stable-ish identity for the wizard step currently on screen. */
  readStepSignature(): string {
    const parts: string[] = [];

    for (const selector of this.stepSelectors) {
      let nodes: Element[];
      try {
        nodes = Array.from(this.doc.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const node of nodes.slice(0, 4)) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const id = node.getAttribute('data-automation-id') ?? node.getAttribute('id') ?? '';
        if (text.length > 0 || id.length > 0) parts.push(`${id}:${text}`);
      }
      if (parts.length > 0) break;
    }

    if (parts.length === 0) {
      const heading = this.doc.querySelector('h1, h2');
      const headingText = (heading?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const controls = this.doc.querySelectorAll(FORM_CONTROL_SELECTOR).length;
      parts.push(`${headingText}#${controls}`);
    }

    return parts.join('|');
  }

  /* ---------------------------------------------------------------------------------------------
   * Confirmation detection — OBSERVATION ONLY (INV-1)
   * ------------------------------------------------------------------------------------------- */

  /**
   * Look for evidence that the human already submitted. This reads; it never acts. The tracker
   * turns a hit into a `draft → applied` status flip (SEC 6.7 step 4).
   */
  checkConfirmation(): ConfirmationEvent | null {
    if (this.confirmationListeners.size === 0) return null;

    // Mutation storms would otherwise re-run these queries dozens of times a second. A throttled
    // sweep is *deferred*, never dropped: the mutation that renders the thank-you screen is
    // frequently the last one the page ever makes.
    const now = Date.now();
    const elapsed = now - this.lastConfirmationCheck;
    if (elapsed < CONFIRMATION_CHECK_INTERVAL_MS) {
      if (this.confirmationTimer === null && this.started) {
        this.confirmationTimer = setTimeout(() => {
          this.confirmationTimer = null;
          this.checkConfirmation();
        }, CONFIRMATION_CHECK_INTERVAL_MS - elapsed);
      }
      return null;
    }
    this.lastConfirmationCheck = now;

    const url = this.win.location.href;

    for (const pattern of this.confirmationUrlPatterns) {
      if (pattern.test(url)) return this.fireConfirmation(url, 'url', pattern.source);
    }

    for (const selector of this.confirmationSelectors) {
      let node: Element | null;
      try {
        node = this.doc.querySelector(selector);
      } catch {
        continue;
      }
      if (node) return this.fireConfirmation(url, 'selector', selector);
    }

    let scanned = 0;
    let nodes: Element[];
    try {
      nodes = Array.from(this.doc.querySelectorAll(CONFIRMATION_TEXT_SCOPES));
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      if (scanned++ >= MAX_TEXT_NODES_SCANNED) break;
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text.length === 0 || text.length > 300) continue;
      if (CONFIRMATION_TEXT_RE.test(text)) {
        return this.fireConfirmation(url, 'text', text.slice(0, 160));
      }
    }

    return null;
  }

  private fireConfirmation(
    url: string,
    source: ConfirmationSource,
    evidence: string,
  ): ConfirmationEvent | null {
    const key = `${source}|${evidence}|${stripQuery(url)}`;
    if (this.firedConfirmations.has(key)) return null;
    this.firedConfirmations.add(key);

    const event: ConfirmationEvent = { url, source, evidence, at: Date.now() };
    for (const listener of [...this.confirmationListeners]) {
      try {
        listener(event);
      } catch {
        // Observation must never throw into the page.
      }
    }
    return event;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

function rank(reason: PageChangeReason): number {
  switch (reason) {
    case 'mutation':
      return 0;
    case 'step':
      return 1;
    case 'hash':
      return 2;
    case 'popstate':
    case 'route':
      return 3;
    case 'load':
      return 4;
    case 'manual':
    case 'initial':
      return 5;
  }
}

function containsFormControl(nodes: NodeList): boolean {
  // Index access rather than `.item()`: mutation records hand back array-likes in some engines.
  for (let i = 0; i < nodes.length; i++) {
    const node: Node | undefined = nodes[i];
    if (!(node instanceof Element)) continue;
    try {
      if (node.matches(FORM_CONTROL_SELECTOR)) return true;
      if (node.querySelector(FORM_CONTROL_SELECTOR) !== null) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/* ------------------------------------------------------------------------------------------------
 * Lazy default instance
 * ---------------------------------------------------------------------------------------------- */

let defaultObserver: PageObserver | null = null;

/**
 * The content script's shared observer. Created on first use — importing this module has no side
 * effects, so the service worker and the options page can import the types safely.
 */
export function getPageObserver(options?: PageObserverOptions): PageObserver {
  if (defaultObserver === null) defaultObserver = new PageObserver(options);
  return defaultObserver;
}

export function disposePageObserver(): void {
  defaultObserver?.dispose();
  defaultObserver = null;
}

/** Convenience wrapper over `getPageObserver().onPageChanged`. */
export function onPageChanged(listener: PageChangeListener): Unsubscribe {
  return getPageObserver().onPageChanged(listener);
}

/** Convenience wrapper over `getPageObserver().onConfirmationLikely`. Observation only (INV-1). */
export function onConfirmationLikely(listener: ConfirmationListener): Unsubscribe {
  return getPageObserver().onConfirmationLikely(listener);
}
