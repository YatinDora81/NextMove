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

export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

export const GESTURE_REQUIRED: ReadonlySet<MessageType> = new Set<MessageType>([
  'AI_GENERATE_ANSWER',
  'AI_GENERATE_COVER',
  'AI_DISAMBIGUATE',
  'RESUME_PARSE',
]);

export function requiresGesture(type: MessageType): boolean {
  return GESTURE_REQUIRED.has(type);
}

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
  retryAt?: number;
}

export interface MessageEnvelope<T extends MessageType = MessageType> {
  type: T;
  reqId: string;
  payload: PayloadOf<T>;
  gesture?: string;
}

export type MessageReply<TData> = { ok: true; data: TData } | { ok: false; error: BusError };

export type PayloadOf<T extends MessageType> = MessageContracts[T]['payload'];
export type ReplyDataOf<T extends MessageType> = MessageContracts[T]['reply'];
export type ReplyOf<T extends MessageType> = MessageReply<ReplyDataOf<T>>;

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

export type MessageHandlers = { [T in MessageType]: MessageHandler<T> };

export type EmptyPayload = Record<string, never>;

export interface ResumeBytes {
  id: string;
  name: string;
  mime: string;
  size: number;
  bytes: string;
}

export type ResumeChoice = 'default' | 'only' | 'most-recent' | 'none';

export interface ResumeAlternative {
  id: string;
  name: string;
  addedAt: number;
}

export interface ResumePick {
  resume: ResumeBytes | null;
  how: ResumeChoice;
  alternatives: ResumeAlternative[];
}

export interface MessageContracts {
  FILL_REQUEST: {
    payload: { profileId: string | null; trigger: FillTrigger };
    reply: FillReport;
  };

  FILL_REPORT: {
    payload: { report: FillReport; job: JobContext | null; profileId: string | null };
    reply: { logged: boolean; applicationId: string | null };
  };

  FIELD_MAP_SAVE: {
    payload: { domain: string; sigHash: string; path: ProfilePath };
    reply: { saved: true };
  };

  FIELD_MAP_GET: {
    payload: { domain: string };
    reply: { mappings: Record<string, ProfilePath> };
  };

  RESUME_GET: {
    payload: { profileId: string | null; path?: string | null };
    reply: ResumePick;
  };

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

  AI_DISAMBIGUATE: {
    payload: { sig: FieldSignature; candidates: ProfilePath[] };
    reply: { path: ProfilePath; confidence: number; model: ModelId };
  };

  RESUME_PARSE: {
    payload: { resumeId: string; text: string };
    reply: { draft: ProfileDraft; model: ModelId | null; source: 'ai' | 'regex' };
  };

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

  CONFIG_GET: {
    payload: { atsId: AtsId };
    reply: ResolvedAdapterConfig;
  };

  CONFIG_REFRESH: {
    payload: { force: boolean };
    reply: { updated: boolean; version: string; fetchedAt: number };
  };

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

  SYNC_PULL: {
    payload: EmptyPayload;
    reply: {
      state: SyncState;
      pulled: { found: boolean; applied: number };
    };
  };

  GESTURE_MINT: {
    payload: { reason: string };
    reply: { gesture: string; expiresAt: number };
  };
}

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

export function looksLikeEnvelope(value: unknown): value is MessageEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; reqId?: unknown };
  return isMessageType(candidate.type) && typeof candidate.reqId === 'string';
}
