/**
 * core/fill/index.ts — the FillEngine orchestrator.
 *
 * JF-001 Rev 3.0 · SEC 4.3 Flow A step 5: "FillEngine writes values with the strategy for each
 * input type; 40-120 ms jittered delays between writes (human-ish pacing, avoids rate-limit style
 * bot flags)." · SEC 6.4 (strategies) · SEC 13 (bot-detection mitigation).
 *
 * Invariants enforced here, in code:
 *
 *   INV-1  Never auto-submit. Every write is preceded by `assertNotSubmitControl`, the strategies
 *          repeat the check, `bridge.click`/`bridge.setValue` repeat it again, and the MAIN-world
 *          script repeats it a fourth time. There is no code path in this engine that can reach a
 *          submit control, a "next step" button or `form.submit()`.
 *
 *   INV-4  Never guess-fill. Only `action === 'fill'` (score >= 70) is written. `suggest` matches
 *          (50-69) are reported to the overlay with their proposed value but never touched, and a
 *          write that cannot be *verified* is downgraded from `filled` to `suggested` — the report
 *          only ever claims what we can prove.
 *
 * The engine is deliberately dependency-light: it takes a `Profile` and `MatchResult[]` and returns
 * a `FillReport`. Tracking (`FILL_REPORT`), overlay rendering and the resume blob read all live
 * with their owners; this file just drives the DOM and counts honestly.
 */

import { FILL_RUN_TIMEOUT_MS } from '@/shared/constants';
import type {
  AtsId,
  FieldSignature,
  FillAction,
  FillReport,
  MatchResult,
  Profile,
  ProfilePath,
} from '@/shared/types';

// SEC 6.2: one definition of what a profile path resolves to, shared with the matcher.
import { resolveProfileValue } from '@/core/matcher';

import { bridgeState, ensureBridge, stampSelector } from './bridge';
import {
  asElement,
  assertNotSubmitControl,
  isAborted,
  isCheckable,
  jitter,
  looksLikeCombobox,
  sleep,
} from './dom';
import {
  DEFAULT_QUIRKS,
  REASON,
  contextOf,
  failed,
  isFillQuirks,
  isSkipReason,
  readQuirks,
  type FillQuirks,
  type FillValue,
  type ResumeAttachment,
  type StrategyContext,
  type StrategyResult,
} from './types';

import { fillChoice, previewChoice } from './strategies/choice';
import { fillCombobox } from './strategies/combobox';
import { fillDate } from './strategies/date';
import { fillFile } from './strategies/file';
import { fillSelect } from './strategies/select';
import { fillText } from './strategies/text';

export * from './types';
export {
  BRIDGE_TIMEOUT_MS,
  bridgeState,
  disposeBridge,
  ensureBridge,
  ping,
  readCommitted,
  stampSelector,
  unstampAll,
  type BridgeOp,
  type BridgeResult,
} from './bridge';
export { isSubmitControl,
  isForbiddenClickTarget,
  assertClickable, assertNotSubmitControl, SubmitControlError } from './dom';
export { setNativeValue } from './strategies/text';
export { fillText } from './strategies/text';
export { fillSelect, normalizeCountry, normalizeRegion } from './strategies/select';
export { fillChoice, fillRadio, fillCheckbox } from './strategies/choice';
export { fillDate, formatDate, parseDateValue } from './strategies/date';
export { fillCombobox } from './strategies/combobox';
export { fillFile, fileFromResume, findDropzone } from './strategies/file';

/* ------------------------------------------------------------------------------------------------
 * Profile path resolution
 * ---------------------------------------------------------------------------------------------- */

/** Read a `ProfilePath` ("personal.firstName", "work[0].title") out of an arbitrary object. */
export function getByPath(root: unknown, path: ProfilePath): unknown {
  if (path.length === 0) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((part) => part.length > 0);

  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Narrow an arbitrary vault read to something a strategy can consume. */
export function toFillValue(raw: unknown): FillValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw.trim().length > 0 ? raw : null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw;
  if (Array.isArray(raw)) {
    const strings = raw.filter((entry): entry is string => typeof entry === 'string');
    return strings.length > 0 ? strings : null;
  }
  return null;
}

/** The string a text-shaped field should receive for a resolved value. */
export function toDisplayString(value: FillValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value.join(', ');
}

/**
 * Resolve a match's value from the vault. Returns `null` when there is nothing to write.
 *
 * This delegates to `resolveProfileValue` (SEC 6.2) rather than traversing the vault literally,
 * because the matcher can legitimately produce paths that are NOT keys of `Profile`:
 *
 *   `personal.fullName`              → firstName + ' ' + lastName
 *   `answers.<slug>`                 → the best banked answer for that canonical question
 *   `authorization.authorizedIn`     → a Yes/No boolean (the vault stores a country list)
 *   `authorization.needsSponsorship` → a Yes/No boolean (the vault stores it per country)
 *
 * A literal `getByPath` returned `undefined` for all four. Lever and Ashby both map their single
 * combined-name control to `personal.fullName`, so the most important field on those two ATS
 * reported `skip / no-value` on every run; the Yes/No work-authorization radios received the raw
 * `['IN']` array instead of a boolean and matched no option. Going through the matcher's resolver
 * keeps one definition of what a profile path means, which is the point of SEC 6.2.
 */
export function resolveValue(profile: Profile, path: ProfilePath | null): FillValue {
  if (path === null) return null;
  return toFillValue(resolveProfileValue(profile, path));
}

/* ------------------------------------------------------------------------------------------------
 * Engine options and events
 * ---------------------------------------------------------------------------------------------- */

/** Emitted once per match so the overlay can outline the field (SEC 4.3 Flow A step 6). */
export interface FillFieldEvent {
  hash: string;
  path: ProfilePath | null;
  score: number;
  /** What the engine actually did — `fill` only when the write was verified. */
  action: FillAction;
  /** The value proposed or written, rendered as text. Empty when nothing applied. */
  value: string;
  ok: boolean;
  reason?: string;
  el: HTMLElement | null;
  sig: FieldSignature;
  /** Stable selector for the node, so the overlay can re-find it after a re-render. */
  selector: string | null;
}

export interface FillEngineOptions {
  profile: Profile;
  atsId: AtsId | string;
  url: string;
  /** Adapter quirks (SEC 6.5) — raw bag from `ResolvedAdapterConfig.quirks`, or pre-normalised. */
  quirks?: Record<string, unknown> | FillQuirks | null;
  /** Resume blob for `file` fields; the caller reads it from IndexedDB (`platform/db`). */
  resume?: ResumeAttachment | null;
  /** Lazy alternative to `resume`: only invoked when a file field is actually reached. */
  resolveResume?: (path: ProfilePath | null) => Promise<ResumeAttachment | null>;
  /** SEC 6.4 / SEC 13 — jittered inter-field delays. Defaults to on. */
  humanPacing?: boolean;
  /** Whole-run ceiling; remaining fields are reported as skipped. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onField?: (event: FillFieldEvent) => void;
  /** Test hook: bypass the MAIN world entirely. */
  preferLocal?: boolean;
  now?: () => number;
}

/* ------------------------------------------------------------------------------------------------
 * The engine
 * ---------------------------------------------------------------------------------------------- */

interface Tally {
  filled: number;
  suggested: number;
  skipped: number;
  errors: number;
}

export class FillEngine {
  private readonly options: FillEngineOptions;
  private readonly quirks: FillQuirks;
  private readonly now: () => number;
  /**
   * One in-flight read per profile path, not one per run.
   *
   * A single form routinely carries two file fields with two different targets — Greenhouse's
   * `#resume` (`resume`) and `#cover_letter` (`coverLetter`). Caching by run alone meant the first
   * field's answer was reused for the second, so the resume PDF got attached to the cover-letter
   * input. Caching by path keeps the "one lazy read per target" property (a form with no file field
   * still never touches IndexedDB) while letting each target resolve to its own file — including
   * to `null`, which is the correct answer when the user has stored no cover letter.
   */
  private readonly resumeByPath = new Map<string, Promise<ResumeAttachment | null>>();

  constructor(options: FillEngineOptions) {
    this.options = options;
    this.quirks = isFillQuirks(options.quirks)
      ? options.quirks
      : readQuirks((options.quirks as Record<string, unknown> | null | undefined) ?? null);
    this.now = options.now ?? (() => Date.now());
  }

  /** Drive every match through its strategy and return an honest `FillReport`. */
  async run(matches: readonly MatchResult[]): Promise<FillReport> {
    const report: FillReport = {
      atsId: String(this.options.atsId),
      url: this.options.url,
      filled: 0,
      suggested: 0,
      skipped: 0,
      errors: 0,
      perField: [],
    };
    const tally: Tally = { filled: 0, suggested: 0, skipped: 0, errors: 0 };

    // Probe the MAIN-world half once. A page without it still fills, via the isolated-world path.
    if (this.options.preferLocal !== true) await ensureBridge();

    const deadline = this.now() + (this.options.timeoutMs ?? FILL_RUN_TIMEOUT_MS);
    const written = new Set<Element>();
    let wroteAnything = false;

    for (const match of matches) {
      const sig = match.node.sig;
      const el = asElement(match.node.el);

      if (isAborted(this.options.signal) || this.now() > deadline) {
        this.record(report, tally, match, el, 'skip', '', false, REASON.timeout);
        continue;
      }

      // INV-4: 50-69 is a suggestion, not a write. The overlay renders it; we do not touch the DOM.
      if (match.action !== 'fill') {
        const proposal = this.proposalFor(match, el);
        const action: FillAction = match.action === 'suggest' ? 'suggest' : 'skip';
        this.record(report, tally, match, el, action, proposal, true);
        continue;
      }

      if (!el || !el.isConnected) {
        this.record(report, tally, match, el, 'skip', '', false, REASON.notFillable);
        continue;
      }

      if (written.has(el)) {
        this.record(report, tally, match, el, 'skip', '', true, REASON.notFillable);
        continue;
      }

      // INV-1: never auto-submit. Asserted defensively before *every* write, whatever the matcher
      // believed this element was. The strategies and the bridge assert it again.
      try {
        assertNotSubmitControl(el, 'fill');
      } catch {
        this.record(report, tally, match, el, 'skip', '', false, REASON.submitControl);
        continue;
      }

      const value = resolveValue(this.options.profile, match.path);
      const isFileField = sig.inputType === 'file';
      if (value === null && !isFileField) {
        this.record(report, tally, match, el, 'skip', '', true, REASON.noValue);
        continue;
      }

      // SEC 4.3 Flow A step 5 / SEC 13: human-ish pacing between writes, never before the first.
      if (wroteAnything && this.options.humanPacing !== false) {
        await sleep(jitter(this.quirks.fillJitterMs.min, this.quirks.fillJitterMs.max), this.options.signal);
      }

      const ctx = this.contextFor(sig);
      let result: StrategyResult;
      try {
        result = await this.dispatch(el, sig, value, match.path, ctx);
      } catch (error) {
        result = failed(error instanceof Error ? error.message : REASON.exception);
      }

      written.add(el);
      wroteAnything = true;

      const rendered = toDisplayString(value);
      if (result.ok && result.verified) {
        this.record(report, tally, match, el, 'fill', rendered, true);
      } else if (result.ok) {
        // INV-4: we wrote, we could not prove it stuck — report it as a suggestion, not a fill.
        this.record(report, tally, match, el, 'suggest', rendered, true, result.reason);
      } else if (isSkipReason(result.reason)) {
        this.record(report, tally, match, el, 'skip', '', false, result.reason);
      } else {
        this.record(report, tally, match, el, 'fill', rendered, false, result.reason);
      }
    }

    report.filled = tally.filled;
    report.suggested = tally.suggested;
    report.skipped = tally.skipped;
    report.errors = tally.errors;
    return report;
  }

  /** Which strategy owns this field (SEC 6.4). */
  private async dispatch(
    el: HTMLElement,
    sig: FieldSignature,
    value: FillValue,
    path: ProfilePath | null,
    ctx: StrategyContext,
  ): Promise<StrategyResult> {
    switch (sig.inputType) {
      case 'select':
        // A scanner-declared `select` that is not a real <select> is an ARIA combobox.
        return el instanceof HTMLSelectElement
          ? fillSelect(el, value, ctx)
          : fillCombobox(el, value, ctx);

      case 'radio':
      case 'checkbox':
        return fillChoice(el, value, ctx);

      case 'date':
        return fillDate(el, value, ctx);

      case 'file':
        return fillFile(el, await this.resume(path), ctx);

      case 'combobox':
        return fillCombobox(el, value, ctx);

      case 'text':
      case 'email':
      case 'tel':
      case 'url':
      case 'textarea': {
        // Some ATS render a typeahead in a plain text input; honour what the element declares.
        if (looksLikeCombobox(el)) return fillCombobox(el, value, ctx);
        if (isCheckable(el)) return fillChoice(el, value, ctx);
        return fillText(el, toDisplayString(value), ctx);
      }

      default:
        return failed(REASON.unsupportedInput);
    }
  }

  private contextFor(sig: FieldSignature): StrategyContext {
    return contextOf({
      quirks: this.quirks,
      sig,
      ...(this.options.signal ? { signal: this.options.signal } : {}),
      ...(this.options.preferLocal === true ? { preferLocal: true } : {}),
    });
  }

  /** Resolve a file target lazily — a form with no file field never touches IndexedDB at all. */
  private async resume(path: ProfilePath | null): Promise<ResumeAttachment | null> {
    if (this.options.resume) return this.options.resume;
    const resolver = this.options.resolveResume;
    if (!resolver) return null;

    const key = path ?? '';
    const inFlight = this.resumeByPath.get(key);
    if (inFlight !== undefined) return inFlight;

    const promise = Promise.resolve(resolver(path)).catch(() => null);
    this.resumeByPath.set(key, promise);
    return promise;
  }

  /** What a `suggest`-tier match would have written, for the overlay's yellow row. */
  private proposalFor(match: MatchResult, el: HTMLElement | null): string {
    const value = resolveValue(this.options.profile, match.path);
    if (value === null) return '';
    if (el && (isCheckable(el) || match.node.sig.inputType === 'radio')) {
      return previewChoice(el, value) ?? toDisplayString(value);
    }
    return toDisplayString(value);
  }

  private record(
    report: FillReport,
    tally: Tally,
    match: MatchResult,
    el: HTMLElement | null,
    action: FillAction,
    value: string,
    ok: boolean,
    reason?: string,
  ): void {
    if (action === 'fill' && ok) tally.filled += 1;
    else if (action === 'suggest') tally.suggested += 1;
    else if (action === 'skip') tally.skipped += 1;
    else tally.errors += 1;

    report.perField.push({ hash: match.node.sig.hash, action, ok });

    const listener = this.options.onField;
    if (!listener) return;

    const event: FillFieldEvent = {
      hash: match.node.sig.hash,
      path: match.path,
      score: match.score,
      action,
      value,
      ok,
      el,
      sig: match.node.sig,
      selector: el ? stampSelector(el) : null,
    };
    if (reason !== undefined) event.reason = reason;

    try {
      listener(event);
    } catch {
      // A misbehaving overlay must never abort a fill run.
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Functional entry point
 * ---------------------------------------------------------------------------------------------- */

/**
 * Run a fill and return the report. This is the whole public surface the content script needs:
 *
 *   const report = await runFill(matches, { profile, atsId, url, quirks, resume });
 *
 * It never submits anything (INV-1) and never writes a value it could not verify without saying so
 * in the report (INV-4).
 */
export async function runFill(
  matches: readonly MatchResult[],
  options: FillEngineOptions,
): Promise<FillReport> {
  return new FillEngine(options).run(matches);
}

/** Empty report for the "no adapter, no matches" path, so callers never special-case null. */
export function emptyReport(atsId: AtsId | string, url: string): FillReport {
  return {
    atsId: String(atsId),
    url,
    filled: 0,
    suggested: 0,
    skipped: 0,
    errors: 0,
    perField: [],
  };
}

/** Diagnostics for the options page: is the MAIN-world half of the bridge alive on this tab? */
export function fillEngineDiagnostics(): {
  bridge: boolean | null;
  quirks: FillQuirks;
} {
  return { bridge: bridgeState(), quirks: { ...DEFAULT_QUIRKS } };
}
