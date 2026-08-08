/**
 * core/adapters/index.ts — barrel for the ATS adapter layer (JF-001 Rev 3.0 SEC 6.5 / 6.7 / F-07).
 *
 * The rest of the extension imports from `@/core/adapters` and never from an individual adapter
 * file: adding an ATS must be a one-file change plus a line in `registry.ts`, never a change at
 * every call site.
 *
 * Typical use:
 *   const adapter = detectAts(location.href, document);              // SEC 6.5 ordered detection
 *   const config  = resolveAdapterConfig(adapter.id, { url, remote }); // seed ⊕ remote (F-14)
 *   const quirks  = resolveFillQuirks(adapter.id, { url, remote });    // SEC 6.4 pacing/format
 *   const next    = adapter.steps?.nextButton?.(document);             // INV-1: highlight, never click
 */

export type {
  AdapterCapture,
  AdapterConfirmation,
  AdapterContext,
  AdapterSteps,
  AtsAdapter,
  AtsId,
  DerivedPath,
  FillQuirks,
  ProfilePath,
} from './types';

export {
  CONTROL_SELECTOR,
  DEFAULT_QUIRKS,
  DERIVED_PATHS,
  DERIVED_PATH_LIST,
  NEXT_TEXT_PATTERN,
  SUBMIT_TEXT_PATTERN,
  captureText,
  controlLabel,
  findControlByText,
  hostMatches,
  isDerivedPath,
  isFilePath,
  matchesAny,
  mergeQuirks,
  queryFirst,
  quirksFromRecord,
  quirksToRecord,
  readCaptureValue,
  safeQuery,
  safeQueryAll,
  uniqueSelectors,
  urlMatchesAny,
  urlMatchesPattern,
} from './types';

export { ashbyAdapter } from './ashby';
export { genericAdapter } from './generic';
export { greenhouseAdapter } from './greenhouse';
export { icimsAdapter } from './icims';
export { leverAdapter } from './lever';
export { smartRecruitersAdapter } from './smartrecruiters';
export { taleoAdapter } from './taleo';
export { workdayAdapter, workdayTenantSlug } from './workday';

export type { ConfigLayerPlan, ResolveAdapterOptions } from './registry';

export {
  ADAPTERS,
  GENERIC_LAYER_KEY,
  SEED_CONFIG,
  SEED_IS_VALID,
  SEED_VERSION,
  buildConfigFromAdapters,
  captureFromAdapter,
  compareSemver,
  configLayerKeys,
  configLayerPlan,
  detectAts,
  detectAtsId,
  getAdapter,
  isConfigNewer,
  isConfirmationState,
  parseRemoteConfig,
  resolveAdapterConfig,
  resolveFillQuirks,
  resolveModelBudgets,
  resolveSynonyms,
} from './registry';
