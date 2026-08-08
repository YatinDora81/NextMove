/**
 * entrypoints/main-world.content.ts — the MAIN-world half of the fill bridge.
 *
 * JF-001 Rev 3.0 · SEC 6.4 (FillEngine: "executed in the MAIN world so framework state managers
 * observe the change") · SEC 10 note ("MAIN-world helper exists solely for native-setter fills and
 * exposes nothing else") · INV-1.
 *
 * WHY THIS FILE EXISTS
 * A content script shares the host page's DOM but not its JavaScript realm. React installs an
 * instance-level `value` trap on every controlled input and compares against a descriptor it
 * captured from *its own* realm; a handful of ATS widgets go further and compare `event.target`
 * identity or read a value back through a page-realm reference. Writing from the page's own realm
 * removes every one of those failure modes at once. That is the entire purpose of this script.
 *
 * WHAT IT EXPOSES
 * Nothing. There is no global, no custom element, no property on `window`, no exported object. The
 * only observable behaviour is a `message` listener that answers a private protocol. Everything
 * else in this file is closed over inside `main()`.
 *
 * THE PROTOCOL (fixed; the ISOLATED half lives in `core/fill/bridge.ts`)
 *   ISOLATED → MAIN   window.postMessage({ __jobfill: 'req', id, op, args }, '*')
 *   MAIN → ISOLATED   window.postMessage({ __jobfill: 'res', id, ok, result?, error? }, '*')
 *
 *   PING           {}                                          → true
 *   SET_VALUE      { selector, value }                          native prototype setter + input/change/blur
 *   SET_SELECT     { selector, value }                          fuzzy option match → selectedIndex + change
 *   CLICK          { selector }                                 el.click() — radio/checkbox/option, NEVER a submit
 *   TYPE_SEQUENCE  { selector, text, perCharDelayMs }           per-character keydown/input/keyup
 *   ATTACH_FILE    { selector, file, dropzoneSelector? }        DataTransfer injection + drop fallback
 *   READ_VALUE     { selector }                                 → the value the page currently holds
 *
 * Elements are addressed by `[data-jobfill-id="<uuid>"]`, stamped on the node by the ISOLATED side
 * before the request is sent. Resolution walks open shadow roots, because the scanner does too.
 *
 * INV-1 — ENFORCED HERE, INDEPENDENTLY
 * Every op re-derives whether its target is a submit control and refuses if it is, using the same
 * rule as `core/fill/dom.ts`: `type=submit`, `[type=image]`, `[formaction]`, a `<button>` with no
 * explicit `type` (which submits its form), or any button-ish control whose accessible name
 * matches /submit|apply now|send application/i. `CLICK` additionally refuses real navigations and
 * wizard "next step" controls, because INV-1 covers advancing an application as well as sending
 * one. The check is duplicated on purpose: a compromised half of the bridge must not be able to
 * make the other half submit an application.
 *
 * TRUST MODEL
 * This script runs in the page's realm, so the page can forge requests to it. That grants the page
 * nothing: every op is something the page could already do to its own DOM, and the one genuinely
 * dangerous action — pressing Submit — is refused here. No extension API, no storage, no key, and
 * no profile data is reachable from this world; `browser.*` is not available in the MAIN world at
 * all, which is exactly why the gesture nonce (INV-2) can never be minted from here.
 */

import {
  isForbiddenClickTarget,
  isSubmitControl,
} from '@/core/fill/dom';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  world: 'MAIN',
  // Do not announce ourselves to the host page with WXT's legacy start-up postMessage.
  noScriptStartedPostMessage: true,

  main() {
    /* -------------------------------------------------------------------------------------------
     * Protocol constants (must match core/fill/bridge.ts exactly)
     * ----------------------------------------------------------------------------------------- */

    const KEY = '__jobfill';
    const REQ = 'req';
    const RES = 'res';

    type Op =
      | 'PING'
      | 'SET_VALUE'
      | 'SET_SELECT'
      | 'CLICK'
      | 'TYPE_SEQUENCE'
      | 'ATTACH_FILE'
      | 'READ_VALUE';

    const OPS: ReadonlySet<string> = new Set<Op>([
      'PING',
      'SET_VALUE',
      'SET_SELECT',
      'CLICK',
      'TYPE_SEQUENCE',
      'ATTACH_FILE',
      'READ_VALUE',
    ]);

    interface Request {
      id: string;
      op: Op;
      args: Record<string, unknown>;
    }

    /** Hard ceilings — a forged request must not be able to hang the page. */
    const MAX_TEXT_LENGTH = 20_000;
    const MAX_PER_CHAR_DELAY_MS = 200;
    const MAX_SHADOW_DEPTH = 12;
    const MAX_SHADOW_HOSTS = 4_000;

    /* -------------------------------------------------------------------------------------------
     * INV-1 — the submit guard
     *
     * This block used to be a hand-copied duplicate of `core/fill/dom.ts`, with a comment claiming
     * it was "byte-for-byte equivalent". It was not: `accessibleName` read `aria-label` before
     * `aria-labelledby` (the ISOLATED half reads them the other way round) and returned `el.value`
     * for *any* input rather than only submit/button/reset. Two guards that are supposed to agree,
     * quietly disagreeing, is the precise failure mode that produced the earlier INV-1 hole — where
     * a wizard-advance button refused by this half was clicked by the other.
     *
     * `core/fill/dom.ts` has zero imports, so the MAIN world can simply USE it. One definition, no
     * copy to drift, and the symmetry test in tests/unit/inv1.test.ts now asserts there is exactly
     * one definition rather than trying to keep two in step.
     * ----------------------------------------------------------------------------------------- */

    /* -------------------------------------------------------------------------------------------
     * Element resolution — open shadow roots included, because the scanner traverses them
     * ----------------------------------------------------------------------------------------- */

    function deepQuery(selector: string): Element | null {
      let visited = 0;

      const search = (root: Document | ShadowRoot, depth: number): Element | null => {
        let direct: Element | null = null;
        try {
          direct = root.querySelector(selector);
        } catch {
          return null; // malformed selector — never throw into the page
        }
        if (direct !== null) return direct;
        if (depth >= MAX_SHADOW_DEPTH) return null;

        let hosts: NodeListOf<Element>;
        try {
          hosts = root.querySelectorAll('*');
        } catch {
          return null;
        }
        for (let i = 0; i < hosts.length; i += 1) {
          if (visited >= MAX_SHADOW_HOSTS) return null;
          const host: Element | undefined = hosts[i];
          if (host === undefined) continue;
          const shadow = host.shadowRoot;
          if (shadow === null) continue;
          visited += 1;
          const found = search(shadow, depth + 1);
          if (found !== null) return found;
        }
        return null;
      };

      return search(document, 0);
    }

    function resolve(args: Record<string, unknown>, key = 'selector'): Element {
      const selector = args[key];
      if (typeof selector !== 'string' || selector.length === 0) {
        throw new Error('missing-selector');
      }
      const el = deepQuery(selector);
      if (el === null) throw new Error('element-not-found');
      return el;
    }

    /* -------------------------------------------------------------------------------------------
     * DOM primitives — the reason this script exists
     * ----------------------------------------------------------------------------------------- */

    type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    function isValueElement(el: Element): el is ValueElement {
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      );
    }

    function prototypeOf(el: ValueElement): object {
      if (el instanceof HTMLTextAreaElement) return HTMLTextAreaElement.prototype;
      if (el instanceof HTMLSelectElement) return HTMLSelectElement.prototype;
      return HTMLInputElement.prototype;
    }

    /**
     * SEC 6.4 (normative). `el.value = x` is swallowed by React's instance-level trap, so the
     * assignment goes through the *prototype* descriptor. Running in the page realm means the
     * descriptor we call is the very one the framework captured.
     */
    function setNativeValue(el: ValueElement, value: string): void {
      const descriptor = Object.getOwnPropertyDescriptor(prototypeOf(el), 'value');
      const setter = descriptor?.set;
      if (typeof setter === 'function') setter.call(el, value);
      else el.value = value;
    }

    function fire(el: Element, type: string, init?: EventInit): void {
      el.dispatchEvent(new Event(type, { bubbles: true, ...init }));
    }

    /** input → change → blur: many ATS only run field validation on blur (SEC 6.4). */
    function fireValueEvents(el: Element): void {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      fire(el, 'change', { composed: true });
      fire(el, 'blur');
    }

    function readValue(el: Element): string {
      if (isValueElement(el)) return el.value;
      const html = el as HTMLElement;
      if (html.isContentEditable) return html.textContent ?? '';
      const aria = el.getAttribute('aria-valuetext') ?? el.getAttribute('data-value');
      return aria ?? '';
    }

    function stringArg(args: Record<string, unknown>, key: string): string {
      const value = args[key];
      if (typeof value !== 'string') throw new Error(`missing-${key}`);
      return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
    }

    /* ---- SET_VALUE --------------------------------------------------------------------------- */

    function opSetValue(args: Record<string, unknown>): boolean {
      const el = resolve(args);
      if (isSubmitControl(el)) throw new Error('submit-control-refused'); // INV-1
      const value = stringArg(args, 'value');

      if (isValueElement(el)) {
        if (el instanceof HTMLSelectElement) return opSetSelectOn(el, value);
        el.focus?.();
        setNativeValue(el, value);
        fireValueEvents(el);
        return true;
      }

      const html = el as HTMLElement;
      if (html.isContentEditable) {
        html.focus?.();
        html.textContent = value; // text only — never innerHTML (SEC 9.2)
        fireValueEvents(html);
        return true;
      }

      throw new Error('not-fillable');
    }

    /* ---- SET_SELECT -------------------------------------------------------------------------- */

    function normalise(text: string): string {
      return text.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    /** Fuzzy option match: exact value → exact text → prefix → substring (SEC 6.4). */
    function pickOptionIndex(select: HTMLSelectElement, wanted: string): number {
      const want = normalise(wanted);
      if (want.length === 0) return -1;

      const rows: Array<{ index: number; value: string; text: string }> = [];
      for (let i = 0; i < select.options.length; i += 1) {
        const option: HTMLOptionElement | undefined = select.options[i];
        if (option === undefined || option.disabled) continue;
        rows.push({
          index: i,
          value: normalise(option.value),
          text: normalise(option.textContent ?? ''),
        });
      }

      for (const row of rows) if (row.value === want) return row.index;
      for (const row of rows) if (row.text === want) return row.index;
      for (const row of rows) if (row.text.startsWith(want) || want.startsWith(row.text)) {
        if (row.text.length > 0) return row.index;
      }
      for (const row of rows) if (row.text.length > 2 && want.includes(row.text)) return row.index;
      for (const row of rows) if (row.text.length > 0 && row.text.includes(want)) return row.index;

      return -1;
    }

    function opSetSelectOn(select: HTMLSelectElement, value: string): boolean {
      const index = pickOptionIndex(select, value);
      if (index === -1) throw new Error('no-option-match');
      select.focus?.();
      select.selectedIndex = index;
      fire(select, 'input', { composed: true });
      fire(select, 'change', { composed: true });
      return true;
    }

    function opSetSelect(args: Record<string, unknown>): boolean {
      const el = resolve(args);
      if (isSubmitControl(el)) throw new Error('submit-control-refused'); // INV-1
      if (!(el instanceof HTMLSelectElement)) throw new Error('not-a-select');
      return opSetSelectOn(el, stringArg(args, 'value'));
    }

    /* ---- CLICK ------------------------------------------------------------------------------- */

    function opClick(args: Record<string, unknown>): boolean {
      const el = resolve(args);
      // INV-1: located and highlighted, never clicked. Radios, checkboxes, their proxy <label>s and
      // listbox options are the whole legitimate surface; submits and wizard advances are refused.
      if (isForbiddenClickTarget(el)) throw new Error('submit-control-refused');

      const clickable = el as HTMLElement;
      if (typeof clickable.click !== 'function') throw new Error('not-clickable');
      clickable.click();
      return true;
    }

    /* ---- TYPE_SEQUENCE ----------------------------------------------------------------------- */

    function sleep(ms: number): Promise<void> {
      return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function opTypeSequence(args: Record<string, unknown>): Promise<boolean> {
      const el = resolve(args);
      if (isSubmitControl(el)) throw new Error('submit-control-refused'); // INV-1
      if (!isValueElement(el) || el instanceof HTMLSelectElement) throw new Error('not-fillable');

      const text = stringArg(args, 'text');
      const rawDelay = args['perCharDelayMs'];
      const delay = Math.min(
        MAX_PER_CHAR_DELAY_MS,
        Math.max(0, typeof rawDelay === 'number' && Number.isFinite(rawDelay) ? rawDelay : 0),
      );

      el.focus?.();
      for (const char of Array.from(text)) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
        setNativeValue(el, el.value + char);
        el.dispatchEvent(
          new InputEvent('input', { bubbles: true, composed: true, data: char, inputType: 'insertText' }),
        );
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));
        if (delay > 0) await sleep(delay);
      }
      return true;
    }

    /* ---- ATTACH_FILE ------------------------------------------------------------------------- */

    function opAttachFile(args: Record<string, unknown>): boolean {
      const el = resolve(args);
      if (isSubmitControl(el)) throw new Error('submit-control-refused'); // INV-1

      const file = args['file'];
      if (!(file instanceof File)) throw new Error('missing-file');

      const transfer = new DataTransfer();
      transfer.items.add(file);

      let attached = false;

      if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'file') {
        el.files = transfer.files;
        fire(el, 'input', { composed: true });
        fire(el, 'change', { composed: true });
        attached = el.files !== null && el.files.length === 1;
      }

      const dropzoneSelector = args['dropzoneSelector'];
      if (typeof dropzoneSelector === 'string' && dropzoneSelector.length > 0) {
        const zone = deepQuery(dropzoneSelector);
        if (zone !== null) {
          if (isSubmitControl(zone)) throw new Error('submit-control-refused'); // INV-1
          const init: DragEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            dataTransfer: transfer,
          };
          zone.dispatchEvent(new DragEvent('dragenter', init));
          zone.dispatchEvent(new DragEvent('dragover', init));
          zone.dispatchEvent(new DragEvent('drop', init));
          attached = true;
        }
      }

      if (!attached) throw new Error('not-fillable');
      return true;
    }

    /* -------------------------------------------------------------------------------------------
     * Dispatch
     * ----------------------------------------------------------------------------------------- */

    async function run(request: Request): Promise<unknown> {
      switch (request.op) {
        case 'PING':
          return true;
        case 'SET_VALUE':
          return opSetValue(request.args);
        case 'SET_SELECT':
          return opSetSelect(request.args);
        case 'CLICK':
          return opClick(request.args);
        case 'TYPE_SEQUENCE':
          return opTypeSequence(request.args);
        case 'ATTACH_FILE':
          return opAttachFile(request.args);
        case 'READ_VALUE':
          return readValue(resolve(request.args));
      }
    }

    function reply(id: string, ok: boolean, result?: unknown, error?: string): void {
      const message: Record<string, unknown> = { [KEY]: RES, id, ok };
      if (result !== undefined) message['result'] = result;
      if (error !== undefined) message['error'] = error;
      try {
        window.postMessage(message, '*');
      } catch {
        // The receiving side times out after 4 s; there is nothing better to do from here.
      }
    }

    function parse(data: unknown): Request | null {
      if (typeof data !== 'object' || data === null) return null;
      const message = data as Record<string, unknown>;
      if (message[KEY] !== REQ) return null;
      if (typeof message['id'] !== 'string' || message['id'].length === 0) return null;
      const op = message['op'];
      if (typeof op !== 'string' || !OPS.has(op)) return null;
      const args = message['args'];
      return {
        id: message['id'],
        op: op as Op,
        args: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
      };
    }

    const onMessage = (event: MessageEvent<unknown>): void => {
      // Same-window only: a frame, an opener or a popup must never drive this bridge.
      if (event.source !== window) return;

      const request = parse(event.data);
      if (request === null) return;

      try {
        const outcome = run(request);
        if (outcome instanceof Promise) {
          outcome.then(
            (result) => reply(request.id, true, result),
            (error: unknown) => reply(request.id, false, undefined, describe(error)),
          );
          return;
        }
        reply(request.id, true, outcome);
      } catch (error) {
        reply(request.id, false, undefined, describe(error));
      }
    };

    function describe(error: unknown): string {
      if (error instanceof Error && error.message.length > 0) return error.message;
      return 'main-world-error';
    }

    window.addEventListener('message', onMessage);
    // Nothing is written to `window`, `globalThis`, or the DOM. The listener is the whole surface.
  },
});
