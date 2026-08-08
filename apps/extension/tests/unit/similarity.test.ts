/**
 * tests/unit/similarity.test.ts — JF-001 Rev 3.0 SEC 11 (Unit).
 *
 * `core/similarity.ts` is policy-free string math, but two policy numbers are applied to its
 * output everywhere else in the system and it is the behaviour *at those boundaries* that this
 * file pins down:
 *
 *   SEC 6.3   `FUZZY_MIN_SIMILARITY` = 0.88 — the Jaro-Winkler floor of the matcher's fuzzy tier.
 *   SEC 5.7   `SAME_Q` = 0.92 / `SIMILAR_Q` = 0.75 — the Jaccard bands of the Answer Bank.
 *
 * A drift of a hundredth in either metric silently moves fields between `fill`, `suggest` and
 * `skip` (INV-4) and moves banked answers between "reuse it" and "spend a key on it". The
 * textbook Jaro/Jaro-Winkler vectors below (MARTHA/MARHTA, DIXON/DICKSONX, CRATE/TRACE) are the
 * canary: if they move, the implementation changed, not the thresholds.
 */

import { describe, expect, it } from 'vitest';

import { FUZZY_MIN_SIMILARITY, SAME_Q, SIMILAR_Q } from '@/shared/constants';
import {
  bestPhraseSimilarity,
  compactText,
  containsPhrase,
  jaccardBigrams,
  jaccardTokenSet,
  jaro,
  jaroWinkler,
  normalizeText,
  normalizedJaroWinkler,
  textSimilarity,
  tokenSet,
  tokenize,
} from '@/core/similarity';

describe('normalization', () => {
  it('splits compound identifiers into a comparable token stream', () => {
    expect(normalizeText('applicantFirstName')).toBe('applicant first name');
    expect(normalizeText('applicant_first_name')).toBe('applicant first name');
    expect(normalizeText('applicant-first-name')).toBe('applicant first name');
    expect(normalizeText('Applicant First Name')).toBe('applicant first name');
  });

  it('folds accents so "Prénom" and "Prenom" compare equal', () => {
    expect(normalizeText('Prénom')).toBe(normalizeText('Prenom'));
    expect(jaroWinkler(normalizeText('Prénom'), normalizeText('Prenom'))).toBe(1);
  });

  it('compactText ignores word boundaries so brand casing survives', () => {
    expect(compactText('LinkedIn Profile')).toBe('linkedinprofile');
    expect(compactText('linkedin profile')).toBe('linkedinprofile');
    // normalizeText deliberately does NOT agree here — that is why compactText exists.
    expect(normalizeText('LinkedIn Profile')).toBe('linked in profile');
  });

  it('is total: empty input never throws and never yields NaN', () => {
    expect(normalizeText('')).toBe('');
    expect(tokenize('')).toEqual([]);
    expect(tokenSet('').size).toBe(0);
    expect(jaro('', '')).toBe(0);
    expect(jaroWinkler('', 'first name')).toBe(0);
    expect(jaccardTokenSet('', '')).toBe(0);
    expect(textSimilarity('', '')).toBe(0);
  });
});

describe('Jaro / Jaro-Winkler — the textbook vectors', () => {
  it('MARTHA/MARHTA: jaro 0.944, jaro-winkler 0.961', () => {
    expect(jaro('martha', 'marhta')).toBeCloseTo(0.944, 3);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
  });

  it('DIXON/DICKSONX: jaro 0.767, jaro-winkler 0.813', () => {
    expect(jaro('dixon', 'dicksonx')).toBeCloseTo(0.767, 3);
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.813, 3);
  });

  it('CRATE/TRACE: no shared prefix, so Winkler adds nothing', () => {
    expect(jaro('crate', 'trace')).toBeCloseTo(0.733, 3);
    expect(jaroWinkler('crate', 'trace')).toBeCloseTo(0.733, 3);
  });

  it('is symmetric and bounded to [0, 1]', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['first name', 'frist name'],
      ['linkedin profile', 'github profile'],
      ['country', 'county'],
      ['', 'anything'],
    ];
    for (const [a, b] of pairs) {
      const forward = jaroWinkler(a, b);
      expect(jaroWinkler(b, a)).toBeCloseTo(forward, 12);
      expect(forward).toBeGreaterThanOrEqual(0);
      expect(forward).toBeLessThanOrEqual(1);
    }
  });
});

describe('SEC 6.3 — behaviour at the 0.88 fuzzy floor', () => {
  it('a single-character site typo clears the floor', () => {
    // "Your Frist Name *" is the case the doc calls out; the windowed comparison finds it.
    const similarity = bestPhraseSimilarity('Your Frist Name *', 'first name');
    expect(similarity).toBeGreaterThanOrEqual(FUZZY_MIN_SIMILARITY);
  });

  it('a genuinely different label does NOT clear the floor', () => {
    expect(bestPhraseSimilarity('Company Name', 'first name')).toBeLessThan(FUZZY_MIN_SIMILARITY);
    expect(bestPhraseSimilarity('Referral source', 'first name')).toBeLessThan(FUZZY_MIN_SIMILARITY);
  });

  it('windowing is what makes the floor usable — the end-to-end comparison alone would miss', () => {
    const whole = normalizedJaroWinkler('Your Frist Name *', 'first name');
    const windowed = bestPhraseSimilarity('Your Frist Name *', 'first name');
    expect(whole).toBeLessThan(FUZZY_MIN_SIMILARITY);
    expect(windowed).toBeGreaterThan(whole);
  });

  it('an exact phrase anywhere in the label scores 1', () => {
    expect(bestPhraseSimilarity('Legal first name (as on passport)', 'first name')).toBe(1);
    expect(containsPhrase('Legal first name (as on passport)', 'first name')).toBe(true);
    expect(containsPhrase('name of first referee', 'first name')).toBe(false);
  });
});

describe('SEC 5.7 — Jaccard behaviour at the 0.92 / 0.75 answer bands', () => {
  const asked = 'why do you want to work at {company}';

  it('the identical question scores 1 — comfortably a SAME_Q hit', () => {
    expect(jaccardTokenSet(asked, 'why do you want to work at {company}')).toBe(1);
    expect(jaccardTokenSet(asked, 'why do you want to work at {company}')).toBeGreaterThanOrEqual(
      SAME_Q,
    );
  });

  it('one extra word lands in [SIMILAR_Q, SAME_Q) — a "similar question" offer', () => {
    // 8 shared tokens, 9 in the union → 0.889.
    const similarity = jaccardTokenSet(asked, 'why do you want to work at {company} specifically');
    expect(similarity).toBeCloseTo(8 / 9, 6);
    expect(similarity).toBeGreaterThanOrEqual(SIMILAR_Q);
    expect(similarity).toBeLessThan(SAME_Q);
  });

  it('three extra words fall below SIMILAR_Q — treated as a new question', () => {
    // 8 shared tokens, 11 in the union → 0.727.
    const similarity = jaccardTokenSet(asked, 'why do you want to work at {company} in this role');
    expect(similarity).toBeCloseTo(8 / 11, 6);
    expect(similarity).toBeLessThan(SIMILAR_Q);
  });

  it('an unrelated question scores far below the floor', () => {
    expect(jaccardTokenSet(asked, 'do you require visa sponsorship')).toBeLessThan(0.2);
  });

  it('is order-insensitive — Jaccard is a set metric', () => {
    expect(jaccardTokenSet('notice period days', 'days period notice')).toBe(1);
  });

  it('bigram Jaccard survives word-order changes but still separates unrelated text', () => {
    expect(jaccardBigrams('cover letter', 'cover letter')).toBe(1);
    expect(jaccardBigrams('cover letter', 'letter cover')).toBeGreaterThan(0.6);
    expect(jaccardBigrams('cover letter', 'visa sponsorship')).toBeLessThan(0.2);
  });
});

describe('textSimilarity — the blended Answer Bank metric', () => {
  it('identical questions score exactly 1', () => {
    expect(textSimilarity('How did you hear about us?', 'how did you hear about us')).toBe(1);
  });

  it('a one-word difference in a long question stays above SIMILAR_Q', () => {
    const similarity = textSimilarity(
      'Why do you want to work at this company and on this team',
      'Why do you want to work for this company and on this team',
    );
    expect(similarity).toBeGreaterThanOrEqual(SIMILAR_Q);
  });

  it('an unrelated question of similar length stays well below SIMILAR_Q', () => {
    const similarity = textSimilarity(
      'Why do you want to work at this company and on this team',
      'Please list every programming language you have shipped production code in',
    );
    expect(similarity).toBeLessThan(SIMILAR_Q);
  });

  it('never leaves [0, 1]', () => {
    for (const [a, b] of [
      ['', ''],
      ['a', ''],
      ['same', 'same'],
      ['completely different', 'nothing alike here'],
    ] as ReadonlyArray<readonly [string, string]>) {
      const value = textSimilarity(a, b);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
