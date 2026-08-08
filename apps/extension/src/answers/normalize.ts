/**
 * answers/normalize.ts — step 1 of the Answer Bank (JF-001 Rev 3.0 SEC 5.7, F-17).
 *
 * Screening questions repeat brutally across applications. Before anything can be matched or
 * banked it has to be reduced to a stable key, and any employer name has to be pulled out of the
 * text so a saved answer can be re-used somewhere else without leaking the wrong company.
 *
 * Three pure, synchronous transforms:
 *
 *   normalizeQuestion(qRaw, company)   the MATCHING KEY. lowercase → punctuation stripped →
 *                                      whitespace collapsed → the posting's company name replaced
 *                                      by the literal token `{company}`.
 *                                        "Why do you want to work at Acme, Inc.?"
 *                                          ⇒ "why do you want to work at {company}"
 *
 *   templatize(answer, company)        the STORAGE transform. Company names detected in an accepted
 *                                      answer are stored as `{company}`, so an answer written for
 *                                      Acme can never land Acme's name in a Globex form (F-17).
 *
 *   rehydrate(answer, company)         the REUSE transform: `{company}` → the current employer.
 *
 * INV-2 / SEC 5.7: nothing here performs I/O, mints a user-gesture nonce, leases a key or touches
 * the network. This module is the front half of a path that is offline by construction.
 *
 * SEC 9.2: `qRaw` and `answer` are page-derived and therefore untrusted. Everything below is plain
 * string math — no HTML is parsed, nothing is ever assigned to `innerHTML`.
 */

import { COMPANY_TOKEN } from '@/shared/constants';

/* ------------------------------------------------------------------------------------------------
 * Token plumbing
 * ---------------------------------------------------------------------------------------------- */

/** Source of the `{company}` placeholder matcher. Tolerates `{ Company }` / `{COMPANY}`. */
export const COMPANY_TOKEN_PATTERN = '\\{\\s*company\\s*\\}';

/** Substituted when an answer is reused but the employer is not (yet) known. */
export const UNKNOWN_COMPANY_FALLBACK = 'your company';

function companyTokenRegex(): RegExp {
  // Fresh instance per call: a module-level /g regex carries `lastIndex` between callers.
  return new RegExp(COMPANY_TOKEN_PATTERN, 'gi');
}

/** True when the text already carries a `{company}` placeholder (i.e. it is a template). */
export function containsCompanyToken(text: string): boolean {
  return new RegExp(COMPANY_TOKEN_PATTERN, 'i').test(text ?? '');
}

/** Collapse every run of whitespace to a single space and trim. */
export function collapseWhitespace(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Replace every non letter/digit/whitespace character with a space (SEC 5.7 "punctuation stripped"). */
export function stripPunctuation(text: string): string {
  return (text ?? '').replace(/[^\p{L}\p{N}\s]+/gu, ' ');
}

/**
 * lowercase → punctuation stripped → whitespace collapsed → split.
 * The single tokenizer used for question keys, company aliases and Jaccard token sets, so both
 * sides of every comparison are always produced the same way.
 */
export function tokenize(text: string): string[] {
  const collapsed = collapseWhitespace(stripPunctuation((text ?? '').toLowerCase()));
  return collapsed.length === 0 ? [] : collapsed.split(' ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------------------------------------
 * Company aliases
 * ---------------------------------------------------------------------------------------------- */

/**
 * Trailing words that are decoration rather than identity. Dropping them yields a second alias
 * ("Acme Technologies Inc." ⇒ also "Acme"), which is what actually appears in prose answers.
 * The full name is always kept as well and is always tried first (longest alias wins).
 */
const COMPANY_TAIL_NOISE: ReadonlySet<string> = new Set([
  'inc',
  'incorporated',
  'llc',
  'llp',
  'ltd',
  'limited',
  'plc',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ag',
  'sa',
  'sas',
  'sarl',
  'bv',
  'nv',
  'ab',
  'oy',
  'as',
  'pte',
  'pty',
  'pvt',
  'private',
  'holdings',
  'holding',
  'group',
  'labs',
  'lab',
  'technologies',
  'technology',
  'solutions',
  'systems',
  'software',
  'services',
  'global',
  'international',
  'worldwide',
  'careers',
  'career',
  'jobs',
  'job',
  'hiring',
  'talent',
  'recruiting',
  'recruitment',
]);

/**
 * Aliases this generic are never specific enough to stand in for an employer — replacing them
 * would mangle unrelated sentences, so they are dropped from the alias list entirely.
 */
const ALIAS_BLOCKLIST: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'and',
  'of',
  'for',
  'at',
  'to',
  'in',
  'on',
  'us',
  'we',
  'you',
  'your',
  'our',
  'team',
  'group',
  'company',
  'careers',
  'career',
  'jobs',
  'job',
  'hiring',
  'inc',
  'llc',
  'ltd',
  'corp',
  'co',
  'labs',
  'global',
  'technology',
  'technologies',
]);

/** Drop trailing decoration tokens ("Acme Technologies Inc." ⇒ "Acme"). Never returns empty. */
export function stripCompanyNoise(company: string): string {
  const tokens = collapseWhitespace(company).split(' ').filter((t) => t.length > 0);
  let end = tokens.length;
  while (end > 1) {
    const last = tokens[end - 1];
    if (last === undefined) break;
    const bare = last.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (bare.length === 0 || COMPANY_TAIL_NOISE.has(bare)) {
      end -= 1;
      continue;
    }
    break;
  }
  return tokens.slice(0, end).join(' ');
}

/**
 * Every spelling of the employer worth searching for, longest first so the most specific match
 * wins. Returns `[]` when the company is unknown — which is the correct behaviour: with no company
 * in hand we must not guess, or an unrelated word gets tokenised into `{company}`.
 */
export function companyAliases(company: string | null | undefined): string[] {
  const raw = (company ?? '').trim();
  if (raw.length === 0) return [];

  const out: string[] = [];
  const push = (candidate: string): void => {
    const value = collapseWhitespace(candidate);
    if (value.length < 2) return;
    const lower = value.toLowerCase();
    if (ALIAS_BLOCKLIST.has(lower)) return;
    // Reject aliases made only of blocklisted words ("The Group").
    const tokens = tokenize(value);
    if (tokens.length === 0) return;
    if (tokens.every((t) => ALIAS_BLOCKLIST.has(t))) return;
    if (out.some((existing) => existing.toLowerCase() === lower)) return;
    out.push(value);
  };

  push(raw);
  // "Acme, Inc." ⇒ "Acme Inc" — punctuation-free but still the full name.
  push(raw.replace(/[^\p{L}\p{N}\s&'-]+/gu, ' '));
  push(stripCompanyNoise(raw.replace(/[^\p{L}\p{N}\s&'-]+/gu, ' ')));
  push(stripCompanyNoise(raw));

  return out.sort((a, b) => b.length - a.length);
}

/** The same aliases, pre-tokenised for `normalizeQuestion`, longest run first. */
export function companyAliasRuns(company: string | null | undefined): string[][] {
  const seen = new Set<string>();
  const runs: string[][] = [];
  for (const alias of companyAliases(company)) {
    const run = tokenize(alias);
    if (run.length === 0) continue;
    const key = run.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    runs.push(run);
  }
  return runs.sort((a, b) => b.length - a.length);
}

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 step 1 — normalize
 * ---------------------------------------------------------------------------------------------- */

function replaceCompanyRuns(tokens: readonly string[], runs: readonly (readonly string[])[]): string[] {
  if (runs.length === 0) return [...tokens];

  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = 0;
    for (const run of runs) {
      if (run.length === 0 || run.length > tokens.length - i) continue;
      let ok = true;
      for (let k = 0; k < run.length; k += 1) {
        if (tokens[i + k] !== run[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched = run.length;
        break;
      }
    }
    if (matched > 0) {
      // Collapse "Acme Acme" style repeats into a single token.
      if (out[out.length - 1] !== COMPANY_TOKEN) out.push(COMPANY_TOKEN);
      i += matched;
      continue;
    }
    const token = tokens[i];
    if (token !== undefined) out.push(token);
    i += 1;
  }
  return out;
}

/**
 * SEC 5.7 step 1. The stable matching key for a screening question.
 *
 * The company is substituted AFTER punctuation stripping so that "Acme, Inc." and "Acme Inc"
 * reduce to the same alias, and so the inserted `{company}` braces survive into the key.
 */
export function normalizeQuestion(qRaw: string, company?: string | null): string {
  const tokens = tokenize(qRaw ?? '');
  if (tokens.length === 0) return '';
  return replaceCompanyRuns(tokens, companyAliasRuns(company)).join(' ');
}

/** Convenience: normalize without any company substitution (used for company-agnostic search). */
export function normalizeText(text: string): string {
  return tokenize(text).join(' ');
}

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 step 4 — bank / reuse
 * ---------------------------------------------------------------------------------------------- */

/**
 * Store-side transform (SEC 5.7 step 4): every occurrence of the employer's name inside an
 * ACCEPTED answer becomes `{company}`. This is the mechanism that makes reuse safe — an answer
 * banked while applying to Acme physically does not contain the string "Acme" any more, so it
 * cannot leak into a Globex form (F-17).
 *
 * Unlike `normalizeQuestion` this preserves the answer's own casing, punctuation and line breaks:
 * the result is text a human will read back and edit.
 */
export function templatize(answer: string, company?: string | null): string {
  const text = answer ?? '';
  if (text.length === 0) return '';

  let out = text;
  for (const alias of companyAliases(company)) {
    const words = alias.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;
    // Allow any run of whitespace (including NBSP) between the alias words.
    const body = words.map(escapeRegExp).join('[\\s\\u00a0]+');
    // Boundaries are expressed as "not a letter/digit" so possessives ("Acme's") and punctuation
    // ("Acme.") still match, while "Acmex" does not.
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${body})(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_match: string, prefix: string) => `${prefix}${COMPANY_TOKEN}`);
  }
  return out;
}

/**
 * Reuse-side transform: `{company}` → the employer we are applying to right now. When the company
 * is unknown we substitute a neutral phrase rather than leaving a literal `{company}` in a form —
 * a visible placeholder in a submitted application is worse than a slightly generic sentence.
 */
export function rehydrate(answer: string, company?: string | null): string {
  const text = answer ?? '';
  if (text.length === 0) return '';
  const name = (company ?? '').trim();
  const replacement = name.length > 0 ? name : UNKNOWN_COMPANY_FALLBACK;
  // Function replacer: a company name containing `$&` must not be interpreted as a back-reference.
  return text.replace(companyTokenRegex(), () => replacement);
}

/** True when `templatize` would change the text — i.e. the answer mentions the employer by name. */
export function mentionsCompany(text: string, company?: string | null): boolean {
  return templatize(text, company) !== (text ?? '');
}
