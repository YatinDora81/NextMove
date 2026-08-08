import type { KeyState, KeyStatus, ModelId } from '@repo/rotation';

export type {
  KeyLedger,
  KeyState,
  KeyStatus,
  ModelBudget,
  ModelBudgets,
  ModelId,
  Outcome,
  PoolSnapshot,
} from '@repo/rotation';

export interface FieldSignature {
  label: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string;
  inputType:
    | 'text'
    | 'email'
    | 'tel'
    | 'url'
    | 'textarea'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'date'
    | 'file'
    | 'combobox';
  sectionHeading: string;
  frameId: number;
  hash: string;
}

export interface FieldNode {
  el: unknown;
  sig: FieldSignature;
  visible: boolean;
  required: boolean;
}

export type ProfilePath = string;

export interface MatchResult {
  node: FieldNode;
  path: ProfilePath | null;
  score: number;
  source: 'user-mapping' | 'adapter' | 'autocomplete' | 'heuristic' | 'ai';
  action: 'fill' | 'suggest' | 'skip';
}

export interface FillReport {
  atsId: string;
  url: string;
  filled: number;
  suggested: number;
  skipped: number;
  errors: number;
  perField: Array<{ hash: string; action: string; ok: boolean }>;
}

export type InputKind = FieldSignature['inputType'];

export type MatchSource = MatchResult['source'];

export type FillAction = 'fill' | 'suggest' | 'skip';

export type AtsId =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'icims'
  | 'ashby'
  | 'smartrecruiters'
  | 'taleo'
  | 'generic';

export type AnswerSource = 'ai' | 'ai-edited' | 'user';

export type AppStatus = 'draft' | 'applied' | 'interview' | 'offer' | 'rejected' | 'ghosted';

export type FillTrigger = 'popup' | 'shortcut' | 'pill' | 'context-menu' | 'auto';

export type AnswerTone = 'concise' | 'enthusiastic' | 'formal';

export type AnswerLength = 'short' | 'medium' | 'long';

export type CoverLetterPreset = 'short' | 'standard' | 'detailed';

export type AnswerScope = 'profile' | 'global';

export type RemotePreference = 'onsite' | 'hybrid' | 'remote' | 'flexible';

export type CompensationPeriod = 'hour' | 'day' | 'month' | 'year';

export type SyncScope = 'profile' | 'mappings' | 'applications';

export type FillableElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | HTMLElement;

export interface PostalAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface ProfilePersonal {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: PostalAddress;
}

export interface ProfileLinks {
  linkedin: string;
  github: string;
  portfolio: string;
  other: string[];
}

export interface WorkEntry {
  title: string;
  company: string;
  location: string;
  start: string;
  end: string | null;
  current: boolean;
  bullets: string[];
}

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  start: string;
  end: string | null;
  gpa: string;
}

export interface ProfileAuthorization {
  authorizedIn: string[];
  needsSponsorship: Record<string, boolean>;
  visaStatus: string;
  willingToRelocate: boolean;
  remotePreference: RemotePreference;
}

export interface ProfileEeo {
  gender: string;
  ethnicity: string;
  veteran: string;
  disability: string;
  declineToState: boolean;
}

export interface ExpectedCompensation {
  amount: number;
  currency: string;
  period: CompensationPeriod;
}

export interface ProfileCompensation {
  expected: ExpectedCompensation;
  noticePeriodDays: number;
}

export interface ProfileAnswer {
  q: string;
  a: string;
  reusable: boolean;
}

export interface Profile {
  id: string;
  label: string;
  isDefault: boolean;
  summary?: string;
  personal: ProfilePersonal;
  links: ProfileLinks;
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  authorization: ProfileAuthorization;
  eeo: ProfileEeo;
  compensation: ProfileCompensation;
  answers: ProfileAnswer[];
  updatedAt: number;
}

export type ProfileDraft = Omit<Profile, 'id' | 'label' | 'isDefault' | 'updatedAt'>;

export interface GeminiKeyRecord {
  id: string;
  label: string;
  ct: string;
  iv: string;
  addedAt: number;
  state: KeyState;
}

export interface GeminiKeyPublic {
  id: string;
  label: string;
  masked: string;
  status: KeyStatus;
  strikes: number;
  addedAt: number;
  lastUsedAt: number;
  retryAt: number | null;
}

export type MappingStore = Record<string, Record<string, ProfilePath>>;

export interface MetaRecord {
  schemaVersion: number;
  installId: string;
  createdAt: number;
  lastMigratedAt?: number | null;
}

export interface ApplicationRow {
  id: string;
  company: string;
  role: string;
  url: string;
  ats: AtsId;
  profileId: string;
  status: AppStatus;
  appliedAt: number | null;
  fillStats: { filled: number; total: number };
  notes: string;
  history: Array<{ at: number; to: AppStatus }>;
  updatedAt?: number;
  syncedAt?: number | null;
}

export interface ApplicationLogInput {
  company: string;
  role: string;
  url: string;
  ats: AtsId;
  profileId: string;
  status?: AppStatus;
  fillStats?: { filled: number; total: number };
  notes?: string;
}

export type ApplicationPatch = Partial<Omit<ApplicationRow, 'id'>>;

export interface TrackerStats {
  appliedThisWeek: number;
  total: number;
  activeInterviews: number;
  responseRate: number;
  medianDaysToResponse: number | null;
}

export interface TrackerQuery {
  status?: AppStatus | null;
  ats?: AtsId | null;
  profileId?: string | null;
  from?: number | null;
  to?: number | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface AnswerRecord {
  id: string;
  qNorm: string;
  qRaw: string;
  answer: string;
  template: boolean;
  source: AnswerSource;
  scope: AnswerScope;
  profileId: string | null;
  timesUsed: number;
  lastUsedAt: number;
  createdAt: number;
}

export interface AnswerHit {
  id: string;
  answer: string;
  similarity: number;
  kind: 'same' | 'similar';
  record: AnswerRecord;
}

export interface ResumeRecord {
  id: string;
  profileId: string | null;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  tags: string[];
  isDefault: boolean;
  addedAt: number;
}

export interface ParseCacheRecord {
  resumeId: string;
  text: string;
  draft: ProfileDraft | null;
  model: ModelId | null;
  parsedAt: number;
}

export interface JobContext {
  title: string;
  company: string;
  jd: string;
  url: string;
}

export interface Settings {
  activeProfileId: string | null;

  fillThreshold: number;
  suggestThreshold: number;

  autoFillOnLoad: boolean;
  showFloatingPill: boolean;
  highlightFilled: boolean;
  humanPacing: boolean;
  reviewOverlay: boolean;

  tone: AnswerTone;
  answerLength: AnswerLength;
  preferredModel: ModelId;
  modelFallbackChain: ModelId[];
  reuseBankedAnswers: boolean;

  autoLogApplications: boolean;
  autoCaptureJobContext: boolean;

  remoteConfigEnabled: boolean;
  syncEnabled: boolean;
  telemetryOptIn: boolean;

  updatedAt: number;
}

export interface SyncState {
  paired: boolean;
  deviceId: string | null;
  deviceName: string | null;
  email: string | null;
  tokenCt: string | null;
  tokenIv: string | null;
  vaultKeyCt: string | null;
  vaultKeyIv: string | null;
  profileVersion: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface RemoteAdapterEntry {
  fieldMap?: Record<string, ProfilePath>;
  quirks?: Record<string, unknown>;
  capture?: { company?: string[]; role?: string[] };
  confirmation?: { urlPatterns?: string[]; selectors?: string[] };
}

export interface RemoteConfig {
  version: string;
  updatedAt: string;
  modelBudgets?: Record<string, { rpm: number; rpd: number }>;
  synonyms?: Record<string, string[]>;
  adapters?: Record<string, RemoteAdapterEntry>;
}

export interface RemoteConfigCache {
  config: RemoteConfig | null;
  fetchedAt: number;
  lastError: string | null;
}

export interface ResolvedAdapterConfig {
  atsId: AtsId;
  version: string;
  source: 'seed' | 'remote';
  fieldMap: Record<string, ProfilePath>;
  quirks: Record<string, unknown>;
  synonyms: Record<string, string[]>;
  capture: { company: string[]; role: string[] };
  confirmation: { urlPatterns: string[]; selectors: string[] };
}
