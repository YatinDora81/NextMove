/**
 * core/adapters/registry.ts — ordered detection + the seed ⊕ remote config overlay.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 6.5  adapter contract, ordered detection (specific adapters first, `generic` last)
 *   SEC 6.7  auto-capture step 2 (adapter selectors) and step 4 (observed confirmation state)
 *   SEC 8.3  the remote config is a STATIC, versioned JSON file on Vercel's CDN. It is *data*,
 *            never code — which is what makes F-14 MV3-legal. Nothing here evaluates anything;
 *            the payload is Zod-validated (`remoteAdapterConfigSchema`) and semver-gated before it
 *            is allowed to sit on top of the shipped seed.
 *   F-14     broken-by-site-update fixes ship in hours, without a store re-review.
 *
 * ### Layering
 *
 * A resolved config is built from up to three sources, lowest authority first:
 *
 *   1. the adapter's own compiled-in block  (`greenhouse.ts` etc.)
 *   2. `config/adapters.seed.json`          (shipped copy of the CDN file — works offline, INV-3)
 *   3. the fetched `adapters.json`          (remote; wins per key)
 *
 * and within (2) and (3) the *layer keys* run from least to most specific:
 * `generic` → `<atsId>` → whatever `adapter.configKeys(url)` adds (Workday's `workday:<tenant>`).
 *
 * Object-valued blocks (`fieldMap`) merge per key, higher authority winning. A remote `fieldMap`
 * value of `""` DELETES the key — that is the hot-fix for "this selector now matches the wrong
 * control". List-valued blocks (`capture`, `confirmation`, and the two selector lists inside
 * `quirks`) are unioned with the higher-authority entries first, so a remote fix takes priority
 * without ever dropping a shipped fallback.
 *
 * INV-1 survives every merge: `FillQuirks.submitSelectors` is union-only (see `mergeQuirks`), so
 * remote config can extend the never-touch list but can never shrink it.
 */

import { DEFAULT_MODEL_BUDGETS } from '@repo/rotation';
import type { ModelBudgets } from '@repo/rotation';
import { remoteAdapterConfigSchema } from '@repo/types/ExtensionTypes';

import type {
  AtsId,
  ProfilePath,
  RemoteAdapterEntry,
  RemoteConfig,
  ResolvedAdapterConfig,
} from '@/shared/types';

import seedJson from '../../../config/adapters.seed.json';

import { ashbyAdapter } from './ashby';
import { genericAdapter } from './generic';
import { greenhouseAdapter } from './greenhouse';
import { icimsAdapter } from './icims';
import { leverAdapter } from './lever';
import { smartRecruitersAdapter } from './smartrecruiters';
import { taleoAdapter } from './taleo';
import {
  DEFAULT_QUIRKS,
  captureText,
  matchesAny,
  mergeQuirks,
  quirksFromRecord,
  quirksToRecord,
  uniqueSelectors,
  urlMatchesAny,
} from './types';
import type { AtsAdapter, FillQuirks } from './types';
import { workdayAdapter } from './workday';

/* ------------------------------------------------------------------------------------------------
 * The ordered chain (SEC 6.5) — specific adapters first, `generic` last
 * ---------------------------------------------------------------------------------------------- */

/**
 * Detection order. `generic.detect()` is unconditionally true, so it MUST stay last: it is the
 * floor of the chain, not a participant in it.
 */
export const ADAPTERS: readonly AtsAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  workdayAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  icimsAdapter,
  taleoAdapter,
  genericAdapter,
];

const ADAPTER_BY_ID: Record<AtsId, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  workday: workdayAdapter,
  icims: icimsAdapter,
  ashby: ashbyAdapter,
  smartrecruiters: smartRecruitersAdapter,
  taleo: taleoAdapter,
  generic: genericAdapter,
};

/** The remote-config layer every adapter inherits, so a global fix can ship once. */
export const GENERIC_LAYER_KEY = 'generic';

export function getAdapter(id: AtsId): AtsAdapter {
  return ADAPTER_BY_ID[id];
}

function toUrl(input: string | URL | null | undefined, doc?: Document): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') {
    try {
      return new URL(input);
    } catch {
      /* fall through to the document's own base */
    }
  }
  if (doc) {
    try {
      return new URL(doc.baseURI);
    } catch {
      /* fall through */
    }
  }
  return new URL('https://unknown.invalid/');
}

/**
 * SEC 6.5 ordered detection. Returns the first adapter whose fingerprint matches; `generic` is
 * last in the chain and always matches, so this never returns `null`.
 *
 * A throwing `detect()` (a malformed selector, a cross-origin `Document` guard) is treated as
 * "no match" and the scan continues — one broken adapter must not cost us the whole page.
 */
export function detectAts(url: string | URL, doc: Document): AtsAdapter {
  const parsed = toUrl(url, doc);
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.detect({ url: parsed, doc })) return adapter;
    } catch {
      continue;
    }
  }
  return genericAdapter;
}

/** Convenience wrapper for callers that only need the id (`ApplicationRow.ats`, `CONFIG_GET`). */
export function detectAtsId(url: string | URL, doc: Document): AtsId {
  return detectAts(url, doc).id;
}

/* ------------------------------------------------------------------------------------------------
 * Remote config — parse, semver gate, layer keys
 * ---------------------------------------------------------------------------------------------- */

/**
 * Zod-validate a fetched `adapters.json`. Returns `null` for anything that does not conform —
 * a bad CDN payload must leave the shipped seed in place, never half-apply (F-14).
 */
export function parseRemoteConfig(raw: unknown): RemoteConfig | null {
  const parsed = remoteAdapterConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function semverParts(version: string): [number, number, number, boolean] {
  const core = version.trim().split('+')[0] ?? '';
  const dashIndex = core.indexOf('-');
  const hasPrerelease = dashIndex >= 0;
  const numeric = hasPrerelease ? core.slice(0, dashIndex) : core;
  const parts = numeric.split('.');
  const toNumber = (value: string | undefined): number => {
    const n = Number.parseInt(value ?? '0', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return [toNumber(parts[0]), toNumber(parts[1]), toNumber(parts[2]), hasPrerelease];
}

/** `-1` / `0` / `1`. A prerelease sorts *below* the release with the same core (semver §11). */
export function compareSemver(a: string, b: string): number {
  const left = semverParts(a);
  const right = semverParts(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] as number;
    const r = right[i] as number;
    if (l !== r) return l < r ? -1 : 1;
  }
  if (left[3] === right[3]) return 0;
  return left[3] ? -1 : 1;
}

/**
 * The F-14 semver gate: a fetched config replaces what we hold only when it is strictly newer.
 * A CDN rollback therefore cannot silently downgrade a client that already pulled the fix.
 */
export function isConfigNewer(candidate: string, current: string | null | undefined): boolean {
  if (current === null || current === undefined || current.trim().length === 0) return true;
  return compareSemver(candidate, current) > 0;
}

/**
 * How the config layers straddle the adapter's own compiled block.
 *
 * `base` layers sit BELOW the adapter's code and `specific` layers sit ABOVE it. That split is
 * what keeps the shared `generic` block from clobbering an adapter that knows better: Greenhouse's
 * `stepContainerSelector: '#application_form'` must survive the generic block's `'form'`, while
 * still inheriting the generic block's confirmation cues and INV-1 submit exclusions.
 *
 * For the generic adapter itself there is no "below": its own `generic` entry is the specific
 * layer, so a CDN hot-fix to `generic` can still override the compiled fallback.
 */
export interface ConfigLayerPlan {
  /** Applied under the adapter's compiled block, least specific first. */
  base: readonly string[];
  /** Applied over the adapter's compiled block, least specific first. */
  specific: readonly string[];
}

/**
 * Remote-config layer plan for this adapter + URL.
 *
 * SEC 6.5 (Workday row): per-tenant variance is expressed as `workday:<tenant>`, which lets one
 * tenant be hot-fixed without touching the shared `workday` block.
 */
export function configLayerPlan(adapter: AtsAdapter, url: URL | null): ConfigLayerPlan {
  if (adapter.id === GENERIC_LAYER_KEY) return { base: [], specific: [GENERIC_LAYER_KEY] };
  const specific: string[] = [adapter.id];
  if (url && typeof adapter.configKeys === 'function') {
    for (const key of adapter.configKeys(url)) {
      const trimmed = key.trim();
      if (trimmed.length > 0 && !specific.includes(trimmed)) specific.push(trimmed);
    }
  }
  return { base: [GENERIC_LAYER_KEY], specific };
}

/** Flattened form of {@link configLayerPlan}, least authoritative first. */
export function configLayerKeys(adapter: AtsAdapter, url: URL | null): readonly string[] {
  const plan = configLayerPlan(adapter, url);
  return [...plan.base, ...plan.specific];
}

/** Entries present in `config` for the given keys, in the same (least → most specific) order. */
function entriesFor(
  config: RemoteConfig | null | undefined,
  keys: readonly string[],
): RemoteAdapterEntry[] {
  const table = config?.adapters;
  if (!table) return [];
  const out: RemoteAdapterEntry[] = [];
  for (const key of keys) {
    const entry = table[key];
    if (entry) out.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * The shipped seed
 * ---------------------------------------------------------------------------------------------- */

/**
 * Reconstruct a full remote-config document from the compiled-in adapters.
 *
 * Two jobs: it is the last-resort seed if `config/adapters.seed.json` ever fails validation, and
 * it is what the test suite diffs the shipped JSON against so the two can never drift.
 */
export function buildConfigFromAdapters(version: string, updatedAt: string): RemoteConfig {
  const adapters: Record<string, RemoteAdapterEntry> = {};
  for (const adapter of ADAPTERS) {
    adapters[adapter.id] = {
      fieldMap: { ...adapter.fieldMap() },
      quirks: quirksToRecord(mergeQuirks(DEFAULT_QUIRKS, adapter.quirks)),
      capture: {
        company: [...(adapter.capture?.company ?? [])],
        role: [...(adapter.capture?.role ?? [])],
      },
      confirmation: {
        urlPatterns: [...(adapter.confirmation?.urlPatterns ?? [])],
        selectors: [...(adapter.confirmation?.selectors ?? [])],
      },
    };
  }
  return {
    version,
    updatedAt,
    modelBudgets: { ...DEFAULT_MODEL_BUDGETS },
    adapters,
  };
}

const seedParse = remoteAdapterConfigSchema.safeParse(seedJson);

/**
 * The shipped defaults (INV-3: the extension is fully functional with the network switched off).
 *
 * If the bundled JSON ever fails its own schema — a bad hand-edit that slipped past CI — we fall
 * back to the adapters' compiled-in blocks rather than shipping a half-parsed config.
 */
export const SEED_CONFIG: RemoteConfig = seedParse.success
  ? seedParse.data
  : buildConfigFromAdapters('0.0.0', new Date(0).toISOString());

export const SEED_VERSION: string = SEED_CONFIG.version;

/** True when the bundled seed validated cleanly. Surfaced by the test suite. */
export const SEED_IS_VALID: boolean = seedParse.success;

/* ------------------------------------------------------------------------------------------------
 * Resolution (seed ⊕ remote)
 * ---------------------------------------------------------------------------------------------- */

export interface ResolveAdapterOptions {
  /** Page URL — required for per-tenant layers such as `workday:<tenant>`. */
  url?: string | URL | null;
  /** The validated CDN document, or `null` when we are running on the seed alone (INV-3). */
  remote?: RemoteConfig | null;
  /** Override the shipped seed. Tests use this; production never does. */
  seed?: RemoteConfig;
}

function mergeFieldMaps(
  base: Record<string, ProfilePath>,
  entries: readonly RemoteAdapterEntry[],
): Record<string, ProfilePath> {
  const out: Record<string, ProfilePath> = { ...base };
  for (const entry of entries) {
    const patch = entry.fieldMap;
    if (!patch) continue;
    for (const [selector, path] of Object.entries(patch)) {
      const key = selector.trim();
      if (key.length === 0) continue;
      // An empty value is the documented "remove this selector" hot-fix (F-14).
      if (typeof path !== 'string' || path.trim().length === 0) {
        delete out[key];
        continue;
      }
      out[key] = path.trim();
    }
  }
  return out;
}

function pickList(
  entries: readonly RemoteAdapterEntry[],
  read: (entry: RemoteAdapterEntry) => readonly string[] | undefined,
): string[] {
  const out: string[] = [];
  // Reverse: most specific layer contributes first.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) continue;
    const list = read(entry);
    if (list) out.push(...list);
  }
  return out;
}

/**
 * The six ordered slices of one resolution, least authoritative first:
 * seed(base) → remote(base) → the adapter's compiled block → seed(specific) → remote(specific).
 */
interface ResolvedLayers {
  adapter: AtsAdapter;
  /** The compiled `generic` block, inherited by every specific adapter; `null` for generic itself. */
  baseAdapter: AtsAdapter | null;
  seedBase: RemoteAdapterEntry[];
  remoteBase: RemoteAdapterEntry[];
  seedSpecific: RemoteAdapterEntry[];
  remoteSpecific: RemoteAdapterEntry[];
  seed: RemoteConfig;
  remote: RemoteConfig | null;
}

function collectLayers(atsId: AtsId, options: ResolveAdapterOptions): ResolvedLayers {
  const adapter = getAdapter(atsId);
  const url = options.url === undefined || options.url === null ? null : toUrl(options.url);
  const plan = configLayerPlan(adapter, url);
  const seed = options.seed ?? SEED_CONFIG;
  const remote = options.remote ?? null;
  return {
    adapter,
    // The generic block is inherited in CODE, not only through the seed JSON, so a broken CDN
    // payload can never cost a specific adapter its baseline INV-1 submit exclusions.
    baseAdapter: adapter.id === GENERIC_LAYER_KEY ? null : genericAdapter,
    seed,
    remote,
    seedBase: entriesFor(seed, plan.base),
    remoteBase: entriesFor(remote, plan.base),
    seedSpecific: entriesFor(seed, plan.specific),
    remoteSpecific: entriesFor(remote, plan.specific),
  };
}

function foldQuirks(layers: ResolvedLayers): FillQuirks {
  let quirks = mergeQuirks(DEFAULT_QUIRKS, layers.baseAdapter?.quirks);
  for (const entry of layers.seedBase) quirks = mergeQuirks(quirks, quirksFromRecord(entry.quirks));
  for (const entry of layers.remoteBase) quirks = mergeQuirks(quirks, quirksFromRecord(entry.quirks));
  quirks = mergeQuirks(quirks, layers.adapter.quirks);
  for (const entry of layers.seedSpecific) quirks = mergeQuirks(quirks, quirksFromRecord(entry.quirks));
  for (const entry of layers.remoteSpecific) {
    quirks = mergeQuirks(quirks, quirksFromRecord(entry.quirks));
  }
  return quirks;
}

/**
 * Build the `FillQuirks` the FillEngine should drive this page with.
 *
 * INV-1: `submitSelectors` accumulates across every layer and is never replaced, so the set of
 * controls the engine refuses to touch can only ever grow.
 */
export function resolveFillQuirks(atsId: AtsId, options: ResolveAdapterOptions = {}): FillQuirks {
  return foldQuirks(collectLayers(atsId, options));
}

/** Synonym dictionary extensions (SEC 6.3): seed ⊕ remote, remote first per profile path. */
export function resolveSynonyms(options: ResolveAdapterOptions = {}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const sources = [(options.seed ?? SEED_CONFIG).synonyms, options.remote?.synonyms];
  for (const source of sources) {
    if (!source) continue;
    for (const [path, aliases] of Object.entries(source)) {
      const existing = out[path] ?? [];
      out[path] = uniqueSelectors([...(aliases ?? []), ...existing]);
    }
  }
  return out;
}

/**
 * Approximate free-tier budgets (SEC 5.2), overridable from remote config.
 *
 * Google revises free-tier limits without notice, so these are soft ceilings — never asserted as
 * fact in UI copy — and the CDN document is the release valve when they change.
 */
export function resolveModelBudgets(options: ResolveAdapterOptions = {}): ModelBudgets {
  const out: ModelBudgets = { ...DEFAULT_MODEL_BUDGETS };
  const sources = [(options.seed ?? SEED_CONFIG).modelBudgets, options.remote?.modelBudgets];
  for (const source of sources) {
    if (!source) continue;
    for (const [model, budget] of Object.entries(source)) {
      if (!budget) continue;
      const rpm = Number(budget.rpm);
      const rpd = Number(budget.rpd);
      if (!Number.isFinite(rpm) || !Number.isFinite(rpd) || rpm <= 0 || rpd <= 0) continue;
      out[model] = { rpm: Math.floor(rpm), rpd: Math.floor(rpd) };
    }
  }
  return out;
}

/**
 * The `CONFIG_GET` reply (SEC 6.6): everything a content script needs to drive one ATS, with the
 * seed and the CDN document already folded together.
 */
export function resolveAdapterConfig(
  atsId: AtsId,
  options: ResolveAdapterOptions = {},
): ResolvedAdapterConfig {
  const layers = collectLayers(atsId, options);
  const { adapter, seed, remote } = layers;

  // Objects merge lowest → highest authority; the last writer of a key wins.
  const base = mergeFieldMaps(layers.baseAdapter?.fieldMap() ?? {}, [
    ...layers.seedBase,
    ...layers.remoteBase,
  ]);
  const withOwn: Record<string, ProfilePath> = { ...base, ...adapter.fieldMap() };
  const fieldMap = mergeFieldMaps(withOwn, [...layers.seedSpecific, ...layers.remoteSpecific]);

  /**
   * Lists concatenate highest → lowest authority, so the first hit is the best evidence:
   * remote(specific) → seed(specific) → this adapter → remote(generic) → seed(generic) → generic code.
   */
  const list = (
    read: (entry: RemoteAdapterEntry) => readonly string[] | undefined,
    own: readonly string[],
    inherited: readonly string[],
  ): string[] =>
    uniqueSelectors([
      ...pickList(layers.remoteSpecific, read),
      ...pickList(layers.seedSpecific, read),
      ...own,
      ...pickList(layers.remoteBase, read),
      ...pickList(layers.seedBase, read),
      ...inherited,
    ]);

  const inheritedCapture = layers.baseAdapter?.capture;
  const inheritedConfirmation = layers.baseAdapter?.confirmation;

  return {
    atsId: adapter.id,
    version: remote?.version ?? seed.version,
    source: remote ? 'remote' : 'seed',
    fieldMap,
    quirks: quirksToRecord(foldQuirks(layers)),
    synonyms: resolveSynonyms({ seed, remote }),
    capture: {
      company: list(
        (entry) => entry.capture?.company,
        adapter.capture?.company ?? [],
        inheritedCapture?.company ?? [],
      ),
      role: list(
        (entry) => entry.capture?.role,
        adapter.capture?.role ?? [],
        inheritedCapture?.role ?? [],
      ),
    },
    confirmation: {
      urlPatterns: list(
        (entry) => entry.confirmation?.urlPatterns,
        adapter.confirmation?.urlPatterns ?? [],
        inheritedConfirmation?.urlPatterns ?? [],
      ),
      selectors: list(
        (entry) => entry.confirmation?.selectors,
        adapter.confirmation?.selectors ?? [],
        inheritedConfirmation?.selectors ?? [],
      ),
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.7 — the two things adapters declare for the tracker
 * ---------------------------------------------------------------------------------------------- */

/**
 * Auto-capture step 2: "each adapter declares where its header lives".
 *
 * Step 1 (JSON-LD `JobPosting`) and step 3 (og:/document.title heuristics) belong to the tracker;
 * this is the middle tier and returns `''` for anything it cannot see.
 */
export function captureFromAdapter(
  doc: Document,
  config: Pick<ResolvedAdapterConfig, 'capture'>,
): { company: string; role: string } {
  return {
    company: captureText(doc, config.capture.company),
    role: captureText(doc, config.capture.role),
  };
}

/**
 * Auto-capture step 4: does this document show a submitted / thank-you state?
 *
 * INV-1: this is pure OBSERVATION. Returning `true` lets the PageObserver flip a tracker row
 * `draft → applied`; nothing is clicked, navigated to, or triggered to reach this state.
 */
export function isConfirmationState(
  config: Pick<ResolvedAdapterConfig, 'confirmation'>,
  url: string | URL,
  doc: Document,
): boolean {
  if (urlMatchesAny(url, config.confirmation.urlPatterns)) return true;
  return matchesAny(doc, config.confirmation.selectors);
}
