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

export interface ExternalSender {
  origin?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
}

export const HANDOFF_HELLO = 'NEXTMOVE_HELLO';
export const HANDOFF_CONNECT = 'NEXTMOVE_CONNECT';
export const HANDOFF_STATUS = 'NEXTMOVE_STATUS';

export type HandoffRequestType =
  | typeof HANDOFF_HELLO
  | typeof HANDOFF_CONNECT
  | typeof HANDOFF_STATUS;

export interface HandoffReply {
  ok: boolean;
  installed: true;
  version: string;
  paired: boolean;
  nonce?: string;
  deviceName?: string | null;
  lastSyncAt?: number | null;
  profilesApplied?: number;
  error?: { code: string; message: string };
}

interface PendingNonce {
  nonce: string;
  expiresAt: number;
}

function randomNonce(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintHandoffNonce(): Promise<string> {
  const pending: PendingNonce = {
    nonce: randomNonce(),
    expiresAt: Date.now() + HANDOFF_NONCE_TTL_MS,
  };
  await browser.storage.session.set({ [HANDOFF_NONCE_KEY]: pending });
  return pending.nonce;
}

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

export async function connectUrl(): Promise<string> {
  const nonce = await mintHandoffNonce();
  const url = new URL(WEB_CONNECT_PATH, WEB_APP_URL);
  url.searchParams.set('n', nonce);
  url.searchParams.set('v', browser.runtime.getManifest().version);
  return url.toString();
}

function senderIsTrusted(sender: ExternalSender): boolean {
  const origin = sender.origin ?? null;
  if (origin === null || !HANDOFF_ALLOWED_ORIGINS.includes(origin)) {
    log.warn(`rejected a handshake from ${origin ?? 'an unknown origin'}`);
    return false;
  }
  if (sender.frameId !== 0 || sender.tab === undefined) {
    log.warn('rejected a handshake from a subframe or a non-tab context');
    return false;
  }
  return true;
}

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

  return true;
}

export async function hasEverConnected(): Promise<boolean> {
  return isPaired();
}
