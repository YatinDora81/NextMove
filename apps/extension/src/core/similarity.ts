/**
 * core/similarity.ts — string-distance primitives, no policy.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 6.3  the fuzzy tier of the FieldMatcher ("Jaro-Winkler ≥ .88 → 55 · suggest")
 *   SEC 5.7  the Answer Bank's question-similarity search (F-17)
 *
 * THRESHOLDS DO NOT LIVE HERE. `FUZZY_MIN_SIMILARITY` (matcher), `SAME_Q` and `SIMILAR_Q`
 * (answer bank) are all in `shared/constants.ts`, because they are product policy that the user
 * and remote config can move. This module only answers "how alike are these two strings", on a
 * closed 0–1 scale, deterministically, with no I/O and no DOM.
 *
 * Every function here is pure and total: no throw paths, no NaN escapes, `''` is always legal
 * input, and the result is always a finite number in [0, 1].
 */

/* ------------------------------------------------------------------------------------------------
 * Normalization & tokenization
 * ---------------------------------------------------------------------------------------------- */

/** Collapse every run of whitespace (including NBSP) to one space and trim. */
export function collapse(input: string): string {
  // \s plus the zero-width family and the BOM, which ATS markup sprinkles into labels.
  return input.replace(/[\s\u00a0\u200b-\u200d\ufeff]+/g, ' ').trim();
}

/**
 * Split identifier-shaped text so `applicantFirstName`, `applicant_first_name`,
 * `applicant-first-name` and `Applicant First Name` all reduce to the same token stream.
 * Also splits letter/digit boundaries so `address1` → `address 1`.
 */
export function splitCompoundWords(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer → HTTP Server
    .replace(/([A-Za-z])(\d)/g, '$1 $2') // address1 → address 1
    .replace(/(\d)([A-Za-z])/g, '$1 $2'); // 1st → 1 st
}

/**
 * Canonical comparison form: compound-split, lowercased, accent-folded, punctuation → space,
 * whitespace collapsed. `"Applicant's e-mail (required)"` → `"applicant s e mail required"`.
 *
 * Accent folding uses NFD + combining-mark removal so `"Prénom"` and `"Prenom"` compare equal —
 * ATS forms in Canada, France and Germany routinely mix the two.
 */
export function normalizeText(input: string): string {
  if (!input) return '';
  const folded = splitCompoundWords(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // drop combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  return collapse(folded);
}

/**
 * Accent-folded, lowercased, with EVERY non-alphanumeric character removed and no compound
 * splitting: `"LinkedIn Profile"` and `"linkedin profile"` both become `"linkedinprofile"`.
 *
 * {@link normalizeText} splits camelCase, which is right for `firstName` but wrong for brand
 * names — it turns "LinkedIn" into "linked in", which then no longer equals the dictionary alias
 * "linkedin". Comparing compact forms makes casing and word boundaries irrelevant, which is
 * exactly what an *exact* label comparison wants.
 */
export function compactText(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Normalized tokens, in document order, duplicates preserved. */
export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/** Normalized token set. Order and multiplicity are discarded. */
export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input));
}

/* ------------------------------------------------------------------------------------------------
 * Jaccard
 * ---------------------------------------------------------------------------------------------- */

/**
 * Jaccard index over normalized token sets: |A ∩ B| / |A ∪ B|.
 *
 * The right tool for *sentence*-scale comparison (screening questions), where word overlap
 * matters and character transpositions do not. Returns 0 when either side has no tokens —
 * an empty question is never "identical" to another empty one for our purposes.
 */
export function jaccardTokenSet(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  // Iterate the smaller set — Jaccard is symmetric, so this is a pure win.
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const token of small) {
    if (large.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Jaccard index over *character bigrams*. Survives word-order changes and short strings better
 * than the token version; used as the tie-breaker inside {@link textSimilarity}.
 */
export function jaccardBigrams(a: string, b: string): number {
  const gramsA = bigrams(normalizeText(a));
  const gramsB = bigrams(normalizeText(b));
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersection = 0;
  const [small, large] = gramsA.size <= gramsB.size ? [gramsA, gramsB] : [gramsB, gramsA];
  for (const gram of small) {
    if (large.has(gram)) intersection++;
  }
  const union = gramsA.size + gramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(normalized: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < normalized.length; i++) {
    out.add(normalized.slice(i, i + 2));
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Jaro / Jaro-Winkler
 * ---------------------------------------------------------------------------------------------- */

/**
 * Jaro similarity — the transposition-tolerant metric SEC 6.3's fuzzy tier is built on.
 * Handles the site-typo case ("Frist name" ↔ "First name") that edit distance handles badly.
 */
export function jaro(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;

  // Characters may only match within ⌊max(|a|,|b|)/2⌋ − 1 positions of each other.
  const window = Math.max(0, Math.floor(Math.max(lenA, lenB) / 2) - 1);
  const matchedA = new Array<boolean>(lenA).fill(false);
  const matchedB = new Array<boolean>(lenB).fill(false);

  let matches = 0;
  for (let i = 0; i < lenA; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, lenB);
    for (let j = start; j < end; j++) {
      if (matchedB[j] === true) continue;
      if (a[i] !== b[j]) continue;
      matchedA[i] = true;
      matchedB[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Count half-transpositions by walking both matched subsequences in lockstep.
  let halfTranspositions = 0;
  let k = 0;
  for (let i = 0; i < lenA; i++) {
    if (matchedA[i] !== true) continue;
    while (k < lenB && matchedB[k] !== true) k++;
    if (k >= lenB) break; // unreachable: the two matched counts are equal by construction
    if (a[i] !== b[k]) halfTranspositions++;
    k++;
  }
  const transpositions = halfTranspositions / 2;

  return (matches / lenA + matches / lenB + (matches - transpositions) / matches) / 3;
}

/** Common-prefix boost is capped at 4 characters, per Winkler's original definition. */
const WINKLER_MAX_PREFIX = 4;
/** Winkler's standard scaling factor. 0.1 is the maximum value that keeps the result ≤ 1. */
const WINKLER_SCALE = 0.1;

/**
 * Jaro-Winkler similarity in [0, 1]. Boosts pairs sharing a leading prefix, which is exactly
 * right for field labels — "first name" / "firstname" / "frist name" all agree up front.
 *
 * SEC 6.3 compares the result against `FUZZY_MIN_SIMILARITY` (0.88) in `shared/constants.ts`.
 */
export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base <= 0) return 0;
  if (base >= 1) return 1;

  const max = Math.min(WINKLER_MAX_PREFIX, a.length, b.length);
  let prefix = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) break;
    prefix++;
  }
  if (prefix === 0) return base;

  return Math.min(1, base + prefix * WINKLER_SCALE * (1 - base));
}

/** Jaro-Winkler over the {@link normalizeText} forms of both inputs. */
export function normalizedJaroWinkler(a: string, b: string): number {
  return jaroWinkler(normalizeText(a), normalizeText(b));
}

/* ------------------------------------------------------------------------------------------------
 * Phrase search
 * ---------------------------------------------------------------------------------------------- */

/**
 * True when every token of `phrase` occurs consecutively, in order, inside `text`.
 * `containsPhrase('applicant first name', 'first name')` → true;
 * `containsPhrase('name of first referee', 'first name')` → false.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  return containsTokenSequence(tokenize(text), tokenize(phrase));
}

/** {@link containsPhrase} on pre-tokenized input — the form the matcher's hot loop uses. */
export function containsTokenSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Best Jaro-Winkler between `phrase` and any same-length window of `text`'s tokens, plus the
 * whole-string comparison.
 *
 * This is what makes the SEC 6.3 fuzzy tier usable on real labels: comparing the alias
 * "first name" against the full label "Your Frist Name *" scores poorly end-to-end, but the
 * two-token window "frist name" scores 0.97 and clears the 0.88 floor.
 */
export function bestPhraseSimilarity(text: string, phrase: string): number {
  const needle = normalizeText(phrase);
  if (needle.length === 0) return 0;
  const haystackNorm = normalizeText(text);
  if (haystackNorm.length === 0) return 0;

  let best = jaroWinkler(haystackNorm, needle);
  if (best >= 1) return 1;

  const needleTokens = needle.split(' ');
  const haystackTokens = haystackNorm.split(' ');
  const width = needleTokens.length;
  if (haystackTokens.length <= width) return best;

  for (let i = 0; i + width <= haystackTokens.length; i++) {
    const window = haystackTokens.slice(i, i + width).join(' ');
    const score = jaroWinkler(window, needle);
    if (score > best) {
      best = score;
      if (best >= 1) return 1;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * Blended similarity (Answer Bank)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Sentence-scale similarity for the Answer Bank (SEC 5.7 / F-17).
 *
 * Token overlap carries the decision (two screening questions are "the same" when they use the
 * same words, whatever the order), and character-level agreement breaks ties so that
 * "Why do you want to work here?" and "Why do you want to work here at Acme?" do not collapse
 * to the same score as an unrelated pair.
 *
 * The caller compares the result against `SAME_Q` / `SIMILAR_Q` from `shared/constants.ts`.
 * Identical strings score exactly 1; disjoint strings score 0.
 */
export function textSimilarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (normA.length === 0 || normB.length === 0) return 0;
  if (normA === normB) return 1;

  const token = jaccardTokenSet(normA, normB);
  const bigram = jaccardBigrams(normA, normB);
  const character = jaroWinkler(normA, normB);

  // Weights chosen so a one-word difference in a ten-word question stays above SIMILAR_Q (0.75)
  // while an unrelated question of similar length stays well below it.
  return clamp01(0.55 * token + 0.25 * bigram + 0.2 * character);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/* ------------------------------------------------------------------------------------------------
 * bestMatch helpers
 * ---------------------------------------------------------------------------------------------- */

/** A scored candidate returned by the `bestMatch` family. */
export interface ScoredCandidate<T> {
  item: T;
  index: number;
  score: number;
}

/** Pluggable scorer: any `(query, candidateText) => number in [0,1]`. */
export type Scorer = (query: string, candidate: string) => number;

export interface BestMatchOptions<T> {
  /** How to read comparable text out of a candidate. Defaults to `String(item)`. */
  toText?: (item: T) => string;
  /** Similarity function. Defaults to {@link normalizedJaroWinkler}. */
  scorer?: Scorer;
  /** Candidates scoring below this are not returned at all. Defaults to 0 (return the best). */
  minScore?: number;
}

/**
 * Highest-scoring candidate, or `null` when the list is empty or nothing clears `minScore`.
 *
 * Ties are broken by the earlier index, which keeps the whole matching pipeline deterministic —
 * the golden expectation suite depends on that.
 */
export function bestMatch<T>(
  query: string,
  candidates: readonly T[],
  options: BestMatchOptions<T> = {},
): ScoredCandidate<T> | null {
  const toText = options.toText ?? ((item: T) => String(item));
  const scorer = options.scorer ?? normalizedJaroWinkler;
  const minScore = options.minScore ?? 0;

  let best: ScoredCandidate<T> | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (item === undefined) continue;
    const score = clamp01(scorer(query, toText(item)));
    if (score < minScore) continue;
    if (best === null || score > best.score) {
      best = { item, index: i, score };
      if (score >= 1) break; // nothing can beat a perfect match
    }
  }
  return best;
}

/** {@link bestMatch} specialised to a list of plain strings. */
export function bestStringMatch(
  query: string,
  candidates: readonly string[],
  options: Omit<BestMatchOptions<string>, 'toText'> = {},
): ScoredCandidate<string> | null {
  return bestMatch(query, candidates, { ...options, toText: (value) => value });
}

/**
 * All candidates scoring at or above `minScore`, best first. Ties keep their original order.
 * Used by the "map this field" picker and by `FieldMatcher.candidates()`.
 */
export function rankMatches<T>(
  query: string,
  candidates: readonly T[],
  options: BestMatchOptions<T> & { limit?: number } = {},
): Array<ScoredCandidate<T>> {
  const toText = options.toText ?? ((item: T) => String(item));
  const scorer = options.scorer ?? normalizedJaroWinkler;
  const minScore = options.minScore ?? 0;

  const scored: Array<ScoredCandidate<T>> = [];
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (item === undefined) continue;
    const score = clamp01(scorer(query, toText(item)));
    if (score >= minScore) scored.push({ item, index: i, score });
  }

  scored.sort((left, right) => (right.score - left.score) || (left.index - right.index));
  const limit = options.limit;
  return typeof limit === 'number' && limit >= 0 ? scored.slice(0, limit) : scored;
}

/**
 * Option picker for `<select>` / listbox fills (SEC 6.4): exact ⟶ startsWith ⟶ contains ⟶ fuzzy,
 * in that priority order, so "India" never loses to "British Indian Ocean Territory".
 *
 * Returns `null` when nothing reaches `minScore` on the fuzzy pass. The FillEngine owns the
 * decision about what to do with a `null` (mark the field `suggest`, never guess — INV-4).
 */
export function bestOptionMatch(
  wanted: string,
  options: readonly string[],
  minScore = 0.88,
): ScoredCandidate<string> | null {
  const target = normalizeText(wanted);
  if (target.length === 0 || options.length === 0) return null;

  const normalized = options.map((option) => normalizeText(option));

  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === target) return pick(options, i, 1);
  }
  for (let i = 0; i < normalized.length; i++) {
    const candidate = normalized[i];
    if (candidate !== undefined && candidate.length > 0 && candidate.startsWith(target)) {
      return pick(options, i, 0.97);
    }
  }
  for (let i = 0; i < normalized.length; i++) {
    const candidate = normalized[i];
    if (candidate !== undefined && candidate.length > 0 && containsPhrase(candidate, target)) {
      return pick(options, i, 0.94);
    }
  }
  const fuzzy = bestStringMatch(target, normalized, { minScore });
  if (fuzzy === null) return null;
  // Report the ORIGINAL option text, not its normalized form — the caller has to write it back.
  return { item: options[fuzzy.index] ?? fuzzy.item, index: fuzzy.index, score: fuzzy.score };
}

function pick(options: readonly string[], index: number, score: number): ScoredCandidate<string> {
  return { item: options[index] ?? '', index, score };
}
