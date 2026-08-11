/**
 * core/fill/types.ts — the FillEngine's shared vocabulary.
 *
 * JF-001 Rev 3.0 · SEC 6.4 (strategy per input type) · SEC 6.5 (adapter quirks) · INV-1 · INV-4.
 *
 * Every strategy returns the same discriminated result so the orchestrator can apply one rule:
 *   ok && verified   → the value provably landed        → counts as `filled`
 *   ok && !verified  → we wrote, the page did not agree → **downgraded to `suggest`** (INV-4)
 *   !ok              → nothing was written              → `skipped` or `errors`, by reason
 */

import {
  FILL_JITTER_MS,
  FILL_VERIFY_DELAY_MS,
  LISTBOX_WAIT_MS,
  TYPEAHEAD_JITTER_MS,
  type JitterRange,
} from '@/shared/constants';
import type { FieldSignature } from '@/shared/types';

/* ------------------------------------------------------------------------------------------------
 * Values
 * ---------------------------------------------------------------------------------------------- */

/** What a profile path can yield once resolved. `null`/`undefined` ⇒ nothing to write. */
export type FillValue = string | number | boolean | string[] | null | undefined;

/* ------------------------------------------------------------------------------------------------
 * Results
 * ---------------------------------------------------------------------------------------------- */

export interface StrategyResult {
  /** Did we perform (or correctly decline) the write without error? */
  ok: boolean;
  /** Did we read the value back and prove the page kept it? */
  verified: boolean;
  /** One of `REASON`, or a free-form message for unexpected failures. */
  reason?: string;
}

export const REASON = {
  noValue: 'no-value',
  noOptionMatch: 'no-option-match',
  notFillable: 'not-fillable',
  /**
   * The control already carries an answer, so nothing was written.
   *
   * Distinct from `notFillable` on purpose: "this control disappeared before it could be filled" and
   * "you have already answered this one" are opposite states, and the overlay renders a different
   * sentence for each. Reporting the second as the first is how a deliberate, correct refusal came
   * to look like a malfunction.
   */
  alreadyAnswered: 'already-answered',
  unsupportedInput: 'unsupported-input',
  noResume: 'no-resume',
  submitControl: 'submit-control',
  bridgeFailed: 'bridge-failed',
  notCommitted: 'value-not-committed',
  commitUnverified: 'commit-unverified',
  listboxTimeout: 'listbox-timeout',
  aborted: 'aborted',
  timeout: 'run-timeout',
  exception: 'exception',
} as const;

export type FillReason = (typeof REASON)[keyof typeof REASON];

/**
 * Failures that mean "there was nothing to do here", not "something broke". The engine counts
 * these as `skipped` rather than `errors` so the report stays honest.
 */
export const SKIP_REASONS: ReadonlySet<string> = new Set<string>([
  REASON.noValue,
  REASON.noOptionMatch,
  REASON.notFillable,
  REASON.alreadyAnswered,
  REASON.unsupportedInput,
  REASON.noResume,
  REASON.timeout,
  REASON.aborted,
]);

export function isSkipReason(reason: string | undefined): boolean {
  return reason !== undefined && SKIP_REASONS.has(reason);
}

export function filled(): StrategyResult {
  return { ok: true, verified: true };
}

/** Wrote something, could not prove it stuck — the engine downgrades this to `suggest`. */
export function unverified(reason: string): StrategyResult {
  return { ok: true, verified: false, reason };
}

export function failed(reason: string): StrategyResult {
  return { ok: false, verified: false, reason };
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.5 — adapter quirks, normalised
 * ---------------------------------------------------------------------------------------------- */

/**
 * The subset of `AtsAdapter.quirks` the FillEngine understands. Adapters (and remote config)
 * hand us a loose `Record<string, unknown>`; `readQuirks` turns it into this, so a malformed
 * remote config can never crash a fill run (F-14 data is untrusted input).
 */
export interface FillQuirks {
  /** Text format for widget date pickers, e.g. `MM/DD/YYYY`. Native inputs always use ISO. */
  dateFormat: string;
  /** Per-character delay window while driving a typeahead (SEC 6.4). */
  typeaheadDelayMs: JitterRange;
  /** Hard cap on waiting for a listbox to render after typing. */
  listboxWaitMs: number;
  /** Inter-field pacing (SEC 6.4 / SEC 13 — human-ish writes). */
  fillJitterMs: JitterRange;
  /** How long to let a framework settle before reading a value back. */
  verifyDelayMs: number;
  /** Extra selectors for resume drop zones that hide their `<input type=file>`. */
  dropzoneSelectors: string[];
  /** Extra selectors identifying a typeahead's popup container. */
  listboxSelectors: string[];
  /** Extra selectors identifying options inside that popup. */
  optionSelectors: string[];
  /** Some widgets only commit on a fresh keystroke stream; forces TYPE_SEQUENCE for text fields. */
  typeTextFields: boolean;
}

export const DEFAULT_QUIRKS: FillQuirks = {
  dateFormat: 'MM/DD/YYYY',
  typeaheadDelayMs: TYPEAHEAD_JITTER_MS,
  listboxWaitMs: LISTBOX_WAIT_MS,
  fillJitterMs: FILL_JITTER_MS,
  verifyDelayMs: FILL_VERIFY_DELAY_MS,
  dropzoneSelectors: [],
  listboxSelectors: [],
  optionSelectors: [],
  typeTextFields: false,
};

function readString(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function readNumber(raw: Record<string, unknown>, key: string): number | null {
  const v = raw[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function readBoolean(raw: Record<string, unknown>, key: string): boolean | null {
  const v = raw[key];
  return typeof v === 'boolean' ? v : null;
}

function readStringArray(raw: Record<string, unknown>, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      out.push(v.trim());
      continue;
    }
    if (!Array.isArray(v)) continue;
    for (const entry of v) {
      if (typeof entry === 'string' && entry.trim().length > 0) out.push(entry.trim());
    }
  }
  return out;
}

function readRange(raw: Record<string, unknown>, key: string, fallback: JitterRange): JitterRange {
  const v = raw[key];
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { min: v, max: v };
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    const min = readNumber(obj, 'min');
    const max = readNumber(obj, 'max');
    if (min !== null && max !== null) return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  return fallback;
}

/** Normalise an adapter's (or remote config's) untrusted quirk bag into `FillQuirks`. */
export function readQuirks(raw: Record<string, unknown> | null | undefined): FillQuirks {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_QUIRKS };

  const dateFormat = readString(raw, 'dateFormat');
  const listboxWaitMs = readNumber(raw, 'listboxWaitMs');
  const verifyDelayMs = readNumber(raw, 'verifyDelayMs');
  const typeTextFields = readBoolean(raw, 'typeTextFields');

  return {
    dateFormat: dateFormat ?? DEFAULT_QUIRKS.dateFormat,
    typeaheadDelayMs: readRange(raw, 'typeaheadDelayMs', DEFAULT_QUIRKS.typeaheadDelayMs),
    listboxWaitMs: listboxWaitMs ?? DEFAULT_QUIRKS.listboxWaitMs,
    fillJitterMs: readRange(raw, 'fillJitterMs', DEFAULT_QUIRKS.fillJitterMs),
    verifyDelayMs: verifyDelayMs ?? DEFAULT_QUIRKS.verifyDelayMs,
    dropzoneSelectors: readStringArray(raw, 'dropzone', 'dropzoneSelectors'),
    listboxSelectors: readStringArray(raw, 'listbox', 'listboxSelectors'),
    optionSelectors: readStringArray(raw, 'option', 'optionSelectors'),
    typeTextFields: typeTextFields ?? DEFAULT_QUIRKS.typeTextFields,
  };
}

/**
 * `readQuirks` is idempotent over an already-normalised bag, so this guard exists purely to skip a
 * redundant normalisation pass — never to decide whether a bag is *usable*.
 *
 * It must therefore test the WHOLE fill-side shape. The adapter layer exports a different interface
 * that also happens to be called `FillQuirks` (`core/adapters/types.ts`: dateFormat,
 * typeaheadDelayMs, listboxWaitMs, dropzoneSelectors, submitSelectors, stepContainerSelector), and
 * `registry.resolveFillQuirks()` hands that shape straight to the engine. A loose two-field check
 * accepted it, `readQuirks` was skipped, and every field this file adds — `fillJitterMs`,
 * `verifyDelayMs`, `listboxSelectors`, `optionSelectors`, `typeTextFields` — stayed `undefined`.
 * That crashed the first paced write (`quirks.fillJitterMs.min`) and every typeahead
 * (`uniqueSelectors(undefined, …)` → "extra is not iterable"), i.e. the entire fill path on every
 * adapter-driven site. Checking every field makes a foreign shape fall through to `readQuirks`,
 * which normalises it and supplies the defaults.
 */
export function isFillQuirks(value: unknown): value is FillQuirks {
  if (typeof value !== 'object' || value === null) return false;
  const q = value as Partial<FillQuirks>;
  const isRange = (r: unknown): boolean =>
    typeof r === 'object' &&
    r !== null &&
    typeof (r as { min?: unknown }).min === 'number' &&
    typeof (r as { max?: unknown }).max === 'number';

  return (
    typeof q.dateFormat === 'string' &&
    typeof q.listboxWaitMs === 'number' &&
    typeof q.verifyDelayMs === 'number' &&
    typeof q.typeTextFields === 'boolean' &&
    isRange(q.typeaheadDelayMs) &&
    isRange(q.fillJitterMs) &&
    Array.isArray(q.dropzoneSelectors) &&
    Array.isArray(q.listboxSelectors) &&
    Array.isArray(q.optionSelectors)
  );
}

/* ------------------------------------------------------------------------------------------------
 * Per-write request — the one escape hatch from "never overwrite an answer"
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a single write is allowed to do beyond the engine's defaults.
 *
 * One shape for every strategy, because the alternative is what shipped before: `fillSelect`
 * refused to clobber a chosen dropdown while `fillText` overwrote whatever the user had typed, so
 * the same ⚡ Fill all respected one answer and destroyed the other.
 */
export interface FillRequest {
  /**
   * Replace an answer the control already carries.
   *
   * A bulk or chained fill never sets this. A field that already reads "Canada", or holds a
   * sentence the user typed, was answered by the page, by a restored draft or by the human, and
   * overwriting it silently destroys work nobody asked us to touch. The only caller entitled to it
   * is an explicit "write this into THIS field" gesture — the user is then looking at the control
   * and asked for the write (the AI answer accepted from a ✨ button is exactly that).
   */
  overwrite?: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Strategy context
 * ---------------------------------------------------------------------------------------------- */

/** Everything a strategy is allowed to know about the run it belongs to. */
export interface StrategyContext {
  quirks: FillQuirks;
  /** Signature of the field being written — lets EEO/consent logic read the label and heading. */
  sig?: FieldSignature;
  /** Aborts the whole fill run (tab closed, user cancelled, run timeout). */
  signal?: AbortSignal;
  /** Force the ISOLATED-world fallbacks; used by tests and by pages with no MAIN-world script. */
  preferLocal?: boolean;
}

export function contextOf(partial?: Partial<StrategyContext>): StrategyContext {
  const ctx: StrategyContext = { quirks: partial?.quirks ?? { ...DEFAULT_QUIRKS } };
  if (partial?.sig !== undefined) ctx.sig = partial.sig;
  if (partial?.signal !== undefined) ctx.signal = partial.signal;
  if (partial?.preferLocal !== undefined) ctx.preferLocal = partial.preferLocal;
  return ctx;
}

/** A resume as the FillEngine needs it — structurally satisfied by `ResumeRecord` (SEC 7.3). */
export interface ResumeAttachment {
  name: string;
  mime: string;
  blob: Blob;
}
