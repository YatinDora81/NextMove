/**
 * shared/messages.ts — the MessageBus protocol (JF-001 Rev 3.0 SEC 6.6).
 *
 * Every cross-context message is a Zod-validated envelope `{type, reqId, payload, gesture?}`;
 * unknown types are dropped and logged, and `onMessageExternal` is refused entirely.
 *
 * INV-2 lives here. `GESTURE_REQUIRED` is the closed set of message types that may reach Gemini,
 * and the router must refuse them unless the envelope carries a fresh (≤ GESTURE_TTL_MS) nonce
 * minted by the overlay/options UI in response to a real user gesture. A compromised page script
 * cannot spoof a quiet AI call.
 *
 * The `MessageContracts` map below is the single source of truth for payload/reply shapes: the bus,
 * every handler in `src/background/**`, and every caller in the UI are type-checked against it, so
 * a handler that returns the wrong shape is a compile error, not a runtime surprise.
 */

import type {
  AnswerHit,
  AnswerLength,
  AnswerRecord,
  AnswerSource,
  AnswerScope,
  ApplicationLogInput,
  ApplicationPatch,
  ApplicationRow,
  AnswerTone,
  AtsId,
  CoverLetterPreset,
  FieldSignature,
  FillReport,
  FillTrigger,
  GeminiKeyPublic,
  JobContext,
  KeyStatus,
  ModelId,
  PoolSnapshot,
  Profile,
  ProfileDraft,
  ProfilePath,
  ResolvedAdapterConfig,
  SyncScope,
  SyncState,
  TrackerQuery,
  TrackerStats,
} from './types';

/* ------------------------------------------------------------------------------------------------
 * The closed message-type universe (SEC 6.6)
 * ---------------------------------------------------------------------------------------------- */

export const MESSAGE_TYPES = [
  'FILL_REQUEST',
  'FILL_REPORT',
  'FIELD_MAP_SAVE',
  'FIELD_MAP_GET',
  'RESUME_GET',

  'AI_GENERATE_ANSWER',
  'AI_GENERATE_COVER',
  'AI_DISAMBIGUATE',
  'RESUME_PARSE',

  'KEYS_ADD',
  'KEYS_TEST',
  'KEYS_DELETE',
  'KEYS_STATUS',

  'TRACKER_LOG',
  'TRACKER_QUERY',
  'TRACKER_UPDATE',

  'ANSWERS_LOOKUP',
  'ANSWERS_SAVE',
  'ANSWERS_LIST',
  'ANSWERS_DELETE',

  'CONFIG_GET',
  'CONFIG_REFRESH',

  'PROFILE_GET',
  'PROFILE_LIST',
  'PROFILE_SAVE',
  'PROFILE_ACTIVE_SET',

  'SYNC_PAIR',
  'SYNC_UNPAIR',
  'SYNC_STATUS',
  'SYNC_PUSH',
  'SYNC_PULL',

  'GESTURE_MINT',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Runtime membership test for the closed union — unknown types are dropped by the router. */
export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------------------------------
 * INV-2 — the gesture-gated set
 * ---------------------------------------------------------------------------------------------- */

/**
 * Exactly the message types that can cause a Gemini request. Nothing else may lease a key.
 * Answer-bank lookups are deliberately absent: a bank hit is a fully offline path (SEC 5.7).
 */
export const GESTURE_REQUIRED: ReadonlySet<MessageType> = new Set<MessageType>([
  'AI_GENERATE_ANSWER',
  'AI_GENERATE_COVER',
  'AI_DISAMBIGUATE',
  'RESUME_PARSE',
]);

export function requiresGesture(type: MessageType): boolean {
  return GESTURE_REQUIRED.has(type);
}

/* ------------------------------------------------------------------------------------------------
 * Envelope + reply
 * ---------------------------------------------------------------------------------------------- */

export const BUS_ERROR_CODES = [
  'BAD_REQUEST',
  'UNKNOWN_TYPE',
  'VALIDATION_FAILED',
  'GESTURE_REQUIRED',
  'GESTURE_EXPIRED',
  'NO_KEYS',
  'ALL_KEYS_BUSY',
  'QUOTA_EXHAUSTED',
  'KEY_INVALID',
  'AI_UNAVAILABLE',
  'TIMEOUT',
  'NETWORK',
  'NOT_FOUND',
  'NOT_PAIRED',
  'SYNC_CONFLICT',
  'INTERNAL',
] as const;

export type BusErrorCode = (typeof BUS_ERROR_CODES)[number];

export interface BusError {
  code: BusErrorCode;
  message: string;
  /** epoch ms — set by ALL_KEYS_BUSY / QUOTA_EXHAUSTED so the UI can render a countdown. */
  retryAt?: number;
}

/** The wire envelope. `gesture` is present only for the GESTURE_REQUIRED set. */
export interface MessageEnvelope<T extends MessageType = MessageType> {
  type: T;
  reqId: string;
  payload: PayloadOf<T>;
  gesture?: string;
}

export type MessageReply<TData> = { ok: true; data: TData } | { ok: false; error: BusError };

/** Payload type for a message type. */
export type PayloadOf<T extends MessageType> = MessageContracts[T]['payload'];
/** Reply *data* type for a message type (i.e. the `data` field of a successful reply). */
export type ReplyDataOf<T extends MessageType> = MessageContracts[T]['reply'];
/** Full reply union for a message type. */
export type ReplyOf<T extends MessageType> = MessageReply<ReplyDataOf<T>>;

/** Where a message came from, resolved by the router from the runtime sender. */
export interface MessageContext {
  type: MessageType;
  reqId: string;
  gesture: string | null;
  tabId: number | null;
  frameId: number | null;
  url: string | null;
  origin: 'popup' | 'options' | 'content' | 'main-world' | 'background' | 'unknown';
}

export type MessageHandler<T extends MessageType> = (
  payload: PayloadOf<T>,
  ctx: MessageContext,
) => ReplyOf<T> | Promise<ReplyOf<T>>;

/** The router's handler table — every message type must be implemented, or it will not compile. */
export type MessageHandlers = { [T in MessageType]: MessageHandler<T> };

/* ------------------------------------------------------------------------------------------------
 * The contract map
 * ---------------------------------------------------------------------------------------------- */

/** Empty payload. Callers pass `{}`. */
export type EmptyPayload = Record<string, never>;

/* ---- F-05 resume attach ------------------------------------------------------------------- */

/**
 * A stored file on its way to a content script.
 *
 * `chrome.runtime` messaging is **JSON**, not structured clone: a `Blob`, a `File` and an
 * `ArrayBuffer` all arrive at the far end as `{}`. The bytes therefore travel as standard base64
 * and the receiver rebuilds the `File`. `size` is the decoded byte length, so the receiver can
 * check what it got against what was sent without decoding first.
 */
export interface ResumeBytes {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Standard base64 (no `data:` prefix, no line breaks). */
  bytes: string;
}

/**
 * How the worker chose among the stored files (F-05: "multiple resumes; per-profile default;
 * picker if ambiguous"). Anything other than `default`/`only` means we made a judgement call, and
 * the caller is expected to say so out loud rather than let the user assume they picked it.
 */
export type ResumeChoice = 'default' | 'only' | 'most-recent' | 'none';

/** One stored file the user could have meant instead — enough to render a picker. */
export interface ResumeAlternative {
  id: string;
  name: string;
  addedAt: number;
}

export interface ResumePick {
  resume: ResumeBytes | null;
  how: ResumeChoice;
  /** The other candidates, newest first. Empty unless the choice was ambiguous. */
  alternatives: ResumeAlternative[];
}

export interface MessageContracts {
  /* ---- fill ------------------------------------------------------------------------------- */

  /** popup/shortcut/pill → content. `profileId: null` ⇒ use the active profile. */
  FILL_REQUEST: {
    payload: { profileId: string | null; trigger: FillTrigger };
    reply: FillReport;
  };

  /** content → sw. Hands the finished run to the tracker (F-12); never auto-submits (INV-1). */
  FILL_REPORT: {
    payload: { report: FillReport; job: JobContext | null; profileId: string | null };
    reply: { logged: boolean; applicationId: string | null };
  };

  /** content → sw. Learn-from-correction (F-13). */
  FIELD_MAP_SAVE: {
    payload: { domain: string; sigHash: string; path: ProfilePath };
    reply: { saved: true };
  };

  /** content → sw. Every saved mapping for one domain, keyed by signature hash. */
  FIELD_MAP_GET: {
    payload: { domain: string };
    reply: { mappings: Record<string, ProfilePath> };
  };

  /**
   * content → sw (F-05 · SEC 6.4's `file` row · SEC 4.3 Flow A step 5).
   *
   * The resume bytes live in the extension's IndexedDB (`resumes`, SEC 7.1). A content script
   * cannot read them: `platform/db` evaluated inside a content script addresses the HOST PAGE's
   * IndexedDB, not ours. So the worker — which is the only context whose `platform/db` IS the
   * extension's own database — reads the blob and hands it back over this message.
   *
   * **NOT gesture-gated on purpose.** INV-2 gates Gemini spend; attaching a file the user already
   * stored is a purely local read that costs nothing and reaches no network. Adding it to
   * `GESTURE_REQUIRED` would break Flow A's one-click promise for zero privacy gain — the same
   * content script is already trusted with the whole decrypted `Profile` via `PROFILE_GET`.
   *
   * `path` is the `ProfilePath` the matcher assigned to the file field, so one message serves both
   * targets SEC 6.5 defines: `resume` (the default resume) and `coverLetter` / `answers.coverLetter`
   * (a stored file tagged `cover-letter`, if there is one). Omitted ⇒ the resume.
   */
  RESUME_GET: {
    payload: { profileId: string | null; path?: string | null };
    reply: ResumePick;
  };

  /* ---- AI (gesture-gated — INV-2) --------------------------------------------------------- */

  AI_GENERATE_ANSWER: {
    payload: {
      question: string;
      jobCtx: JobContext;
      tone: AnswerTone;
      length: AnswerLength;
      profileId: string | null;
    };
    reply: { text: string; model: ModelId; keyId: string };
  };

  AI_GENERATE_COVER: {
    payload: {
      jobCtx: JobContext;
      tone: AnswerTone;
      preset: CoverLetterPreset;
      profileId: string | null;
    };
    reply: { subject: string | null; body: string; model: ModelId; keyId: string };
  };

  /** Optional assist for a 50–69 gray-zone field. Fired only from "Ask AI to resolve". */
  AI_DISAMBIGUATE: {
    payload: { sig: FieldSignature; candidates: ProfilePath[] };
    reply: { path: ProfilePath; confidence: number; model: ModelId };
  };

  /**
   * options → sw (SEC 4.3 Flow C, step 4).
   *
   * `text` is the resume text the Options page already extracted locally with pdf.js / mammoth and
   * displayed verbatim on the consent screen — the payload IS what will be sent to Gemini, which is
   * what makes "we show you exactly what leaves the device" literally true. The blob stays in
   * IndexedDB and never crosses this bus; the worker holds no PDF/DOCX parser at all.
   *
   * `resumeId` is still carried so the worker can read and write `parseCache` (SEC 7.1) and a
   * re-parse costs no second Gemini call.
   */
  RESUME_PARSE: {
    payload: { resumeId: string; text: string };
    reply: { draft: ProfileDraft; model: ModelId | null; source: 'ai' | 'regex' };
  };

  /* ---- keys (INV-5 — a plaintext key never appears in any reply) --------------------------- */

  KEYS_ADD: {
    payload: { key: string; label: string };
    reply: { record: GeminiKeyPublic; pool: PoolSnapshot[] };
  };

  KEYS_TEST: {
    payload: { id: string };
    reply: { id: string; status: KeyStatus; ok: boolean; message: string };
  };

  KEYS_DELETE: {
    payload: { id: string };
    reply: { deleted: true };
  };

  KEYS_STATUS: {
    payload: { model?: ModelId };
    reply: { keys: GeminiKeyPublic[]; pool: PoolSnapshot[]; model: ModelId | null };
  };

  /* ---- tracker ---------------------------------------------------------------------------- */

  TRACKER_LOG: {
    payload: { entry: ApplicationLogInput };
    reply: { row: ApplicationRow; created: boolean };
  };

  TRACKER_QUERY: {
    payload: TrackerQuery;
    reply: { rows: ApplicationRow[]; total: number; stats: TrackerStats };
  };

  TRACKER_UPDATE: {
    payload: { id: string; patch: ApplicationPatch };
    reply: { row: ApplicationRow };
  };

  /* ---- answer bank (offline — no gesture, no key lease, no network) ------------------------ */

  ANSWERS_LOOKUP: {
    payload: { qRaw: string; qNorm?: string; company: string | null; profileId: string | null };
    reply: { hit: AnswerHit | null };
  };

  ANSWERS_SAVE: {
    payload: {
      qRaw: string;
      answer: string;
      source: AnswerSource;
      profileId: string | null;
      company: string | null;
      scope?: AnswerScope;
    };
    reply: { record: AnswerRecord; created: boolean };
  };

  ANSWERS_LIST: {
    payload: { search?: string; profileId?: string | null; limit?: number; offset?: number };
    reply: { records: AnswerRecord[]; total: number };
  };

  ANSWERS_DELETE: {
    payload: { id: string };
    reply: { deleted: true };
  };

  /* ---- remote config (F-14) --------------------------------------------------------------- */

  CONFIG_GET: {
    payload: { atsId: AtsId };
    reply: ResolvedAdapterConfig;
  };

  CONFIG_REFRESH: {
    payload: { force: boolean };
    reply: { updated: boolean; version: string; fetchedAt: number };
  };

  /* ---- profiles --------------------------------------------------------------------------- */

  PROFILE_GET: {
    payload: { profileId: string | null };
    reply: { profile: Profile | null };
  };

  PROFILE_LIST: {
    payload: EmptyPayload;
    reply: { profiles: Profile[]; activeProfileId: string | null };
  };

  PROFILE_SAVE: {
    payload: { profile: Profile };
    reply: { profile: Profile };
  };

  PROFILE_ACTIVE_SET: {
    payload: { profileId: string };
    reply: { activeProfileId: string };
  };

  /* ---- Phase-2 sync (P2 only; nothing else may depend on it — INV-3) ----------------------- */

  SYNC_PAIR: {
    payload: { code: string; deviceName: string };
    reply: { state: SyncState };
  };

  SYNC_UNPAIR: {
    payload: EmptyPayload;
    reply: { state: SyncState };
  };

  SYNC_STATUS: {
    payload: EmptyPayload;
    reply: { state: SyncState };
  };

  SYNC_PUSH: {
    payload: { scopes: SyncScope[] };
    reply: {
      state: SyncState;
      pushed: { profile: boolean; mappings: number; applications: number };
    };
  };

  /**
   * Pull the account's E2E profile vault down and merge it into local storage. Separate from
   * SYNC_PUSH because the two are not symmetric: a push is routine and fire-and-forget, a pull can
   * change what the extension autofills with and is therefore always user-visible.
   */
  SYNC_PULL: {
    payload: EmptyPayload;
    reply: {
      state: SyncState;
      pulled: { found: boolean; applied: number };
    };
  };

  /* ---- gesture minting (INV-2) ------------------------------------------------------------ */

  /**
   * Called by the overlay/options UI from inside a real user-gesture handler. The returned nonce
   * is the only thing that unlocks the GESTURE_REQUIRED set, and it dies after GESTURE_TTL_MS.
   */
  GESTURE_MINT: {
    payload: { reason: string };
    reply: { gesture: string; expiresAt: number };
  };
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/** Correlation id for one request/reply pair. */
export function newReqId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'req_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeEnvelope<T extends MessageType>(
  type: T,
  payload: PayloadOf<T>,
  gesture?: string,
): MessageEnvelope<T> {
  const envelope: MessageEnvelope<T> = { type, reqId: newReqId(), payload };
  if (gesture !== undefined) envelope.gesture = gesture;
  return envelope;
}

export function okReply<TData>(data: TData): { ok: true; data: TData } {
  return { ok: true, data };
}

export function errReply(
  code: BusErrorCode,
  message: string,
  retryAt?: number,
): { ok: false; error: BusError } {
  const error: BusError = { code, message };
  if (typeof retryAt === 'number' && Number.isFinite(retryAt)) error.retryAt = retryAt;
  return { ok: false, error };
}

export function isOk<TData>(
  reply: MessageReply<TData>,
): reply is { ok: true; data: TData } {
  return reply.ok;
}

/**
 * Structural guard used by the router before Zod parsing — cheap rejection of anything that is
 * obviously not one of ours (page scripts postMessage a lot of noise).
 */
export function looksLikeEnvelope(value: unknown): value is MessageEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; reqId?: unknown };
  return isMessageType(candidate.type) && typeof candidate.reqId === 'string';
}
