/**
 * ai/humanize.ts — the SEC 5.5 post-pass.
 *
 * "A post-pass scans for AI-tell phrases and triggers one automatic rewrite if found."
 *
 * Two things live here and nothing else:
 *   1. `detectAiTells()` — a pure, synchronous, dependency-free detector. It is exported on its own
 *      precisely so it can be unit-tested against fixture answers without a network or a key.
 *   2. `humanizeAnswer()` — the ONE-shot rewrite orchestrator. It takes the rewrite as a callback
 *      so this module never imports a prompt template or the Gemini client (no cycles, and the
 *      detector stays usable from a test, from the options page, and from the service worker).
 *
 * The phrase lists are also consumed by `prompts/screening_answer.ts` and
 * `prompts/cover_letter.ts`, so the ban list in the prompt and the detector that polices the
 * output can never drift apart.
 */

/* ------------------------------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------------------------------- */

/**
 * Openers SEC 5.5 bans outright. These are quoted into the prompt verbatim and matched against the
 * output — a generated answer that starts with one of them is rewritten, no exceptions.
 */
export const BOILERPLATE_OPENERS: readonly string[] = [
  'I am writing to express',
  'I am writing to apply',
  'I am thrilled',
  'I am excited to apply',
  'I am excited about the opportunity',
  'I am reaching out',
  'I would like to express my interest',
  'It is with great enthusiasm',
  'I am delighted',
  'Please accept this',
];

/**
 * Words that are fine once and fatal in a row. `detectAiTells` flags a *chain* — three or more of
 * these inside one sentence — rather than any single occurrence, because "scalable" is a real word
 * that a backend engineer legitimately uses.
 */
export const BUZZWORDS: readonly string[] = [
  'best-in-class',
  'bleeding-edge',
  'cutting-edge',
  'detail-oriented',
  'dynamic',
  'ever-evolving',
  'fast-paced',
  'game-changing',
  'go-getter',
  'holistic',
  'impactful',
  'innovative',
  'leverage',
  'mission-critical',
  'next-generation',
  'paradigm',
  'proactive',
  'results-driven',
  'robust',
  'scalable',
  'seamless',
  'self-starter',
  'state-of-the-art',
  'synergy',
  'synergies',
  'team player',
  'thought leader',
  'value-add',
  'world-class',
];

export type AiTellSeverity = 'hard' | 'soft';

export interface AiTellRule {
  id: string;
  label: string;
  severity: AiTellSeverity;
  pattern: RegExp;
}

export interface AiTell {
  id: string;
  label: string;
  severity: AiTellSeverity;
  /** The exact text that tripped the rule, for the rewrite prompt and for tests. */
  sample: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `\b` does not work next to a hyphen, so buzzword boundaries are spelled out. */
function phrasePattern(phrase: string): RegExp {
  return new RegExp('(?<![\\w-])' + escapeRegExp(phrase) + '(?![\\w-])', 'i');
}

const OPENER_RULES: readonly AiTellRule[] = BOILERPLATE_OPENERS.map((phrase) => ({
  id: 'opener:' + phrase.toLowerCase().replace(/[^a-z]+/g, '-'),
  label: 'Boilerplate opener "' + phrase + '"',
  severity: 'hard' as const,
  pattern: phrasePattern(phrase),
}));

/**
 * Phrases that read as machine-written to a recruiter. Every one of these has been observed in
 * unedited flash-class output; `hard` means "always rewrite", `soft` means "rewrite if it is not
 * alone".
 */
export const PHRASE_RULES: readonly AiTellRule[] = [
  { id: 'delve', label: '"delve into"', severity: 'hard', pattern: /\bdelv(?:e|ing|ed)\b/i },
  { id: 'tapestry', label: '"tapestry"', severity: 'hard', pattern: /\btapestry\b/i },
  {
    id: 'fast-paced-world',
    label: '"in today\'s fast-paced / ever-evolving …"',
    severity: 'hard',
    pattern: /in today['’]s\s+(?:fast-paced|ever-(?:evolving|changing)|dynamic|digital)/i,
  },
  {
    id: 'proven-track-record',
    label: '"a proven track record"',
    severity: 'hard',
    pattern: /\ba proven track record\b/i,
  },
  {
    id: 'perfect-fit',
    label: '"perfect fit" / "ideal candidate"',
    severity: 'hard',
    pattern: /\b(?:perfect fit|ideal candidate|perfect candidate)\b/i,
  },
  {
    id: 'wealth-of-experience',
    label: '"a wealth of experience"',
    severity: 'hard',
    pattern: /\ba wealth of (?:experience|knowledge)\b/i,
  },
  {
    id: 'leverage-my',
    label: '"leverage my skills / expertise"',
    severity: 'hard',
    pattern: /\bleverage (?:my|the|their|your)\s+\w+/i,
  },
  {
    id: 'passionate-about',
    label: '"deeply passionate about"',
    severity: 'hard',
    pattern: /\b(?:deeply|truly|incredibly)\s+passionate about\b/i,
  },
  {
    id: 'align-with',
    label: '"aligns perfectly with"',
    severity: 'hard',
    pattern: /\baligns?\s+(?:perfectly|seamlessly|closely)\s+with\b/i,
  },
  {
    id: 'testament',
    label: '"a testament to"',
    severity: 'hard',
    pattern: /\ba testament to\b/i,
  },
  {
    id: 'navigate-complexities',
    label: '"navigate the complexities"',
    severity: 'hard',
    pattern: /\bnavigat(?:e|ing) the (?:complexities|intricacies|landscape)\b/i,
  },
  {
    id: 'not-only-but-also',
    label: '"not only … but also"',
    severity: 'soft',
    pattern: /\bnot only\b[^.!?]{0,80}\bbut also\b/i,
  },
  {
    id: 'furthermore',
    label: '"furthermore" / "moreover"',
    severity: 'soft',
    pattern: /\b(?:furthermore|moreover|additionally,)\b/i,
  },
  {
    id: 'in-conclusion',
    label: '"in conclusion"',
    severity: 'soft',
    pattern: /\bin conclusion\b/i,
  },
  {
    id: 'utilize',
    label: '"utilize" (just say "use")',
    severity: 'soft',
    pattern: /\butiliz(?:e|es|ed|ing|ation)\b|\butilis(?:e|es|ed|ing|ation)\b/i,
  },
  {
    id: 'plethora',
    label: '"a plethora / myriad of"',
    severity: 'soft',
    pattern: /\b(?:a plethora of|a myriad of|myriad)\b/i,
  },
  {
    id: 'realm',
    label: '"in the realm of"',
    severity: 'soft',
    pattern: /\bin the realm of\b/i,
  },
  {
    id: 'pivotal',
    label: '"pivotal role"',
    severity: 'soft',
    pattern: /\bpivotal role\b/i,
  },
  {
    id: 'meticulous',
    label: '"meticulous"',
    severity: 'soft',
    pattern: /\bmeticulous(?:ly)?\b/i,
  },
  {
    id: 'hit-the-ground-running',
    label: '"hit the ground running"',
    severity: 'soft',
    pattern: /\bhit the ground running\b/i,
  },
  {
    id: 'as-an-ai',
    label: 'model self-reference',
    severity: 'hard',
    pattern: /\b(?:as an ai|as a language model|i am an ai)\b/i,
  },
  {
    id: 'placeholder-bracket',
    label: 'unfilled placeholder',
    severity: 'hard',
    pattern: /\[[^\]\n]{2,40}\]|\{\{[^}\n]{1,40}\}\}|<[A-Za-z][^>\n]{1,40}>/,
  },
];

const ALL_PHRASE_RULES: readonly AiTellRule[] = [...OPENER_RULES, ...PHRASE_RULES];

/* ------------------------------------------------------------------------------------------------
 * Text measurement
 * ---------------------------------------------------------------------------------------------- */

export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches === null ? 0 : matches.length;
}

/** Sentence split good enough for prose: terminators followed by whitespace, plus hard newlines. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'‘“])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function countSentences(text: string): number {
  return splitSentences(text).length;
}

/** Population standard deviation of per-sentence word counts. Low value = machine rhythm. */
export function sentenceLengthSpread(text: string): number {
  const lengths = splitSentences(text).map(countWords).filter((n) => n > 0);
  if (lengths.length < 2) return Number.POSITIVE_INFINITY;
  const mean = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
  const variance = lengths.reduce((sum, n) => sum + (n - mean) * (n - mean), 0) / lengths.length;
  return Math.sqrt(variance);
}

/** `[Company Name]`, `{{role}}`, `<your name>` — a cover letter must never ship one (SEC 5.5). */
export function findPlaceholderBrackets(text: string): string[] {
  const found = text.match(/\[[^\]\n]{2,40}\]|\{\{[^}\n]{1,40}\}\}|<[A-Za-z][^>\n]{1,40}>/g);
  return found === null ? [] : found;
}

export function containsPlaceholderBrackets(text: string): boolean {
  return findPlaceholderBrackets(text).length > 0;
}

/* ------------------------------------------------------------------------------------------------
 * The detector
 * ---------------------------------------------------------------------------------------------- */

const BUZZWORD_MATCHERS: ReadonlyArray<{ word: string; pattern: RegExp }> = BUZZWORDS.map(
  (word) => ({ word, pattern: phrasePattern(word) }),
);

/** Three or more buzzwords inside one sentence is the "buzzword chain" SEC 5.5 bans. */
function detectBuzzwordChains(text: string): AiTell[] {
  const tells: AiTell[] = [];
  for (const sentence of splitSentences(text)) {
    const hits: string[] = [];
    for (const matcher of BUZZWORD_MATCHERS) {
      if (matcher.pattern.test(sentence)) hits.push(matcher.word);
    }
    if (hits.length >= 3) {
      tells.push({
        id: 'buzzword-chain',
        label: 'Buzzword chain (' + hits.slice(0, 5).join(', ') + ')',
        severity: 'hard',
        sample: sentence,
      });
      break;
    }
  }
  return tells;
}

export interface DetectOptions {
  /** Word ceiling for this length preset; exceeding it is a hard tell. */
  maxWords?: number;
  /** Sentence range the template asked for. */
  minSentences?: number;
  maxSentences?: number;
  /** Turn off the rhythm heuristic (cover letters are longer and legitimately even). */
  checkRhythm?: boolean;
}

/**
 * Scan a generated answer for the things that make a recruiter's eyes glaze over.
 * Pure, synchronous, and exported on its own so it is trivially testable (SEC 5.5 post-pass).
 */
export function detectAiTells(text: string, options: DetectOptions = {}): AiTell[] {
  const tells: AiTell[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return tells;

  for (const rule of ALL_PHRASE_RULES) {
    const match = rule.pattern.exec(trimmed);
    if (match !== null) {
      tells.push({
        id: rule.id,
        label: rule.label,
        severity: rule.severity,
        sample: match[0],
      });
    }
  }

  tells.push(...detectBuzzwordChains(trimmed));

  const words = countWords(trimmed);
  const sentences = countSentences(trimmed);

  if (options.maxWords !== undefined && words > options.maxWords) {
    tells.push({
      id: 'too-long',
      label: 'Over the ' + String(options.maxWords) + '-word limit (' + String(words) + ')',
      severity: 'hard',
      sample: String(words) + ' words',
    });
  }
  if (options.maxSentences !== undefined && sentences > options.maxSentences) {
    tells.push({
      id: 'too-many-sentences',
      label:
        'More than ' + String(options.maxSentences) + ' sentences (' + String(sentences) + ')',
      severity: 'hard',
      sample: String(sentences) + ' sentences',
    });
  }
  if (options.minSentences !== undefined && sentences < options.minSentences) {
    tells.push({
      id: 'too-few-sentences',
      label: 'Fewer than ' + String(options.minSentences) + ' sentences',
      severity: 'hard',
      sample: String(sentences) + ' sentences',
    });
  }

  if (options.checkRhythm !== false && sentences >= 3 && sentenceLengthSpread(trimmed) < 2) {
    tells.push({
      id: 'monotone-rhythm',
      label: 'Every sentence is the same length',
      severity: 'soft',
      sample: 'sentence-length spread ' + sentenceLengthSpread(trimmed).toFixed(1),
    });
  }

  return tells;
}

export function hasAiTells(text: string, options: DetectOptions = {}): boolean {
  return detectAiTells(text, options).length > 0;
}

/**
 * The rewrite trigger: one hard tell, or two soft ones. A single "utilize" is not worth a second
 * Gemini call — free-tier quota is the scarce resource here (SEC 5.4).
 */
export function shouldRewrite(tells: readonly AiTell[]): boolean {
  let soft = 0;
  for (const tell of tells) {
    if (tell.severity === 'hard') return true;
    soft += 1;
  }
  return soft >= 2;
}

/* ------------------------------------------------------------------------------------------------
 * The one-shot rewrite
 * ---------------------------------------------------------------------------------------------- */

export interface HumanizeResult {
  /** The text to actually use. */
  text: string;
  /** `true` when the rewrite ran AND its output was better, so it replaced the draft. */
  rewritten: boolean;
  /** Tells present in `text` (i.e. after the decision). */
  tells: AiTell[];
  /** Tells present in the original draft — useful for the "why was this rewritten" affordance. */
  initialTells: AiTell[];
}

/** `null` ⇒ the rewrite could not be produced (quota, network); the draft is kept as-is. */
export type RewriteFn = (draft: string, tells: readonly AiTell[]) => Promise<string | null>;

/**
 * Run the detector; if it trips, spend exactly ONE more generation on a rewrite and keep whichever
 * version scores better. Never loops — a second failed rewrite would double the quota cost of every
 * answer for a marginal gain (SEC 5.6 keeps the budget honest).
 */
export async function humanizeAnswer(
  draft: string,
  rewrite: RewriteFn,
  options: DetectOptions = {},
): Promise<HumanizeResult> {
  const initialTells = detectAiTells(draft, options);
  if (!shouldRewrite(initialTells)) {
    return { text: draft, rewritten: false, tells: initialTells, initialTells };
  }

  let candidate: string | null = null;
  try {
    candidate = await rewrite(draft, initialTells);
  } catch {
    candidate = null;
  }

  if (candidate === null || candidate.trim().length === 0) {
    return { text: draft, rewritten: false, tells: initialTells, initialTells };
  }

  const candidateTells = detectAiTells(candidate, options);
  if (score(candidateTells) < score(initialTells)) {
    return { text: candidate.trim(), rewritten: true, tells: candidateTells, initialTells };
  }
  return { text: draft, rewritten: false, tells: initialTells, initialTells };
}

/** Hard tells count triple, so a rewrite that trades one hard tell for two soft ones still wins. */
function score(tells: readonly AiTell[]): number {
  let total = 0;
  for (const tell of tells) total += tell.severity === 'hard' ? 3 : 1;
  return total;
}
