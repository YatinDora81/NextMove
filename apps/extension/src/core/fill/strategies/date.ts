/**
 * core/fill/strategies/date.ts — dates.
 *
 * JF-001 Rev 3.0 · SEC 6.4: "Native `<input type=date>` → ISO value + events. Widget pickers →
 * adapter-declared text format (`MM/DD/YYYY` etc.) typed into the visible input; never open the
 * calendar popup."
 *
 * Why "never open the popup" is a rule and not a preference: a calendar overlay steals focus, its
 * day cells are frequently `<button>` elements without a `type` attribute (which INV-1 classifies
 * as submit controls), and on multi-step wizards it can sit on top of the step's own navigation.
 * Setting the value and firing the event stream reaches the same framework state with none of that
 * risk — so this file never clicks a calendar trigger, and never focuses the field before writing.
 */

import { readCommitted, setValue, typeSequence } from '../bridge';
import {
  assertNotSubmitControl,
  dispatchKey,
  isAborted,
  sleep,
} from '../dom';
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
 * Parsing
 * ---------------------------------------------------------------------------------------------- */

export interface DateParts {
  year: number;
  month: number; // 1–12
  day: number | null; // null for "YYYY-MM" values (profile work/education dates)
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

function clampMonth(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
}

function clampDay(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

function monthFromName(token: string): number | null {
  const n = token.toLowerCase();
  const long = MONTH_NAMES.indexOf(n as (typeof MONTH_NAMES)[number]);
  if (long !== -1) return long + 1;
  const short = MONTH_SHORT.indexOf(n.slice(0, 3));
  return short === -1 ? null : short + 1;
}

/**
 * Accepts what the vault actually stores plus what a user is likely to have typed:
 * `2024-06-01`, `2024-06`, `06/01/2024`, `01/06/2024` (with a hint), `Jun 2024`, epoch ms, Date.
 */
export function parseDateValue(value: FillValue, dayFirst = false): DateParts | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }

  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw.length === 0) return null;

  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(raw);
  if (iso) {
    const year = Number(iso[1]);
    const month = clampMonth(Number(iso[2]));
    if (month === null) return null;
    const dayToken = iso[3];
    const day = dayToken === undefined ? null : clampDay(Number(dayToken));
    return { year, month, day };
  }

  const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    let year = Number(slashed[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    // A value above 12 can only be the day — that beats any format hint.
    const monthFirst = second > 12 ? true : first > 12 ? false : !dayFirst;
    const month = clampMonth(monthFirst ? first : second);
    const day = clampDay(monthFirst ? second : first);
    if (month === null || day === null) return null;
    return { year, month, day };
  }

  const named = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})?,?\s*(\d{4})$/.exec(raw);
  if (named) {
    const monthToken = named[1];
    const yearToken = named[3];
    if (monthToken === undefined || yearToken === undefined) return null;
    const month = monthFromName(monthToken);
    if (month === null) return null;
    const dayToken = named[2];
    return {
      year: Number(yearToken),
      month,
      day: dayToken === undefined ? null : clampDay(Number(dayToken)),
    };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Formatting
 * ---------------------------------------------------------------------------------------------- */

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Render `parts` in an adapter-declared pattern. Supported tokens:
 * `YYYY` `YY` `MMMM` `MMM` `MM` `M` `DD` `D`. Everything else is copied verbatim.
 */
export function formatDate(parts: DateParts, pattern: string): string {
  const day = parts.day ?? 1;
  const monthIndex = parts.month - 1;
  const longName = MONTH_NAMES[monthIndex] ?? '';
  const shortName = MONTH_SHORT[monthIndex] ?? '';

  return pattern.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(parts.year);
      case 'YY':
        return pad2(parts.year % 100);
      case 'MMMM':
        return longName.charAt(0).toUpperCase() + longName.slice(1);
      case 'MMM':
        return shortName.charAt(0).toUpperCase() + shortName.slice(1);
      case 'MM':
        return pad2(parts.month);
      case 'M':
        return String(parts.month);
      case 'DD':
        return pad2(day);
      case 'D':
        return String(day);
      default:
        return token;
    }
  });
}

export function toIsoDate(parts: DateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day ?? 1)}`;
}

export function toIsoMonth(parts: DateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}`;
}

/** Native date-ish input types, which always speak ISO regardless of what they render. */
const NATIVE_DATE_TYPES = new Set(['date', 'month', 'week', 'datetime-local']);

export function isNativeDateInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && NATIVE_DATE_TYPES.has(el.type.toLowerCase());
}

function nativeValueFor(el: HTMLInputElement, parts: DateParts): string | null {
  switch (el.type.toLowerCase()) {
    case 'date':
      return toIsoDate(parts);
    case 'month':
      return toIsoMonth(parts);
    case 'datetime-local':
      return `${toIsoDate(parts)}T00:00`;
    case 'week': {
      // ISO week number for the given day — the only sane thing to put in a week input.
      const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day ?? 1));
      const dayNumber = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - dayNumber + 3);
      const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      const week =
        1 +
        Math.round(
          ((date.getTime() - firstThursday.getTime()) / 86_400_000 -
            3 +
            ((firstThursday.getUTCDay() + 6) % 7)) /
            7,
        );
      return `${date.getUTCFullYear()}-W${pad2(week)}`;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Strategy
 * ---------------------------------------------------------------------------------------------- */

const DAY_FIRST_HINT = /\bdd\s*[/.-]\s*mm|d\/m\/y|day first\b/i;

function wantsDayFirst(pattern: string, ctx: StrategyContext): boolean {
  if (DAY_FIRST_HINT.test(pattern)) return true;
  const placeholder = ctx.sig?.placeholder ?? '';
  return DAY_FIRST_HINT.test(placeholder);
}

/** Native inputs get ISO; widget pickers get the adapter's text format. Never opens a calendar. */
export async function fillDate(
  el: Element,
  value: FillValue,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  try {
    assertNotSubmitControl(el, 'fill'); // INV-1
  } catch {
    return failed(REASON.submitControl);
  }

  const pattern = ctx.quirks.dateFormat;
  const parts = parseDateValue(value, wantsDayFirst(pattern, ctx));
  if (!parts) return failed(REASON.noValue);

  const callOptions = ctx.preferLocal === true ? { preferLocal: true } : undefined;

  if (isNativeDateInput(el)) {
    if (el.disabled || el.readOnly) return failed(REASON.notFillable);
    const isoValue = nativeValueFor(el, parts);
    if (isoValue === null) return failed(REASON.unsupportedInput);

    const written = await setValue(el, isoValue, callOptions);
    if (!written.ok) return failed(REASON.bridgeFailed);

    await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
    if (isAborted(ctx.signal)) return failed(REASON.aborted);

    const actual = await readCommitted(el, callOptions);
    if (actual === isoValue) return filled();
    // A native picker rejects out-of-range values silently by leaving the field empty.
    return unverified(REASON.notCommitted);
  }

  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return failed(REASON.notFillable);
  }
  if (el.disabled || el.readOnly) return failed(REASON.notFillable);

  const text = formatDate(parts, pattern);

  // Set-then-verify. We deliberately do NOT focus first: focus is what pops the calendar open on
  // most widget pickers, and INV-1 keeps us away from the button-shaped cells inside it.
  const written = await setValue(el, text, callOptions);
  if (!written.ok) return failed(REASON.bridgeFailed);

  await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  let actual = await readCommitted(el, callOptions);
  if (actual !== null && sameDate(actual, parts, pattern)) return filled();

  // Masked pickers (jQuery UI, Kendo, react-datepicker) only accept a real keystroke stream.
  await setValue(el, '', callOptions);
  const typed = await typeSequence(el, text, ctx.quirks.typeaheadDelayMs, {
    ...(callOptions ?? {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });

  if (typed.ok) {
    // If typing popped a calendar open anyway, dismiss it. Escape closes; it never submits.
    dispatchKey(el, 'keydown', 'Escape');
    await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
    actual = await readCommitted(el, callOptions);
    if (actual !== null && sameDate(actual, parts, pattern)) return filled();
  }

  // INV-4: the widget reformatted or rejected our value in a way we cannot confirm.
  return unverified(REASON.notCommitted);
}

/** A picker that reformats "06/01/2024" into "Jun 1, 2024" still committed the right date. */
function sameDate(actual: string, parts: DateParts, pattern: string): boolean {
  if (actual.trim().length === 0) return false;
  if (actual === formatDate(parts, pattern)) return true;
  const reparsed = parseDateValue(actual, DAY_FIRST_HINT.test(pattern));
  if (!reparsed) return false;
  if (reparsed.year !== parts.year || reparsed.month !== parts.month) return false;
  if (parts.day === null || reparsed.day === null) return true;
  return reparsed.day === parts.day;
}
