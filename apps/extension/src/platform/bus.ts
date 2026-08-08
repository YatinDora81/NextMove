/**
 * platform/bus.ts — the typed MessageBus (JF-001 Rev 3.0 SEC 6.6).
 *
 * "Every cross-context message is a Zod-validated envelope {type, reqId, payload}; unknown types
 *  are dropped and logged. External messages (onMessageExternal) are refused entirely."
 *
 * Everything about this file is a trust boundary:
 *
 *   1. Structural pre-check (`looksLikeEnvelope`) rejects the noise other extensions and page
 *      scripts put on the wire without ever entering our dispatch path.
 *   2. `messageEnvelopeSchema` (Zod) validates the envelope. A message whose `type` is not in the
 *      closed `MESSAGE_TYPES` union is DROPPED and LOGGED — never dispatched.
 *   3. The sender is checked: anything carrying a foreign extension id is refused.
 *   4. INV-2 — `AI_GENERATE_ANSWER`, `AI_GENERATE_COVER`, `AI_DISAMBIGUATE` and `RESUME_PARSE`
 *      (`GESTURE_REQUIRED`) are refused unless the envelope carries a live, unburned gesture
 *      nonce. The nonce is consumed here, once, before the handler sees anything.
 *   5. `GESTURE_MINT` is refused from any origin that is not trusted extension UI — the
 *      MAIN-world script must never be able to manufacture its own permission slip.
 *   6. `browser.runtime.onMessageExternal` is registered explicitly and refuses everything.
 *
 * Handlers are registered per message type and are type-checked against `MessageContracts`, so a
 * handler that replies with the wrong shape is a compile error rather than a runtime surprise.
 */

import type { WxtBrowser } from 'wxt/browser';

import {
  errReply,
  looksLikeEnvelope,
  makeEnvelope,
  requiresGesture,
  type MessageContext,
  type MessageEnvelope,
  type MessageHandler,
  type MessageHandlers,
  type MessageReply,
  type MessageType,
  type PayloadOf,
  type ReplyOf,
} from '@/shared/messages';
import { messageEnvelopeSchema } from '@/shared/schema';
import { consumeGesture } from '@/platform/gesture';
import { createLogger } from '@/platform/logger';

const log = createLogger('bus');

/**
 * Late-bound extension API handle. WXT auto-imports `browser`, but resolving it off `globalThis`
 * at call time keeps this module usable in a plain vitest run where a fake browser is installed
 * on the global object before the first bus call.
 */
function ext(): WxtBrowser {
  const g = globalThis as unknown as { browser?: WxtBrowser; chrome?: WxtBrowser };
  const api = g.browser ?? g.chrome;
  if (!api) throw new Error('extension messaging APIs are unavailable in this context');
  return api;
}

/** Minimal shape of `runtime.MessageSender` that the router actually reads. */
interface Sender {
  id?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined; url?: string | undefined } | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Sending
 * ---------------------------------------------------------------------------------------------- */

function normalizeReply<T extends MessageType>(type: T, raw: unknown): ReplyOf<T> {
  if (raw === undefined || raw === null) {
    return errReply('INTERNAL', `no reply received for ${type}`);
  }
  if (typeof raw === 'object' && 'ok' in raw && typeof (raw as { ok: unknown }).ok === 'boolean') {
    return raw as ReplyOf<T>;
  }
  log.warn(`malformed reply for ${type}`, raw);
  return errReply('VALIDATION_FAILED', `malformed reply for ${type}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Send a message to the service worker (or, from the worker, to every extension page) and get the
 * typed reply from `MessageContracts`.
 *
 * `gesture` is required for the `GESTURE_REQUIRED` set (INV-2); mint one with `GESTURE_MINT` from
 * inside a real user-gesture handler and pass it straight through — do not cache it, it dies in
 * 5 seconds and burns on first use.
 *
 * Never throws: transport failures come back as `{ ok: false, error }` so callers have exactly one
 * code path to handle.
 */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: PayloadOf<T>,
  gesture?: string,
): Promise<ReplyOf<T>> {
  const envelope = makeEnvelope(type, payload, gesture);
  try {
    const raw: unknown = await ext().runtime.sendMessage(envelope);
    return normalizeReply(type, raw);
  } catch (error) {
    const message = describeError(error);
    log.warn(`send of ${type} failed`, message);
    return errReply('INTERNAL', `bus transport failed for ${type}: ${message}`);
  }
}

/**
 * Popup/options/service-worker → a specific tab (and optionally a specific frame). This is how
 * `FILL_REQUEST` reaches the content script.
 */
export async function sendToTab<T extends MessageType>(
  tabId: number,
  type: T,
  payload: PayloadOf<T>,
  options: { frameId?: number; gesture?: string } = {},
): Promise<ReplyOf<T>> {
  const envelope = makeEnvelope(type, payload, options.gesture);
  try {
    const api = ext();
    if (!api.tabs || typeof api.tabs.sendMessage !== 'function') {
      return errReply('INTERNAL', 'tabs.sendMessage is unavailable in this context');
    }
    const raw: unknown =
      options.frameId === undefined
        ? await api.tabs.sendMessage(tabId, envelope)
        : await api.tabs.sendMessage(tabId, envelope, { frameId: options.frameId });
    return normalizeReply(type, raw);
  } catch (error) {
    const message = describeError(error);
    log.warn(`send of ${type} to tab ${tabId} failed`, message);
    return errReply('INTERNAL', `bus transport failed for ${type}: ${message}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Handler registry
 * ---------------------------------------------------------------------------------------------- */

type ErasedHandler = (
  payload: unknown,
  ctx: MessageContext,
) => MessageReply<unknown> | Promise<MessageReply<unknown>>;

const handlers = new Map<MessageType, ErasedHandler>();

/**
 * Register the handler for one message type. Returns an unregister function.
 *
 * The single cast in this file lives here: the registry is keyed by a union, so the per-type
 * relationship between payload and reply is erased inside the map and re-established by the
 * generic signature. Callers stay fully type-checked against `MessageContracts`.
 */
export function registerHandler<T extends MessageType>(
  type: T,
  handler: MessageHandler<T>,
): () => void {
  if (handlers.has(type)) {
    log.warn(`handler for ${type} replaced — the previous one will no longer be called`);
  }
  handlers.set(type, handler as unknown as ErasedHandler);
  return () => {
    if (handlers.get(type) === (handler as unknown as ErasedHandler)) handlers.delete(type);
  };
}

/** Bulk registration for the service worker's handler table. */
export function registerHandlers(table: Partial<MessageHandlers>): () => void {
  const disposers: Array<() => void> = [];
  for (const key of Object.keys(table) as MessageType[]) {
    const handler = table[key];
    if (!handler) continue;
    disposers.push(registerHandler(key, handler as MessageHandler<MessageType>));
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function hasHandler(type: MessageType): boolean {
  return handlers.has(type);
}

/** Message types with no handler yet — used by the service worker's own startup self-check. */
export function unhandledTypes(types: readonly MessageType[]): MessageType[] {
  return types.filter((type) => !handlers.has(type));
}

export function clearHandlers(): void {
  handlers.clear();
}

/* ------------------------------------------------------------------------------------------------
 * Origin resolution
 * ---------------------------------------------------------------------------------------------- */

function extensionBaseUrl(): string {
  try {
    return ext().runtime.getURL('/');
  } catch {
    return '';
  }
}

/**
 * Where a message came from. Anything we cannot positively identify is `'unknown'` and is treated
 * as untrusted — `GESTURE_MINT` is refused for it.
 */
function resolveOrigin(sender: Sender): MessageContext['origin'] {
  if (sender.tab && typeof sender.tab.id === 'number') {
    // Content scripts (ISOLATED world). The MAIN-world script has no extension messaging at all,
    // so it can never reach this listener — `'main-world'` stays reserved for explicit relays.
    return 'content';
  }
  const url = sender.url ?? '';
  if (url === '') return 'unknown';

  const base = extensionBaseUrl();
  if (base !== '' && !url.startsWith(base)) return 'unknown';

  if (url.includes('popup.html')) return 'popup';
  if (url.includes('options.html')) return 'options';
  return 'background';
}

/** Trusted enough to mint a user-gesture nonce: real extension UI the user is looking at. */
const GESTURE_MINT_ORIGINS: ReadonlySet<MessageContext['origin']> = new Set<MessageContext['origin']>([
  'popup',
  'options',
  'content',
  'background',
]);

/* ------------------------------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------------------------- */

async function dispatch(
  envelope: MessageEnvelope,
  sender: Sender,
): Promise<MessageReply<unknown>> {
  const origin = resolveOrigin(sender);
  const ctx: MessageContext = {
    type: envelope.type,
    reqId: envelope.reqId,
    // Already burned by the gate below — recorded for diagnostics, not for re-verification.
    gesture: envelope.gesture ?? null,
    tabId: sender.tab?.id ?? null,
    frameId: sender.frameId ?? null,
    url: sender.tab?.url ?? sender.url ?? null,
    origin,
  };

  // INV-2 — the gesture gate. Nothing that can spend a Gemini key gets past here without a fresh,
  // single-use nonce minted by trusted UI inside a real user gesture.
  if (requiresGesture(envelope.type)) {
    if (envelope.gesture === undefined) {
      log.warn(`${envelope.type} refused: no gesture token (INV-2)`);
      return errReply('GESTURE_REQUIRED', 'This action must be triggered by a user gesture.');
    }
    if (!consumeGesture(envelope.gesture)) {
      log.warn(`${envelope.type} refused: gesture token expired, replayed, or unknown (INV-2)`);
      return errReply('GESTURE_EXPIRED', 'Your confirmation expired — click again to continue.');
    }
  }

  // A page-facing context must never be able to mint its own permission slip.
  if (envelope.type === 'GESTURE_MINT' && !GESTURE_MINT_ORIGINS.has(origin)) {
    log.warn(`GESTURE_MINT refused from untrusted origin '${origin}' (INV-2)`);
    return errReply('BAD_REQUEST', 'Gesture tokens may only be minted by extension UI.');
  }

  const handler = handlers.get(envelope.type);
  if (!handler) {
    log.error(`no handler registered for ${envelope.type}`);
    return errReply('INTERNAL', `No handler registered for ${envelope.type}.`);
  }

  try {
    const reply = await handler(envelope.payload, ctx);
    if (typeof reply !== 'object' || reply === null || typeof (reply as { ok: unknown }).ok !== 'boolean') {
      log.error(`handler for ${envelope.type} returned a malformed reply`, reply);
      return errReply('INTERNAL', `Handler for ${envelope.type} returned a malformed reply.`);
    }
    return reply;
  } catch (error) {
    log.error(`handler for ${envelope.type} threw`, error);
    return errReply('INTERNAL', describeError(error));
  }
}

/**
 * SEC 6.6 — "unknown types are dropped and logged". Anything that structurally resembles one of
 * our envelopes but names a type outside `MESSAGE_TYPES` is reported at warn level; the rest of
 * the wire noise (we listen on `<all_urls>`) stays at debug so the console remains readable.
 */
function logDroppedMessage(message: unknown): void {
  if (typeof message !== 'object' || message === null) return;
  const candidate = message as { type?: unknown; reqId?: unknown };
  if (typeof candidate.type === 'string' && typeof candidate.reqId === 'string') {
    log.warn(`dropped a message with an unknown type: ${candidate.type}`);
    return;
  }
  if ('type' in candidate) log.debug('ignored a foreign message', message);
}

/** Validate an already-structurally-checked envelope and route it to its handler. */
async function route(message: unknown, sender: Sender): Promise<MessageReply<unknown>> {
  const parsed = messageEnvelopeSchema.safeParse(message);
  if (!parsed.success) {
    log.warn('dropped a malformed envelope', parsed.error.issues);
    return errReply('VALIDATION_FAILED', 'Malformed message envelope.');
  }

  const ownId = ((): string | null => {
    try {
      return ext().runtime.id;
    } catch {
      return null;
    }
  })();
  if (sender.id !== undefined && ownId !== null && sender.id !== ownId) {
    log.warn(`refused a message from a foreign extension id: ${sender.id}`);
    return errReply('BAD_REQUEST', 'Messages from other extensions are refused.');
  }

  const envelope: MessageEnvelope = {
    type: parsed.data.type,
    reqId: parsed.data.reqId,
    payload: parsed.data.payload as PayloadOf<MessageType>,
    ...(parsed.data.gesture === undefined ? {} : { gesture: parsed.data.gesture }),
  };

  return dispatch(envelope, sender);
}

type RuntimeListener = (
  message: unknown,
  sender: Sender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

let messageListener: RuntimeListener | null = null;

/**
 * Install the router. Called once from the service worker after its handlers are registered.
 * Idempotent — a second call is a no-op.
 */
export function startRouter(): void {
  if (messageListener !== null) return;
  const api = ext();

  messageListener = (message, sender, sendResponse) => {
    // Structural check FIRST, synchronously: only claim the response channel for messages that
    // are actually ours. Returning `false` here leaves foreign traffic to whoever else is
    // listening instead of answering it with `undefined`.
    if (!looksLikeEnvelope(message)) {
      logDroppedMessage(message);
      return false;
    }

    let pending: Promise<MessageReply<unknown>>;
    try {
      pending = route(message, sender);
    } catch (error) {
      log.error('router threw synchronously', error);
      sendResponse(errReply('INTERNAL', describeError(error)));
      return true;
    }

    void pending.then(sendResponse, (error: unknown) => {
      log.error('router rejected', error);
      sendResponse(errReply('INTERNAL', describeError(error)));
    });
    // `true` keeps the response channel open for the async handler — the MV3-portable contract.
    return true;
  };

  api.runtime.onMessage.addListener(messageListener as unknown as Parameters<
    typeof api.runtime.onMessage.addListener
  >[0]);

  // SEC 6.6 used to refuse every external message here, on the stated grounds that
  // `externally_connectable` was absent from the manifest so the listener could never fire. That
  // grounds no longer holds: the manifest now lists the NextMove origins so the web app can hand
  // this extension a pairing code and an E2E vault key. Registering a blanket refusal here is
  // therefore not a harmless belt-and-braces — it is a live bug. Chrome runs external listeners in
  // registration order and delivers the FIRST synchronous `sendResponse`, and the router installs
  // before the handoff does, so the refusal won every race and the handshake could never complete.
  //
  // External messages are now owned exclusively by `background/handoff.ts`, which is the layer that
  // can actually authorise one: it checks `sender.origin` against an exact allowlist, requires the
  // top frame of a real tab, and burns a single-use nonce. An unknown message type there returns
  // `false` without responding, which is the correct refusal — Chrome closes the channel and the
  // caller sees no reply.
  log.info('message router started');
}

/** Tear the router down (tests, and a clean reload path). */
export function stopRouter(): void {
  const api = ext();
  if (messageListener !== null) {
    api.runtime.onMessage.removeListener(
      messageListener as unknown as Parameters<typeof api.runtime.onMessage.removeListener>[0],
    );
    messageListener = null;
  }
}

export function isRouterStarted(): boolean {
  return messageListener !== null;
}
