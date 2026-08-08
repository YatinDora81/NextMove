/**
 * shared/constants.ts — every magic number in JobFill, named once.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 5.2  Free-tier model ids (budgets themselves live in @repo/rotation / remote config)
 *   SEC 5.4  Rotation timings and the Gemini request budget
 *   SEC 5.5  Prompt input caps and generation defaults
 *   SEC 5.7  Answer-similarity thresholds
 *   SEC 6.3  FieldMatcher scoring table and INV-4 thresholds
 *   SEC 6.4  Human-paced fill jitter, typeahead pacing, listbox wait cap
 *   SEC 7.1  Storage map (chrome.storage keys + Dexie tables)
 *   SEC 8.2  Pair-code alphabet
 *   SEC 10   Command id
 *   SEC 14.2 Remote config URL / API base URL (plain build-time constants — no env secrets)
 *
 * INV-6 / SEC 14.1 R-3: `API_BASE_URL` MUST NOT be imported from `src/ai/**`. The extension's
 * AI path talks to Google directly and never crosses the NextMove API. This is enforced by
 * `no-restricted-imports` in `apps/extension/eslint.config.js`, not merely promised here.
 */

import type { ModelId, Settings, SyncState } from './types';

/* ------------------------------------------------------------------------------------------------
 * SEC 7.1 — Storage map
 * ---------------------------------------------------------------------------------------------- */

export const STORAGE_KEY_META = 'jf.meta';
export const STORAGE_KEY_PROFILES = 'jf.profiles';
export const STORAGE_KEY_SETTINGS = 'jf.settings';
export const STORAGE_KEY_KEYS = 'jf.keys';
export const STORAGE_KEY_MAPPINGS = 'jf.mappings';
export const STORAGE_KEY_SYNC = 'jf.sync';

/** The complete `chrome.storage.local` surface. Nothing else may be written at the top level. */
export const STORAGE_KEYS = {
  meta: STORAGE_KEY_META,
  profiles: STORAGE_KEY_PROFILES,
  settings: STORAGE_KEY_SETTINGS,
  keys: STORAGE_KEY_KEYS,
  mappings: STORAGE_KEY_MAPPINGS,
  sync: STORAGE_KEY_SYNC,
} as const;

export type StorageKeyName = keyof typeof STORAGE_KEYS;
export type StorageKey = (typeof STORAGE_KEYS)[StorageKeyName];

/** Bumped whenever a stored shape changes; `jf.meta.schemaVersion` drives migrations. */
export const SCHEMA_VERSION = 1;

/** IndexedDB (Dexie) — blobs, tracker rows, parse cache, answer bank. */
export const DB_NAME = 'jobfill';
export const DB_VERSION = 1;
export const DB_TABLES = {
  resumes: 'resumes',
  applications: 'applications',
  parseCache: 'parseCache',
  answerBank: 'answerBank',
} as const;

/** Per-install secret used to derive the vault key (SEC 5.3). Not a top-level storage key. */
export const VAULT_SECRET_KEY = 'jf.vault.secret';
export const VAULT_PBKDF2_ITERATIONS = 210_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;

/* ------------------------------------------------------------------------------------------------
 * SEC 6.3 — FieldMatcher scoring (INV-4: never guess-fill)
 * ---------------------------------------------------------------------------------------------- */

/** score ≥ FILL_THRESHOLD ⇒ fill. */
export const FILL_THRESHOLD = 70;
/** SUGGEST_THRESHOLD ≤ score < FILL_THRESHOLD ⇒ suggest. Below ⇒ skip + flag. */
export const SUGGEST_THRESHOLD = 50;

/** Order of authority: user mapping → adapter → autocomplete → heuristics. */
export const SCORE = {
  userMapping: 100,
  adapter: 98,
  autocomplete: 95,
  exactLabelSynonym: 90,
  tokenSynonym: 75,
  placeholderSynonym: 65,
  fuzzy: 55,
} as const;

export const SCORE_MODIFIER = {
  /** input type agrees with the profile path (email field ↔ email path). */
  inputTypeAgreement: 5,
  /** a "Name" under a *References* heading must not take the applicant's name. */
  conflictingSection: -20,
  /** this profile path was already filled in this form. */
  duplicatePath: -30,
} as const;

/** Jaro-Winkler floor for the fuzzy tier (SEC 6.3). */
export const FUZZY_MIN_SIMILARITY = 0.88;

/** Gray zone where `AI_DISAMBIGUATE` may be offered — user click only (INV-2). */
export const DISAMBIGUATE_MIN_SCORE = SUGGEST_THRESHOLD;
export const DISAMBIGUATE_MAX_SCORE = FILL_THRESHOLD - 1;

/* ------------------------------------------------------------------------------------------------
 * SEC 5.7 — Answer memory similarity
 * ---------------------------------------------------------------------------------------------- */

/** ≥ SAME_Q ⇒ the same question; reuse the banked answer outright. */
export const SAME_Q = 0.92;
/** SIMILAR_Q ≤ s < SAME_Q ⇒ offer a side-by-side "similar question" preview. */
export const SIMILAR_Q = 0.75;

/** Placeholder token substituted for the employer name so answers never leak the wrong company. */
export const COMPANY_TOKEN = '{company}';

/* ------------------------------------------------------------------------------------------------
 * SEC 6.4 — FillEngine pacing
 * ---------------------------------------------------------------------------------------------- */

export interface JitterRange {
  readonly min: number;
  readonly max: number;
}

/** Inter-field delay for a human-paced fill run. */
export const FILL_JITTER_MS: JitterRange = { min: 40, max: 120 };
/** Per-character delay while driving a typeahead / combobox. */
export const TYPEAHEAD_JITTER_MS: JitterRange = { min: 30, max: 60 };
/** Hard cap on waiting for a listbox to appear after typing. Past this ⇒ mark `suggest`. */
export const LISTBOX_WAIT_MS = 3_000;
/** Delay before reading a field back to verify the framework committed our value. */
export const FILL_VERIFY_DELAY_MS = 60;
/** PageObserver debounce for SPA re-renders and multi-step wizards. */
export const OBSERVER_DEBOUNCE_MS = 250;
/** Upper bound on a single fill run so a pathological page can never hang the content script. */
export const FILL_RUN_TIMEOUT_MS = 60_000;

/* ------------------------------------------------------------------------------------------------
 * INV-2 — user-gesture gating
 * ---------------------------------------------------------------------------------------------- */

/** A gesture nonce is valid for 5 seconds. Anything older is refused by the bus. */
export const GESTURE_TTL_MS = 5_000;
export const GESTURE_NONCE_BYTES = 16;

/* ------------------------------------------------------------------------------------------------
 * SEC 5.2 / 5.5 — Gemini
 * ---------------------------------------------------------------------------------------------- */

export const MODEL_FLASH_LITE: ModelId = 'gemini-2.5-flash-lite';
export const MODEL_FLASH: ModelId = 'gemini-2.5-flash';
export const MODEL_FLASH_LEGACY: ModelId = 'gemini-2.0-flash';

/**
 * The free-tier models JobFill will spend a user key on. Their budgets are *approximate* and
 * config-driven — Google revises free-tier limits without notice, so the shipped numbers live in
 * `DEFAULT_MODEL_BUDGETS` (@repo/rotation) and are overridable from remote config (SEC 5.2).
 */
export const FREE_TIER_MODELS: readonly ModelId[] = [
  MODEL_FLASH_LITE,
  MODEL_FLASH,
  MODEL_FLASH_LEGACY,
];

/** Degrade the model before failing the user (SEC 5.4). Mirrors MODEL_FALLBACK_CHAIN. */
export const DEFAULT_MODEL_CHAIN: readonly ModelId[] = [
  MODEL_FLASH_LITE,
  MODEL_FLASH,
  MODEL_FLASH_LEGACY,
];

/** Preferred model per prompt template (SEC 5.5); the chain takes over when a tier is spent. */
export const MODEL_FOR_TASK = {
  screeningAnswer: MODEL_FLASH_LITE,
  disambiguate: MODEL_FLASH_LITE,
  coverLetter: MODEL_FLASH,
  resumeExtract: MODEL_FLASH,
} as const;

export const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
export const GEMINI_API_BASE = GEMINI_API_ORIGIN + '/v1beta';
/** Cheapest possible validation ping for a freshly added key (SEC 5.3). */
export const GEMINI_MODELS_LIST_URL = GEMINI_API_BASE + '/models';
/** Keys travel in this header, never in the query string — keeps them out of URL logs. */
export const GEMINI_API_KEY_HEADER = 'x-goog-api-key';

/** One Gemini call may not outlive this. */
export const GEMINI_TIMEOUT_MS = 25_000;
/** 5xx / network retries on the *same* key before rotating (ledger is refunded — SEC 5.6). */
export const GEMINI_NET_RETRIES = 2;
export const GEMINI_RETRY_JITTER_MS: JitterRange = { min: 250, max: 1_000 };
/** One repair prompt when JSON output fails Zod, then fall back (SEC 5.6). */
export const GEMINI_JSON_REPAIR_ATTEMPTS = 1;

export const GEMINI_DEFAULT_TEMPERATURE = 0.6;
export const GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 700;
export const GEMINI_JSON_MIME = 'application/json';

/** Prompt input caps (SEC 5.5) — truncate before anything is sent. */
export const MAX_JD_CHARS = 6_000;
export const MAX_RESUME_CHARS = 20_000;
export const MAX_QUESTION_CHARS = 1_000;
/** Default ceiling for a screening answer: 2–5 sentences. */
export const ANSWER_MAX_WORDS = 120;

/* ------------------------------------------------------------------------------------------------
 * SEC 14.2 — build-time endpoints (the extension carries no env secrets)
 * ---------------------------------------------------------------------------------------------- */

/** F-14 remote selector config on Vercel's CDN. Data, never code. */
export const CONFIG_URL = 'https://nextmove-yatin.vercel.app/extension/adapters.json';

/**
 * NextMove API base — Phase-2 sync only (SEC 08).
 * INV-3: nothing outside `src/sync/**` may require this to be reachable.
 * INV-6: `src/ai/**` may never import this symbol.
 */
export const API_BASE_URL = 'https://nextmove-yatin.vercel.app';

export const CONFIG_FETCH_TIMEOUT_MS = 10_000;
export const CONFIG_MIN_POLL_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const SYNC_TIMEOUT_MS = 15_000;
/** Server-side cap on a mappings PUT (mirrors `siteMappingsPutSchema` in @repo/types). */
export const SYNC_MAX_MAPPINGS = 5_000;

/** SEC 8.2 — pairing codes exclude ambiguous glyphs (no 0/O/1/I/L). */
export const PAIR_CODE_LENGTH = 8;
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------------------------------------
 * SEC 10 / SEC 5.4 — extension platform ids
 * ---------------------------------------------------------------------------------------------- */

/** `commands` key in the manifest; suggested key Alt+J. */
export const COMMAND_FILL_PAGE = 'fill-page';

/** Daily remote-config poll (F-14). */
export const ALARM_CONFIG_POLL = 'jf.alarm.configPoll';
/** Pacific-midnight RPD ledger reset (SEC 5.4). */
export const ALARM_QUOTA_RESET = 'jf.alarm.quotaReset';
/** F-15 background sync. Only ever armed while the install is paired. */
export const ALARM_SYNC_PUSH = 'jf.alarm.syncPush';
export const CONFIG_POLL_PERIOD_MINUTES = 24 * 60;

/** Context-menu item ids (the only other user-gesture entry point into the AI path). */
export const MENU_FILL_PAGE = 'jf.menu.fillPage';
export const MENU_GENERATE_ANSWER = 'jf.menu.generateAnswer';

/** Toolbar badge shown when a key has been quarantined DEAD (SEC 5.6). */
export const BADGE_KEY_DEAD = '!';

/** Shadow-DOM host id for in-page overlays — namespaced so host CSS can never reach it. */
export const OVERLAY_HOST_ID = 'nextmove-autofill-root';

/** Quota reset timezone of record: Google resets free-tier quotas at Pacific midnight. */
export const QUOTA_RESET_TIMEZONE = 'America/Los_Angeles';

/* ------------------------------------------------------------------------------------------------
 * Shipped defaults
 * ---------------------------------------------------------------------------------------------- */

export const DEFAULT_SETTINGS: Settings = {
  activeProfileId: null,

  fillThreshold: FILL_THRESHOLD,
  suggestThreshold: SUGGEST_THRESHOLD,

  autoFillOnLoad: false,
  showFloatingPill: true,
  highlightFilled: true,
  humanPacing: true,
  reviewOverlay: true,

  tone: 'concise',
  answerLength: 'short',
  preferredModel: MODEL_FLASH_LITE,
  modelFallbackChain: [MODEL_FLASH_LITE, MODEL_FLASH, MODEL_FLASH_LEGACY],
  reuseBankedAnswers: true,

  autoLogApplications: true,
  autoCaptureJobContext: true,

  remoteConfigEnabled: true,
  syncEnabled: false,
  telemetryOptIn: false,

  updatedAt: 0,
};

export const DEFAULT_SYNC_STATE: SyncState = {
  paired: false,
  deviceId: null,
  deviceName: null,
  email: null,
  tokenCt: null,
  tokenIv: null,
  vaultKeyCt: null,
  vaultKeyIv: null,
  profileVersion: 0,
  lastSyncAt: null,
  lastError: null,
};

/* ------------------------------------------------------------------------------------------------
 * SEC 8.5 — the web onboarding handoff (first run)
 * ---------------------------------------------------------------------------------------------- */

/**
 * The NextMove web app. Same origin as `API_BASE_URL` today, but named separately because they are
 * different concerns: one is an API the service worker calls, the other is a page a human is sent
 * to. They will diverge the moment the API moves to `api.nextmove.app`.
 */
export const WEB_APP_URL = 'https://nextmove-yatin.vercel.app';

/**
 * Where a fresh install sends the user. The extension mints a nonce, stashes it in
 * `chrome.storage.session`, and appends it — so only the tab this install opened can complete the
 * handshake, and only once (see `background/handlers/handoff.ts`).
 */
export const WEB_CONNECT_PATH = '/extension/connect';

/** Told to the user after they remove the extension. `http(s)` only, ≤1023 chars, never a secret. */
export const WEB_UNINSTALL_URL = `${WEB_APP_URL}/extension?farewell=1`;

/**
 * Origins allowed to complete the handshake, checked against `sender.origin` on every
 * `onMessageExternal`. `externally_connectable` in the manifest is the real gate — this is the
 * belt to its braces, and the reason it is a Set of exact strings is that a `startsWith` check
 * here would happily accept `https://nextmove-yatin.vercel.app.evil.com`.
 */
export const HANDOFF_ALLOWED_ORIGINS: readonly string[] = [
  WEB_APP_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** How long a first-run handshake nonce stays redeemable. Long enough to sign up, not much more. */
export const HANDOFF_NONCE_TTL_MS = 30 * 60 * 1_000;

/** `chrome.storage.session` key holding `{ nonce, expiresAt }` for the pending handshake. */
export const HANDOFF_NONCE_KEY = 'jf.handoff.nonce';

/* ------------------------------------------------------------------------------------------------
 * F-15 — background sync cadence
 * ---------------------------------------------------------------------------------------------- */

/**
 * How often a paired install pushes whatever is dirty. Five minutes rather than one: the service
 * worker is torn down between alarms anyway, and applications are logged in bursts (you apply to
 * six jobs in an evening, not one every 60 seconds).
 */
export const SYNC_ALARM_PERIOD_MINUTES = 5;

/**
 * A local write marks sync dirty; the alarm drains it. There is deliberately no `setTimeout`
 * debounce — MV3 kills the worker between events, so a timer that has not fired yet is a timer
 * that never will.
 */
export const SYNC_DIRTY_KEY = 'jf.sync.dirty';
