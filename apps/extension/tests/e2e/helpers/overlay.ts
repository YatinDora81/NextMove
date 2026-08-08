/**
 * tests/e2e/helpers/overlay.ts — reading and driving JobFill's CLOSED shadow DOM.
 *
 * SEC 4.4 decision of record: "Overlay isolation — Closed Shadow DOM + unique element name. Host
 * page CSS/JS cannot restyle or sniff the JobFill UI." That is a real security property and this
 * suite does not weaken it: `content/overlay/mount.ts` keeps the root in a module-private variable
 * and `attachShadow({ mode: 'closed' })` means `host.shadowRoot` is `null` for everybody, including
 * Playwright's selector engine, which walks the DOM exactly like a page script would.
 *
 * So the overlay is read through the **Chrome DevTools Protocol** instead, which sits underneath
 * the DOM API rather than inside it: `DOM.getDocument({ pierce: true })` returns closed shadow
 * roots to the debugger. This is strictly an observer — nothing here modifies the extension, the
 * page, or the shadow root, and the extension cannot tell it is being watched.
 *
 * Clicks are the other half. `Overlay.click()` resolves the target's viewport rectangle over CDP
 * and then presses it with `page.mouse`, so what reaches the overlay is a REAL, trusted browser
 * input event at real coordinates — the same thing a human produces, and the only way to prove
 * that the ✨ affordance is actually clickable where it is drawn. No synthetic `element.click()`
 * is used anywhere in this suite.
 *
 * Node ids are invalidated by every `DOM.getDocument`, so each call re-resolves from the document
 * root. That is a few extra protocol round-trips per assertion and buys total freedom from stale
 * handles when the overlay re-renders under us.
 */

import type { BrowserContext, CDPSession, Page } from '@playwright/test';

/** Viewport-relative geometry, in CSS pixels. */
export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Host element name is `nextmove-autofill-root-<random>` (SEC 4.4 — unique per document). */
const HOST_PREFIX = 'nextmove-autofill-root';

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_MS = 100;

interface ProtocolNode {
  nodeId: number;
  nodeName: string;
  children?: ProtocolNode[];
  shadowRoots?: ProtocolNode[];
}

function findShadowRoot(node: ProtocolNode): ProtocolNode | null {
  if (node.nodeName.toLowerCase().startsWith(HOST_PREFIX)) {
    return node.shadowRoots?.[0] ?? null;
  }
  for (const child of node.children ?? []) {
    const hit = findShadowRoot(child);
    if (hit !== null) return hit;
  }
  for (const root of node.shadowRoots ?? []) {
    const hit = findShadowRoot(root);
    if (hit !== null) return hit;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((done) => {
    setTimeout(done, ms);
  });
}

export class Overlay {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(context: BrowserContext, page: Page): Promise<Overlay> {
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    return new Overlay(page, cdp);
  }

  /** The closed shadow root's node id, or null while the overlay has not been mounted yet. */
  private async rootNodeId(): Promise<number | null> {
    const document = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const root = findShadowRoot(document.root as unknown as ProtocolNode);
    return root?.nodeId ?? null;
  }

  /** True once the overlay host exists in this document. */
  async mounted(): Promise<boolean> {
    return (await this.rootNodeId()) !== null;
  }

  private async nodeIdFor(selector: string): Promise<number | null> {
    const rootId = await this.rootNodeId();
    if (rootId === null) return null;
    const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: rootId, selector });
    return nodeId === 0 ? null : nodeId;
  }

  private async nodeIdsFor(selector: string): Promise<number[]> {
    const rootId = await this.rootNodeId();
    if (rootId === null) return [];
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', { nodeId: rootId, selector });
    return [...nodeIds];
  }

  /** Evaluate `expression` (a function source, `this` = the node) and return a plain value. */
  private async callOn(nodeId: number, expression: string): Promise<unknown> {
    const { object } = await this.cdp.send('DOM.resolveNode', { nodeId });
    const objectId = object.objectId;
    if (objectId === undefined) return null;
    try {
      const { result } = await this.cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: expression,
        returnByValue: true,
      });
      return result.value as unknown;
    } finally {
      await this.cdp.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }

  /** The whole overlay markup — used for diagnostics and for coarse "does it say X" assertions. */
  async html(): Promise<string> {
    const rootId = await this.rootNodeId();
    if (rootId === null) return '';
    const { outerHTML } = await this.cdp.send('DOM.getOuterHTML', { nodeId: rootId });
    return outerHTML;
  }

  /** `textContent` of the first match, or null when nothing matches. */
  async text(selector: string): Promise<string | null> {
    const nodeId = await this.nodeIdFor(selector);
    if (nodeId === null) return null;
    const value = await this.callOn(nodeId, 'function () { return this.textContent ?? ""; }');
    return typeof value === 'string' ? value : null;
  }

  /** `textContent` of every match, in document order. */
  async texts(selector: string): Promise<string[]> {
    const out: string[] = [];
    for (const nodeId of await this.nodeIdsFor(selector)) {
      const value = await this.callOn(nodeId, 'function () { return this.textContent ?? ""; }');
      if (typeof value === 'string') out.push(value);
    }
    return out;
  }

  /** `className` of every match — how marker tones (`jf-marker--next`, …) are asserted. */
  async classNames(selector: string): Promise<string[]> {
    const out: string[] = [];
    for (const nodeId of await this.nodeIdsFor(selector)) {
      const value = await this.callOn(nodeId, 'function () { return this.className ?? ""; }');
      if (typeof value === 'string') out.push(value);
    }
    return out;
  }

  async count(selector: string): Promise<number> {
    return (await this.nodeIdsFor(selector)).length;
  }

  /** Viewport-relative rectangle of the first match, or null. */
  async rect(selector: string): Promise<OverlayRect | null> {
    const nodeId = await this.nodeIdFor(selector);
    if (nodeId === null) return null;
    return this.rectOfNode(nodeId);
  }

  private async rectOfNode(nodeId: number): Promise<OverlayRect | null> {
    const value = await this.callOn(
      nodeId,
      'function () { const r = this.getBoundingClientRect();' +
        ' return { x: r.x, y: r.y, width: r.width, height: r.height }; }',
    );
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const { x, y, width, height } = record;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) {
      return null;
    }
    return { x, y, width, height };
  }

  /** Wait until `selector` exists inside the overlay; returns its rectangle. */
  async waitFor(selector: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<OverlayRect> {
    const deadline = Date.now() + timeoutMs;
    let lastSeen = '';
    while (Date.now() < deadline) {
      const rect = await this.rect(selector);
      if (rect !== null && rect.width > 0 && rect.height > 0) return rect;
      lastSeen = rect === null ? 'not present' : 'present but zero-sized';
      await sleep(POLL_MS);
    }
    throw new Error(
      `overlay selector '${selector}' never became clickable within ${timeoutMs}ms (${lastSeen})`,
    );
  }

  /** Wait until some node matching `selector` contains `needle`. Returns the matching text. */
  async waitForText(
    selector: string,
    needle: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let seen: string[] = [];
    while (Date.now() < deadline) {
      seen = await this.texts(selector);
      const hit = seen.find((text) => text.includes(needle));
      if (hit !== undefined) return hit;
      await sleep(POLL_MS);
    }
    throw new Error(
      `overlay: no '${selector}' contained ${JSON.stringify(needle)} within ${timeoutMs}ms. ` +
        `Saw: ${JSON.stringify(seen)}`,
    );
  }

  /** Press the first match with a real, trusted mouse click at its centre. */
  async click(selector: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const rect = await this.waitFor(selector, timeoutMs);
    await this.page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  }

  /**
   * Press the first `selector` whose text contains `needle` — how the suite reaches buttons the
   * overlay labels rather than classes ("Insert into form", "Use saved").
   */
  async clickByText(selector: string, needle: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let seen: string[] = [];
    while (Date.now() < deadline) {
      seen = [];
      for (const nodeId of await this.nodeIdsFor(selector)) {
        const text = await this.callOn(nodeId, 'function () { return this.textContent ?? ""; }');
        if (typeof text !== 'string') continue;
        seen.push(text);
        if (!text.includes(needle)) continue;
        const rect = await this.rectOfNode(nodeId);
        if (rect === null || rect.width === 0 || rect.height === 0) continue;
        await this.page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return;
      }
      await sleep(POLL_MS);
    }
    throw new Error(
      `overlay: no clickable '${selector}' labelled ${JSON.stringify(needle)} within ${timeoutMs}ms. ` +
        `Saw: ${JSON.stringify(seen)}`,
    );
  }

  async dispose(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}
