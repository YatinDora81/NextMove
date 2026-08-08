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
