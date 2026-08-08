/**
 * background/handoff.ts — the web → extension handshake (JF-001 SEC 8.2, revised).
 *
 * ── The problem this replaces ──────────────────────────────────────────────────────────────────
 *
 * Pairing used to be: open NextMove on the web, find Settings → Devices, click "New code", read an
 * 8-character code off the screen, open the extension's Options page, find the Sync tab, and retype
 * it before it expires in five minutes. Every wallet and password manager worth copying abandoned
 * that pattern years ago, and the reason is not aesthetics — each of those six steps is a place a
 * new user stops.
 *
 * What replaces it is what Phantom, Backpack and MetaMask all do: on install the extension opens a
 * full tab of the product's own site, the user signs in and onboards there, and the page hands the
 * credential back to the extension directly. One click, no transcription.
 *
 * ── The mechanism ──────────────────────────────────────────────────────────────────────────────
 *
 *   1. `onInstalled` mints a nonce, stashes it in `chrome.storage.session` (which never touches
 *      disk and dies with the browser session), and opens `<web>/extension/connect?n=<nonce>`.
 *   2. The user signs in and completes onboarding. The page generates the E2E vault key **in the
 *      browser**, seals the profile with it, and `PUT`s only ciphertext.
 *   3. The page calls `chrome.runtime.sendMessage(<extensionId>, { type: 'NEXTMOVE_CONNECT', … })`
 *      carrying a fresh pairing code and that vault key.
 *   4. This module validates the sender, burns the nonce, redeems the code for a device JWT, stores
 *      the vault key sealed at rest, and pulls the profile down.
 *
 * The vault key travels browser → extension and never through the server, so `PUT /api/sync/profile`
 * stays exactly as server-blind as SEC 7.4 promises — the difference is that now there is actually
 * a key in existence, which there previously was not.
 *
 * ── What is and is not a security boundary ─────────────────────────────────────────────────────
 *
 * The real gate is `externally_connectable` in the manifest: a page whose origin is not listed
 * there physically cannot open a port to this extension, and Chrome enforces that, not us. On top
 * of it this module re-checks `sender.origin` against an exact-match allowlist (never `startsWith`,
 * which would accept `https://nextmove-yatin.vercel.app.evil.com`) and requires `frameId === 0`, so
 * our page embedded as an iframe on someone else's site cannot pair on the user's behalf.
 *
 * The nonce is **not** what keeps hostile origins out — the two checks above do that. It buys
 * single-use replay protection and binds the first-run handshake to the tab this install opened.
 * A user who connects later (extension already installed, no pending nonce) asks for one with
 * `NEXTMOVE_HELLO`, which is safe for the same reason: only an allowed origin can ask.
 */

import { createLogger } from '@/platform/logger';
import { patchSettings } from '@/platform/storage';
import {
  HANDOFF_ALLOWED_ORIGINS,
  HANDOFF_NONCE_KEY,
  HANDOFF_NONCE_TTL_MS,
  WEB_APP_URL,
  WEB_CONNECT_PATH,
} from '@/shared/constants';
import { defaultDeviceName, isPaired, readSyncState, requestPairing, writeVaultKey } from '@/sync';
import { isVaultKey } from '@/sync/e2e';
import { reconcileAfterPairing } from '@/sync/profile';

const log = createLogger('bg:handoff');

/**
 * The part of `runtime.MessageSender` this module actually reads, declared structurally rather than
 * pulled from `@types/chrome` — the extension does not depend on that package, and the three fields
 * below are the only ones a security check may rest on.
 */
export interface ExternalSender {
  origin?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Wire protocol
 * ---------------------------------------------------------------------------------------------- */

export const HANDOFF_HELLO = 'NEXTMOVE_HELLO';
export const HANDOFF_CONNECT = 'NEXTMOVE_CONNECT';
export const HANDOFF_STATUS = 'NEXTMOVE_STATUS';

export type HandoffRequestType =
  | typeof HANDOFF_HELLO
  | typeof HANDOFF_CONNECT
  | typeof HANDOFF_STATUS;

export interface HandoffReply {
  ok: boolean;
  /** Present on every reply so the page can render "installed" without a second round trip. */
  installed: true;
  version: string;
  paired: boolean;
  /** Only on a HELLO — the single-use token the following CONNECT must echo. */
  nonce?: string;
  deviceName?: string | null;
  lastSyncAt?: number | null;
  /** How many profiles the pull wrote locally. Lets the page say "restored 1 profile". */
  profilesApplied?: number;
  error?: { code: string; message: string };
}

interface PendingNonce {
  nonce: string;
  expiresAt: number;
}

/* ------------------------------------------------------------------------------------------------
 * The nonce
 * ---------------------------------------------------------------------------------------------- */

function randomNonce(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `chrome.storage.session` rather than `.local`: it is memory-backed and not exposed to content
 * scripts, so a pending nonce never survives a browser restart and never lands on disk.
 */
export async function mintHandoffNonce(): Promise<string> {
  const pending: PendingNonce = {
    nonce: randomNonce(),
    expiresAt: Date.now() + HANDOFF_NONCE_TTL_MS,
  };
  await browser.storage.session.set({ [HANDOFF_NONCE_KEY]: pending });
  return pending.nonce;
}

/** Reads and *removes* the pending nonce. Single-use is enforced by the removal, not by a flag. */
async function burnHandoffNonce(): Promise<PendingNonce | null> {
  const stored = await browser.storage.session.get(HANDOFF_NONCE_KEY);
  const raw: unknown = stored[HANDOFF_NONCE_KEY];
  await browser.storage.session.remove(HANDOFF_NONCE_KEY);

  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate['nonce'] !== 'string' || typeof candidate['expiresAt'] !== 'number') {
    return null;
  }
  return { nonce: candidate['nonce'], expiresAt: candidate['expiresAt'] };
}

/** The URL a fresh install opens. The nonce rides in the query so the page can echo it back. */
export async function connectUrl(): Promise<string> {
  const nonce = await mintHandoffNonce();
  const url = new URL(WEB_CONNECT_PATH, WEB_APP_URL);
  url.searchParams.set('n', nonce);
  url.searchParams.set('v', browser.runtime.getManifest().version);
  return url.toString();
}

/* ------------------------------------------------------------------------------------------------
 * Sender validation
 * ---------------------------------------------------------------------------------------------- */

/**
 * `sender.origin` is the security origin; `sender.url` is not a substitute for it (it can be
 * `about:blank` in a sandboxed frame). Chrome populates `origin` for external messages from a page.
 */
function senderIsTrusted(sender: ExternalSender): boolean {
  const origin = sender.origin ?? null;
  if (origin === null || !HANDOFF_ALLOWED_ORIGINS.includes(origin)) {
    log.warn(`rejected a handshake from ${origin ?? 'an unknown origin'}`);
    return false;
  }
  // Top frame of a real tab only. Our own page iframed onto a hostile site would otherwise be able
  // to drive the handshake with the user's session.
  if (sender.frameId !== 0 || sender.tab === undefined) {
    log.warn('rejected a handshake from a subframe or a non-tab context');
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Handlers
 * ---------------------------------------------------------------------------------------------- */

async function baseReply(ok: boolean): Promise<HandoffReply> {
  const state = await readSyncState();
  return {
    ok,
    installed: true,
    version: browser.runtime.getManifest().version,
    paired: state.paired,
    deviceName: state.deviceName,
    lastSyncAt: state.lastSyncAt,
  };
}

function failure(base: HandoffReply, code: string, message: string): HandoffReply {
  return { ...base, ok: false, error: { code, message } };
}

async function handleHello(): Promise<HandoffReply> {
  const reply = await baseReply(true);
  reply.nonce = await mintHandoffNonce();
  return reply;
}

/**
 * Redeem a pairing code and a vault key in one shot.
 *
 * Order matters and is not arbitrary: the nonce is burned *first* (so a failure downstream cannot
 * be retried against the same nonce), then the code is exchanged for a device JWT, then the vault
 * key is stored, and only then is `syncEnabled` flipped. If the key write failed after the device
 * was paired we would have a device that syncs applications but can never open its own profile —
 * so a failed key write unwinds by leaving sync disabled and reporting it.
 */
async function handleConnect(message: Record<string, unknown>): Promise<HandoffReply> {
  const base = await baseReply(true);

  const pending = await burnHandoffNonce();
  const nonce = typeof message['nonce'] === 'string' ? message['nonce'] : '';
  if (pending === null || pending.nonce !== nonce) {
    return failure(base, 'BAD_NONCE', 'This connect link is no longer valid. Start again from NextMove.');
  }
  if (Date.now() > pending.expiresAt) {
    return failure(base, 'NONCE_EXPIRED', 'This connect link expired. Start again from NextMove.');
  }

  const pairCode = typeof message['pairCode'] === 'string' ? message['pairCode'].trim() : '';
  if (pairCode.length === 0) {
    return failure(base, 'BAD_REQUEST', 'The connect request carried no pairing code.');
  }

  const vaultKey = message['vaultKey'];
  if (!isVaultKey(vaultKey)) {
    return failure(base, 'BAD_VAULT_KEY', 'The connect request carried no usable vault key.');
  }

  const deviceName =
    typeof message['deviceName'] === 'string' && message['deviceName'].trim().length > 0
      ? message['deviceName'].trim().slice(0, 60)
      : defaultDeviceName();

  const paired = await requestPairing(pairCode, deviceName);
  if (!paired.ok) {
    log.warn(`handoff pairing failed: ${paired.error.code}`);
    return failure(base, paired.error.code.toUpperCase(), paired.error.message);
  }

  const stored = await writeVaultKey(vaultKey);
  if (!stored.ok) {
    return failure(base, 'VAULT_KEY_STORE_FAILED', stored.error.message);
  }

  await patchSettings({ syncEnabled: true });

  // Pull whatever the account already holds. A brand-new account has nothing, and that is a
  // success — `reconcileAfterPairing` seeds it from this device instead.
  const reconciled = await reconcileAfterPairing();
  const after = await baseReply(true);
  if (!reconciled.ok) {
    log.warn(`paired, but the first profile sync failed: ${reconciled.error.code}`);
    return { ...after, profilesApplied: 0 };
  }

  log.info(`connected via web handoff — ${String(reconciled.data.applied)} profiles applied`);
  return { ...after, profilesApplied: reconciled.data.applied };
}

async function handleStatus(): Promise<HandoffReply> {
  return baseReply(true);
}

/**
 * The single `onMessageExternal` listener. Registered synchronously at the top level of the service
 * worker (see `entrypoints/background.ts`) — a listener added after an `await` misses the very
 * message that woke the worker, which is the classic MV3 bug where the first connect after an idle
 * period silently does nothing.
 */
export function handleExternalMessage(
  message: unknown,
  sender: ExternalSender,
  sendResponse: (reply: HandoffReply) => void,
): boolean {
  if (!senderIsTrusted(sender)) return false;
  if (message === null || typeof message !== 'object') return false;

  const body = message as Record<string, unknown>;
  const type = body['type'];
  if (type !== HANDOFF_HELLO && type !== HANDOFF_CONNECT && type !== HANDOFF_STATUS) return false;

  void (async (): Promise<void> => {
    try {
      if (type === HANDOFF_HELLO) sendResponse(await handleHello());
      else if (type === HANDOFF_CONNECT) sendResponse(await handleConnect(body));
      else sendResponse(await handleStatus());
    } catch (error) {
      log.error('handshake threw', error);
      const base = await baseReply(false);
      sendResponse(
        failure(base, 'INTERNAL', error instanceof Error ? error.message : String(error)),
      );
    }
  })();

  // Keeps the message channel open for the async work above. Without it Chrome closes the port the
  // moment this function returns and `sendResponse` is a no-op.
  return true;
}

/** Whether this install has ever been connected — used to decide if onboarding should open. */
export async function hasEverConnected(): Promise<boolean> {
  return isPaired();
}
