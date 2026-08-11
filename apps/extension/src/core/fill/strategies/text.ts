/**
 * core/fill/strategies/text.ts — text · textarea · email · tel · url.
 *
 * JF-001 Rev 3.0 · SEC 6.4: "Native prototype setter + real events executed in the MAIN world so
 * framework state managers observe the change."
 *
 * The write goes through the bridge (MAIN world) first; `bridge.setValue` degrades to an
 * isolated-world write of the same node when the MAIN-world script is unavailable. Either way we
 * read the value back before claiming success — INV-4 means never *assuming* a value landed.
 */

import { readCommitted, setValue, typeSequence } from '../bridge';
import {
  assertNotSubmitControl,
  isAborted,
  isTextLike,
  readLocalValue,
  sleep,
} from '../dom';
import { normalize } from '../matching';
import {
  REASON,
  failed,
  filled,
  unverified,
  type FillRequest,
  type StrategyContext,
  type StrategyResult,
} from '../types';

/**
 * SEC 6.4 (normative) — framework-safe write.
 *
 * `el.value = x` is intercepted by React's instance-level value trap, so the assignment is made
 * through the *prototype* descriptor instead; the framework's tracker then sees a genuine change
 * when `input` fires. `change` covers Angular/Vue, and `blur` matters because a large share of ATS
 * only run field validation on blur.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); // bypasses React's value trap
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true })); // many ATS validate on blur
}

/** What the page is allowed to end up holding for `value` and still count as committed. */
function expectedValue(el: Element, value: string): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const max = el.maxLength;
    if (typeof max === 'number' && max > 0 && value.length > max) return value.slice(0, max);
  }
  return value;
}

function committed(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  if (actual === expected) return true;
  const a = normalize(actual);
  const b = normalize(expected);
  if (a === b) return true;
  // Input masks ("(415) 555-0134" for "4155550134") keep the digits and drop nothing else.
  const digitsA = actual.replace(/\D+/g, '');
  const digitsB = expected.replace(/\D+/g, '');
  if (digitsB.length >= 6 && digitsA === digitsB) return true;
  // Trimming / whitespace normalisation by the widget is still a successful commit.
  return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2;
}

/**
 * Is the text standing in the field the text we were about to write?
 *
 * Deliberately stricter than `committed`. That judges a value the page has just taken FROM us and is
 * generous about reformatting — it accepts a prefix within two characters, so a widget that trimmed
 * or truncated our write still counts as a commit. Asking the opposite question, "did the human
 * already answer this with our value", cannot afford that generosity: "Ash" is a different answer
 * from "Asha", and treating it as a match would report a nickname the user chose as a value we
 * never wrote — the exact silent-overwrite failure this guard exists to prevent, minus the write.
 */
function alreadySays(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  if (actual === expected) return true;
  if (normalize(actual) === normalize(expected)) return true;
  // An input mask ("(415) 555-0134" for "4155550134") is the same answer, differently punctuated.
  const digitsA = actual.replace(/\D+/g, '');
  const digitsB = expected.replace(/\D+/g, '');
  return digitsB.length >= 6 && digitsA === digitsB;
}

/**
 * Does this control already hold something a human would call an answer?
 *
 * The text half of the engine's one "already answered" policy (`isAlreadyAnswered`). Whitespace is
 * not an answer; anything else is, because from here a value the page defaulted, a value restored
 * from a draft and a sentence the user typed are indistinguishable — and all three are answers
 * JobFill has no business replacing.
 *
 * Deliberately shape-based rather than `isTextLike`: a `date`/`number`/`month` input holds a typed
 * answer exactly the same way, and the engine asks this question before it knows which strategy
 * will run. Radios and checkboxes must never be asked — their `value` is the option's own label,
 * which reads non-blank whether or not the box is ticked (see `isAlreadyAnswered`).
 */
export function textHasRealValue(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim().length > 0;
  }
  const html = el as HTMLElement;
  if (html.isContentEditable) return (html.textContent ?? '').trim().length > 0;
  return false;
}

/**
 * Write a plain text value and prove it stuck.
 *
 * Escalation ladder: bridge SET_VALUE → (unverified) a real keystroke stream → (still unverified)
 * report `suggest` so the overlay asks the human instead of lying about the field.
 */
export async function fillText(
  el: Element,
  value: string,
  ctx: StrategyContext,
  request: FillRequest = {},
): Promise<StrategyResult> {
  try {
    // INV-1: never auto-submit. A text write can never target a submit control.
    assertNotSubmitControl(el, 'fill');
  } catch {
    return failed(REASON.submitControl);
  }

  if (value.length === 0) return failed(REASON.noValue);

  const html = el as HTMLElement;
  const fillable = isTextLike(el) || html.isContentEditable;
  if (!fillable) return failed(REASON.notFillable);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.readOnly || el.disabled) return failed(REASON.notFillable);
  }

  const expected = expectedValue(el, value);

  // An already-answered field is left exactly as it is (see `textHasRealValue`). When the standing
  // text is the text we would have written, that is a `filled` — the field is correct and the report
  // should say so instead of opening a gap for the user to go and check, the same way `fillSelect`
  // treats a dropdown that already reads the right thing. Otherwise nothing is written and the field
  // is reported as skipped, not as an error: declining to clobber an answer is the strategy working.
  if (request.overwrite !== true && textHasRealValue(el)) {
    return alreadySays(readLocalValue(el), expected) ? filled() : failed(REASON.alreadyAnswered);
  }

  const callOptions = ctx.preferLocal === true ? { preferLocal: true } : undefined;

  if (ctx.quirks.typeTextFields && isTextLike(el)) {
    // Some widgets (masked phone fields, "type-to-confirm" inputs) only accept keystrokes.
    await setValue(el, '', callOptions);
    const typed = await typeSequence(el, value, ctx.quirks.typeaheadDelayMs, {
      ...(callOptions ?? {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    if (!typed.ok) return failed(REASON.bridgeFailed);
  } else {
    const written = await setValue(el, expected, callOptions);
    if (!written.ok) return failed(REASON.bridgeFailed);
  }

  await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  let actual = await readCommitted(el, callOptions);
  if (committed(actual, expected)) return filled();

  // React sometimes re-renders the controlled value one tick later; a keystroke stream survives it.
  await setValue(el, '', callOptions);
  const retyped = await typeSequence(el, expected, 0, {
    ...(callOptions ?? {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (retyped.ok) {
    await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
    actual = await readCommitted(el, callOptions);
    if (committed(actual, expected)) return filled();
  }

  // INV-4: we cannot prove the value landed, so it is a suggestion, not a fill.
  return unverified(REASON.notCommitted);
}

/** Convenience for callers that already hold a `FillValue`-ish scalar. */
export async function fillTextValue(
  el: Element,
  value: string | number,
  ctx: StrategyContext,
  request: FillRequest = {},
): Promise<StrategyResult> {
  return fillText(el, typeof value === 'number' ? String(value) : value, ctx, request);
}
