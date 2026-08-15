/**
 * tests/unit/ui-state.test.ts — the two device-local `jf.*` keys the bottom-right shell added.
 *
 *   `jf.ui`              did the user leave the panel collapsed into its bubble?
 *   `jf.fieldDismissals` which per-field suggestions did they wave off, on which domain, when?
 *
 * Both live OUTSIDE the closed six-slot map in `platform/storage.ts` (see `STORAGE_KEY_UI` in
 * `shared/constants.ts` for why), which means nothing validates their shape on the way in and both
 * parsers are on a render path. So the property under test is not "we can round-trip our own
 * writes" — it is **garbage in, working UI out**: another extension version, a half-written object,
 * a user poking at `chrome.storage`, or a machine whose clock moved backwards must all cost the
 * user nothing worse than a forgotten preference.
 *
 * The dismissal TTL gets its own attention because an unbounded refusal ledger is not a feature: it
 * turns one bad guess in March into permanent blindness in December, on a profile that has changed
 * and a matcher that has improved since.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DISMISSAL_TTL_MS,
  DISMISSALS_STORAGE_KEY,
  dismissField,
  parseDismissals,
  readDismissedHashes,
  restoreField,
} from '@/content/dismissals';
import {
  DEFAULT_UI_STATE,
  UI_STORAGE_KEY,
  parseUiState,
  readUiState,
  setPanelCollapsed,
} from '@/content/ui-state';

import { resetBrowserMock, type BrowserMock } from '../setup';

let mock: BrowserMock;

beforeEach(() => {
  mock = resetBrowserMock();
});

/* ------------------------------------------------------------------------------------------------
 * jf.ui
 * ---------------------------------------------------------------------------------------------- */

describe('jf.ui — the panel collapse preference', () => {
  it('defaults to collapsed, so a page load is a promise rather than an interruption', () => {
    expect(DEFAULT_UI_STATE.panelCollapsed).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'panelCollapsed'],
    ['a number', 7],
    ['an array', [{ panelCollapsed: false }]],
    ['an empty object', {}],
    ['the right key with the wrong type', { panelCollapsed: 'false' }],
    ['the right key holding null', { panelCollapsed: null }],
    ['a plausible-looking neighbour', { collapsed: false }],
  ])('falls back to the default for %s', (_what, raw) => {
    expect(parseUiState(raw)).toEqual(DEFAULT_UI_STATE);
  });

  it('keeps a boolean it recognises, in both positions', () => {
    expect(parseUiState({ panelCollapsed: false })).toEqual({ panelCollapsed: false });
    expect(parseUiState({ panelCollapsed: true })).toEqual({ panelCollapsed: true });
  });

  it('drops members it does not know rather than carrying them forward', () => {
    expect(parseUiState({ panelCollapsed: false, panelWidth: 900, __proto__: { x: 1 } })).toEqual({
      panelCollapsed: false,
    });
  });

  it('round-trips through storage', async () => {
    await setPanelCollapsed(false);
    expect(mock.__store[UI_STORAGE_KEY]).toEqual({ panelCollapsed: false });
    expect(await readUiState()).toEqual({ panelCollapsed: false });

    await setPanelCollapsed(true);
    expect(await readUiState()).toEqual({ panelCollapsed: true });
  });

  it('reads the default back out of a corrupt value instead of throwing', async () => {
    mock.__store[UI_STORAGE_KEY] = 'not an object at all';
    await expect(readUiState()).resolves.toEqual(DEFAULT_UI_STATE);
  });
});

/* ------------------------------------------------------------------------------------------------
 * jf.fieldDismissals
 * ---------------------------------------------------------------------------------------------- */

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const FRESH = NOW - 60_000;
const STALE = NOW - DISMISSAL_TTL_MS - 1;

describe('jf.fieldDismissals — the per-field ✗ ledger', () => {
  it.each([
    ['null', null],
    ['a string', 'jobs.example'],
    ['an array', [['jobs.example', {}]]],
    ['a number', 12],
  ])('parses %s as "nothing is dismissed"', (_what, raw) => {
    expect(parseDismissals(raw, NOW)).toEqual({});
  });

  it('keeps a well-formed entry', () => {
    expect(parseDismissals({ 'jobs.example': { abc123: FRESH } }, NOW)).toEqual({
      'jobs.example': { abc123: FRESH },
    });
  });

  it('drops domain buckets that are not objects, and keeps the ones beside them', () => {
    const parsed = parseDismissals(
      {
        'jobs.example': { abc123: FRESH },
        'broken.example': 'nope',
        'array.example': [FRESH],
        'null.example': null,
        '': { abc123: FRESH },
      },
      NOW,
    );
    expect(parsed).toEqual({ 'jobs.example': { abc123: FRESH } });
  });

  it('drops timestamps that are not finite numbers', () => {
    const parsed = parseDismissals(
      {
        'jobs.example': {
          good: FRESH,
          stringy: String(FRESH),
          nan: Number.NaN,
          infinite: Number.POSITIVE_INFINITY,
          nothing: null,
          '': FRESH,
        },
      },
      NOW,
    );
    expect(parsed).toEqual({ 'jobs.example': { good: FRESH } });
  });

  it('prunes anything older than the TTL — a refusal is not a permanent verdict', () => {
    const parsed = parseDismissals({ 'jobs.example': { fresh: FRESH, stale: STALE } }, NOW);
    expect(parsed).toEqual({ 'jobs.example': { fresh: FRESH } });
  });

  it('keeps an entry that is exactly at the TTL boundary, and drops the one past it', () => {
    const parsed = parseDismissals(
      { 'jobs.example': { boundary: NOW - DISMISSAL_TTL_MS, past: NOW - DISMISSAL_TTL_MS - 1 } },
      NOW,
    );
    expect(Object.keys(parsed['jobs.example'] ?? {})).toEqual(['boundary']);
  });

  it('re-stamps a timestamp from the future rather than letting it outlive the TTL', () => {
    // A clock that moved backwards would otherwise leave the entry alive by however far it jumped.
    const parsed = parseDismissals({ 'jobs.example': { ahead: NOW + 5 * DISMISSAL_TTL_MS } }, NOW);
    expect(parsed).toEqual({ 'jobs.example': { ahead: NOW } });
  });

  it('drops a domain bucket left empty by pruning, so it cannot accumulate one per site', () => {
    expect(parseDismissals({ 'jobs.example': { stale: STALE } }, NOW)).toEqual({});
    expect(parseDismissals({ 'jobs.example': {} }, NOW)).toEqual({});
  });

  it('dismisses, reads back, and scopes to the domain it was dismissed on', async () => {
    await dismissField('jobs.example', 'hash-a');
    await dismissField('jobs.example', 'hash-b');
    await dismissField('other.example', 'hash-a');

    expect([...(await readDismissedHashes('jobs.example'))].sort()).toEqual(['hash-a', 'hash-b']);
    expect([...(await readDismissedHashes('other.example'))]).toEqual(['hash-a']);
    expect([...(await readDismissedHashes('unvisited.example'))]).toEqual([]);
  });

  it('ignores an empty domain or hash instead of writing a bucket nothing can match', async () => {
    await dismissField('', 'hash-a');
    await dismissField('jobs.example', '');
    expect(mock.__store[DISMISSALS_STORAGE_KEY]).toBeUndefined();
    expect([...(await readDismissedHashes(''))]).toEqual([]);
  });

  it('restores one field without disturbing its neighbour', async () => {
    await dismissField('jobs.example', 'hash-a');
    await dismissField('jobs.example', 'hash-b');

    await restoreField('jobs.example', 'hash-a');
    expect([...(await readDismissedHashes('jobs.example'))]).toEqual(['hash-b']);
  });

  it('removes the domain entirely when its last dismissal is restored', async () => {
    await dismissField('jobs.example', 'hash-a');
    await restoreField('jobs.example', 'hash-a');
    expect(mock.__store[DISMISSALS_STORAGE_KEY]).toEqual({});
  });

  it('is a no-op when asked to restore something that was never dismissed', async () => {
    await dismissField('jobs.example', 'hash-a');
    const before = JSON.stringify(mock.__store[DISMISSALS_STORAGE_KEY]);
    await restoreField('jobs.example', 'never-dismissed');
    await restoreField('never.example', 'hash-a');
    expect(JSON.stringify(mock.__store[DISMISSALS_STORAGE_KEY])).toBe(before);
  });

  it('self-heals a corrupt blob on the next write rather than needing a migration', async () => {
    mock.__store[DISMISSALS_STORAGE_KEY] = {
      'jobs.example': { stale: STALE, bad: 'nope' },
      broken: 'not an object',
    };
    await dismissField('jobs.example', 'hash-new');

    const stored = mock.__store[DISMISSALS_STORAGE_KEY] as Record<string, Record<string, number>>;
    expect(Object.keys(stored)).toEqual(['jobs.example']);
    expect(Object.keys(stored['jobs.example'] ?? {})).toEqual(['hash-new']);
  });
});
