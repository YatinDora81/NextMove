/**
 * tests/unit/synonyms.test.ts — JF-001 Rev 3.0 SEC 11 (Unit · "synonym coverage").
 *
 * The dictionary is the only reason the generic engine works on a form nobody has ever seen. Two
 * failure modes matter and both are asserted mechanically rather than by eyeballing the table:
 *
 *   COVERAGE.   Every fillable leaf of the SEC 7.2 `Profile` must have at least one alias.
 *               A vault field with no alias can never be matched heuristically, so it silently
 *               becomes "adapter-only" — invisible on the long tail of career pages the generic
 *               adapter has to carry.
 *
 *   SOUNDNESS.  Every alias must round-trip: fed to the FieldMatcher as a label, it must resolve
 *               back to the path that declares it. An alias that resolves elsewhere is worse than
 *               a missing one — it makes the matcher confidently wrong (the thing INV-4 exists to
 *               prevent).
 *
 * The exclusion list below is deliberate and each entry carries its reason. Growing it should
 * require an argument, which is why it lives in the test rather than in the dictionary.
 */

import { describe, expect, it } from 'vitest';

import { FieldMatcher } from '@/core/matcher';
import { buildFieldSignature } from '@/core/signature';
import {
  GENERIC_ALIAS_TOKENS,
  QUESTION_PATHS,
  SYNONYMS,
  SYNONYMS_VERSION,
  SYNONYM_PATHS,
  mergeSynonyms,
} from '@/core/synonyms';
import type { FieldNode, ProfilePath } from '@/shared/types';

import { makeProfile, unloadFixture } from '../setup';

/* ------------------------------------------------------------------------------------------------
 * Which vault leaves are supposed to be fillable
 * ---------------------------------------------------------------------------------------------- */

/**
 * Leaves of the SEC 7.2 `Profile` that no ATS ever asks for, so no alias is owed.
 * Each one is either JobFill's own bookkeeping or a value the FillEngine derives rather than
 * matches.
 */
const NOT_FILLABLE: ReadonlySet<ProfilePath> = new Set<ProfilePath>([
  'id', // internal vault id
  'label', // the profile's own nickname in the switcher
  'isDefault', // UI state
  'updatedAt', // local mtime
  'work[0].current', // derived from `end === null`, never a form field of its own
  'work[0].bullets', // AI context, not a fillable value
  'education[0].field', // present in the dictionary, listed here only if it ever leaves it
  'eeo.declineToState', // a global user preference, applied to the eeo.* answers
  'answers', // the raw Q/A array; the fillable surface is the `answers.<slug>` virtual paths
]);

/**
 * Walk the vault and produce every leaf path in the same notation the dictionary uses
 * (`work[0].title`, `personal.address.city`, `skills`).
 */
function profileLeafPaths(): ProfilePath[] {
  const out: ProfilePath[] = [];

  const walk = (value: unknown, prefix: string): void => {
    if (Array.isArray(value)) {
      // Arrays are addressed by their first element (`work[0].title`) or as a whole (`skills`).
      const first = value[0];
      if (first !== undefined && typeof first === 'object' && first !== null) {
        walk(first, `${prefix}[0]`);
      } else {
        out.push(prefix);
      }
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, prefix.length === 0 ? key : `${prefix}.${key}`);
      }
      return;
    }
    out.push(prefix);
  };

  walk(makeProfile(), '');
  return out;
}

/**
 * `authorization.needsSponsorship` is stored per country (`{ US: true }`), so the walker sees
 * `authorization.needsSponsorship.US`. Collapse those back to the path the dictionary declares.
 */
function canonicalise(path: ProfilePath): ProfilePath {
  if (path.startsWith('authorization.needsSponsorship')) return 'authorization.needsSponsorship';
  if (path.startsWith('authorization.authorizedIn')) return 'authorization.authorizedIn';
  // The raw Q/A array is not a fillable leaf: its fillable surface is the `answers.<slug>`
  // virtual paths declared in QUESTION_PATHS and resolved by `matcher.resolveProfileValue`.
  if (path.startsWith('answers[0]')) return 'answers';
  return path;
}

/* ------------------------------------------------------------------------------------------------
 * Coverage
 * ---------------------------------------------------------------------------------------------- */

describe('SYNONYMS coverage — every fillable vault leaf has an alias', () => {
  const leaves = [...new Set(profileLeafPaths().map(canonicalise))];

  it('the walker actually found the vault (guards against a silent empty run)', () => {
    expect(leaves.length).toBeGreaterThan(30);
    expect(leaves).toContain('personal.firstName');
    expect(leaves).toContain('compensation.expected.currency');
  });

  const fillable = leaves.filter((path) => !NOT_FILLABLE.has(path));

  for (const path of fillable) {
    it(`${path} has at least one alias`, () => {
      const aliases = SYNONYMS[path];
      expect(aliases, `no synonym entry for "${path}"`).toBeDefined();
      expect(aliases?.length ?? 0).toBeGreaterThan(0);
    });
  }

  it('reports the whole gap at once, so a schema change lists everything it broke', () => {
    const missing = fillable.filter((path) => (SYNONYMS[path]?.length ?? 0) === 0);
    expect(missing).toEqual([]);
  });

  it('every virtual `answers.<slug>` path is both declared and aliased', () => {
    for (const path of Object.keys(QUESTION_PATHS)) {
      expect(SYNONYMS[path], `answers path "${path}" has no aliases`).toBeDefined();
      expect(SYNONYMS[path]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('every dictionary path is either a real vault leaf or a documented virtual path', () => {
    const known = new Set<ProfilePath>([
      ...leaves,
      ...Object.keys(QUESTION_PATHS),
      'personal.fullName', // firstName + ' ' + lastName
    ]);
    const orphans = SYNONYM_PATHS.filter((path) => !known.has(path));
    expect(orphans).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Soundness
 * ---------------------------------------------------------------------------------------------- */

describe('SYNONYMS soundness', () => {
  it('no alias is claimed by two different paths', () => {
    const owners = new Map<string, ProfilePath[]>();
    for (const [path, aliases] of Object.entries(SYNONYMS)) {
      for (const alias of aliases) {
        const key = alias.toLowerCase().trim();
        owners.set(key, [...(owners.get(key) ?? []), path]);
      }
    }
    const shared = [...owners.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([alias, paths]) => `${alias} → ${paths.join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('no alias is blank, padded, or duplicated within its own path', () => {
    for (const [path, aliases] of Object.entries(SYNONYMS)) {
      const seen = new Set<string>();
      for (const alias of aliases) {
        expect(alias.trim(), `"${alias}" in ${path} is blank`).not.toBe('');
        expect(alias, `"${alias}" in ${path} has stray whitespace`).toBe(alias.trim());
        expect(seen.has(alias.toLowerCase()), `"${alias}" repeats in ${path}`).toBe(false);
        seen.add(alias.toLowerCase());
      }
    }
  });

  it('every alias round-trips through the matcher back to its own path', () => {
    const matcher = new FieldMatcher({ requireValue: false });
    const misses: string[] = [];

    for (const [path, aliases] of Object.entries(SYNONYMS)) {
      for (const alias of aliases) {
        unloadFixture();
        document.body.innerHTML = `<label for="probe">${alias}</label><input id="probe" name="q" />`;
        const el = document.querySelector('#probe');
        if (el === null) throw new Error('probe input did not mount');
        const node: FieldNode = { el, sig: buildFieldSignature(el, 0), visible: true, required: false };
        const result = matcher.matchOne(node);
        if (result.path !== path) {
          misses.push(`${path} :: "${alias}" resolved to ${String(result.path)} @ ${result.score}`);
        }
      }
    }

    expect(misses).toEqual([]);
  });

  it('generic one-word tokens exist as aliases somewhere (otherwise the guard list is stale)', () => {
    const singleWordAliases = new Set<string>();
    for (const aliases of Object.values(SYNONYMS)) {
      for (const alias of aliases) {
        const lower = alias.toLowerCase().trim();
        if (!lower.includes(' ')) singleWordAliases.add(lower);
      }
    }
    // At least the headline offenders the matcher special-cases must actually be in the table.
    for (const token of ['name', 'title', 'company', 'email', 'phone', 'city', 'country']) {
      expect(GENERIC_ALIAS_TOKENS.has(token)).toBe(true);
      expect(singleWordAliases.has(token), `"${token}" is guarded but never used`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * F-14 — remote config folding
 * ---------------------------------------------------------------------------------------------- */

describe('mergeSynonyms — remote config layering (F-14)', () => {
  it('is the identity when there is no remote config', () => {
    const merged = mergeSynonyms();
    expect(merged.version).toBe(SYNONYMS_VERSION);
    expect(merged.addedPaths).toEqual([]);
    expect(merged.addedAliases).toBe(0);
    expect(Object.keys(merged.dictionary).sort()).toEqual([...SYNONYM_PATHS].sort());
  });

  it('appends remote aliases after the shipped ones — a push can never demote a known phrasing', () => {
    const merged = mergeSynonyms(SYNONYMS, { 'personal.firstName': ['jina la kwanza'] }, '2.3.1');
    const aliases = merged.dictionary['personal.firstName'] ?? [];
    expect(aliases[0]).toBe(SYNONYMS['personal.firstName']?.[0]);
    expect(aliases).toContain('jina la kwanza');
    expect(merged.addedAliases).toBe(1);
    expect(merged.version).toBe(`${SYNONYMS_VERSION}+remote:2.3.1`);
  });

  it('de-duplicates by normalized comparison, not raw equality', () => {
    const before = SYNONYMS['personal.firstName']?.length ?? 0;
    const merged = mergeSynonyms(SYNONYMS, { 'personal.firstName': ['  First   Name  '] }, '2.3.1');
    expect(merged.dictionary['personal.firstName']?.length).toBe(before);
    expect(merged.addedAliases).toBe(0);
  });

  it('reports brand-new paths so a bad CDN push is debuggable', () => {
    const merged = mergeSynonyms(SYNONYMS, { 'custom.taxId': ['tax id', 'pan number'] }, '2.3.1');
    expect(merged.addedPaths).toEqual(['custom.taxId']);
    expect(merged.dictionary['custom.taxId']).toEqual(['tax id', 'pan number']);
  });

  it('defends itself against a malformed CDN response (SEC 14.2 — untrusted boundary)', () => {
    const hostile = {
      'personal.firstName': ['', '   ', 42, null],
      '': ['nothing'],
      'links.linkedin': 'not-an-array',
    } as unknown as Record<string, readonly string[]>;

    const merged = mergeSynonyms(SYNONYMS, hostile, '9.9.9');
    expect(merged.addedAliases).toBe(0);
    expect(merged.addedPaths).toEqual([]);
    expect(merged.dictionary['personal.firstName']).toEqual([...(SYNONYMS['personal.firstName'] ?? [])]);
    expect(merged.dictionary['links.linkedin']).toEqual([...(SYNONYMS['links.linkedin'] ?? [])]);
    expect(Object.keys(merged.dictionary)).not.toContain('');
  });

  it('never mutates the shipped dictionary', () => {
    const before = [...(SYNONYMS['personal.email'] ?? [])];
    mergeSynonyms(SYNONYMS, { 'personal.email': ['courriel'] }, '1.0.1');
    expect([...(SYNONYMS['personal.email'] ?? [])]).toEqual(before);
  });
});
