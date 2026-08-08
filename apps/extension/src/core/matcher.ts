/**
 * core/matcher.ts — FieldMatcher: signatures → profile paths, scored.
 *
 * Implements JF-001 Rev 3.0 SEC 6.3 **exactly**. The table is the contract:
 *
 *   | Signal                                          | Score | Source        |
 *   |-------------------------------------------------|-------|---------------|
 *   | Saved user mapping for (domain, sig.hash)        |  100  | user-mapping  |
 *   | Adapter field-map hit                           |   98  | adapter       |
 *   | `autocomplete` token                            |   95  | autocomplete  |
 *   | Exact synonym on label                          |   90  | heuristic     |
 *   | Synonym on name/id tokens                       |   75  | heuristic     |
 *   | Synonym on placeholder / aria                   |   65  | heuristic     |
 *   | Fuzzy token overlap (Jaro-Winkler ≥ .88)        |   55  | heuristic     |
 *   | No signal above floor                           |    0  | skip + flag   |
 *
 *   Modifiers: +5 input-type agreement · −20 conflicting section heading ·
 *              −30 profile path already filled in this form.
 *   Actions:   ≥70 fill · 50–69 suggest · <50 skip     ← INV-4, never guess-fill.
 *
 * "Order of authority: user mapping → adapter map → autocomplete attribute → heuristics. First
 * tier that produces a confident answer wins." Tiers are therefore evaluated in order and the
 * first one that yields a path stops the search — a lower tier can never overrule a higher one,
 * only the modifiers can move the final number.
 *
 * The scoring numbers themselves live in `shared/constants.ts` (`SCORE`, `SCORE_MODIFIER`,
 * `FILL_THRESHOLD`, `SUGGEST_THRESHOLD`, `FUZZY_MIN_SIMILARITY`) so the user and remote config can
 * move the thresholds without this file changing.
 *
 * Determinism is a hard requirement: a golden expectation suite is written against this module, so
 * every tie is broken by an explicit, stable rule (alias specificity, then declaration order).
 */

import {
  FILL_THRESHOLD,
  FUZZY_MIN_SIMILARITY,
  SCORE,
  SCORE_MODIFIER,
  SIMILAR_Q,
  SUGGEST_THRESHOLD,
} from '@/shared/constants';
import type {
  FieldNode,
  FieldSignature,
  InputKind,
  MatchResult,
  MatchSource,
  Profile,
  ProfilePath,
} from '@/shared/types';

import { elementOf, matches } from './signature';
import {
  AFFIRMATIVE_VALUES,
  COMPENSATION_PERIOD_VALUES,
  GENERIC_ALIAS_TOKENS,
  NEGATIVE_VALUES,
  QUESTION_PATHS,
  REMOTE_PREFERENCE_VALUES,
  SYNONYMS,
  countryVariants,
  lookupCountry,
  lookupSubdivision,
  mergeSynonyms,
  subdivisionVariants,
} from './synonyms';
import type { SynonymDictionary } from './synonyms';
import {
  bestPhraseSimilarity,
  compactText,
  containsTokenSequence,
  jaroWinkler,
  normalizeText,
  textSimilarity,
} from './similarity';

/* ------------------------------------------------------------------------------------------------
 * autocomplete → profile path (SEC 6.3 tier 3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * WHATWG autofill field names we can honour. The `autocomplete` attribute is the highest-trust
 * *page-authored* signal there is — the site is telling us what the field means — so it outranks
 * every heuristic.
 *
 * Tokens we deliberately do not map (`cc-*`, `bday*`, `sex`, `photo`) either have no vault
 * counterpart or are payment data JobFill must never touch.
 */
export const AUTOCOMPLETE_MAP: Readonly<Record<string, ProfilePath>> = {
  name: 'personal.fullName',
  'given-name': 'personal.firstName',
  'family-name': 'personal.lastName',
  nickname: 'personal.firstName',
  email: 'personal.email',
  tel: 'personal.phone',
  'tel-national': 'personal.phone',
  'tel-local': 'personal.phone',
  'street-address': 'personal.address.line1',
  'address-line1': 'personal.address.line1',
  'address-line2': 'personal.address.line2',
  'address-level2': 'personal.address.city',
  'address-level1': 'personal.address.state',
  'postal-code': 'personal.address.postalCode',
  country: 'personal.address.country',
  'country-name': 'personal.address.country',
  organization: 'work[0].company',
  'organization-title': 'work[0].title',
  url: 'links.portfolio',
};

/** Autofill "detail tokens" that qualify a field name and are stripped before lookup. */
const AUTOCOMPLETE_MODIFIERS: ReadonlySet<string> = new Set([
  'on',
  'off',
  'shipping',
  'billing',
  'home',
  'work',
  'mobile',
  'fax',
  'pager',
]);

/**
 * Extract the autofill field name from an `autocomplete` attribute value.
 * `"section-applicant shipping given-name"` → `"given-name"`; `"off"` / `"nope"` → `null`.
 */
export function parseAutocomplete(value: string): ProfilePath | null {
  const normalized = value.toLowerCase().trim();
  if (normalized.length === 0) return null;

  const tokens = normalized.split(/\s+/);
  // The field name is the last meaningful token; scan backwards so qualifiers are skipped.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token === undefined || token.length === 0) continue;
    if (token.startsWith('section-')) continue;
    if (AUTOCOMPLETE_MODIFIERS.has(token)) continue;
    const path = AUTOCOMPLETE_MAP[token];
    if (path !== undefined) return path;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * +5 input-type agreement (SEC 6.3 modifier 1)
 * ---------------------------------------------------------------------------------------------- */

/**
 * "matching inputType +5 (email field ↔ email path)".
 *
 * Only strong, unambiguous agreements are listed. `text` appears nowhere: it is the default kind
 * for most controls, so rewarding it would hand +5 to almost every match and make the modifier
 * meaningless.
 */
export const EXPECTED_INPUT_TYPES: Readonly<Record<ProfilePath, readonly InputKind[]>> = {
  'personal.email': ['email'],
  'personal.phone': ['tel'],
  'links.linkedin': ['url'],
  'links.github': ['url'],
  'links.portfolio': ['url'],
  'links.other': ['url'],
  'personal.address.country': ['select', 'combobox'],
  'personal.address.state': ['select', 'combobox'],
  'work[0].start': ['date'],
  'work[0].end': ['date'],
  'education[0].start': ['date'],
  'education[0].end': ['date'],
  'authorization.authorizedIn': ['radio', 'checkbox', 'select'],
  'authorization.needsSponsorship': ['radio', 'checkbox', 'select'],
  'authorization.willingToRelocate': ['radio', 'checkbox', 'select'],
  'authorization.remotePreference': ['select', 'radio', 'combobox'],
  'eeo.gender': ['select', 'radio'],
  'eeo.ethnicity': ['select', 'radio'],
  'eeo.veteran': ['select', 'radio'],
  'eeo.disability': ['select', 'radio'],
  'compensation.expected.currency': ['select', 'combobox'],
  'compensation.expected.period': ['select', 'radio'],
  summary: ['textarea'],
  skills: ['textarea'],
  'answers.coverLetter': ['textarea', 'file'],
  // SEC 6.5 derived path: the bytes live in Dexie `resumes`, so a file control is the ONLY thing
  // this can be written into (F-05).
  resume: ['file'],
  'answers.whyCompany': ['textarea'],
  'answers.howDidYouHear': ['select', 'combobox', 'textarea'],
  'answers.references': ['textarea'],
  'answers.additionalInfo': ['textarea'],
};

/** Does the control's kind agree with what this profile path should be filled into? */
export function inputTypeAgrees(path: ProfilePath, inputType: InputKind): boolean {
  const expected = EXPECTED_INPUT_TYPES[path];
  if (expected === undefined) return false;
  return expected.includes(inputType);
}

/* ------------------------------------------------------------------------------------------------
 * −20 conflicting section heading (SEC 6.3 modifier 2)
 * ---------------------------------------------------------------------------------------------- */

export interface SectionConflictRule {
  /** Stable id, surfaced in `explain()` so a surprising score is traceable. */
  id: string;
  /** Matched against `FieldSignature.sectionHeading`. */
  heading: RegExp;
  /** Profile-path prefixes this heading conflicts with. */
  conflicts: readonly string[];
  /** Paths exempted from the rule even though they match a `conflicts` prefix. */
  allows?: readonly string[];
}

/**
 * The doc's canonical example: "a 'Name' under *References* must not take the applicant's name."
 *
 * Every rule below encodes the same idea — the heading says the fields underneath describe
 * SOMEONE ELSE, or a different chapter of the applicant's history than the candidate path assumes.
 * Rules are data so a future remote-config push can extend them without a release.
 */
export const SECTION_CONFLICT_RULES: readonly SectionConflictRule[] = [
  {
    id: 'references',
    heading: /\b(?:references?|referees?|referral contacts?)\b/i,
    conflicts: [
      'personal.',
      'links.',
      'work[0].',
      'education[0].',
      'authorization.',
      'compensation.',
      'eeo.',
    ],
    // The "References" free-text question legitimately lives under a References heading.
    allows: ['answers.references'],
  },
  {
    id: 'emergency-contact',
    heading: /\b(?:emergency contact|next of kin|in case of emergency)\b/i,
    conflicts: ['personal.', 'links.'],
  },
  {
    id: 'family',
    heading: /\b(?:spouse|partner details|guardian|parent(?:'s)? (?:name|details)|dependents?|family member)\b/i,
    conflicts: ['personal.', 'links.'],
  },
  {
    id: 'supervisor',
    heading: /\b(?:supervisor|manager(?:'s)? (?:name|contact|details)|employer contact|hiring manager contact)\b/i,
    conflicts: ['personal.', 'links.'],
  },
  {
    id: 'education-section',
    heading: /\b(?:education|educational background|academic (?:background|history|details))\b/i,
    conflicts: ['work[0].'],
  },
  {
    id: 'employment-section',
    heading: /\b(?:work experience|employment history|work history|professional experience|previous employment)\b/i,
    conflicts: ['education[0].'],
  },
];

/** `true` when `path` sits under `prefix` (`'personal.'` covers `'personal.address.city'`). */
function pathHasPrefix(path: ProfilePath, prefix: string): boolean {
  if (prefix.endsWith('.')) return path.startsWith(prefix);
  return path === prefix || path.startsWith(`${prefix}.`);
}

/** The first rule that fires for this (heading, path) pair, or `null`. */
export function findSectionConflict(
  sectionHeading: string,
  path: ProfilePath,
  rules: readonly SectionConflictRule[] = SECTION_CONFLICT_RULES,
): SectionConflictRule | null {
  if (sectionHeading.length === 0) return null;
  for (const rule of rules) {
    if (!rule.heading.test(sectionHeading)) continue;
    if (rule.allows?.some((allowed) => pathHasPrefix(path, allowed)) === true) continue;
    if (rule.conflicts.some((prefix) => pathHasPrefix(path, prefix))) return rule;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Alias index
 * ---------------------------------------------------------------------------------------------- */

interface AliasEntry {
  path: ProfilePath;
  alias: string;
  norm: string;
  /** Word-boundary-free form, so "LinkedIn Profile" and "linkedin profile" compare equal. */
  compact: string;
  tokens: readonly string[];
  /**
   * Single generic word ("name", "title", "source"). These match only on an EXACT token-sequence
   * equality and never take part in windowed fuzzy matching — otherwise "Company Name" would fill
   * with the applicant's full name. See `GENERIC_ALIAS_TOKENS` in synonyms.ts.
   */
  generic: boolean;
  /** Declaration order across the whole dictionary — the final, stable tie-break. */
  order: number;
}

function buildAliasIndex(dictionary: SynonymDictionary | Record<ProfilePath, string[]>): AliasEntry[] {
  const entries: AliasEntry[] = [];
  let order = 0;
  for (const [path, aliases] of Object.entries(dictionary)) {
    for (const alias of aliases) {
      const norm = normalizeText(alias);
      if (norm.length === 0) continue;
      const tokens = norm.split(' ');
      const firstToken = tokens[0];
      entries.push({
        path,
        alias,
        norm,
        compact: compactText(alias),
        tokens,
        generic: tokens.length === 1 && firstToken !== undefined && GENERIC_ALIAS_TOKENS.has(firstToken),
        order: order++,
      });
    }
  }
  return entries;
}

/**
 * Longest token stream in which a generic one-word alias ("name", "title", "source") is still
 * treated as evidence. Beyond this the word is almost certainly incidental.
 */
const GENERIC_ALIAS_STREAM_LIMIT = 4;

/**
 * An alias at least this many tokens long counts as an exact label match when it appears verbatim
 * inside a longer label. See `tierExactLabel`.
 */
const EXACT_PHRASE_MIN_TOKENS = 5;

/**
 * Aliases shorter than this may only be compared against a whole normalized string, never against
 * a sliding token window. See `tierFuzzy`.
 */
const FUZZY_MIN_ALIAS_LENGTH = 5;

/**
 * More specific aliases win: more tokens first, then longer text, then declaration order.
 * This is what makes `last_name` resolve to `personal.lastName` (alias "last name", 2 tokens)
 * rather than `personal.fullName` (alias "name", 1 token).
 */
function moreSpecific(a: AliasEntry, b: AliasEntry): boolean {
  if (a.tokens.length !== b.tokens.length) return a.tokens.length > b.tokens.length;
  if (a.norm.length !== b.norm.length) return a.norm.length > b.norm.length;
  return a.order < b.order;
}

/* ------------------------------------------------------------------------------------------------
 * File targets (F-05) — the vocabulary `synonyms.ts` does not carry
 * ---------------------------------------------------------------------------------------------- */

/**
 * Aliases for `resume`, the SEC 6.5 derived path.
 *
 * WHY IT IS HERE AND NOT IN `synonyms.ts`: that table is the *vault* alias dictionary — every path
 * in it resolves to a value inside the SEC 7.2 `Profile`, which is what makes `hasValue()` and the
 * "map this field" picker meaningful for its entries. `resume` resolves to a Dexie blob instead
 * (SEC 7.1), and it is the matcher — not the dictionary — that knows a file control is the only
 * place it can go. Moving these three lines into `synonyms.ts` would be a purely cosmetic change
 * and is fine to do; nothing else depends on the location.
 *
 * WHY IT IS NEEDED AT ALL: without it, `resume` exists only as an adapter-map target, so F-05
 * works on the seven fingerprinted ATS and nowhere else. Every hand-rolled career page — the long
 * tail SEC 6.5 says the heuristic tiers exist for — scored 0 on its attachment control and offered
 * the user nothing. `answers.coverLetter` already covers the other half of the pair.
 *
 * `coverLetter` (the derived path) is deliberately absent: `answers.coverLetter` already claims
 * that vocabulary and already accepts a `file` control, so adding a second path for it would put
 * two entries in a tie for every "Cover letter" label on earth.
 */
export const FILE_TARGET_SYNONYMS: Readonly<Record<ProfilePath, readonly string[]>> = {
  resume: [
    'resume',
    'resume cv',
    'cv resume',
    'cv',
    'curriculum vitae',
    'resume or cv',
    'upload resume',
    'attach resume',
    'resume upload',
    'resume file',
    'resume attachment',
    'upload your resume',
    'attach your resume',
  ],
};

/** Paths that address a file control rather than a text value (mirrors `adapters.isFilePath`). */
const FILE_ONLY_PATHS: ReadonlySet<ProfilePath> = new Set<ProfilePath>(['resume']);

/**
 * A heuristic `resume` hit only makes sense on a file control.
 *
 * "Paste your resume below" is a textarea, and mapping it to `resume` would hand the FillEngine a
 * path whose value is a blob — it would resolve to nothing, and the field would be reported as
 * skipped instead of being matched by whatever weaker-but-writable path came next. The adapter and
 * user-mapping tiers are exempt: an explicit selector or a saved correction is a statement of fact
 * about that element, and this heuristic has no standing to overrule either.
 */
function fileTargetSuitsControl(path: ProfilePath, inputType: InputKind): boolean {
  return !FILE_ONLY_PATHS.has(path) || inputType === 'file';
}

/* ------------------------------------------------------------------------------------------------
 * Matcher
 * ---------------------------------------------------------------------------------------------- */

/**
 * Paths that carry the SAME information, for the −30 "already filled in this form" modifier.
 *
 * Filling "First Name" and "Last Name" answers the applicant's name; a later "Full Name" field is
 * therefore a duplicate. This is what makes SEC 6.3's canonical example come out right: on a form
 * that already captured the applicant's name, a "Full Name" under a *References* heading scores
 * 90 − 20 (conflicting section) − 30 (duplicate) = 40 and is skipped, instead of quietly filling
 * the referee's name box with the applicant's own.
 */
export const CONSUMPTION_ALIASES: Readonly<Record<ProfilePath, readonly ProfilePath[]>> = {
  'personal.firstName': ['personal.fullName'],
  'personal.lastName': ['personal.fullName'],
  'personal.fullName': ['personal.firstName', 'personal.lastName'],
};

export interface FieldMatcherContext {
  /** The vault entry being filled (SEC 7.2). Used to skip paths the profile cannot answer. */
  profile?: Profile | null;
  /** `jf.mappings[domain]` — sigHash → ProfilePath. Tier 1, score 100 (F-13). */
  userMappings?: Readonly<Record<string, ProfilePath>> | null;
  /** Adapter field map — CSS selector → ProfilePath. Tier 2, score 98 (SEC 6.5). */
  adapterFieldMap?: Readonly<Record<string, ProfilePath>> | null;
  /** Extra aliases from remote config, folded over the shipped dictionary (F-14). */
  remoteSynonyms?: Readonly<Record<string, readonly string[]>> | null;
  /** Version string of the remote synonym table, for provenance in `explain()`. */
  remoteSynonymsVersion?: string | null;
  /** INV-4 thresholds. Default to `FILL_THRESHOLD` / `SUGGEST_THRESHOLD`. */
  fillThreshold?: number;
  suggestThreshold?: number;
  /**
   * When true (the default), a candidate whose profile value is empty is demoted to `suggest`
   * rather than `fill` — filling a field with "" is worse than leaving it for the human.
   */
  requireValue?: boolean;
  /** Country hint for `authorization.*` resolution (an adapter may know the tenant's country). */
  country?: string | null;
}

/** Why a field scored what it did. Feeds the overlay's "why?" popover and the test suite. */
export interface MatchExplanation {
  hash: string;
  label: string;
  path: ProfilePath | null;
  base: number;
  source: MatchSource;
  /** The dictionary alias / autocomplete token / selector that produced the hit. */
  evidence: string;
  modifiers: Array<{ id: string; delta: number; detail: string }>;
  score: number;
  action: MatchResult['action'];
}

interface TierHit {
  path: ProfilePath;
  base: number;
  source: MatchSource;
  evidence: string;
}

/** Pre-computed, normalized views of a signature — built once, read by every tier. */
interface SignatureView {
  labelNorm: string;
  labelDenoised: string;
  labelCompact: string;
  labelDenoisedCompact: string;
  labelTokens: readonly string[];
  identifierNorm: string;
  identifierTokens: readonly string[];
  hintTokens: readonly string[];
}

export class FieldMatcher {
  private readonly ctx: FieldMatcherContext;
  private readonly aliases: AliasEntry[];
  private readonly fillThreshold: number;
  private readonly suggestThreshold: number;
  /** Composite dictionary version ("1.0.0" or "1.0.0+remote:2.3.1"). */
  readonly synonymsVersion: string;

  constructor(context: FieldMatcherContext = {}) {
    this.ctx = context;
    // File targets are appended AFTER the shipped table so declaration order — which
    // `moreSpecific` uses to break ties — keeps every existing path exactly where it was.
    const merged = mergeSynonyms(
      { ...SYNONYMS, ...FILE_TARGET_SYNONYMS },
      context.remoteSynonyms ?? null,
      context.remoteSynonymsVersion ?? null,
    );
    this.aliases = buildAliasIndex(merged.dictionary);
    this.synonymsVersion = merged.version;
    this.fillThreshold = context.fillThreshold ?? FILL_THRESHOLD;
    this.suggestThreshold = context.suggestThreshold ?? SUGGEST_THRESHOLD;
  }

  /**
   * Score every node of a scanned form.
   *
   * The −30 "duplicate path" modifier is scoped PER FORM, not per page: two forms on one page may
   * each legitimately ask for an email address. A path is marked consumed only when a node
   * actually reaches `fill` — a `suggest` must never suppress a later genuine fill.
   */
  match(nodes: readonly FieldNode[]): MatchResult[] {
    const consumedByForm = new Map<string, Set<ProfilePath>>();
    const results: MatchResult[] = [];

    for (const node of nodes) {
      const formKey = formKeyOf(node);
      let consumed = consumedByForm.get(formKey);
      if (consumed === undefined) {
        consumed = new Set<ProfilePath>();
        consumedByForm.set(formKey, consumed);
      }

      const result = this.matchOne(node, consumed);
      if (result.action === 'fill' && result.path !== null) {
        consumed.add(result.path);
        for (const covered of CONSUMPTION_ALIASES[result.path] ?? []) consumed.add(covered);
      }
      results.push(result);
    }

    return results;
  }

  /** Score a single node. `consumed` carries the paths already filled in the same form. */
  matchOne(node: FieldNode, consumed: ReadonlySet<ProfilePath> = new Set()): MatchResult {
    const explanation = this.explain(node, consumed);
    return {
      node,
      path: explanation.path,
      score: explanation.score,
      source: explanation.source,
      action: explanation.action,
    };
  }

  /** Full scoring trace for one node. `matchOne` is this, minus the reasoning. */
  explain(node: FieldNode, consumed: ReadonlySet<ProfilePath> = new Set()): MatchExplanation {
    const sig = node.sig;
    const hit = this.firstTierHit(node);

    if (hit === null) {
      // "No signal above floor — <50 · skip + flag" (SEC 6.3, last row).
      return {
        hash: sig.hash,
        label: sig.label,
        path: null,
        base: 0,
        source: 'heuristic',
        evidence: '',
        modifiers: [],
        score: 0,
        action: 'skip',
      };
    }

    const modifiers: MatchExplanation['modifiers'] = [];

    if (inputTypeAgrees(hit.path, sig.inputType)) {
      modifiers.push({
        id: 'input-type-agreement',
        delta: SCORE_MODIFIER.inputTypeAgreement,
        detail: `${sig.inputType} matches ${hit.path}`,
      });
    }

    const conflict = findSectionConflict(sig.sectionHeading, hit.path);
    if (conflict !== null) {
      modifiers.push({
        id: `conflicting-section:${conflict.id}`,
        delta: SCORE_MODIFIER.conflictingSection,
        detail: `"${sig.sectionHeading}" is not the applicant's own ${hit.path}`,
      });
    }

    if (consumed.has(hit.path)) {
      modifiers.push({
        id: 'duplicate-path',
        delta: SCORE_MODIFIER.duplicatePath,
        detail: `${hit.path} was already filled in this form`,
      });
    }

    const delta = modifiers.reduce((sum, modifier) => sum + modifier.delta, 0);
    const score = clampScore(hit.base + delta);

    let action = this.actionFor(score);

    // INV-4 in its second form: never write a value we do not have. A path we cannot resolve is
    // demoted to `suggest` so the overlay offers it instead of blanking the field.
    //
    // A `file` field is the one exception, and it is an exception about EVIDENCE, not about rigour.
    // The value of a file field does not live in the vault at all: SEC 7.1 puts resume bytes in
    // IndexedDB (`resumes`) precisely because they are megabytes, and the SEC 7.2 `Profile` has no
    // `resume` key by design. `hasValue('resume')` is therefore false on every profile that has
    // ever existed, including a perfectly complete one — so it is not evidence that the match is
    // wrong, which is the only thing this demotion is meant to detect.
    //
    // This does NOT re-open guess-filling (F-05 / INV-4). It only lets the field reach the engine;
    // `core/fill/strategies/file.ts` still refuses to invent an attachment, returns `no-resume`
    // when nothing is stored, and the write is reported as `filled` only once `input.files.length`
    // or the page's own filename chip proves it landed.
    const valueLivesOutsideTheVault = sig.inputType === 'file';

    if (
      action === 'fill' &&
      this.ctx.requireValue !== false &&
      !valueLivesOutsideTheVault &&
      !this.hasValue(hit.path)
    ) {
      action = 'suggest';
      modifiers.push({ id: 'empty-value', delta: 0, detail: `${hit.path} is empty in the profile` });
    }

    return {
      hash: sig.hash,
      label: sig.label,
      path: hit.path,
      base: hit.base,
      source: hit.source,
      evidence: hit.evidence,
      modifiers,
      score,
      action,
    };
  }

  /** INV-4: ≥70 fill · 50–69 suggest · <50 skip. */
  actionFor(score: number): MatchResult['action'] {
    if (score >= this.fillThreshold) return 'fill';
    if (score >= this.suggestThreshold) return 'suggest';
    return 'skip';
  }

  /**
   * Ranked alternative paths for a node — the "map this field" picker and the gray-zone
   * `AI_DISAMBIGUATE` candidate list (SEC 6.6). Never used for filling.
   */
  candidates(node: FieldNode, limit = 5): Array<{ path: ProfilePath; score: number; alias: string }> {
    const view = viewOf(node.sig);
    const best = new Map<ProfilePath, { score: number; alias: string }>();

    const consider = (path: ProfilePath, score: number, alias: string): void => {
      const existing = best.get(path);
      if (existing === undefined || score > existing.score) best.set(path, { score, alias });
    };

    for (const entry of this.aliases) {
      const similarity = Math.max(
        entry.generic
          ? jaroWinkler(view.labelDenoised, entry.norm)
          : bestPhraseSimilarity(view.labelNorm, entry.norm),
        entry.generic
          ? jaroWinkler(view.identifierNorm, entry.norm)
          : bestPhraseSimilarity(view.identifierNorm, entry.norm),
      );
      if (similarity > 0.5) consider(entry.path, similarity, entry.alias);
    }

    return [...best.entries()]
      .map(([path, info]) => ({ path, score: info.score, alias: info.alias }))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, Math.max(0, limit));
  }

  /* ---- the authority chain ----------------------------------------------------------------- */

  private firstTierHit(node: FieldNode): TierHit | null {
    const view = viewOf(node.sig);

    const authoritative = this.tierUserMapping(node) ?? this.tierAdapter(node);
    if (authoritative !== null) return authoritative;

    const heuristic =
      this.tierAutocomplete(node) ??
      this.tierExactLabel(view) ??
      this.tierIdentifierTokens(view) ??
      this.tierPlaceholderAria(view) ??
      this.tierFuzzy(view);

    // A guessed `resume` on something that is not a file control is not a match (see
    // `fileTargetSuitsControl`).
    if (heuristic !== null && !fileTargetSuitsControl(heuristic.path, node.sig.inputType)) {
      return null;
    }
    return heuristic;
  }

  /** Tier 1 — 100. The user mapped this exact (domain, sig.hash) before (F-13). */
  private tierUserMapping(node: FieldNode): TierHit | null {
    const mappings = this.ctx.userMappings;
    if (!mappings) return null;
    const path = mappings[node.sig.hash];
    if (typeof path !== 'string' || path.length === 0) return null;
    return { path, base: SCORE.userMapping, source: 'user-mapping', evidence: `sigHash ${node.sig.hash.slice(0, 12)}` };
  }

  /**
   * Tier 2 — 98. An adapter selector matched the element (SEC 6.5).
   * The longest matching selector wins, as a stand-in for CSS specificity; ties fall to
   * declaration order in the adapter's map.
   */
  private tierAdapter(node: FieldNode): TierHit | null {
    const fieldMap = this.ctx.adapterFieldMap;
    if (!fieldMap) return null;
    const el = elementOf(node.el);
    if (el === null) return null;

    let winner: { selector: string; path: ProfilePath } | null = null;
    for (const [selector, path] of Object.entries(fieldMap)) {
      if (typeof path !== 'string' || path.length === 0) continue;
      if (!matches(el, selector)) continue;
      if (winner === null || selector.length > winner.selector.length) {
        winner = { selector, path };
      }
    }
    if (winner === null) return null;
    return { path: winner.path, base: SCORE.adapter, source: 'adapter', evidence: winner.selector };
  }

  /** Tier 3 — 95. The page told us what the field is. */
  private tierAutocomplete(node: FieldNode): TierHit | null {
    const path = parseAutocomplete(node.sig.autocomplete);
    if (path === null) return null;
    return {
      path,
      base: SCORE.autocomplete,
      source: 'autocomplete',
      evidence: node.sig.autocomplete,
    };
  }

  /**
   * Tier 4 — 90. The label IS a synonym.
   *
   * "Exactly" is judged three ways, all of which mean the label asks precisely this question:
   *   - equal after normalization ("Given name" = "given name");
   *   - equal after de-noising ("Please enter your Given Name *" = "given name");
   *   - equal in {@link compactText} form, which ignores word boundaries entirely so the brand
   *     casing in "LinkedIn Profile" still equals the alias "linkedin profile".
   *
   * Plus one deliberate extension: a LONG alias phrase (≥ 5 tokens) occurring verbatim inside the
   * label also counts as exact. Real screening questions carry qualifiers — "Are you legally
   * authorized to work" arrives as "Are you legally authorized to work *in the United States*" —
   * and the trailing clause narrows the question rather than changing it. A phrase that long is
   * far too specific to collide by accident, so this cannot promote a weak match.
   */
  private tierExactLabel(view: SignatureView): TierHit | null {
    if (view.labelNorm.length === 0) return null;

    let winner: AliasEntry | null = null;
    for (const entry of this.aliases) {
      const exact =
        entry.norm === view.labelNorm ||
        entry.norm === view.labelDenoised ||
        (entry.compact.length > 0 &&
          (entry.compact === view.labelCompact || entry.compact === view.labelDenoisedCompact));

      const longPhrase =
        !exact &&
        entry.tokens.length >= EXACT_PHRASE_MIN_TOKENS &&
        (containsTokenSequence(view.labelTokens, entry.tokens) ||
          containsTokenSequence(view.labelDenoised.split(' '), entry.tokens));

      if (!exact && !longPhrase) continue;
      if (winner === null || moreSpecific(entry, winner)) winner = entry;
    }
    if (winner === null) return null;
    return {
      path: winner.path,
      base: SCORE.exactLabelSynonym,
      source: 'heuristic',
      evidence: `label = "${winner.alias}"`,
    };
  }

  /**
   * Tier 5 — 75. A synonym appears in the `name`/`id` token stream (`fname`, `applicant_first`).
   *
   * `name`/`id` ONLY — the label deliberately does not participate. SEC 6.3 grades an *exact*
   * label synonym at 90 and anything looser as fuzzy at 55; letting a label that merely contains
   * a synonym score 75 here would collapse two tiers into one and let "Frist name" outrank a
   * genuine identifier hit.
   */
  private tierIdentifierTokens(view: SignatureView): TierHit | null {
    const hit = this.bestTokenAlias(view.identifierTokens);
    if (hit === null) return null;
    return {
      path: hit.path,
      base: SCORE.tokenSynonym,
      source: 'heuristic',
      evidence: `name/id ⊇ "${hit.alias}"`,
    };
  }

  /** Tier 6 — 65. A synonym appears in the placeholder or the ARIA label. */
  private tierPlaceholderAria(view: SignatureView): TierHit | null {
    const hit = this.bestTokenAlias(view.hintTokens);
    if (hit === null) return null;
    return {
      path: hit.path,
      base: SCORE.placeholderSynonym,
      source: 'heuristic',
      evidence: `placeholder/aria ⊇ "${hit.alias}"`,
    };
  }

  /**
   * Tier 7 — 55. Jaro-Winkler ≥ .88 against the label or the identifier, comparing both the whole
   * string and every same-width token window (so "Your Frist Name *" still finds "first name").
   *
   * Generic single-word aliases are excluded from the windowed comparison — otherwise the window
   * "name" inside "Company Name" would score 1.0 against the alias "name".
   */
  private tierFuzzy(view: SignatureView): TierHit | null {
    let winner: { entry: AliasEntry; similarity: number } | null = null;

    for (const entry of this.aliases) {
      // Whole-string comparison only for generic and very short aliases. Jaro-Winkler on a 3–4
      // character string is dominated by its prefix bonus, so windowing "land" (Country, de) over
      // "I accept the terms and conditions" finds "and" at 0.92 and confidently offers to fill a
      // consent checkbox with a country. Long aliases do not have that failure mode.
      const wholeStringOnly = entry.generic || entry.norm.length < FUZZY_MIN_ALIAS_LENGTH;
      const similarity = wholeStringOnly
        ? Math.max(
            jaroWinkler(view.labelDenoised, entry.norm),
            jaroWinkler(view.identifierNorm, entry.norm),
          )
        : Math.max(
            bestPhraseSimilarity(view.labelNorm, entry.norm),
            bestPhraseSimilarity(view.identifierNorm, entry.norm),
          );

      if (similarity < FUZZY_MIN_SIMILARITY) continue;
      if (
        winner === null ||
        similarity > winner.similarity ||
        (similarity === winner.similarity && moreSpecific(entry, winner.entry))
      ) {
        winner = { entry, similarity };
      }
    }

    if (winner === null) return null;
    return {
      path: winner.entry.path,
      base: SCORE.fuzzy,
      source: 'heuristic',
      evidence: `~"${winner.entry.alias}" (jw ${winner.similarity.toFixed(3)})`,
    };
  }

  /**
   * Most specific alias whose tokens occur consecutively in any of the supplied token streams.
   *
   * Plain containment, as SEC 6.3 requires — its worked example is `applicant_first` scoring 75 on
   * the one-token alias "first". Correctness here rests entirely on `moreSpecific`: `last_name`
   * matches both "last name" (2 tokens) and "name" (1 token), and the longer alias wins, so the
   * applicant's surname lands in the surname field rather than their full name.
   *
   * A generic one-word alias buried in a long identifier is weak evidence, though, so those are
   * only honoured in short streams — "first" inside `applicant_first` counts, "title" inside
   * `page_header_title_container_label` does not.
   */
  private bestTokenAlias(...streams: ReadonlyArray<readonly string[]>): AliasEntry | null {
    const usable = streams.filter((stream) => stream.length > 0);
    if (usable.length === 0) return null;

    let winner: AliasEntry | null = null;
    for (const entry of this.aliases) {
      const hit = usable.some((stream) => {
        if (entry.generic && stream.length > GENERIC_ALIAS_STREAM_LIMIT) return false;
        return containsTokenSequence(stream, entry.tokens);
      });
      if (!hit) continue;
      if (winner === null || moreSpecific(entry, winner)) winner = entry;
    }
    return winner;
  }

  /** Can the active profile actually answer this path? */
  private hasValue(path: ProfilePath): boolean {
    const profile = this.ctx.profile;
    if (!profile) return true; // no profile supplied ⇒ do not second-guess the score
    const value = resolveProfileValue(profile, path, { country: this.ctx.country ?? undefined });
    return !isEmptyValue(value);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Signature views & form scoping
 * ---------------------------------------------------------------------------------------------- */

/** Leading/trailing phrasing that carries no meaning for matching. */
function denoiseLabel(normalized: string): string {
  let out = normalized;
  out = out.replace(
    /^(?:please\s+)?(?:enter|provide|input|type|select|choose|specify|state|share|upload|tell us|what is|what s|whats|what are|do you have)\s+/,
    '',
  );
  out = out.replace(/^(?:your|the|a|an|my)\s+/, '');
  // "Applicant First Name" and "Candidate Email" are the same question as "First Name" / "Email".
  out = out.replace(/^(?:applicant|candidate|employee)\s+(?=\S)/, '');
  out = out.replace(/\s+(?:optional|required|mandatory|if any|if applicable|please)$/, '');
  return out.trim();
}

function viewOf(sig: FieldSignature): SignatureView {
  const labelNorm = normalizeText(sig.label);
  const labelDenoised = denoiseLabel(labelNorm);
  const identifierNorm = normalizeText(`${sig.name} ${sig.id}`);
  const hintNorm = normalizeText(`${sig.placeholder} ${sig.ariaLabel}`);

  return {
    labelNorm,
    labelDenoised,
    labelCompact: compactText(labelNorm),
    labelDenoisedCompact: compactText(labelDenoised),
    labelTokens: labelNorm.length === 0 ? [] : labelNorm.split(' '),
    identifierNorm,
    identifierTokens: identifierNorm.length === 0 ? [] : identifierNorm.split(' '),
    hintTokens: hintNorm.length === 0 ? [] : hintNorm.split(' '),
  };
}

/**
 * Scope key for the −30 duplicate modifier: the owning `<form>` when there is one, otherwise the
 * frame. Two forms on one page each get their own consumed-path set.
 */
const formScopeIds = new WeakMap<Element, string>();
let formScopeCounter = 0;

function formKeyOf(node: FieldNode): string {
  const el = elementOf(node.el);
  if (el !== null && typeof el.closest === 'function') {
    try {
      const form = el.closest('form');
      if (form !== null) {
        let id = formScopeIds.get(form);
        if (id === undefined) {
          id = `form#${++formScopeCounter}`;
          formScopeIds.set(form, id);
        }
        return `${node.sig.frameId}::${id}`;
      }
    } catch {
      /* ignore */
    }
  }
  return `${node.sig.frameId}::document`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

/* ------------------------------------------------------------------------------------------------
 * Profile path resolution
 * ---------------------------------------------------------------------------------------------- */

export interface ResolveValueOptions {
  /**
   * ISO-3166 alpha-2 of the country the form is for. Disambiguates the work-authorization
   * questions ("do you require sponsorship?" means "…in *this* country").
   */
  country?: string;
}

/**
 * Parse a SEC 6.2 profile path into traversal segments.
 * `"work[0].title"` → `['work', 0, 'title']`; `"needsSponsorship.US"` → `['needsSponsorship','US']`.
 */
export function parseProfilePath(path: ProfilePath): Array<string | number> {
  const segments: Array<string | number> = [];
  const pattern = /[^.[\]]+|\[(\d+)\]/g;
  let match: RegExpExecArray | null = pattern.exec(path);

  while (match !== null) {
    const index = match[1];
    if (index !== undefined) {
      segments.push(Number.parseInt(index, 10));
    } else {
      const key = match[0];
      // A bare numeric dot-segment ("answers.0.a") is an array index.
      segments.push(/^\d+$/.test(key) ? Number.parseInt(key, 10) : key);
    }
    match = pattern.exec(path);
  }
  return segments;
}

/**
 * Read a value out of the vault by path (SEC 6.2: "dot path into vault").
 *
 * Beyond literal traversal it resolves the three VIRTUAL paths the synonym dictionary needs, none
 * of which are keys of the `Profile` object:
 *
 *   `personal.fullName`            → firstName + ' ' + lastName
 *   `answers.<slug>`               → best entry in `profile.answers[]` for that canonical question
 *   `authorization.authorizedIn`   → boolean ("are you authorized to work [here]?")
 *   `authorization.needsSponsorship` → boolean ("will you require sponsorship?")
 *
 * The two authorization paths are the ones every ATS asks as a Yes/No, while the vault stores them
 * per country. With a `country` hint the answer is exact; without one the resolution is documented
 * and deterministic rather than a guess — see the comments at each site.
 */
export function resolveProfileValue(
  profile: Profile,
  path: ProfilePath,
  options: ResolveValueOptions = {},
): unknown {
  if (path.length === 0) return undefined;

  if (path === 'personal.fullName') {
    const first = profile.personal.firstName.trim();
    const last = profile.personal.lastName.trim();
    const full = `${first} ${last}`.trim();
    return full.length > 0 ? full : undefined;
  }

  if (path === 'authorization.authorizedIn') {
    const authorized = profile.authorization.authorizedIn;
    if (!Array.isArray(authorized) || authorized.length === 0) return undefined;
    const country = normalizeCountryCode(options.country);
    // With a hint: exactly whether the applicant may already work there.
    // Without one: authorized somewhere ⇒ the honest generic answer to "are you authorized to
    // work?" on a form that has not said where.
    return country === null ? true : authorized.includes(country);
  }

  if (path === 'authorization.needsSponsorship') {
    return resolveSponsorship(profile, options.country);
  }

  if (path.startsWith('answers.')) {
    const answer = resolveAnswerPath(profile, path);
    if (answer !== undefined) return answer;
    // Fall through: "answers.0.a" is a legitimate literal path.
  }

  const segments = parseProfilePath(path);
  let current: unknown = profile;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }

    if (Array.isArray(current)) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * "Will you now or in the future require sponsorship?"
 *
 * With a country hint, answer for that country. Without one, answer for the first country the
 * applicant has recorded that they are NOT already authorized to work in — that is the only entry
 * the question can be about. If every recorded country is one they may already work in, the answer
 * is `false`.
 */
function resolveSponsorship(profile: Profile, countryHint?: string): boolean | undefined {
  const record = profile.authorization.needsSponsorship;
  if (record === null || typeof record !== 'object') return undefined;

  const entries = Object.entries(record).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
  );
  if (entries.length === 0) return undefined;

  const hint = normalizeCountryCode(countryHint);
  if (hint !== null) {
    for (const [code, needs] of entries) {
      if (normalizeCountryCode(code) === hint) return needs;
    }
    return undefined;
  }

  if (entries.length === 1) return entries[0]?.[1];

  const authorized = new Set(
    (profile.authorization.authorizedIn ?? [])
      .map((code) => normalizeCountryCode(code))
      .filter((code): code is string => code !== null),
  );
  for (const [code, needs] of entries) {
    const normalized = normalizeCountryCode(code);
    if (normalized !== null && !authorized.has(normalized)) return needs;
  }
  return false;
}

/** Any spelling of a country → its ISO alpha-2, or `null`. */
function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const record = lookupCountry(value);
  if (record !== null) return record.code;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

/** Best entry in `profile.answers[]` for an `answers.<slug>` virtual path. */
function resolveAnswerPath(profile: Profile, path: ProfilePath): string | undefined {
  const canonical = QUESTION_PATHS[path];
  if (canonical === undefined) return undefined;
  if (!Array.isArray(profile.answers) || profile.answers.length === 0) return undefined;

  const questions = [canonical, ...(SYNONYMS[path] ?? [])];

  let best: { answer: string; similarity: number } | null = null;
  for (const entry of profile.answers) {
    if (typeof entry?.a !== 'string' || entry.a.trim().length === 0) continue;
    for (const question of questions) {
      const similarity = textSimilarity(entry.q, question);
      if (best === null || similarity > best.similarity) {
        best = { answer: entry.a, similarity };
      }
    }
  }

  // SIMILAR_Q (SEC 5.7) is the repo-wide floor for "close enough to reuse this answer".
  return best !== null && best.similarity >= SIMILAR_Q ? best.answer : undefined;
}

/** Empty for fill purposes: undefined, null, '', [], or a whitespace-only string. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return !Number.isFinite(value);
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Value formatting (SEC 6.4 — "Country/state values normalized")
 * ---------------------------------------------------------------------------------------------- */

/** Coerce a profile value to yes/no, or `null` when it is not a boolean question. */
export function toBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const normalized = normalizeText(value);
  if (normalized.length === 0) return null;
  if (/^(?:yes|y|true|1|agree|i agree|accept|affirmative)$/.test(normalized)) return true;
  if (/^(?:no|n|false|0|disagree|decline|negative)$/.test(normalized)) return false;
  return null;
}

const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Every spelling of a profile value an ATS control might accept, in preference order.
 *
 * SEC 6.4 requires this for `<select>` and combobox fills: "Country/state values normalized
 * ('USA' ≈ 'United States' ≈ 'US')". The FillEngine walks the list until an option matches; a
 * plain text input takes element 0.
 *
 * `path` is optional but sharpens the decision — with it, `"CA"` under
 * `personal.address.state` is California, and under `personal.address.country` it is Canada.
 */
export function candidateValuesForField(
  value: unknown,
  sig: FieldSignature,
  path?: ProfilePath,
): string[] {
  if (value === null || value === undefined) return [];

  if (typeof value === 'boolean') {
    return value ? [...AFFIRMATIVE_VALUES] : [...NEGATIVE_VALUES];
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return [];
    const plain = String(value);
    const grouped = value.toLocaleString('en-US');
    return grouped === plain ? [plain] : [plain, grouped];
  }

  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (items.length === 0) return [];
    // Multi-selects want the items; a text field wants them joined.
    return sig.inputType === 'select' || sig.inputType === 'combobox'
      ? [...items, items.join(', ')]
      : [items.join(', '), ...items];
  }

  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (text.length === 0) return [];

  const wantsOptions =
    sig.inputType === 'select' || sig.inputType === 'combobox' || sig.inputType === 'radio';

  /* ---- countries -------------------------------------------------------------------------- */
  const isCountryPath = path !== undefined && /(?:^|\.)country$/.test(path);
  if (isCountryPath || (path === undefined && wantsOptions)) {
    const country = lookupCountry(text);
    if (country !== null && (isCountryPath || text.length <= 3)) {
      return dedupe(countryVariants(country));
    }
  }

  /* ---- states / provinces ------------------------------------------------------------------ */
  const isStatePath = path !== undefined && /(?:^|\.)state$/.test(path);
  if (isStatePath) {
    const subdivision = lookupSubdivision(text);
    if (subdivision !== null) return dedupe(subdivisionVariants(subdivision));
  }

  /* ---- enums -------------------------------------------------------------------------------- */
  const key = text.toLowerCase();
  if (path === 'authorization.remotePreference' || (path === undefined && wantsOptions)) {
    const variants = REMOTE_PREFERENCE_VALUES[key];
    if (variants !== undefined) return dedupe([...variants]);
  }
  if (path === 'compensation.expected.period' || (path === undefined && wantsOptions)) {
    const variants = COMPENSATION_PERIOD_VALUES[key];
    if (variants !== undefined) return dedupe([...variants]);
  }

  /* ---- dates -------------------------------------------------------------------------------- */
  const yearMonth = YEAR_MONTH.exec(text);
  if (yearMonth !== null) {
    const [, year, month] = yearMonth;
    if (year !== undefined && month !== undefined) {
      if (sig.inputType === 'date') return [`${year}-${month}-01`];
      return dedupe([
        `${month}/${year}`,
        `${year}-${month}`,
        `${monthName(month)} ${year}`,
        `${month}/01/${year}`,
      ]);
    }
  }

  const isoDate = ISO_DATE.exec(text);
  if (isoDate !== null) {
    const [, year, month, day] = isoDate;
    if (year !== undefined && month !== undefined && day !== undefined) {
      if (sig.inputType === 'date') return [text];
      return dedupe([`${month}/${day}/${year}`, `${day}/${month}/${year}`, text]);
    }
  }

  /* ---- yes/no written as text --------------------------------------------------------------- */
  if (wantsOptions) {
    const boolish = toBooleanish(text);
    if (boolish !== null) {
      return boolish ? dedupe([text, ...AFFIRMATIVE_VALUES]) : dedupe([text, ...NEGATIVE_VALUES]);
    }
  }

  return [text];
}

/**
 * The single string to write into a field: `candidateValuesForField(...)[0]`, or `''`.
 * Booleans become "Yes"/"No"; a country becomes its display name; a "YYYY-MM" becomes the shape
 * the control expects.
 */
export function formatValueForField(
  value: unknown,
  sig: FieldSignature,
  path?: ProfilePath,
): string {
  return candidateValuesForField(value, sig, path)[0] ?? '';
}

const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthName(month: string): string {
  const index = Number.parseInt(month, 10) - 1;
  return MONTH_NAMES[index] ?? month;
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Module-level convenience
 * ---------------------------------------------------------------------------------------------- */

/** One-shot match with default context. */
export function matchFields(
  nodes: readonly FieldNode[],
  context: FieldMatcherContext = {},
): MatchResult[] {
  return new FieldMatcher(context).match(nodes);
}

/** Every path the matcher can produce, for the "map this field" picker. */
export function knownProfilePaths(): ProfilePath[] {
  return Object.keys(SYNONYMS);
}
