/**
 * content/dismissals.ts — "no, not that one" memory for per-field suggestions.
 *
 * Proactive suggestions (F-06) now paint on every recognized input the moment a page is scanned,
 * so the ✗ button has to mean something durable: if the matcher keeps proposing your personal
 * email for a field that wants your work one, dismissing it once must hold across reloads and
 * across the SPA re-scans that fire several times per application flow. Without persistence the
 * ✗ is just a flicker and the suggestion returns 250ms later on the next mutation.
 *
 * Keyed `domain → FieldSignature.hash → timestamp`. The hash is the stable, content-derived field
 * identity the scanner already computes, which is what makes this survive DOM churn; the domain
 * scope keeps a dismissal on one ATS from silencing the same-looking field on another.
 *
 * INV-4 (never guess-fill) is why this is a *suggestion* ledger and not a fill ledger: nothing in
 * here has ever been written into a page. The dismissal only stops us from proposing.
 *
 * Entries expire after `DISMISSAL_TTL_MS`. A dismissal is a reaction to one bad guess at one
 * moment — the profile the guess came from changes, the user adds the missing field, the matcher
 * gets better — so an unbounded record would quietly turn into permanent blindness. The prune
 * runs inside `parseDismissals`, which every read AND every write goes through, so the store
 * self-heals rather than needing a migration.
 *
 * Stored at the standalone `jf.fieldDismissals` key with raw `browser.storage.local`, outside the
 * six-slot map in `platform/storage.ts` (see `STORAGE_KEY_FIELD_DISMISSALS`). Nothing validates
 * the shape for us, and the domain and hash strings on the way in are page-derived (SEC 9.2:
 * page text is untrusted), so the parser below assumes the whole blob is hostile.
 */

import { FIELD_DISMISSAL_TTL_MS, STORAGE_KEY_FIELD_DISMISSALS } from '@/shared/constants';
import { createLogger } from '@/platform/logger';

const log = createLogger('dismissals');

/** domain → fieldHash → dismissed-at epoch millis. */
export type FieldDismissals = Record<string, Record<string, number>>;

export const DISMISSALS_STORAGE_KEY = STORAGE_KEY_FIELD_DISMISSALS;

export const DISMISSAL_TTL_MS = FIELD_DISMISSAL_TTL_MS;

/**
 * Coerce anything at all into a pruned `FieldDismissals`. Pure and total, and `now` is a
 * parameter rather than a `Date.now()` call sprinkled through the body so expiry is testable
 * without faking the clock.
 *
 * Dropped on the way through: non-object roots, non-object (or array) domain buckets, timestamps
 * that are not finite numbers, timestamps older than the TTL, timestamps far enough in the future
 * to be a clock artefact rather than a real dismissal, and any domain bucket left empty
 * afterwards — an empty bucket is indistinguishable from no bucket and would otherwise
 * accumulate one entry per site the user ever un-dismissed on.
 */
export function parseDismissals(raw: unknown, now: number = Date.now()): FieldDismissals {
  const out: FieldDismissals = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;

  for (const [domain, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (domain.length === 0) continue;
    if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) continue;

    const kept: Record<string, number> = {};
    for (const [hash, at] of Object.entries(bucket as Record<string, unknown>)) {
      if (hash.length === 0) continue;
      if (typeof at !== 'number' || !Number.isFinite(at)) continue;
      // A timestamp in the future means the machine's clock moved backwards since the write.
      // Keeping it would make the entry outlive the TTL by however far the clock jumped, so treat
      // anything beyond `now` as if it were dismissed right now and let it expire on schedule.
      const age = now - at;
      if (age > DISMISSAL_TTL_MS) continue;
      kept[hash] = age < 0 ? now : at;
    }

    if (Object.keys(kept).length > 0) out[domain] = kept;
  }

  return out;
}

async function readDismissals(): Promise<FieldDismissals> {
  try {
    const bag = await browser.storage.local.get(DISMISSALS_STORAGE_KEY);
    return parseDismissals((bag as Record<string, unknown>)[DISMISSALS_STORAGE_KEY]);
  } catch (error) {
    log.debug('could not read field dismissals', error);
    return {};
  }
}

async function writeDismissals(state: FieldDismissals): Promise<void> {
  try {
    await browser.storage.local.set({ [DISMISSALS_STORAGE_KEY]: state });
  } catch (error) {
    // Losing the write means the suggestion comes back on the next scan — annoying, not harmful,
    // and not worth a toast in front of a user who is mid-application.
    log.debug('could not persist field dismissals', error);
  }
}

/**
 * The hashes to suppress on this domain, as a Set because the suggestion renderer checks it once
 * per field on a page that may carry a hundred of them.
 */
export async function readDismissedHashes(domain: string): Promise<Set<string>> {
  if (domain.length === 0) return new Set<string>();
  const state = await readDismissals();
  return new Set(Object.keys(state[domain] ?? {}));
}

export async function dismissField(domain: string, hash: string): Promise<void> {
  if (domain.length === 0 || hash.length === 0) return;
  const state = await readDismissals();
  const bucket = { ...(state[domain] ?? {}), [hash]: Date.now() };
  await writeDismissals({ ...state, [domain]: bucket });
}

/**
 * Undo a dismissal — the "restore suggestion" affordance in the expanded panel row, which exists
 * because ✗ sits one 18px button away from ✓ and a mis-click must not be a one-way door.
 */
export async function restoreField(domain: string, hash: string): Promise<void> {
  if (domain.length === 0 || hash.length === 0) return;
  const state = await readDismissals();
  const bucket = state[domain];
  if (bucket === undefined || !Object.prototype.hasOwnProperty.call(bucket, hash)) return;

  const next: Record<string, number> = { ...bucket };
  delete next[hash];

  const outer: FieldDismissals = { ...state };
  if (Object.keys(next).length > 0) outer[domain] = next;
  else delete outer[domain];

  await writeDismissals(outer);
}
