import { z } from 'zod';

import { registerHandlers, startRouter, unhandledTypes } from '@/platform/bus';
import { consumeGesture } from '@/platform/gesture';
import { createLogger } from '@/platform/logger';
import {
  MESSAGE_TYPES,
  errReply,
  isMessageType,
  requiresGesture,
} from '@/shared/messages';
import type {
  MessageContext,
  MessageHandler,
  MessageHandlers,
  MessageType,
  PayloadOf,
  ReplyOf,
} from '@/shared/messages';
import {
  answerScopeSchema,
  answerSourceSchema,
  answerLengthSchema,
  answerToneSchema,
  applicationLogInputSchema,
  applicationPatchSchema,
  appStatusSchema,
  atsIdSchema,
  coverLetterPresetSchema,
  fieldSignatureSchema,
  fillReportSchema,
  jobContextSchema,
  profileSchema,
  syncScopeSchema,
} from '@/shared/schema';

import { buildHandlerTable, prepareHandlers } from '@/background/handlers';

const log = createLogger('bg:router');

const nullableString = z.string().nullable();
const profileIdRef = nullableString;

const emptyPayload = z.object({});

const fillTriggerSchema = z.enum(['popup', 'shortcut', 'pill', 'context-menu', 'auto']);

const PAYLOAD_SCHEMAS: { readonly [T in MessageType]: z.ZodType } = {
  FILL_REQUEST: z.object({ profileId: profileIdRef, trigger: fillTriggerSchema }),
  FILL_REPORT: z.object({
    report: fillReportSchema,
    job: jobContextSchema.nullable(),
    profileId: profileIdRef,
  }),
  FIELD_MAP_SAVE: z.object({
    domain: z.string().min(1),
    sigHash: z.string().min(1),
    path: z.string().min(1),
  }),
  FIELD_MAP_GET: z.object({ domain: z.string().min(1) }),
  RESUME_GET: z.object({ profileId: profileIdRef, path: nullableString.optional() }),

  AI_GENERATE_ANSWER: z.object({
    question: z.string(),
    jobCtx: jobContextSchema,
    tone: answerToneSchema,
    length: answerLengthSchema,
    profileId: profileIdRef,
  }),
  AI_GENERATE_COVER: z.object({
    jobCtx: jobContextSchema,
    tone: answerToneSchema,
    preset: coverLetterPresetSchema,
    profileId: profileIdRef,
  }),
  AI_DISAMBIGUATE: z.object({
    sig: fieldSignatureSchema,
    candidates: z.array(z.string()),
  }),
  RESUME_PARSE: z.object({ resumeId: z.string().min(1) }),

  KEYS_ADD: z.object({ key: z.string().min(1), label: z.string() }),
  KEYS_TEST: z.object({ id: z.string().min(1) }),
  KEYS_DELETE: z.object({ id: z.string().min(1) }),
  KEYS_STATUS: z.object({ model: z.string().optional() }),

  TRACKER_LOG: z.object({ entry: applicationLogInputSchema }),
  TRACKER_QUERY: z.object({
    status: appStatusSchema.nullable().optional(),
    ats: atsIdSchema.nullable().optional(),
    profileId: nullableString.optional(),
    from: z.number().nullable().optional(),
    to: z.number().nullable().optional(),
    search: nullableString.optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  TRACKER_UPDATE: z.object({ id: z.string().min(1), patch: applicationPatchSchema }),

  ANSWERS_LOOKUP: z.object({
    qRaw: z.string(),
    qNorm: z.string().optional(),
    company: nullableString,
    profileId: profileIdRef,
  }),
  ANSWERS_SAVE: z.object({
    qRaw: z.string(),
    answer: z.string(),
    source: answerSourceSchema,
    profileId: profileIdRef,
    company: nullableString,
    scope: answerScopeSchema.optional(),
  }),
  ANSWERS_LIST: z.object({
    search: z.string().optional(),
    profileId: nullableString.optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  ANSWERS_DELETE: z.object({ id: z.string().min(1) }),

  CONFIG_GET: z.object({ atsId: atsIdSchema }),
  CONFIG_REFRESH: z.object({ force: z.boolean() }),

  PROFILE_GET: z.object({ profileId: profileIdRef }),
  PROFILE_LIST: emptyPayload,
  PROFILE_SAVE: z.object({ profile: profileSchema }),
  PROFILE_ACTIVE_SET: z.object({ profileId: z.string().min(1) }),

  SYNC_PAIR: z.object({ code: z.string(), deviceName: z.string() }),
  SYNC_UNPAIR: emptyPayload,
  SYNC_STATUS: emptyPayload,
  SYNC_PUSH: z.object({ scopes: z.array(syncScopeSchema) }),
  SYNC_PULL: z.object({}),

  GESTURE_MINT: z.object({ reason: z.string() }),
};

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => (issue.path.length > 0 ? issue.path.join('.') : '<root>') + ': ' + issue.message)
    .join('; ');
}

function withGestureGate<T extends MessageType>(
  type: T,
  handler: MessageHandler<T>,
): MessageHandler<T> {
  if (!requiresGesture(type)) return handler;

  return (payload, ctx) => {
    if (ctx.gesture === null || ctx.gesture.length === 0) {
      log.warn(`${type} refused: no verified user gesture reached the handler (INV-2)`);
      return errReply(
        'GESTURE_REQUIRED',
        'This action must be triggered by a user gesture.',
      ) as ReplyOf<T>;
    }
    return handler(payload, ctx);
  };
}

function withPayloadValidation<T extends MessageType>(
  type: T,
  handler: MessageHandler<T>,
): MessageHandler<T> {
  const schema = PAYLOAD_SCHEMAS[type];

  return (payload, ctx) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      log.warn(`${type} refused: malformed payload — ${describeIssues(parsed.error)}`);
      return errReply(
        'VALIDATION_FAILED',
        `The ${type} payload did not match its contract.`,
      ) as ReplyOf<T>;
    }
    return handler(payload, ctx);
  };
}

function guard<T extends MessageType>(type: T, handler: MessageHandler<T>): MessageHandler<T> {
  return withGestureGate(type, withPayloadValidation(type, handler));
}

let table: MessageHandlers | null = null;

function handlerTable(): MessageHandlers {
  if (table !== null) return table;

  const raw = buildHandlerTable();
  const guarded = {} as Record<MessageType, MessageHandler<MessageType>>;
  for (const type of MESSAGE_TYPES) {
    guarded[type] = guard(type, raw[type] as MessageHandler<MessageType>);
  }
  table = guarded as MessageHandlers;
  return table;
}

export function resetRouter(): void {
  table = null;
}

let installed = false;

export function installRouter(): void {
  if (installed) return;

  prepareHandlers();
  registerHandlers(handlerTable());

  startRouter();

  const missing = unhandledTypes(MESSAGE_TYPES);
  if (missing.length > 0) {
    log.error(`message types with no handler: ${missing.join(', ')}`);
  } else {
    log.info(`router installed — ${String(MESSAGE_TYPES.length)} message types handled`);
  }

  installed = true;
}

export function isRouterInstalled(): boolean {
  return installed;
}

export interface LocalDispatchOptions {
  gesture?: string;
  tabId?: number | null;
  frameId?: number | null;
  url?: string | null;
}

export async function dispatchLocal<T extends MessageType>(
  type: T,
  payload: PayloadOf<T>,
  options: LocalDispatchOptions = {},
): Promise<ReplyOf<T>> {
  if (!isMessageType(type)) {
    log.warn(`dropped a local dispatch with an unknown type: ${String(type)}`);
    return errReply('UNKNOWN_TYPE', 'Unknown message type.') as ReplyOf<T>;
  }

  if (requiresGesture(type)) {
    if (options.gesture === undefined) {
      log.warn(`${type} refused locally: no gesture token (INV-2)`);
      return errReply(
        'GESTURE_REQUIRED',
        'This action must be triggered by a user gesture.',
      ) as ReplyOf<T>;
    }
    if (!consumeGesture(options.gesture)) {
      log.warn(`${type} refused locally: gesture expired, replayed, or unknown (INV-2)`);
      return errReply(
        'GESTURE_EXPIRED',
        'Your confirmation expired — click again to continue.',
      ) as ReplyOf<T>;
    }
  }

  const ctx: MessageContext = {
    type,
    reqId: `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    gesture: options.gesture ?? null,
    tabId: options.tabId ?? null,
    frameId: options.frameId ?? null,
    url: options.url ?? null,
    origin: 'background',
  };

  const handler = handlerTable()[type] as MessageHandler<T>;
  try {
    return await handler(payload, ctx);
  } catch (error) {
    log.error(`local dispatch of ${type} threw`, error);
    return errReply(
      'INTERNAL',
      error instanceof Error ? error.message : String(error),
    ) as ReplyOf<T>;
  }
}
