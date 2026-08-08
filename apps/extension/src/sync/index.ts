/**
 * sync/index.ts — barrel for the Phase-2 sync client (JF-001 Rev 3.0, F-15).
 *
 * The whole module is behind an explicit opt-in. INV-3 (local-first) is not a comment here: every
 * exported entry point returns `{ ok: false, error: { code: 'not-paired' } }` when the user has
 * never paired, so importing this barrel can never make a v1 code path depend on the network.
 *
 * Typical wiring in the service worker (`src/background/**`, owned by S1):
 *
 *   SYNC_STATUS  → `status()`
 *   SYNC_PAIR    → `requestPairing(code, deviceName)`
 *   SYNC_UNPAIR  → `unpair()`
 *   SYNC_PUSH    → `sealProfileVault(buildSyncProfileVault(profiles, activeId, Date.now()),
 *                                    rawKeyMaterial(vaultKey), state.profileVersion + 1)`
 *                  → `pushProfileBlob(envelope)` → on `isVersionConflict(error)`:
 *                    `openProfileVault(error.remote, rawKeyMaterial(vaultKey))`, merge, re-seal at
 *                    `error.remoteVersion + 1`, push again.
 *                  → `pushMappings()` / `pushApplications(rows)`
 *   SYNC_CONNECT → `redeemHandoff(...)` — the web onboarding hands over a pair code and the vault
 *                  key in one message; see `background/handlers/sync.ts`.
 *
 * `toBusError(error)` maps any `SyncError` onto the `shared/messages.ts` bus vocabulary.
 */

export {
  applyPulledMappings,
  defaultDeviceName,
  deleteApplication,
  flattenMappingStore,
  foldMappingRows,
  hasVaultKey,
  isPaired,
  isVersionConflict,
  listAllApplications,
  listApplications,
  patchApplication,
  pullMappings,
  pullProfileBlob,
  pushApplication,
  pushApplications,
  pushMappings,
  pushProfileBlob,
  readLocalMappings,
  readSyncState,
  readVaultKey,
  requestPairing,
  status,
  SYNC_ROUTES,
  toBusError,
  unpair,
  writeVaultKey,
} from '@/sync/client';

export type {
  ApplicationPage,
  SyncError,
  SyncErrorCode,
  SyncResult,
  VersionConflictError,
} from '@/sync/client';

export {
  base64ToBytes,
  buildSyncProfileVault,
  bytesToBase64,
  canOpenProfileVault,
  DEVICE_TOKEN_MAGIC,
  E2E_MAGIC,
  forgetInstallSecret,
  generateVaultKey,
  hasSealedHeader,
  isBase64OfLength,
  isVaultError,
  isVaultKey,
  openBlob,
  openDeviceToken,
  openProfileVault,
  openVaultKey,
  passphraseMaterial,
  randomBytes,
  rawKeyMaterial,
  sealBlob,
  sealDeviceToken,
  sealProfileVault,
  sealVaultKey,
  syncProfileVaultSchema,
  VaultError,
} from '@/sync/e2e';

export type { SealedBlob, SealedBlobMagic, SyncProfileVault, VaultKeyMaterial } from '@/sync/e2e';

export {
  assertSyncSafe,
  checkSyncSafe,
  classifySyncBody,
  GEMINI_KEY_PATTERN,
  isKeyShaped,
  isSyncGuardError,
  SYNC_BODY_KINDS,
  SyncGuardError,
} from '@/sync/guard';

export type { SyncBodyKind, SyncGuardReason } from '@/sync/guard';
