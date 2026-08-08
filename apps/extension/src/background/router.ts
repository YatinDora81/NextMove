/**
 * background/router.ts — the MessageRouter (JF-001 Rev 3.0 SEC 4.1 / 6.6).
 *
 * SEC 6.6: *"Every cross-context message is a Zod-validated envelope {type, reqId, payload};
 * unknown types are dropped and logged. External messages (onMessageExternal) are refused
 * entirely."* And: *"Enforcement of INV-2 lives here."*
 *
 * ── What this file is, and what `platform/bus.ts` is ────────────────────────────────────────────
 * `platform/bus.ts` owns the wire: it installs the single `runtime.onMessage` listener, validates
 * envelopes with `messageEnvelopeSchema`, drops and logs unknown types, refuses messages carrying a
 * foreign extension id, refuses `onMessageExternal` outright, and — the INV-2 gate — verifies and
 * BURNS the user-gesture nonce for every `GESTURE_REQUIRED` type before any handler runs.
 *
 * This file is the service worker's half of that contract:
 *
 *   1. it owns the exhaustive handler table (typed against `MessageContracts`, so a handler that
 *      replies with the wrong shape is a compile error);
 *   2. it re-validates each payload against a per-type Zod schema — the envelope check upstream can
 *      only say "this is one of ours", not "this is a well-formed AI_GENERATE_ANSWER";
 *   3. it re-asserts INV-2 per handler, fail-closed (see `withGestureGate`);
 *   4. it provides `dispatchLocal`, the in-worker entry point used by the Alt+J command, the
 *      context menu and anything else that starts inside the worker rather than on the wire — and
 *      THAT path calls `consumeGesture` itself, because there is no bus in front of it;
 *   5. it self-checks at start-up that every `MessageType` has a handler.
 *
 * There is exactly ONE nonce-burn site per message, by construction: the wire path burns in
 * `platform/bus.dispatch`, the local path burns in `dispatchLocal`. Burning twice would be a
 * guaranteed false negative — a single-use token cannot be consumed a second time — which is why
 * `withGestureGate` asserts rather than re-consumes.
 */

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

/* ------------------------------------------------------------------------------------------------
 * Per-type payload schemas — the router's own Zod pass
 * ---------------------------------------------------------------------------------------------- */

const nullableString = z.string().nullable();
const profileIdRef = nullableString;

/** `Record<string, never>` on the wire: callers send `{}`. */
const emptyPayload = z.object({});

const fillTriggerSchema = z.enum(['popup', 'shortcut', 'pill', 'context-menu', 'auto']);

/**
 * One schema per message type, mirroring `MessageContracts`. Objects are non-strict, so a caller
 * that sends an extra field is not punished for it — but a caller that omits a required field, or
 * sends a string where a number belongs, is refused with `VALIDATION_FAILED` before any storage,
 * any key lease and any network call can happen.
 *
 * The handler receives the ORIGINAL payload, not the parsed one: parsing here is a gate, not a
 * transform, and stripping unknown keys would quietly change what a handler sees.
 */
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
  // F-05. `path` is the matcher's ProfilePath for the file field (`resume` / `coverLetter`);
  // omitted or null ⇒ the resume. Not gesture-gated: a local IndexedDB read is not AI spend.
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

  // INV-5: the router validates the SHAPE of a key payload and nothing else. It never inspects,
  // stores, echoes or logs `key` — `platform/logger` would redact it, and no code path prints it.
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

/* ------------------------------------------------------------------------------------------------
 * The wrappers
 * ---------------------------------------------------------------------------------------------- */

/**
 * INV-2 — the gesture gate, restated at the handler boundary.
 *
 * The nonce for a wire message is verified and burned exactly once, upstream, in
 * `platform/bus.dispatch` → `consumeGesture(envelope.gesture)`; a message that failed that check
 * never reaches a handler, and `ctx.gesture` is non-null for every gated message that did. Calling
 * `consumeGesture` again here would therefore always return `false` — the token no longer exists —
 * so this wrapper ASSERTS the upstream contract instead, and fails closed.
 *
 * That assertion is not decoration: it is what makes the invariant survive a future transport. If
 * anything ever delivers a `GESTURE_REQUIRED` message to this table without going through the bus's
 * gate, `ctx.gesture` is null and the message dies here rather than spending a key. The local path
 * (`dispatchLocal`) does its own real `consumeGesture` for exactly that reason.
 */
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

/** Zod pass. Failures are logged with their issues and refused as `VALIDATION_FAILED`. */
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

/** Both wrappers, in the order the invariants demand: gesture first, then shape. */
function guard<T extends MessageType>(type: T, handler: MessageHandler<T>): MessageHandler<T> {
  return withGestureGate(type, withPayloadValidation(type, handler));
}

/* ------------------------------------------------------------------------------------------------
 * The table
 * ---------------------------------------------------------------------------------------------- */

let table: MessageHandlers | null = null;

/**
 * The guarded, exhaustive table. Built once per worker lifetime — and rebuilt from scratch whenever
 * Chrome resurrects the worker, which is the only sane assumption in MV3.
 */
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

/** Tear the memoised table down (tests, and a clean reload path). */
export function resetRouter(): void {
  table = null;
}

/* ------------------------------------------------------------------------------------------------
 * Installation
 * ---------------------------------------------------------------------------------------------- */

let installed = false;

/**
 * Install the router: register every handler, start the bus listener, and self-check.
 *
 * MUST run synchronously from the top level of the background entrypoint. MV3 delivers the event
 * that woke the worker immediately after the script evaluates, so a listener registered inside an
 * `await` can miss the very message it was resurrected for.
 *
 * Idempotent: `startRouter()` no-ops if a listener is already installed, and the memoised table
 * means re-registration cannot leave two copies of a handler behind.
 */
export function installRouter(): void {
  if (installed) return;

  prepareHandlers();
  registerHandlers(handlerTable());

  // SEC 6.6: this is what refuses `onMessageExternal` outright and drops unknown types.
  startRouter();

  const missing = unhandledTypes(MESSAGE_TYPES);
  if (missing.length > 0) {
    // Unreachable while `buildHandlerTable()` returns `MessageHandlers` — kept because a silent
    // hole in the table would surface as an inexplicable INTERNAL error in the field.
    log.error(`message types with no handler: ${missing.join(', ')}`);
  } else {
    log.info(`router installed — ${String(MESSAGE_TYPES.length)} message types handled`);
  }

  installed = true;
}

export function isRouterInstalled(): boolean {
  return installed;
}

/* ------------------------------------------------------------------------------------------------
 * In-worker dispatch
 * ---------------------------------------------------------------------------------------------- */

export interface LocalDispatchOptions {
  /** A nonce minted by `platform/gesture.mintGesture` — required for the `GESTURE_REQUIRED` set. */
  gesture?: string;
  tabId?: number | null;
  frameId?: number | null;
  url?: string | null;
}

/**
 * Run a message through the router without putting it on the wire.
 *
 * This is how things that ORIGINATE in the worker reach the handler table: the Alt+J command, the
 * context menu, and anything else Chrome hands straight to the background. There is no bus in front
 * of these, so this function is their gate.
 *
 * INV-2: for any type in `GESTURE_REQUIRED` this calls `consumeGesture(gesture)` itself and refuses
 * the message when it fails — the single burn site for the local path, mirroring what
 * `platform/bus.dispatch` does for the wire path. A caller that wants to start an AI request from a
 * genuine user action (a context-menu click) mints a nonce and passes it here; nothing else can.
 */
export async function dispatchLocal<T extends MessageType>(
  type: T,
  payload: PayloadOf<T>,
  options: LocalDispatchOptions = {},
): Promise<ReplyOf<T>> {
  if (!isMessageType(type)) {
    // Defensive: `MessageType` is closed at compile time, but a dynamic caller could still arrive
    // here through an `as` cast. SEC 6.6 — drop it and log it.
    log.warn(`dropped a local dispatch with an unknown type: ${String(type)}`);
    return errReply('UNKNOWN_TYPE', 'Unknown message type.') as ReplyOf<T>;
  }

  // INV-2: the gesture gate for messages that never touch the bus. Verified AND burned here.
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
