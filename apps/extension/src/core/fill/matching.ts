/**
 * core/fill/matching.ts — string comparison used when the *page* offers the choices.
 *
 * JF-001 Rev 3.0 · SEC 6.4: selects, radio groups and typeaheads all reduce to the same problem —
 * "which of these rendered options is the profile value?". The ranking is fixed and deliberately
 * conservative: exact > alias > startsWith > contains > fuzzy, and the fuzzy tier uses the same
 * Jaro-Winkler floor (0.88) the FieldMatcher uses for labels (SEC 6.3), so a bad option match can
 * never be more confident than a bad label match.
 *
 * This is intentionally separate from `core/similarity.ts` (owned by the matcher): that module
 * scores *labels against profile paths*; this one scores *profile values against DOM options*.
 */

import { FUZZY_MIN_SIMILARITY } from '@/shared/constants';

/** Lowercase, de-accent, drop punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const n = normalize(input);
  return n.length === 0 ? [] : n.split(' ');
}

/** Jaro-Winkler similarity in [0, 1]. Same metric as SEC 6.3's fuzzy tier. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] === true) continue;
      if (a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (aMatched[i] !== true) continue;
    while (bMatched[k] !== true) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;

  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Sørensen–Dice over token sets — better than JW for multi-word option text. */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

export type MatchKind = 'exact' | 'alias' | 'prefix' | 'contains' | 'fuzzy';

export interface OptionScore {
  /** 0–1. Ranks candidates; the caller applies `MIN_OPTION_SCORE` as the accept floor. */
  score: number;
  kind: MatchKind;
}

/** Below this, we refuse to pick an option at all — INV-4 applies to values, not just fields. */
export const MIN_OPTION_SCORE = 0.62;

const KIND_WEIGHT: Record<MatchKind, number> = {
  exact: 1,
  alias: 0.97,
  prefix: 0.86,
  contains: 0.74,
  fuzzy: 0.7,
};

/**
 * Score one rendered option against the desired value plus any aliases for it
 * (e.g. "United States", "USA", "US" all describe the same country).
 */
export function scoreOption(
  optionTexts: readonly string[],
  desiredVariants: readonly string[],
): OptionScore {
  const options = optionTexts.map(normalize).filter((t) => t.length > 0);
  const wanted = desiredVariants.map(normalize).filter((t) => t.length > 0);
  if (options.length === 0 || wanted.length === 0) return { score: 0, kind: 'fuzzy' };

  const primary = wanted[0] ?? '';
  let best: OptionScore = { score: 0, kind: 'fuzzy' };

  const consider = (candidate: OptionScore): void => {
    if (candidate.score > best.score) best = candidate;
  };

  for (const option of options) {
    for (let i = 0; i < wanted.length; i++) {
      const want = wanted[i];
      if (want === undefined) continue;
      const isPrimary = i === 0;
      if (option === want) {
        consider({ score: isPrimary ? KIND_WEIGHT.exact : KIND_WEIGHT.alias, kind: isPrimary ? 'exact' : 'alias' });
        continue;
      }
      if (option.startsWith(want) || want.startsWith(option)) {
        const ratio = Math.min(option.length, want.length) / Math.max(option.length, want.length);
        consider({ score: KIND_WEIGHT.prefix * (0.75 + 0.25 * ratio), kind: 'prefix' });
        continue;
      }
      if (option.includes(want) || want.includes(option)) {
        const ratio = Math.min(option.length, want.length) / Math.max(option.length, want.length);
        consider({ score: KIND_WEIGHT.contains * (0.7 + 0.3 * ratio), kind: 'contains' });
      }
    }

    const jw = jaroWinkler(option, primary);
    const dice = tokenOverlap(option, primary);
    const fuzzy = Math.max(jw >= FUZZY_MIN_SIMILARITY ? jw : 0, dice >= 0.8 ? dice : 0);
    if (fuzzy > 0) consider({ score: KIND_WEIGHT.fuzzy * fuzzy, kind: 'fuzzy' });
  }

  return best;
}

export interface RankedOption<T> {
  item: T;
  score: number;
  kind: MatchKind;
}

/**
 * Rank a set of DOM options. `textsOf` returns every string that identifies the option
 * (its value attribute, its rendered text, its aria-label…).
 */
export function rankOptions<T>(
  items: readonly T[],
  textsOf: (item: T) => readonly string[],
  desiredVariants: readonly string[],
): RankedOption<T>[] {
  const ranked: RankedOption<T>[] = [];
  for (const item of items) {
    const { score, kind } = scoreOption(textsOf(item), desiredVariants);
    if (score > 0) ranked.push({ item, score, kind });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Highest-scoring option at or above `MIN_OPTION_SCORE`, else null. */
export function bestOption<T>(
  items: readonly T[],
  textsOf: (item: T) => readonly string[],
  desiredVariants: readonly string[],
  floor: number = MIN_OPTION_SCORE,
): RankedOption<T> | null {
  const ranked = rankOptions(items, textsOf, desiredVariants);
  const top = ranked[0];
  if (!top || top.score < floor) return null;
  return top;
}

/** True when the two strings describe the same value after normalisation. */
export function sameValue(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** Placeholder rows ("Select…", "-- choose --") must never win a match. */
export function isPlaceholderOption(value: string, text: string): boolean {
  if (value.trim().length > 0) return false;
  const n = normalize(text);
  if (n.length === 0) return true;
  return /^(select|choose|please select|please choose|pick|none|n a|-+|no selection)/.test(n);
}
