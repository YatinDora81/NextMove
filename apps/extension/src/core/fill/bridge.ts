/**
 * core/fill/bridge.ts — the ISOLATED-world half of the MAIN-world fill bridge.
 *
 * JF-001 Rev 3.0 · SEC 4.1 (content-script layer) · SEC 6.4 (FillEngine) · INV-1.
 *
 * Why a bridge at all: a content script shares the DOM but not the page's JS realm. Most of the
 * time an isolated-world write is enough, but a handful of ATS widgets only believe values that
 * were produced by the page's own realm (they compare against a captured prototype descriptor, or
 * they read `event.target` identity). `entrypoints/main-world.content.ts` runs in the page realm
 * and performs the actual write on request.
 *
 * PROTOCOL (fixed — implemented on the other side by agent S2):
 *   ISOLATED → MAIN   window.postMessage({ __jobfill: 'req', id, op, args }, '*')
 *   MAIN → ISOLATED   window.postMessage({ __jobfill: 'res', id, ok, result?, error? }, '*')
 *
 * Elements are addressed by a unique selector: we stamp `data-jobfill-id="<uuid>"` on the node and
 * pass `[data-jobfill-id="<uuid>"]`. Requests time out after 4000 ms.
 *
 * SECURITY
 *   - Only messages with `event.source === window` are considered (same-window origin check); a
 *     frame or opener cannot answer on the bridge's behalf.
 *   - The page itself *can* forge a response — it is the page's own realm. That is why nothing
 *     here treats `ok: true` as proof: every strategy re-reads the DOM itself before it reports a
 *     field as `filled` (INV-4 — never guess).
 *   - INV-1 is enforced here **and** in the MAIN-world script: neither side will touch a submit
 *     control, so a compromised half cannot make the other half submit an application.
 */

import type { JitterRange } from '@/shared/constants';
import {
  JOBFILL_ID_ATTR,
  assertClickable,
  assertNotSubmitControl,
  dispatchValueEvents,
  isAborted,
  isForbiddenClickTarget,
  jitter,
  readLocalValue,
  setNativeValueRaw,
  sleep,
} from './dom';

/* ------------------------------------------------------------------------------------------------
 * Protocol
 * ---------------------------------------------------------------------------------------------- */

export const BRIDGE_KEY = '__jobfill' as const;
export const BRIDGE_REQ = 'req' as const;
export const BRIDGE_RES = 'res' as const;

export type BridgeOp =
  | 'PING'
  | 'SET_VALUE'
  | 'SET_SELECT'
  | 'CLICK'
  | 'TYPE_SEQUENCE'
  | 'ATTACH_FILE'
  | 'READ_VALUE';

export interface BridgeArgMap {
  PING: Record<string, never>;
  SET_VALUE: { selector: string; value: string };
  SET_SELECT: { selector: string; value: string };
  CLICK: { selector: string };
  TYPE_SEQUENCE: { selector: string; text: string; perCharDelayMs: number };
  ATTACH_FILE: { selector: string; file: File; dropzoneSelector?: string };
  READ_VALUE: { selector: string };
}

export interface BridgeRequestMessage<K extends BridgeOp = BridgeOp> {
  __jobfill: typeof BRIDGE_REQ;
  id: string;
  op: K;
  args: BridgeArgMap[K];
}

export interface BridgeResponseMessage {
  __jobfill: typeof BRIDGE_RES;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Fixed by the shared contract. */
export const BRIDGE_TIMEOUT_MS = 4_000;
/** Availability probe: short, because a page without the MAIN script must not cost 4 s per field. */
export const BRIDGE_PING_TIMEOUT_MS = 700;
export const BRIDGE_PING_ATTEMPTS = 3;

export type BridgeVia = 'main' | 'local';

export type BridgeResult<T> =
  | { ok: true; value: T; via: BridgeVia }
  | { ok: false; error: string; via: BridgeVia };

export interface BridgeCallOptions {
  timeoutMs?: number;
  /** Set false to fail instead of silently degrading to an isolated-world write. */
  allowLocalFallback?: boolean;
  /** Skip the MAIN world entirely (tests, or pages where the MAIN script never loaded). */
  preferLocal?: boolean;
  signal?: AbortSignal;
}

/* ------------------------------------------------------------------------------------------------
 * Selector stamping
 * ---------------------------------------------------------------------------------------------- */

function newId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `jf-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * Stamp `data-jobfill-id` on a node and return the selector the MAIN world will resolve.
 * Idempotent: an already-stamped node keeps its id, so repeated ops address the same element.
 */
export function stampSelector(el: Element): string {
  let id = el.getAttribute(JOBFILL_ID_ATTR);
  if (id === null || id.length === 0) {
    id = newId();
    el.setAttribute(JOBFILL_ID_ATTR, id);
  }
  return `[${JOBFILL_ID_ATTR}="${id}"]`;
}

/** Remove our marker once a run is over so we leave the host page as we found it. */
export function unstampAll(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll(`[${JOBFILL_ID_ATTR}]`))) {
    el.removeAttribute(JOBFILL_ID_ATTR);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------------------------------- */

interface Pending {
  resolve: (value: BridgeResponseMessage) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let listening = false;
let consecutiveTimeouts = 0;
let readyProbe: Promise<boolean> | null = null;
let ready: boolean | null = null;

function isResponse(value: unknown): value is BridgeResponseMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  return msg[BRIDGE_KEY] === BRIDGE_RES && typeof msg['id'] === 'string' && typeof msg['ok'] === 'boolean';
}

/**
 * Same-window origin check: the MAIN-world script lives in *this* window and nowhere else, so a
 * frame, an opener or a popup must never be able to answer on the bridge.
 *
 * `event.source === window` is the normal browser answer and short-circuits immediately. The
 * fallback covers the two remaining cases: a `null` source (sender window already destroyed) and
 * DOM implementations used in tests that do not set `source` to the window object at all. Anything
 * that *is* window-like and is not ours is another browsing context — always rejected.
 */
function isSameWindow(event: MessageEvent<unknown>): boolean {
  if (event.source === window) return true;

  const source = event.source as { postMessage?: unknown; document?: unknown } | null | undefined;
  if (source == null) {
    // Sender window already destroyed; fall back to the origin.
    return event.origin === '' || event.origin === window.location.origin;
  }

  // Identity through the document survives wrapper differences. A same-origin frame has a
  // *different* document and is rejected; a cross-origin frame throws on the access and is
  // rejected too.
  try {
    if (source.document === window.document) return true;
  } catch {
    return false;
  }

  // Window-like and demonstrably not ours ⇒ another browsing context.
  if (typeof source.postMessage === 'function') return false;
  return event.origin === '' || event.origin === window.location.origin;
}

function onMessage(event: MessageEvent<unknown>): void {
  if (!isSameWindow(event)) return;
  if (!isResponse(event.data)) return;

  const entry = pending.get(event.data.id);
  if (!entry) return;
  pending.delete(event.data.id);
  clearTimeout(entry.timer);
  entry.resolve(event.data);
}

function ensureListening(): boolean {
  if (typeof window === 'undefined') return false;
  if (listening) return true;
  window.addEventListener('message', onMessage);
  listening = true;
  return true;
}

/** Detach the listener and fail every in-flight request. Used on teardown and by tests. */
export function disposeBridge(): void {
  if (listening && typeof window !== 'undefined') {
    window.removeEventListener('message', onMessage);
  }
  listening = false;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ __jobfill: BRIDGE_RES, id: '', ok: false, error: 'bridge-disposed' });
  }
  pending.clear();
  readyProbe = null;
  ready = null;
  consecutiveTimeouts = 0;
}

/** Raw transport. Never throws; a timeout resolves as `{ ok: false, error: 'timeout' }`. */
export async function call<K extends BridgeOp>(
  op: K,
  args: BridgeArgMap[K],
  timeoutMs: number = BRIDGE_TIMEOUT_MS,
): Promise<BridgeResult<unknown>> {
  if (!ensureListening()) return { ok: false, error: 'no-window', via: 'main' };

  const id = newId();
  const message: BridgeRequestMessage<K> = { __jobfill: BRIDGE_REQ, id, op, args };

  const response = await new Promise<BridgeResponseMessage>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ __jobfill: BRIDGE_RES, id, ok: false, error: 'timeout' });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      window.postMessage(message, '*');
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({
        __jobfill: BRIDGE_RES,
        id,
        ok: false,
        error: error instanceof Error ? error.message : 'postMessage-failed',
      });
    }
  });

  if (response.error === 'timeout') {
    consecutiveTimeouts += 1;
    // Two silent timeouts in a row means the MAIN half is gone; stop paying 4 s per field.
    if (consecutiveTimeouts >= 2) ready = false;
  } else {
    consecutiveTimeouts = 0;
  }

  if (response.ok) return { ok: true, value: response.result, via: 'main' };
  return { ok: false, error: response.error ?? 'bridge-error', via: 'main' };
}

/* ------------------------------------------------------------------------------------------------
 * Availability
 * ---------------------------------------------------------------------------------------------- */

/** `true` once the MAIN-world script has answered a PING. Cached for the life of the document. */
export async function ping(options?: { timeoutMs?: number; attempts?: number }): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? BRIDGE_PING_TIMEOUT_MS;
  const attempts = Math.max(1, options?.attempts ?? BRIDGE_PING_ATTEMPTS);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await call('PING', {}, timeoutMs);
    if (result.ok) {
      consecutiveTimeouts = 0;
      return true;
    }
    // document_idle races: the MAIN script may still be evaluating. Give it a beat.
    if (attempt < attempts - 1) await sleep(150);
  }
  return false;
}

/** Probe once per document; every helper consults this before paying for a round trip. */
export async function ensureBridge(): Promise<boolean> {
  if (ready !== null) return ready;
  if (readyProbe === null) {
    readyProbe = ping().then((value) => {
      ready = value;
      return value;
    });
  }
  return readyProbe;
}

/** `null` until the first probe completes. */
export function bridgeState(): boolean | null {
  return ready;
}

/* ------------------------------------------------------------------------------------------------
 * ISOLATED-world fallbacks
 *
 * These are not a consolation prize: an isolated-world write hits the same DOM node, and because
 * React's instance-level value trap lives in the page realm it is simply not in our way. They keep
 * the FillEngine working on pages where the MAIN-world script never ran.
 * ---------------------------------------------------------------------------------------------- */

function localSetValue(el: Element, value: string): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // SEC 6.4: prototype setter, then the real event trio (many ATS validate on blur).
    setNativeValueRaw(el, value);
    dispatchValueEvents(el, ['input', 'change', 'blur']);
    return true;
  }
  const html = el as HTMLElement;
  if (html.isContentEditable) {
    html.textContent = value;
    dispatchValueEvents(html, ['input', 'change', 'blur']);
    return true;
  }
  return false;
}

function localSetSelect(el: Element, value: string): boolean {
  if (!(el instanceof HTMLSelectElement)) return false;
  const wanted = value.trim().toLowerCase();
  let index = -1;
  for (let i = 0; i < el.options.length; i++) {
    const option: HTMLOptionElement | undefined = el.options[i];
    if (!option) continue;
    if (option.value.trim().toLowerCase() === wanted) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    for (let i = 0; i < el.options.length; i++) {
      const option: HTMLOptionElement | undefined = el.options[i];
      if (!option) continue;
      if ((option.textContent ?? '').trim().toLowerCase() === wanted) {
        index = i;
        break;
      }
    }
  }
  if (index === -1) return false;
  el.selectedIndex = index;
  dispatchValueEvents(el, ['input', 'change']);
  return true;
}

function localClick(el: Element): boolean {
  // INV-1: located and highlighted, never clicked — the guard runs on both sides of the bridge,
  // and it is the SAME guard. `isForbiddenClickTarget` (not the weaker `isSubmitControl`) is what
  // the MAIN world enforces, so this side must enforce it too, or the fallback below silently
  // becomes a way around it.
  if (isForbiddenClickTarget(el)) return false;
  if (typeof (el as HTMLElement).click !== 'function') return false;
  (el as HTMLElement).click();
  return true;
}

async function localTypeSequence(
  el: Element,
  text: string,
  delayFor: () => number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  for (const char of Array.from(text)) {
    if (isAborted(signal)) return false;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
    setNativeValueRaw(el, el.value + char);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));
    const delay = delayFor();
    if (delay > 0) await sleep(delay, signal);
  }
  return true;
}

function localAttachFile(el: Element, file: File, dropzone: Element | null): boolean {
  let attached = false;
  const transfer = new DataTransfer();
  transfer.items.add(file); // File built from the IndexedDB blob (SEC 6.4 / SEC 7.1)

  if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'file') {
    el.files = transfer.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    attached = el.files !== null && el.files.length === 1;
  }

  if (dropzone) {
    const init: DragEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: transfer,
    };
    dropzone.dispatchEvent(new DragEvent('dragenter', init));
    dropzone.dispatchEvent(new DragEvent('dragover', init));
    dropzone.dispatchEvent(new DragEvent('drop', init));
    attached = true;
  }

  return attached;
}

/* ------------------------------------------------------------------------------------------------
 * Typed helpers — MAIN world first, isolated world as the safety net
 * ---------------------------------------------------------------------------------------------- */

function guard(el: Element, op: string): BridgeResult<never> | null {
  try {
    assertNotSubmitControl(el, op); // INV-1: never auto-submit, on this side of the bridge too.
    return null;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'submit-control', via: 'local' };
  }
}

/**
 * INV-1 for CLICK specifically. Clicking is the only op that can *advance or submit* an
 * application, so it carries the wider refusal set (`isForbiddenClickTarget`) that the MAIN world
 * also enforces. Writing a value into a next-step button is meaningless; clicking one is not.
 */
function guardClick(el: Element, op: string): BridgeResult<never> | null {
  try {
    assertClickable(el, op);
    return null;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'submit-control', via: 'local' };
  }
}

/** The exact string the MAIN world throws when it refuses on INV-1 grounds. */
const SUBMIT_REFUSED = 'submit-control-refused';

async function useMain(options?: BridgeCallOptions): Promise<boolean> {
  if (options?.preferLocal === true) return false;
  return ensureBridge();
}

function localResult<T>(succeeded: boolean, value: T, error: string): BridgeResult<T> {
  return succeeded ? { ok: true, value, via: 'local' } : { ok: false, error, via: 'local' };
}

export async function setValue(
  el: Element,
  value: string,
  options?: BridgeCallOptions,
): Promise<BridgeResult<void>> {
  const blocked = guard(el, 'set the value of');
  if (blocked) return blocked;

  if (await useMain(options)) {
    const result = await call(
      'SET_VALUE',
      { selector: stampSelector(el), value },
      options?.timeoutMs ?? BRIDGE_TIMEOUT_MS,
    );
    if (result.ok) return { ok: true, value: undefined, via: 'main' };
    if (options?.allowLocalFallback === false) return { ok: false, error: result.error, via: 'main' };
  } else if (options?.allowLocalFallback === false) {
    return { ok: false, error: 'bridge-unavailable', via: 'main' };
  }

  return localResult(localSetValue(el, value), undefined, 'not-fillable');
}

export async function setSelect(
  el: Element,
  value: string,
  options?: BridgeCallOptions,
): Promise<BridgeResult<void>> {
  const blocked = guard(el, 'select an option on');
  if (blocked) return blocked;

  if (await useMain(options)) {
    const result = await call(
      'SET_SELECT',
      { selector: stampSelector(el), value },
      options?.timeoutMs ?? BRIDGE_TIMEOUT_MS,
    );
    if (result.ok) return { ok: true, value: undefined, via: 'main' };
    if (options?.allowLocalFallback === false) return { ok: false, error: result.error, via: 'main' };
  } else if (options?.allowLocalFallback === false) {
    return { ok: false, error: 'bridge-unavailable', via: 'main' };
  }

  return localResult(localSetSelect(el, value), undefined, 'no-option-match');
}

/**
 * Click a radio, a checkbox, a listbox option or the label that proxies one.
 * INV-1: this helper refuses submit controls outright, and so does the MAIN-world script.
 */
export async function click(el: Element, options?: BridgeCallOptions): Promise<BridgeResult<void>> {
  // INV-1, first of three gates: the CLICK-specific refusal set (submit + wizard advance +
  // real navigation), identical to the MAIN world's.
  const blocked = guardClick(el, 'click');
  if (blocked) return blocked;

  if (await useMain(options)) {
    const result = await call(
      'CLICK',
      { selector: stampSelector(el) },
      options?.timeoutMs ?? BRIDGE_TIMEOUT_MS,
    );
    if (result.ok) return { ok: true, value: undefined, via: 'main' };
    // INV-1: a REFUSAL is a decision, not a transport failure. If the MAIN world declined this
    // target on invariant grounds, retrying it through the local path would be laundering the
    // refusal through a second implementation. Only genuine transport problems (timeout, no
    // bridge, missing element) may fall back.
    if (result.error === SUBMIT_REFUSED) return { ok: false, error: result.error, via: 'main' };
    if (options?.allowLocalFallback === false) return { ok: false, error: result.error, via: 'main' };
  } else if (options?.allowLocalFallback === false) {
    return { ok: false, error: 'bridge-unavailable', via: 'main' };
  }

  return localResult(localClick(el), undefined, 'not-clickable');
}

/**
 * Drive a real keystroke stream. Pass a `JitterRange` to get a fresh 30–60 ms style delay per
 * character (SEC 6.4); a plain number keeps a constant cadence. Long strings are split across
 * several requests so no single call can approach the 4 s protocol timeout.
 */
export async function typeSequence(
  el: Element,
  text: string,
  perCharDelayMs: number | JitterRange,
  options?: BridgeCallOptions,
): Promise<BridgeResult<void>> {
  const blocked = guard(el, 'type into');
  if (blocked) return blocked;
  if (text.length === 0) return { ok: true, value: undefined, via: 'local' };

  const timeoutMs = options?.timeoutMs ?? BRIDGE_TIMEOUT_MS;
  const chars = Array.from(text);
  const jittered = typeof perCharDelayMs !== 'number';

  // Budget: never let one request's own delays consume the timeout.
  const worstDelay = jittered ? Math.max(perCharDelayMs.min, perCharDelayMs.max) : perCharDelayMs;
  const perCall = jittered ? 1 : Math.max(1, Math.floor((timeoutMs - 1_000) / Math.max(1, worstDelay)));

  const delayFor = (): number =>
    jittered ? jitter(perCharDelayMs.min, perCharDelayMs.max) : perCharDelayMs;

  const viaMain = await useMain(options);
  // Characters already delivered by the MAIN world. TYPE_SEQUENCE appends, so the local fallback
  // must resume from here — retyping the whole string would duplicate the prefix.
  let sent = 0;

  if (viaMain) {
    for (let i = 0; i < chars.length; i += perCall) {
      if (isAborted(options?.signal)) return { ok: false, error: 'aborted', via: 'main' };
      const chunk = chars.slice(i, i + perCall);
      const result = await call(
        'TYPE_SEQUENCE',
        { selector: stampSelector(el), text: chunk.join(''), perCharDelayMs: delayFor() },
        timeoutMs,
      );
      if (!result.ok) {
        if (options?.allowLocalFallback === false) {
          return { ok: false, error: result.error, via: 'main' };
        }
        break;
      }
      sent += chunk.length;
    }
    if (sent === chars.length) return { ok: true, value: undefined, via: 'main' };
  } else if (options?.allowLocalFallback === false) {
    return { ok: false, error: 'bridge-unavailable', via: 'main' };
  }

  const remaining = chars.slice(sent).join('');
  const done = await localTypeSequence(el, remaining, delayFor, options?.signal);
  return localResult(done, undefined, 'not-fillable');
}

/** DataTransfer injection; `dropzone` receives a `drop` with the same transfer when supplied. */
export async function attachFile(
  el: Element,
  file: File,
  dropzone?: Element | null,
  options?: BridgeCallOptions,
): Promise<BridgeResult<void>> {
  const blocked = guard(el, 'attach a file to');
  if (blocked) return blocked;
  if (dropzone) {
    const dropBlocked = guard(dropzone, 'drop a file on');
    if (dropBlocked) return dropBlocked;
  }

  if (await useMain(options)) {
    const args: BridgeArgMap['ATTACH_FILE'] = { selector: stampSelector(el), file };
    if (dropzone) args.dropzoneSelector = stampSelector(dropzone);
    const result = await call('ATTACH_FILE', args, options?.timeoutMs ?? BRIDGE_TIMEOUT_MS);
    if (result.ok) return { ok: true, value: undefined, via: 'main' };
    if (options?.allowLocalFallback === false) return { ok: false, error: result.error, via: 'main' };
  } else if (options?.allowLocalFallback === false) {
    return { ok: false, error: 'bridge-unavailable', via: 'main' };
  }

  return localResult(localAttachFile(el, file, dropzone ?? null), undefined, 'not-fillable');
}

/**
 * Read the value the page currently holds — the commit check behind every `verified: true`.
 * Falls back to a direct DOM read, which addresses the very same node.
 */
export async function readValue(
  el: Element,
  options?: BridgeCallOptions,
): Promise<BridgeResult<string>> {
  if (await useMain(options)) {
    const result = await call(
      'READ_VALUE',
      { selector: stampSelector(el) },
      options?.timeoutMs ?? BRIDGE_TIMEOUT_MS,
    );
    if (result.ok && typeof result.value === 'string') {
      return { ok: true, value: result.value, via: 'main' };
    }
    if (result.ok && (result.value === null || result.value === undefined)) {
      return { ok: true, value: '', via: 'main' };
    }
    if (options?.allowLocalFallback === false) {
      return { ok: false, error: result.ok ? 'bad-result' : result.error, via: 'main' };
    }
  } else if (options?.allowLocalFallback === false) {
    return { ok: false, error: 'bridge-unavailable', via: 'main' };
  }

  const local = readLocalValue(el);
  return local === null
    ? { ok: false, error: 'not-readable', via: 'local' }
    : { ok: true, value: local, via: 'local' };
}

/** Verification read: the DOM is authoritative here, the bridge covers exotic custom widgets. */
export async function readCommitted(
  el: Element,
  options?: BridgeCallOptions,
): Promise<string | null> {
  const local = readLocalValue(el);
  if (local !== null) return local;
  const result = await readValue(el, options);
  return result.ok ? result.value : null;
}
