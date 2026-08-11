/**
 * core/fill/strategies/choice.ts — radio groups and checkboxes.
 *
 * JF-001 Rev 3.0 · SEC 6.4: "Resolve group by `name`; match option label to profile value
 * ('Yes/No', visa answers); call `.click()` on the target (click drives both native and
 * custom-styled inputs)."
 *
 * The hard parts in the wild:
 *   - the real <input> is usually `opacity:0` / `sr-only` under a styled <span>, so a click on the
 *     input may be swallowed and the <label> is the element that actually toggles;
 *   - some ATS ship ARIA widgets (`role="radio"` on a <div>) with no <input> at all;
 *   - the answer vocabulary is not "yes"/"no" but "I am authorized to work…", "Will now or in the
 *     future require sponsorship", "I decline to self-identify".
 *
 * INV-1: every element this file clicks is a radio, a checkbox, an ARIA radio/checkbox or the
 * <label> that proxies one — and `bridge.click` re-checks the submit guard on both sides anyway.
 */

import { click, readCommitted } from '../bridge';
import {
  assertNotSubmitControl,
  cssEscape,
  isAborted,
  isCheckable,
  isVisible,
  labelElementFor,
  labelTextFor,
  rootOf,
  sleep,
} from '../dom';
import { MIN_OPTION_SCORE, bestOption, normalize } from '../matching';
import {
  REASON,
  failed,
  filled,
  unverified,
  type FillValue,
  type StrategyContext,
  type StrategyResult,
} from '../types';

/* ------------------------------------------------------------------------------------------------
 * Answer vocabulary
 * ---------------------------------------------------------------------------------------------- */

const YES_WORDS = [
  'yes',
  'y',
  'true',
  'i do',
  'i am',
  'i have',
  'i agree',
  'agree',
  'accept',
  'i accept',
  'i consent',
  'confirm',
  'i confirm',
  'authorized',
  'authorised',
  'eligible',
  'available',
];

const NO_WORDS = [
  'no',
  'n',
  'false',
  'i do not',
  'i am not',
  'i have not',
  'do not',
  'not required',
  'no thanks',
  'disagree',
  'decline',
];

const DECLINE_RE =
  /decline|prefer not|do ?n[o']t wish|not wish to|choose not to|rather not|not disclose|no answer|i do not wish/i;

const YES_RE = /^(yes|y|true|1)$/i;
const NO_RE = /^(no|n|false|0)$/i;

/** Ternary answer a checkbox/radio group is being asked for. */
export type ChoiceIntent = 'yes' | 'no' | 'decline' | 'literal';

export function classifyIntent(value: FillValue): ChoiceIntent {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DECLINE_RE.test(trimmed)) return 'decline';
    if (YES_RE.test(trimmed)) return 'yes';
    if (NO_RE.test(trimmed)) return 'no';
  }
  return 'literal';
}

function variantsForIntent(intent: ChoiceIntent, raw: string): string[] {
  switch (intent) {
    case 'yes':
      return ['Yes', ...YES_WORDS];
    case 'no':
      return ['No', ...NO_WORDS];
    case 'decline':
      return [
        'I decline to self-identify',
        'Decline to state',
        'Prefer not to say',
        'Prefer not to answer',
        'I do not wish to answer',
        'I do not wish to disclose',
        'Choose not to disclose',
      ];
    case 'literal':
      return raw.length > 0 ? [raw] : [];
  }
}

/* ------------------------------------------------------------------------------------------------
 * Group resolution
 * ---------------------------------------------------------------------------------------------- */

export interface ChoiceOption {
  /** The element that reports checked-ness — the <input>, or the ARIA widget itself. */
  control: HTMLElement;
  /** The element worth clicking first (the input, or the ARIA widget). */
  input: HTMLInputElement | null;
  /** The <label> that proxies a visually hidden input, when there is one. */
  proxy: HTMLElement | null;
  label: string;
  value: string;
}

function ariaRoleOf(el: Element): string {
  return (el.getAttribute('role') ?? '').toLowerCase();
}

function toOption(el: HTMLElement): ChoiceOption {
  const input = el instanceof HTMLInputElement ? el : null;
  return {
    control: el,
    input,
    proxy: labelElementFor(el),
    label: labelTextFor(el),
    value: input?.value ?? el.getAttribute('data-value') ?? el.getAttribute('value') ?? '',
  };
}

/**
 * Can a human reach this option at all?
 *
 * The control itself is routinely styled away — `opacity:0` under a decorated `<span>` — while its
 * `<label>` carries the whole widget, so "is the input visible" is the wrong question and its
 * `<label>` is the right one. `core/scanner.ts` applies the same rule when it decides whether a
 * choice control is on screen.
 */
function choiceVisible(el: HTMLElement): boolean {
  if (isVisible(el)) return true;
  const label = labelElementFor(el);
  return label !== null && isVisible(label);
}

/**
 * Drop the members of a group no human could pick — a wizard step that is rendered but hidden, or
 * an option the page has styled out of existence — while keeping the ones behind a visible label.
 *
 * Never returns an empty group: if the whole group is off screen the caller still gets the real
 * membership, so `isChecked` can report what the group already answers rather than pretending the
 * question does not exist.
 */
function reachableMembers<T extends HTMLElement>(found: readonly T[]): T[] {
  const reachable = found.filter(choiceVisible);
  return reachable.length > 0 ? reachable : [...found];
}

/**
 * All members of the group `el` belongs to. Native radios group by `name` inside their form;
 * ARIA widgets group by the enclosing `role="radiogroup"` / fieldset.
 */
export function resolveGroup(el: HTMLElement): ChoiceOption[] {
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'radio') {
    const name = el.name;
    if (name.length > 0) {
      const scope: ParentNode = el.form ?? rootOf(el);
      const found = Array.from(
        scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${cssEscape(name)}"]`),
      );
      if (found.length > 0) return reachableMembers(found).map(toOption);
    }
  }

  const role = ariaRoleOf(el);
  if (role === 'radio') {
    const group = el.closest('[role="radiogroup"]') ?? el.parentElement;
    if (group) {
      const found = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
      if (found.length > 0) return reachableMembers(found).map(toOption);
    }
  }

  const fieldset = el.closest('fieldset, [role="group"], [role="radiogroup"]');
  if (fieldset) {
    const found = Array.from(
      fieldset.querySelectorAll<HTMLElement>('input[type="radio"], [role="radio"]'),
    );
    if (found.length > 1) return reachableMembers(found).map(toOption);
  }

  return [toOption(el)];
}

function isChecked(option: ChoiceOption): boolean {
  if (option.input) return option.input.checked;
  const aria = option.control.getAttribute('aria-checked');
  return aria === 'true';
}

function optionTexts(option: ChoiceOption): string[] {
  const texts = [option.label, option.value];
  const aria = option.control.getAttribute('aria-label');
  if (aria) texts.push(aria);
  const title = option.control.getAttribute('title');
  if (title) texts.push(title);
  return texts.filter((t) => t.trim().length > 0);
}

/** Map a profile value onto the option whose label best expresses it. */
export function mapValueToOption(
  options: readonly ChoiceOption[],
  value: FillValue,
): ChoiceOption | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  const intent = classifyIntent(value);
  const variants = variantsForIntent(intent, raw);
  if (variants.length === 0) return null;

  if (intent === 'yes' || intent === 'no') {
    // A two-option group is answered by polarity, not by fuzzy text: "I am authorized" vs
    // "I am not authorized" differ by one token and fuzzy scoring would happily pick the wrong one.
    const polar = pickByPolarity(options, intent);
    if (polar) return polar;
  }

  const choice = bestOption(options, optionTexts, variants, MIN_OPTION_SCORE);
  if (choice) return choice.item;

  if (intent === 'decline') {
    const declining = options.find((o) => DECLINE_RE.test(o.label) || DECLINE_RE.test(o.value));
    if (declining) return declining;
  }
  return null;
}

function polarityOf(text: string): 'yes' | 'no' | null {
  const n = normalize(text);
  if (n.length === 0) return null;
  if (DECLINE_RE.test(text)) return null;
  const negative =
    /\b(no|not|never|n a|none|do not|does not|will not|cannot|without|neither)\b/.test(n) ||
    n === 'n' ||
    n === 'false';
  if (negative) return 'no';
  const positive =
    /\b(yes|y|true|i am|i do|i have|i will|i agree|agree|accept|consent|authorized|authorised|eligible|require|required)\b/.test(
      n,
    ) || n === '1';
  if (positive) return 'yes';
  return null;
}

function pickByPolarity(
  options: readonly ChoiceOption[],
  intent: 'yes' | 'no',
): ChoiceOption | null {
  const matches = options.filter((o) => {
    for (const text of optionTexts(o)) {
      const polarity = polarityOf(text);
      if (polarity !== null) return polarity === intent;
    }
    return false;
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/* ------------------------------------------------------------------------------------------------
 * Strategy
 * ---------------------------------------------------------------------------------------------- */

async function clickAndVerify(
  option: ChoiceOption,
  wantChecked: boolean,
  ctx: StrategyContext,
): Promise<boolean> {
  const callOptions = ctx.preferLocal === true ? { preferLocal: true } : undefined;

  // Custom-styled inputs are often `opacity:0` and ignore direct clicks; the <label> is what the
  // widget actually listens to. Try the real control first, then its proxy.
  const targets: HTMLElement[] = [];
  const control = option.input ?? option.control;
  if (isVisible(control) || option.proxy === null) targets.push(control);
  if (option.proxy) targets.push(option.proxy);
  if (!targets.includes(control)) targets.push(control);

  for (const target of targets) {
    if (isAborted(ctx.signal)) return false;
    const result = await click(target, callOptions);
    if (!result.ok) continue;
    await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
    if (isChecked(option) === wantChecked) return true;
  }

  return isChecked(option) === wantChecked;
}

/** Radio group: pick the option that expresses the profile value and click it. */
export async function fillRadio(
  el: Element,
  value: FillValue,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  try {
    // INV-1: located and highlighted, never clicked — applies to the group member we resolve too.
    assertNotSubmitControl(el, 'click');
  } catch {
    return failed(REASON.submitControl);
  }

  if (!(el instanceof HTMLElement)) return failed(REASON.notFillable);

  const options = resolveGroup(el);
  if (options.length === 0) return failed(REASON.notFillable);

  const target = mapValueToOption(options, value);
  // INV-4: no option clearly expresses the stored answer ⇒ leave it for the human.
  if (!target) return failed(REASON.noOptionMatch);
  if (target.input?.disabled === true) return failed(REASON.notFillable);

  try {
    assertNotSubmitControl(target.input ?? target.control, 'click');
    if (target.proxy) assertNotSubmitControl(target.proxy, 'click');
  } catch {
    return failed(REASON.submitControl);
  }

  if (isChecked(target)) return filled();

  const done = await clickAndVerify(target, true, ctx);
  if (done) return filled();

  // INV-4: the widget did not take our click; report a suggestion instead of a phantom fill.
  return unverified(REASON.notCommitted);
}

/** Checkbox (or checkbox group when the value is a list). */
export async function fillCheckbox(
  el: Element,
  value: FillValue,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  try {
    assertNotSubmitControl(el, 'click'); // INV-1
  } catch {
    return failed(REASON.submitControl);
  }

  if (!(el instanceof HTMLElement)) return failed(REASON.notFillable);
  if (el instanceof HTMLInputElement && el.disabled) return failed(REASON.notFillable);

  if (Array.isArray(value)) return fillCheckboxGroup(el, value, ctx);

  const intent = classifyIntent(value);
  const option = toOption(el);

  let wantChecked: boolean;
  if (intent === 'yes') wantChecked = true;
  else if (intent === 'no') wantChecked = false;
  else if (intent === 'decline') wantChecked = DECLINE_RE.test(option.label);
  else if (typeof value === 'string' && value.trim().length > 0) {
    // A labelled checkbox in a set — check it when the label expresses the stored value.
    const choice = bestOption([option], optionTexts, [value.trim()], MIN_OPTION_SCORE);
    if (!choice) return failed(REASON.noOptionMatch);
    wantChecked = true;
  } else if (typeof value === 'number') wantChecked = value !== 0;
  else return failed(REASON.noValue);

  if (isChecked(option) === wantChecked) return filled();

  const done = await clickAndVerify(option, wantChecked, ctx);
  return done ? filled() : unverified(REASON.notCommitted);
}

async function fillCheckboxGroup(
  el: HTMLElement,
  values: readonly string[],
  ctx: StrategyContext,
): Promise<StrategyResult> {
  const wanted = values.filter((v) => v.trim().length > 0);
  if (wanted.length === 0) return failed(REASON.noValue);

  const name = el instanceof HTMLInputElement ? el.name : '';
  const scope: ParentNode =
    (el instanceof HTMLInputElement ? el.form : null) ??
    el.closest('fieldset, [role="group"]') ??
    rootOf(el);

  const members: HTMLElement[] =
    name.length > 0
      ? Array.from(
          scope.querySelectorAll<HTMLInputElement>(
            `input[type="checkbox"][name="${cssEscape(name)}"]`,
          ),
        )
      : [el];

  const options = members.map(toOption);
  let matched = 0;
  let committedAll = true;

  for (const value of wanted) {
    const choice = bestOption(options, optionTexts, [value], MIN_OPTION_SCORE);
    if (!choice) continue;
    matched++;
    if (isChecked(choice.item)) continue;
    const done = await clickAndVerify(choice.item, true, ctx);
    if (!done) committedAll = false;
  }

  if (matched === 0) return failed(REASON.noOptionMatch);
  return committedAll ? filled() : unverified(REASON.notCommitted);
}

/** Entry point used by the engine: dispatches on the element's own type. */
export async function fillChoice(
  el: Element,
  value: FillValue,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  if (isCheckable(el)) {
    return el.type.toLowerCase() === 'radio' ? fillRadio(el, value, ctx) : fillCheckbox(el, value, ctx);
  }
  const role = ariaRoleOf(el);
  if (role === 'radio') return fillRadio(el, value, ctx);
  if (role === 'checkbox' || role === 'switch') return fillCheckbox(el, value, ctx);
  return failed(REASON.unsupportedInput);
}

/** Exposed for the engine's dry-run/preview path — never clicks anything. */
export function previewChoice(el: Element, value: FillValue): string | null {
  if (!(el instanceof HTMLElement)) return null;
  const option = mapValueToOption(resolveGroup(el), value);
  return option ? option.label : null;
}

/** Read what the group currently answers, for the overlay's "already answered" state. */
export async function readChoice(el: Element, ctx: StrategyContext): Promise<string | null> {
  if (!(el instanceof HTMLElement)) return null;
  const checked = resolveGroup(el).find(isChecked);
  if (checked) return checked.label;
  return readCommitted(el, ctx.preferLocal === true ? { preferLocal: true } : undefined);
}
