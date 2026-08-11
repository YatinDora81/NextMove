/**
 * core/fill/strategies/select.ts — native <select>.
 *
 * JF-001 Rev 3.0 · SEC 6.4: "Fuzzy-match option text/value → set selectedIndex → dispatch change.
 * Country/state values normalized ('USA' ≈ 'United States' ≈ 'US')."
 *
 * The whole difficulty is vocabulary, not mechanics: the vault stores `country: "IN"` while the
 * page offers "India", and a US state dropdown may list "CA", "California" or "California (CA)".
 * `countryVariants` / `regionVariants` expand a stored value into every spelling an ATS is likely
 * to render, and `pickOption` ranks the rendered options against that set.
 */

import { readCommitted, setSelect } from '../bridge';
import {
  assertNotSubmitControl,
  isAborted,
  sleep,
} from '../dom';
import {
  MIN_OPTION_SCORE,
  bestOption,
  isPlaceholderOption,
  normalize,
  type RankedOption,
} from '../matching';
import {
  REASON,
  failed,
  filled,
  unverified,
  type FillRequest,
  type FillValue,
  type StrategyContext,
  type StrategyResult,
} from '../types';

/* ------------------------------------------------------------------------------------------------
 * Country / region vocabulary
 * ---------------------------------------------------------------------------------------------- */

/** ISO-3166 alpha-2 → [canonical name, ...aliases]. Covers the markets JobFill ships into. */
const COUNTRIES: Readonly<Record<string, readonly string[]>> = {
  AE: ['United Arab Emirates', 'UAE'],
  AR: ['Argentina'],
  AT: ['Austria'],
  AU: ['Australia'],
  BE: ['Belgium'],
  BD: ['Bangladesh'],
  BR: ['Brazil', 'Brasil'],
  CA: ['Canada'],
  CH: ['Switzerland'],
  CL: ['Chile'],
  CN: ['China', "People's Republic of China", 'PRC'],
  CO: ['Colombia'],
  CZ: ['Czechia', 'Czech Republic'],
  DE: ['Germany', 'Deutschland'],
  DK: ['Denmark'],
  EG: ['Egypt'],
  ES: ['Spain', 'España'],
  FI: ['Finland'],
  FR: ['France'],
  GR: ['Greece'],
  HK: ['Hong Kong', 'Hong Kong SAR'],
  HU: ['Hungary'],
  ID: ['Indonesia'],
  IE: ['Ireland', 'Republic of Ireland'],
  IL: ['Israel'],
  IN: ['India', 'Bharat'],
  IT: ['Italy', 'Italia'],
  JP: ['Japan'],
  KE: ['Kenya'],
  KR: ['South Korea', 'Korea, Republic of', 'Republic of Korea', 'Korea South'],
  LK: ['Sri Lanka'],
  LU: ['Luxembourg'],
  MA: ['Morocco'],
  MX: ['Mexico', 'México'],
  MY: ['Malaysia'],
  NG: ['Nigeria'],
  NL: ['Netherlands', 'The Netherlands', 'Holland'],
  NO: ['Norway'],
  NZ: ['New Zealand'],
  PH: ['Philippines', 'The Philippines'],
  PK: ['Pakistan'],
  PL: ['Poland'],
  PT: ['Portugal'],
  RO: ['Romania'],
  RU: ['Russia', 'Russian Federation'],
  SA: ['Saudi Arabia'],
  SE: ['Sweden'],
  SG: ['Singapore'],
  TH: ['Thailand'],
  TR: ['Turkey', 'Türkiye', 'Turkiye'],
  TW: ['Taiwan'],
  UA: ['Ukraine'],
  GB: ['United Kingdom', 'UK', 'Great Britain', 'GB', 'England', 'Britain'],
  US: [
    'United States',
    'United States of America',
    'USA',
    'U.S.',
    'U.S.A.',
    'US',
    'America',
  ],
  VN: ['Vietnam', 'Viet Nam'],
  ZA: ['South Africa'],
};

/** Region code → [canonical name, ...aliases]. US states, Canadian provinces, Indian states/UTs. */
const REGIONS: Readonly<Record<string, readonly string[]>> = {
  // United States
  AL: ['Alabama'], AK: ['Alaska'], AZ: ['Arizona'], AR: ['Arkansas'], CA: ['California'],
  CO: ['Colorado'], CT: ['Connecticut'], DE: ['Delaware'], DC: ['District of Columbia', 'Washington DC'],
  FL: ['Florida'], GA: ['Georgia'], HI: ['Hawaii'], ID: ['Idaho'], IL: ['Illinois'],
  IN_US: ['Indiana'], IA: ['Iowa'], KS: ['Kansas'], KY: ['Kentucky'], LA: ['Louisiana'],
  ME: ['Maine'], MD: ['Maryland'], MA: ['Massachusetts'], MI: ['Michigan'], MN: ['Minnesota'],
  MS: ['Mississippi'], MO: ['Missouri'], MT: ['Montana'], NE: ['Nebraska'], NV: ['Nevada'],
  NH: ['New Hampshire'], NJ: ['New Jersey'], NM: ['New Mexico'], NY: ['New York'],
  NC: ['North Carolina'], ND: ['North Dakota'], OH: ['Ohio'], OK: ['Oklahoma'], OR: ['Oregon'],
  PA: ['Pennsylvania'], PR: ['Puerto Rico'], RI: ['Rhode Island'], SC: ['South Carolina'],
  SD: ['South Dakota'], TN: ['Tennessee'], TX: ['Texas'], UT: ['Utah'], VT: ['Vermont'],
  VA: ['Virginia'], WA: ['Washington'], WV: ['West Virginia'], WI: ['Wisconsin'], WY: ['Wyoming'],
  // Canada
  AB: ['Alberta'], BC: ['British Columbia'], MB: ['Manitoba'], NB: ['New Brunswick'],
  NL: ['Newfoundland and Labrador'], NS: ['Nova Scotia'], NT: ['Northwest Territories'],
  NU: ['Nunavut'], ON: ['Ontario'], PE: ['Prince Edward Island'], QC: ['Quebec', 'Québec'],
  SK: ['Saskatchewan'], YT: ['Yukon'],
  // India
  AP: ['Andhra Pradesh'], AR_IN: ['Arunachal Pradesh'], AS: ['Assam'], BR: ['Bihar'],
  CG: ['Chhattisgarh'], GA_IN: ['Goa'], GJ: ['Gujarat'], HR: ['Haryana'], HP: ['Himachal Pradesh'],
  JH: ['Jharkhand'], KA: ['Karnataka'], KL: ['Kerala'], MP: ['Madhya Pradesh'],
  MH: ['Maharashtra'], MN_IN: ['Manipur'], ML: ['Meghalaya'], MZ: ['Mizoram'], NL_IN: ['Nagaland'],
  OD: ['Odisha', 'Orissa'], PB: ['Punjab'], RJ: ['Rajasthan'], SK_IN: ['Sikkim'],
  TN_IN: ['Tamil Nadu'], TS: ['Telangana'], TR: ['Tripura'], UP: ['Uttar Pradesh'],
  UK_IN: ['Uttarakhand'], WB: ['West Bengal'], DL: ['Delhi', 'NCT of Delhi', 'New Delhi'],
  JK: ['Jammu and Kashmir'], LA_IN: ['Ladakh'], CH_IN: ['Chandigarh'], PY: ['Puducherry', 'Pondicherry'],
};

function realCode(key: string): string {
  const underscore = key.indexOf('_');
  return underscore === -1 ? key : key.slice(0, underscore);
}

function lookupVariants(
  table: Readonly<Record<string, readonly string[]>>,
  input: string,
): string[] | null {
  const wanted = normalize(input);
  if (wanted.length === 0) return null;

  for (const [key, names] of Object.entries(table)) {
    const code = realCode(key);
    if (normalize(code) === wanted) return [...names, code];
    for (const name of names) {
      if (normalize(name) === wanted) return [...names, code];
    }
  }
  return null;
}

/** Every spelling of a country an ATS might render, primary form first. */
export function countryVariants(value: string): string[] {
  const found = lookupVariants(COUNTRIES, value);
  return found ?? [value];
}

/** Every spelling of a state/province an ATS might render, primary form first. */
export function regionVariants(value: string): string[] {
  const found = lookupVariants(REGIONS, value);
  return found ?? [value];
}

/** Canonical country name for a stored value ("IN" → "India"), or null when unknown. */
export function normalizeCountry(value: string): string | null {
  const found = lookupVariants(COUNTRIES, value);
  return found?.[0] ?? null;
}

/** Canonical region name for a stored value ("CA" → "California"), or null when unknown. */
export function normalizeRegion(value: string): string | null {
  const found = lookupVariants(REGIONS, value);
  return found?.[0] ?? null;
}

const COUNTRY_HINT = /\bcountry|nation|citizenship\b/i;
const REGION_HINT = /\bstate|province|region|county\b/i;

/**
 * Expand a raw profile value into the variants worth matching, using the field's own label as the
 * hint for which vocabulary applies (a bare "CA" is California under "State" and Canada under
 * "Country").
 */
export function valueVariants(value: string, label: string): string[] {
  const variants = new Set<string>();
  variants.add(value);

  const hint = `${label}`;
  if (COUNTRY_HINT.test(hint)) {
    for (const v of countryVariants(value)) variants.add(v);
  } else if (REGION_HINT.test(hint)) {
    for (const v of regionVariants(value)) variants.add(v);
  } else {
    // No hint: try both, country first (its codes are globally unique, region codes are not).
    const asCountry = lookupVariants(COUNTRIES, value);
    if (asCountry) for (const v of asCountry) variants.add(v);
    const asRegion = lookupVariants(REGIONS, value);
    if (asRegion) for (const v of asRegion) variants.add(v);
  }

  return [...variants];
}

/* ------------------------------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------------------------------- */

export interface SelectOptionInfo {
  index: number;
  value: string;
  text: string;
  disabled: boolean;
}

export function collectOptions(el: HTMLSelectElement): SelectOptionInfo[] {
  const out: SelectOptionInfo[] = [];
  for (let i = 0; i < el.options.length; i++) {
    const option: HTMLOptionElement | undefined = el.options[i];
    if (!option) continue;
    const text = (option.textContent ?? '').replace(/\s+/g, ' ').trim();
    // `label` is spec'd as a string but is absent in some DOM implementations — never assume.
    const label = (option.label ?? option.getAttribute('label') ?? '').trim();
    out.push({
      index: i,
      value: option.value ?? '',
      text: text.length > 0 ? text : label,
      disabled: option.disabled === true,
    });
  }
  return out;
}

function optionTexts(option: SelectOptionInfo): string[] {
  const texts = [option.text, option.value];
  // "California (CA)" and "United States - US" are common; expose the bracketed part too.
  const bracketed = /[([]([^)\]]{1,40})[)\]]/.exec(option.text);
  if (bracketed?.[1]) texts.push(bracketed[1]);
  const dashed = option.text.split(/\s[-–—]\s/);
  if (dashed.length === 2) texts.push(...dashed);
  return texts.filter((t) => t.trim().length > 0);
}

/**
 * Option captions that mean "nothing has been chosen yet".
 *
 * Deliberately anchored at the start of the text: "Select your country" is a placeholder, while
 * "Selected Board Member" is a real answer that happens to begin with the same letters.
 */
const PLACEHOLDER_OPTION_TEXT = /^\s*(select|choose|please|pick|--|—)/i;

/**
 * Does the dropdown already carry a real answer?
 *
 * The `<select>` clause of the engine's one "already answered" policy (`isAlreadyAnswered`).
 *
 * The page's own default, a value restored from a draft, and a choice the user made by hand are
 * indistinguishable from here — and all three are answers JobFill has no business replacing. Only
 * an empty `value` or a placeholder caption ("Select…", "-- Choose --") counts as unanswered.
 *
 * Distinct from `matching.isPlaceholderOption`, which ranks CANDIDATE options and therefore treats
 * any option carrying a value as selectable. This asks the opposite question — what does the
 * control currently say — where a placeholder that ships with a value ("--", value="0") still
 * means the field is blank.
 */
export function selectHasRealValue(el: HTMLSelectElement): boolean {
  // A `<select multiple>` answers this question by a different rule; see below.
  if (el.multiple) return multiSelectHasRealValue(el);

  const option: HTMLOptionElement | undefined = el.options[el.selectedIndex];
  if (!option) return false;
  if ((option.value ?? '').length === 0) return false;
  return !PLACEHOLDER_OPTION_TEXT.test(option.textContent ?? '');
}

/**
 * Does a `<select multiple>` already carry a real answer?
 *
 * Same policy, different convention — which is why this is not `selectHasRealValue`:
 *
 *   - a single select is ALWAYS showing something (the user agent selects the first option when
 *     the markup selected none), so a page that wants a blank-looking dropdown has to ship a
 *     placeholder row — "Select…", "-- Choose --" — and the single-case rule has to read that
 *     caption to tell an unanswered control from an answered one;
 *   - a multi-select renders its options as a list with no collapsed display, so nothing is
 *     selected until something selects it, and the placeholder convention does not apply: a row
 *     captioned "Select all that apply" is an instruction, not a stand-in for the answer. Every
 *     selected option is there because the user, a restored draft or the page's own markup put it
 *     there — and all three are answers a bulk fill has no business replacing.
 *
 * So "answered" here is "at least one selected option carries a value". A selected row with no
 * value submits nothing and is the one selection that means nothing.
 *
 * Relaxing the caption rule inside `selectHasRealValue` would not have been enough: it reads
 * `el.selectedIndex`, which on a multi-select is only the FIRST selected option, so a control whose
 * valueless instruction row sits selected above three real choices would still read as unanswered.
 */
function multiSelectHasRealValue(el: HTMLSelectElement): boolean {
  for (let i = 0; i < el.options.length; i++) {
    const option: HTMLOptionElement | undefined = el.options[i];
    if (option?.selected !== true) continue;
    if ((option.value ?? '').length > 0) return true;
  }
  return false;
}

/** Every option index the control currently shows as selected. */
function selectedIndices(el: HTMLSelectElement): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < el.options.length; i++) {
    const option: HTMLOptionElement | undefined = el.options[i];
    if (option?.selected === true) out.add(i);
  }
  return out;
}

/** Is the control showing exactly `wanted` — no option missing, none left over? */
function selectionIs(el: HTMLSelectElement, wanted: ReadonlySet<number>): boolean {
  const current = selectedIndices(el);
  if (current.size !== wanted.size) return false;
  for (const index of wanted) {
    if (!current.has(index)) return false;
  }
  return true;
}

/** Rank the rendered options against a set of desired spellings. */
export function pickOption(
  options: readonly SelectOptionInfo[],
  variants: readonly string[],
): RankedOption<SelectOptionInfo> | null {
  const selectable = options.filter(
    (o) => !o.disabled && !isPlaceholderOption(o.value, o.text),
  );
  if (selectable.length === 0) return null;
  return bestOption(selectable, optionTexts, variants, MIN_OPTION_SCORE);
}

/* ------------------------------------------------------------------------------------------------
 * Strategy
 * ---------------------------------------------------------------------------------------------- */

function desiredStrings(value: FillValue): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'boolean') return value ? ['Yes', 'True'] : ['No', 'False'];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.filter((v) => v.trim().length > 0);
  return value.trim().length > 0 ? [value] : [];
}

/** Fuzzy-match option text/value → selectedIndex → change (SEC 6.4). */
export async function fillSelect(
  el: Element,
  value: FillValue,
  ctx: StrategyContext,
  request: FillRequest = {},
): Promise<StrategyResult> {
  try {
    // INV-1: never auto-submit. A <select> is not a submit control, but the guard is unconditional.
    assertNotSubmitControl(el, 'select an option on');
  } catch {
    return failed(REASON.submitControl);
  }

  if (!(el instanceof HTMLSelectElement)) return failed(REASON.notFillable);
  if (el.disabled) return failed(REASON.notFillable);

  const wanted = desiredStrings(value);
  if (wanted.length === 0) return failed(REASON.noValue);

  const options = collectOptions(el);
  if (options.length === 0) return failed(REASON.notFillable);

  const label = `${ctx.sig?.label ?? ''} ${ctx.sig?.name ?? ''} ${ctx.sig?.id ?? ''} ${ctx.sig?.autocomplete ?? ''}`;

  if (el.multiple && Array.isArray(value)) {
    // The overwrite policy applies here too — `fillMultiSelect` enforces its own clause of it,
    // because "already answered" means something different for a list than for a dropdown.
    return fillMultiSelect(el, value, label, ctx, request);
  }

  const primary = wanted[0] ?? '';
  const variants = valueVariants(primary, label);
  for (const extra of wanted.slice(1)) variants.push(extra);

  const choice = pickOption(options, variants);
  // INV-4: no confident option ⇒ leave the field alone rather than guess a neighbour.
  if (!choice) return failed(REASON.noOptionMatch);

  // An already-answered dropdown is left exactly as it is (see `selectHasRealValue`). When the
  // standing answer is the one we would have written, that is a `filled` — the field is correct and
  // the report should say so, the same way `fillRadio` treats an option that is already checked.
  // Otherwise nothing is written and the field is reported as skipped under `already-answered`, not
  // as an error and not as `not-fillable`: declining to clobber an answer is the strategy working,
  // and the overlay has to be able to tell the user which of the two happened.
  if (request.overwrite !== true && selectHasRealValue(el)) {
    return el.selectedIndex === choice.item.index ? filled() : failed(REASON.alreadyAnswered);
  }

  const callOptions = ctx.preferLocal === true ? { preferLocal: true } : undefined;
  // Some ATS build value-less option lists; then the visible text is the only address there is.
  const address = choice.item.value.length > 0 ? choice.item.value : choice.item.text;

  const written = await setSelect(el, address, callOptions);
  if (!written.ok) {
    // Last resort: drive selectedIndex directly on the shared node.
    el.selectedIndex = choice.item.index;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  if (el.selectedIndex === choice.item.index) return filled();

  const actual = await readCommitted(el, callOptions);
  if (actual !== null && normalize(actual) === normalize(address)) return filled();

  // INV-4: written but not provably committed ⇒ downgrade to a suggestion.
  return unverified(REASON.notCommitted);
}

async function fillMultiSelect(
  el: HTMLSelectElement,
  values: readonly string[],
  label: string,
  ctx: StrategyContext,
  request: FillRequest,
): Promise<StrategyResult> {
  const options = collectOptions(el);
  const chosen = new Set<number>();

  for (const value of values) {
    const choice = pickOption(options, valueVariants(value, label));
    if (choice) chosen.add(choice.item.index);
  }
  // INV-4: nothing matched confidently ⇒ leave the list alone rather than tick a neighbour.
  if (chosen.size === 0) return failed(REASON.noOptionMatch);

  // The multi-select clause of the same policy the single path applies above: a list the user has
  // already ticked is left exactly as it is (see `multiSelectHasRealValue`). Writing here is not a
  // per-option merge but a replacement — the loop below clears every option we did not choose — so
  // a partial standing selection is precisely the case that must not be touched: the user dropping
  // one of five skills is an edit, and re-adding it is the clobber this policy exists to stop.
  // A list that already reads exactly what we would have written is reported as `filled`, matching
  // the single path, so the panel does not invent a gap for the user to go and check.
  if (request.overwrite !== true && multiSelectHasRealValue(el)) {
    return selectionIs(el, chosen) ? filled() : failed(REASON.alreadyAnswered);
  }

  for (let i = 0; i < el.options.length; i++) {
    const option: HTMLOptionElement | undefined = el.options[i];
    if (option) option.selected = chosen.has(i);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  // A count would pass while the page re-selected a different set; compare the actual indices.
  // INV-4: written but not provably committed ⇒ downgrade to a suggestion.
  return selectionIs(el, chosen) ? filled() : unverified(REASON.notCommitted);
}
