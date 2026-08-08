import type { ModelId, Settings, SyncState } from './types';

export const STORAGE_KEY_META = 'jf.meta';
export const STORAGE_KEY_PROFILES = 'jf.profiles';
export const STORAGE_KEY_SETTINGS = 'jf.settings';
export const STORAGE_KEY_KEYS = 'jf.keys';
export const STORAGE_KEY_MAPPINGS = 'jf.mappings';
export const STORAGE_KEY_SYNC = 'jf.sync';

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

export const SCHEMA_VERSION = 1;

export const DB_NAME = 'jobfill';
export const DB_VERSION = 1;
export const DB_TABLES = {
  resumes: 'resumes',
  applications: 'applications',
  parseCache: 'parseCache',
  answerBank: 'answerBank',
} as const;

export const VAULT_SECRET_KEY = 'jf.vault.secret';
export const VAULT_PBKDF2_ITERATIONS = 210_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;

export const FILL_THRESHOLD = 70;
export const SUGGEST_THRESHOLD = 50;

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
  inputTypeAgreement: 5,
  conflictingSection: -20,
  duplicatePath: -30,
} as const;

export const FUZZY_MIN_SIMILARITY = 0.88;

export const DISAMBIGUATE_MIN_SCORE = SUGGEST_THRESHOLD;
export const DISAMBIGUATE_MAX_SCORE = FILL_THRESHOLD - 1;

export const SAME_Q = 0.92;
export const SIMILAR_Q = 0.75;

export const COMPANY_TOKEN = '{company}';

export interface JitterRange {
  readonly min: number;
  readonly max: number;
}

export const FILL_JITTER_MS: JitterRange = { min: 40, max: 120 };
export const TYPEAHEAD_JITTER_MS: JitterRange = { min: 30, max: 60 };
export const LISTBOX_WAIT_MS = 3_000;
export const FILL_VERIFY_DELAY_MS = 60;
export const OBSERVER_DEBOUNCE_MS = 250;
export const FILL_RUN_TIMEOUT_MS = 60_000;

export const GESTURE_TTL_MS = 5_000;
export const GESTURE_NONCE_BYTES = 16;

export const MODEL_FLASH_LITE: ModelId = 'gemini-2.5-flash-lite';
export const MODEL_FLASH: ModelId = 'gemini-2.5-flash';
export const MODEL_FLASH_LEGACY: ModelId = 'gemini-2.0-flash';

export const FREE_TIER_MODELS: readonly ModelId[] = [
  MODEL_FLASH_LITE,
  MODEL_FLASH,
  MODEL_FLASH_LEGACY,
];

export const DEFAULT_MODEL_CHAIN: readonly ModelId[] = [
  MODEL_FLASH_LITE,
  MODEL_FLASH,
  MODEL_FLASH_LEGACY,
];

export const MODEL_FOR_TASK = {
  screeningAnswer: MODEL_FLASH_LITE,
  disambiguate: MODEL_FLASH_LITE,
  coverLetter: MODEL_FLASH,
  resumeExtract: MODEL_FLASH,
} as const;

export const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
export const GEMINI_API_BASE = GEMINI_API_ORIGIN + '/v1beta';
export const GEMINI_MODELS_LIST_URL = GEMINI_API_BASE + '/models';
export const GEMINI_API_KEY_HEADER = 'x-goog-api-key';

export const GEMINI_TIMEOUT_MS = 25_000;
export const GEMINI_NET_RETRIES = 2;
export const GEMINI_RETRY_JITTER_MS: JitterRange = { min: 250, max: 1_000 };
export const GEMINI_JSON_REPAIR_ATTEMPTS = 1;

export const GEMINI_DEFAULT_TEMPERATURE = 0.6;
export const GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 700;
export const GEMINI_JSON_MIME = 'application/json';

export const MAX_JD_CHARS = 6_000;
export const MAX_RESUME_CHARS = 20_000;
export const MAX_QUESTION_CHARS = 1_000;
export const ANSWER_MAX_WORDS = 120;

export const CONFIG_URL = 'https://nextmove-yatin.vercel.app/extension/adapters.json';

export const API_BASE_URL = 'https://nextmove-yatin.vercel.app';

export const CONFIG_FETCH_TIMEOUT_MS = 10_000;
export const CONFIG_MIN_POLL_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const SYNC_TIMEOUT_MS = 15_000;
export const SYNC_MAX_MAPPINGS = 5_000;

export const PAIR_CODE_LENGTH = 8;
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const COMMAND_FILL_PAGE = 'fill-page';

export const ALARM_CONFIG_POLL = 'jf.alarm.configPoll';
export const ALARM_QUOTA_RESET = 'jf.alarm.quotaReset';
export const ALARM_SYNC_PUSH = 'jf.alarm.syncPush';
export const CONFIG_POLL_PERIOD_MINUTES = 24 * 60;

export const MENU_FILL_PAGE = 'jf.menu.fillPage';
export const MENU_GENERATE_ANSWER = 'jf.menu.generateAnswer';

export const BADGE_KEY_DEAD = '!';

export const OVERLAY_HOST_ID = 'nextmove-autofill-root';

export const QUOTA_RESET_TIMEZONE = 'America/Los_Angeles';

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

export const WEB_APP_URL = 'https://nextmove-yatin.vercel.app';

export const WEB_CONNECT_PATH = '/extension/connect';

export const WEB_UNINSTALL_URL = `${WEB_APP_URL}/extension?farewell=1`;

export const HANDOFF_ALLOWED_ORIGINS: readonly string[] = [
  WEB_APP_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export const HANDOFF_NONCE_TTL_MS = 30 * 60 * 1_000;

export const HANDOFF_NONCE_KEY = 'jf.handoff.nonce';

export const SYNC_ALARM_PERIOD_MINUTES = 5;

export const SYNC_DIRTY_KEY = 'jf.sync.dirty';

export const ONBOARDING_PAGE = '/onboarding.html';

export const ONBOARDED_KEY = 'nm:onboarded';
export const MODE_KEY = 'nm:mode';
export const ONBOARDING_DRAFT_KEY = 'nm:onboarding:draft';
export const BACKUP_NUDGE_DISMISSED_KEY = 'nm:nudge:backup:dismissed';

export const ONBOARDING_AUTOSAVE_MS = 400;

export const WEB_AUTH_REDIRECT_PATH = '/onboarding';

export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';
