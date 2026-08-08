import { z } from 'zod';

import {
  compensationPeriodSchema,
  createEmptyProfile,
  draftToProfile,
  educationEntrySchema,
  EMPTY_PROFILE,
  expectedCompensationSchema,
  postalAddressSchema,
  profileAnswerSchema,
  profileAuthorizationSchema,
  profileCompensationSchema,
  profileEeoSchema,
  profileLinksSchema,
  profileListSchema,
  profilePatchSchema,
  profilePersonalSchema,
  profileSchema,
  remotePreferenceSchema,
  resumeExtractOutputSchema,
  workEntrySchema,
} from '@repo/types/ProfileTypes';

import { DEFAULT_SETTINGS, DEFAULT_SYNC_STATE, SCHEMA_VERSION } from './constants';
import { BUS_ERROR_CODES, MESSAGE_TYPES } from './messages';
import type { BusErrorCode, MessageType } from './messages';
import type {
  AnswerRecord,
  ApplicationRow,
  KeyState,
  MappingStore,
  MetaRecord,
  Profile,
  ProfileDraft,
  Settings,
  SyncState,
} from './types';

type Extends<Target, Candidate extends Target> = Candidate extends Target ? true : never;

export const atsIdSchema = z.enum([
  'greenhouse',
  'lever',
  'workday',
  'icims',
  'ashby',
  'smartrecruiters',
  'taleo',
  'generic',
]);

export const appStatusSchema = z.enum([
  'draft',
  'applied',
  'interview',
  'offer',
  'rejected',
  'ghosted',
]);

export const answerSourceSchema = z.enum(['ai', 'ai-edited', 'user']);
export const answerScopeSchema = z.enum(['profile', 'global']);
export const answerToneSchema = z.enum(['concise', 'enthusiastic', 'formal']);
export const answerLengthSchema = z.enum(['short', 'medium', 'long']);
export const coverLetterPresetSchema = z.enum(['short', 'standard', 'detailed']);
export const fillActionSchema = z.enum(['fill', 'suggest', 'skip']);
export const matchSourceSchema = z.enum([
  'user-mapping',
  'adapter',
  'autocomplete',
  'heuristic',
  'ai',
]);
export const inputKindSchema = z.enum([
  'text',
  'email',
  'tel',
  'url',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'date',
  'file',
  'combobox',
]);
export const keyStatusSchema = z.enum(['ACTIVE', 'COOLDOWN', 'EXHAUSTED', 'DEAD']);
export const syncScopeSchema = z.enum(['profile', 'mappings', 'applications']);

const epochMs = z.number().int().nonnegative();

export {
  compensationPeriodSchema,
  createEmptyProfile,
  draftToProfile,
  educationEntrySchema,
  EMPTY_PROFILE,
  expectedCompensationSchema,
  postalAddressSchema,
  profileAnswerSchema,
  profileAuthorizationSchema,
  profileCompensationSchema,
  profileEeoSchema,
  profileLinksSchema,
  profileListSchema,
  profilePatchSchema,
  profilePersonalSchema,
  profileSchema,
  remotePreferenceSchema,
  resumeExtractOutputSchema,
  workEntrySchema,
};

export type ProfileZodMatchesInterface = Extends<Profile, z.infer<typeof profileSchema>>;
export type ProfileInterfaceMatchesZod = Extends<z.infer<typeof profileSchema>, Profile>;

export type ProfileDraftZodMatchesInterface = Extends<
  ProfileDraft,
  z.infer<typeof resumeExtractOutputSchema>
>;
export type ProfileDraftInterfaceMatchesZod = Extends<
  z.infer<typeof resumeExtractOutputSchema>,
  ProfileDraft
>;

const score = z.number().int().min(0).max(100);

export const settingsSchema = z.object({
  activeProfileId: z.string().nullable().default(DEFAULT_SETTINGS.activeProfileId),

  fillThreshold: score.default(DEFAULT_SETTINGS.fillThreshold),
  suggestThreshold: score.default(DEFAULT_SETTINGS.suggestThreshold),

  autoFillOnLoad: z.boolean().default(DEFAULT_SETTINGS.autoFillOnLoad),
  showFloatingPill: z.boolean().default(DEFAULT_SETTINGS.showFloatingPill),
  highlightFilled: z.boolean().default(DEFAULT_SETTINGS.highlightFilled),
  humanPacing: z.boolean().default(DEFAULT_SETTINGS.humanPacing),
  reviewOverlay: z.boolean().default(DEFAULT_SETTINGS.reviewOverlay),

  tone: answerToneSchema.default(DEFAULT_SETTINGS.tone),
  answerLength: answerLengthSchema.default(DEFAULT_SETTINGS.answerLength),
  preferredModel: z.string().default(DEFAULT_SETTINGS.preferredModel),
  modelFallbackChain: z.array(z.string()).default([...DEFAULT_SETTINGS.modelFallbackChain]),
  reuseBankedAnswers: z.boolean().default(DEFAULT_SETTINGS.reuseBankedAnswers),

  autoLogApplications: z.boolean().default(DEFAULT_SETTINGS.autoLogApplications),
  autoCaptureJobContext: z.boolean().default(DEFAULT_SETTINGS.autoCaptureJobContext),

  remoteConfigEnabled: z.boolean().default(DEFAULT_SETTINGS.remoteConfigEnabled),
  syncEnabled: z.boolean().default(DEFAULT_SETTINGS.syncEnabled),
  telemetryOptIn: z.boolean().default(DEFAULT_SETTINGS.telemetryOptIn),

  updatedAt: epochMs.default(DEFAULT_SETTINGS.updatedAt),
});

export type SettingsZodMatchesInterface = Extends<Settings, z.infer<typeof settingsSchema>>;
export type SettingsInterfaceMatchesZod = Extends<z.infer<typeof settingsSchema>, Settings>;

export const settingsPatchSchema = settingsSchema.partial();

export const fillStatsSchema = z.object({
  filled: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const applicationHistoryEntrySchema = z.object({
  at: epochMs,
  to: appStatusSchema,
});

export const applicationRowSchema = z.object({
  id: z.string().min(1),
  company: z.string(),
  role: z.string(),
  url: z.string(),
  ats: atsIdSchema,
  profileId: z.string(),
  status: appStatusSchema,
  appliedAt: epochMs.nullable(),
  fillStats: fillStatsSchema,
  notes: z.string(),
  history: z.array(applicationHistoryEntrySchema),
  updatedAt: epochMs.optional(),
  syncedAt: epochMs.nullable().optional(),
});

export type ApplicationRowZodMatchesInterface = Extends<
  ApplicationRow,
  z.infer<typeof applicationRowSchema>
>;
export type ApplicationRowInterfaceMatchesZod = Extends<
  z.infer<typeof applicationRowSchema>,
  ApplicationRow
>;

export const applicationPatchSchema = applicationRowSchema.partial().omit({ id: true });

export const applicationLogInputSchema = z.object({
  company: z.string(),
  role: z.string(),
  url: z.string(),
  ats: atsIdSchema,
  profileId: z.string(),
  status: appStatusSchema.optional(),
  fillStats: fillStatsSchema.optional(),
  notes: z.string().optional(),
});

export const answerRecordSchema = z.object({
  id: z.string().min(1),
  qNorm: z.string(),
  qRaw: z.string(),
  answer: z.string(),
  template: z.boolean(),
  source: answerSourceSchema,
  scope: answerScopeSchema,
  profileId: z.string().nullable(),
  timesUsed: z.number().int().nonnegative(),
  lastUsedAt: epochMs,
  createdAt: epochMs,
});

export type AnswerRecordZodMatchesInterface = Extends<
  AnswerRecord,
  z.infer<typeof answerRecordSchema>
>;
export type AnswerRecordInterfaceMatchesZod = Extends<
  z.infer<typeof answerRecordSchema>,
  AnswerRecord
>;

export const metaRecordSchema = z.object({
  schemaVersion: z.number().int().positive().default(SCHEMA_VERSION),
  installId: z.string(),
  createdAt: epochMs,
  lastMigratedAt: epochMs.nullable().optional(),
});

export type MetaRecordZodMatchesInterface = Extends<MetaRecord, z.infer<typeof metaRecordSchema>>;
export type MetaRecordInterfaceMatchesZod = Extends<z.infer<typeof metaRecordSchema>, MetaRecord>;

export const mappingStoreSchema = z.record(z.string(), z.record(z.string(), z.string()));

export type MappingStoreZodMatchesInterface = Extends<
  MappingStore,
  z.infer<typeof mappingStoreSchema>
>;
export type MappingStoreInterfaceMatchesZod = Extends<
  z.infer<typeof mappingStoreSchema>,
  MappingStore
>;

export const keyLedgerSchema = z.object({
  used: z.number().int().nonnegative(),
  resetAt: epochMs,
});

export const keyStateSchema = z.object({
  id: z.string().min(1),
  status: keyStatusSchema,
  strikes: z.number().int().nonnegative(),
  cooldownUntil: epochMs,
  lastUsedAt: epochMs,
  rpm: z.record(z.string(), z.array(z.number())),
  daily: z.record(z.string(), keyLedgerSchema),
});

export type KeyStateZodMatchesInterface = Extends<KeyState, z.infer<typeof keyStateSchema>>;

export const geminiKeyRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  ct: z.string().min(1),
  iv: z.string().min(1),
  addedAt: epochMs,
  state: keyStateSchema,
});

export const geminiKeyRecordListSchema = z.array(geminiKeyRecordSchema);

export const syncStateSchema = z.object({
  paired: z.boolean().default(DEFAULT_SYNC_STATE.paired),
  deviceId: z.string().nullable().default(DEFAULT_SYNC_STATE.deviceId),
  deviceName: z.string().nullable().default(DEFAULT_SYNC_STATE.deviceName),
  email: z.string().nullable().default(DEFAULT_SYNC_STATE.email),
  tokenCt: z.string().nullable().default(DEFAULT_SYNC_STATE.tokenCt),
  tokenIv: z.string().nullable().default(DEFAULT_SYNC_STATE.tokenIv),
  vaultKeyCt: z.string().nullable().default(DEFAULT_SYNC_STATE.vaultKeyCt),
  vaultKeyIv: z.string().nullable().default(DEFAULT_SYNC_STATE.vaultKeyIv),
  profileVersion: z.number().int().nonnegative().default(DEFAULT_SYNC_STATE.profileVersion),
  lastSyncAt: epochMs.nullable().default(DEFAULT_SYNC_STATE.lastSyncAt),
  lastError: z.string().nullable().default(DEFAULT_SYNC_STATE.lastError),
});

export type SyncStateZodMatchesInterface = Extends<SyncState, z.infer<typeof syncStateSchema>>;
export type SyncStateInterfaceMatchesZod = Extends<z.infer<typeof syncStateSchema>, SyncState>;

export const fieldSignatureSchema = z.object({
  label: z.string(),
  name: z.string(),
  id: z.string(),
  placeholder: z.string(),
  ariaLabel: z.string(),
  autocomplete: z.string(),
  inputType: inputKindSchema,
  sectionHeading: z.string(),
  frameId: z.number().int(),
  hash: z.string(),
});

export const fillReportSchema = z.object({
  atsId: z.string(),
  url: z.string(),
  filled: z.number().int().nonnegative(),
  suggested: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  perField: z.array(
    z.object({ hash: z.string(), action: z.string(), ok: z.boolean() }),
  ),
});

export const jobContextSchema = z.object({
  title: z.string(),
  company: z.string(),
  jd: z.string(),
  url: z.string(),
});

export const messageTypeSchema = z.enum(
  [...MESSAGE_TYPES] as [MessageType, ...MessageType[]],
);

export const busErrorCodeSchema = z.enum(
  [...BUS_ERROR_CODES] as [BusErrorCode, ...BusErrorCode[]],
);

export const messageEnvelopeSchema = z.object({
  type: messageTypeSchema,
  reqId: z.string().min(1),
  payload: z.unknown(),
  gesture: z.string().min(1).optional(),
});

export const busErrorSchema = z.object({
  code: busErrorCodeSchema,
  message: z.string(),
  retryAt: z.number().optional(),
});

export const coverLetterOutputSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
});

export const disambiguateOutputSchema = z.object({
  path: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type CoverLetterOutput = z.infer<typeof coverLetterOutputSchema>;
export type DisambiguateOutput = z.infer<typeof disambiguateOutputSchema>;
