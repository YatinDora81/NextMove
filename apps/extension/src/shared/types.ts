/**
 * shared/types.ts — the spine of the system.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 6.2  Core Type Contracts (FieldSignature / FieldNode / ProfilePath / MatchResult / FillReport)
 *   SEC 6.3  FieldMatcher scoring vocabulary (MatchSource, FillAction)
 *   SEC 6.7  Tracker rows and auto-capture context
 *   SEC 7.1  Storage map (meta, profiles, settings, keys, mappings, sync)
 *   SEC 7.2  Profile schema (the vault)
 *   SEC 7.3  Key records, mappings, tracker rows, answer bank
 *   SEC 8.2  Pairing / sync state
 *   SEC 14.1 R-3 — this module may only depend on `@repo/rotation` (pure, dependency-free).
 *
 * Rules of the house:
 *   - No DOM types leak into the storage contracts; `FieldNode.el` is deliberately `unknown`
 *     (SEC 6.2 verbatim) so the service worker can hold a FieldNode-shaped record without
 *     dragging `lib.dom` into non-DOM contexts. Narrow with `asElement()` at the call site.
 *   - Every interface here is mirrored by a Zod schema in `shared/schema.ts`; the two are
 *     pinned together by compile-time drift guards in that file.
 */

import type { KeyState, KeyStatus, ModelId } from '@repo/rotation';

/** Re-exported so the rest of the extension has a single import surface for rotation types. */
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

/* ------------------------------------------------------------------------------------------------
 * SEC 6.2 — Core type contracts (verbatim)
 * ---------------------------------------------------------------------------------------------- */

export interface FieldSignature {
  label: string; // resolved via <label for>, wrapping label, aria-labelledby, or nearest text
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string; // autocomplete attr = highest-trust signal
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
  sectionHeading: string; // nearest h1–h4/fieldset legend — disambiguates "Name" fields
  frameId: number;
  hash: string; // sha1(normalized signature) — mapping key
}

export interface FieldNode {
  el: unknown;
  sig: FieldSignature;
  visible: boolean;
  required: boolean;
}

export type ProfilePath = string; // dot path into vault: "personal.firstName", "work[0].title"

export interface MatchResult {
  node: FieldNode;
  path: ProfilePath | null;
  score: number; // 0–100
  source: 'user-mapping' | 'adapter' | 'autocomplete' | 'heuristic' | 'ai';
  action: 'fill' | 'suggest' | 'skip'; // ≥70 fill · 50–69 suggest · <50 skip (INV-4)
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

/* ------------------------------------------------------------------------------------------------
 * Derived vocabulary — aliases over the unions above so nobody re-types them
 * ---------------------------------------------------------------------------------------------- */

/** The 11 input kinds the FillEngine knows how to drive (SEC 6.4). */
export type InputKind = FieldSignature['inputType'];

/** Which tier of the SEC 6.3 authority chain produced a match. */
export type MatchSource = MatchResult['source'];

/** INV-4 outcome for a single field. */
export type FillAction = 'fill' | 'suggest' | 'skip';

/** Adapters of record (SEC 6.5). `generic` is the always-true fallback. */
export type AtsId =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'icims'
  | 'ashby'
  | 'smartrecruiters'
  | 'taleo'
  | 'generic';

/** Provenance of a banked answer (SEC 5.7). */
export type AnswerSource = 'ai' | 'ai-edited' | 'user';

/** Tracker lifecycle (SEC 6.7). Lowercase on-device; the cloud enum is uppercase (SEC 7.4). */
export type AppStatus = 'draft' | 'applied' | 'interview' | 'offer' | 'rejected' | 'ghosted';

/** What caused a fill run. `auto` exists only for opt-in re-fills, never for submits (INV-1). */
export type FillTrigger = 'popup' | 'shortcut' | 'pill' | 'context-menu' | 'auto';

/** Tone presets for AI answers and cover letters (F-09 / F-10). */
export type AnswerTone = 'concise' | 'enthusiastic' | 'formal';

/** Length presets for generated answers. */
export type AnswerLength = 'short' | 'medium' | 'long';

/** Cover-letter length presets (SEC 5.5 cover_letter.v1). */
export type CoverLetterPreset = 'short' | 'standard' | 'detailed';

/** Where a banked answer applies. */
export type AnswerScope = 'profile' | 'global';

/** Remote-work stance asked by nearly every ATS. */
export type RemotePreference = 'onsite' | 'hybrid' | 'remote' | 'flexible';

/** Expected-compensation cadence. */
export type CompensationPeriod = 'hour' | 'day' | 'month' | 'year';

/** Which slices Phase-2 sync may push (SEC 8.3). Keys and the Answer Bank are never listed. */
export type SyncScope = 'profile' | 'mappings' | 'applications';

/**
 * Convenience narrowing for `FieldNode.el`. The scanner stores real elements; the type is
 * `unknown` so storage contracts stay DOM-free (SEC 6.2).
 */
export type FillableElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | HTMLElement;

/* ------------------------------------------------------------------------------------------------
 * SEC 7.2 — Profile schema (the vault)
 * ---------------------------------------------------------------------------------------------- */

export interface PostalAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // ISO-3166 alpha-2 when known ("IN", "US"), free text otherwise
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
  start: string; // "YYYY-MM"
  end: string | null; // null ⇒ current
  current: boolean;
  bullets: string[]; // feeds AI answers & cover letters
}

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  start: string; // "YYYY-MM"
  end: string | null;
  gpa: string; // free text — "8.4/10", "3.9", ""
}

export interface ProfileAuthorization {
  authorizedIn: string[]; // country codes the applicant may already work in
  needsSponsorship: Record<string, boolean>; // country code → needs sponsorship there
  visaStatus: string;
  willingToRelocate: boolean;
  remotePreference: RemotePreference;
}

export interface ProfileEeo {
  gender: string;
  ethnicity: string;
  veteran: string;
  disability: string;
  declineToState: boolean; // user may set this globally; fill engine then answers "decline"
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
  /** Short elevator pitch. Optional because a resume parse may not produce one. */
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

/**
 * Output contract of `resume_extract.v1` (SEC 5.5): everything a resume can tell us, minus the
 * identity fields the client assigns. Zod mirror: `resumeExtractOutputSchema` in shared/schema.ts.
 */
export type ProfileDraft = Omit<Profile, 'id' | 'label' | 'isDefault' | 'updatedAt'>;

/* ------------------------------------------------------------------------------------------------
 * SEC 7.3 — Key records, mappings, tracker, answer bank
 * ---------------------------------------------------------------------------------------------- */

/**
 * `jf.keys` row. The plaintext key is NEVER stored: `ct`/`iv` are the AES-256-GCM envelope and
 * the rotation ledgers live in `state` (SEC 5.4, math owned by `@repo/rotation`). INV-5: this
 * record must never be logged, never synced, never sent to the NextMove API.
 */
export interface GeminiKeyRecord {
  id: string;
  label: string;
  ct: string; // base64 AES-256-GCM ciphertext (includes auth tag)
  iv: string; // base64, 12 bytes, unique per encryption
  addedAt: number;
  state: KeyState;
}

/** Everything the UI is allowed to see about a key (INV-5 — no `ct`, no `iv`, no plaintext). */
export interface GeminiKeyPublic {
  id: string;
  label: string;
  masked: string; // "AIza…9F2k"
  status: KeyStatus;
  strikes: number;
  addedAt: number;
  lastUsedAt: number;
  /** epoch ms this key can serve the current model again; null when it is usable right now. */
  retryAt: number | null;
}

/** `jf.mappings` — learn-from-correction (F-13): domain → sigHash → profile path. */
export type MappingStore = Record<string, Record<string, ProfilePath>>;

/** `jf.meta` — drives migrations (SEC 7.1). */
export interface MetaRecord {
  schemaVersion: number;
  installId: string;
  createdAt: number;
  lastMigratedAt?: number | null;
}

/** Dexie `applications` row — the tracker (F-12 / SEC 6.7). */
export interface ApplicationRow {
  id: string;
  company: string;
  role: string;
  url: string;
  ats: AtsId;
  profileId: string;
  status: AppStatus;
  appliedAt: number | null; // null while the row is still `draft`
  fillStats: { filled: number; total: number };
  notes: string;
  history: Array<{ at: number; to: AppStatus }>;
  /** Local mtime — drives last-write-wins during Phase-2 sync. */
  updatedAt?: number;
  /** epoch ms of the last successful push to `/api/job-applications`; null when never synced. */
  syncedAt?: number | null;
}

/** Everything the tracker needs to open a row; the service fills in id/status/history. */
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

/** Partial update for an existing tracker row. */
export type ApplicationPatch = Partial<Omit<ApplicationRow, 'id'>>;

/** Stats strip on the tracker dashboard (SEC 6.7). */
export interface TrackerStats {
  appliedThisWeek: number;
  total: number;
  activeInterviews: number;
  /** 0–1: share of applied rows that reached interview or beyond. */
  responseRate: number;
  /** null until at least one row has a recorded response. */
  medianDaysToResponse: number | null;
}

/** Filters accepted by the tracker dashboard and the popup mini-tracker. */
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

/** Dexie `answerBank` row — ask once, reuse forever (F-17 / SEC 5.7). */
export interface AnswerRecord {
  id: string;
  qNorm: string; // normalized, company name replaced by the {company} token
  qRaw: string;
  answer: string;
  template: boolean; // true ⇒ {company} is re-substituted on every reuse
  source: AnswerSource;
  scope: AnswerScope;
  profileId: string | null; // null ⇒ global scope
  timesUsed: number;
  lastUsedAt: number;
  createdAt: number;
}

/** A bank hit, ready to be offered above the field. */
export interface AnswerHit {
  id: string;
  answer: string; // already re-substituted for the current company
  similarity: number; // 0–1
  kind: 'same' | 'similar'; // ≥ SAME_Q ⇒ same, ≥ SIMILAR_Q ⇒ similar
  record: AnswerRecord;
}

/** Dexie `resumes` row. Blobs never leave IndexedDB; only extracted text can reach Gemini. */
export interface ResumeRecord {
  id: string;
  profileId: string | null; // null ⇒ shared across profiles
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  tags: string[];
  isDefault: boolean;
  addedAt: number;
}

/** Dexie `parseCache` row — re-parse a resume without re-spending quota (SEC 7.1). */
export interface ParseCacheRecord {
  resumeId: string;
  text: string;
  draft: ProfileDraft | null;
  model: ModelId | null;
  parsedAt: number;
}

/* ------------------------------------------------------------------------------------------------
 * Job context, settings, sync state, remote config
 * ---------------------------------------------------------------------------------------------- */

/** Auto-captured posting context (SEC 6.7). `jd` is truncated before it reaches a prompt. */
export interface JobContext {
  title: string;
  company: string;
  jd: string;
  url: string;
}

/** `jf.settings` (SEC 7.1). Defaults live in `shared/constants.ts` as `DEFAULT_SETTINGS`. */
export interface Settings {
  activeProfileId: string | null;

  // Matcher thresholds (INV-4). User-tunable but clamped to 0–100 by the Zod mirror.
  fillThreshold: number;
  suggestThreshold: number;

  // Fill behaviour
  autoFillOnLoad: boolean; // opt-in; never touches submit controls (INV-1)
  showFloatingPill: boolean;
  highlightFilled: boolean;
  humanPacing: boolean; // jittered inter-field delays (SEC 6.4)
  reviewOverlay: boolean; // F-06 review-before-submit summary

  // AI (INV-2 — every one of these is still gesture-gated at the bus)
  tone: AnswerTone;
  answerLength: AnswerLength;
  preferredModel: ModelId;
  modelFallbackChain: ModelId[];
  reuseBankedAnswers: boolean; // F-17 lookup before any key lease

  // Tracker
  autoLogApplications: boolean;
  autoCaptureJobContext: boolean;

  // Platform
  remoteConfigEnabled: boolean; // F-14 daily adapters.json poll
  syncEnabled: boolean; // P2 only; false keeps the extension fully local (INV-3)
  telemetryOptIn: boolean; // F-16 is V2 and opt-in — ships false, stays false in v1

  updatedAt: number;
}

/** `jf.sync` — Phase-2 pairing state (SEC 8.2). The device JWT is stored encrypted. */
export interface SyncState {
  paired: boolean;
  deviceId: string | null;
  deviceName: string | null;
  email: string | null;
  tokenCt: string | null; // base64 AES-256-GCM ciphertext of the device-bound JWT
  tokenIv: string | null; // base64, 12 bytes
  /**
   * The E2E vault key, sealed at rest with the per-install secret. Arrives from the web onboarding
   * handoff (or is minted here for an account that has no vault yet) and never leaves the device —
   * the server stores only the ciphertext it opens.
   */
  vaultKeyCt: string | null;
  vaultKeyIv: string | null;
  /** Optimistic-concurrency version of the last ProfileBlob we pushed/pulled. */
  profileVersion: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

/** One adapter's remote override block (mirrors `remoteAdapterConfigSchema` in @repo/types). */
export interface RemoteAdapterEntry {
  fieldMap?: Record<string, ProfilePath>;
  quirks?: Record<string, unknown>;
  capture?: { company?: string[]; role?: string[] };
  confirmation?: { urlPatterns?: string[]; selectors?: string[] };
}

/**
 * F-14 remote selector config, served as static JSON from Vercel's CDN.
 * MV3-legal: this is *data*, never code. Zod-validated and semver-gated before it can
 * replace the shipped seed.
 */
export interface RemoteConfig {
  version: string; // semver
  updatedAt: string; // ISO
  modelBudgets?: Record<string, { rpm: number; rpd: number }>;
  synonyms?: Record<string, string[]>;
  adapters?: Record<string, RemoteAdapterEntry>;
}

/** What the service worker actually keeps: the config plus when we last fetched it. */
export interface RemoteConfigCache {
  config: RemoteConfig | null;
  fetchedAt: number;
  lastError: string | null;
}

/** Resolved adapter data handed to a content script (seed ⊕ remote). */
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
