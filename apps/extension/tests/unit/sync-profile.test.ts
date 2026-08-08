import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, makeProfile, resetBrowserMock } from '../setup';

installBrowserMock();

import { generateVaultKey, isVaultKey } from '@repo/vault';

import { HANDOFF_NONCE_KEY, HANDOFF_ALLOWED_ORIGINS, WEB_APP_URL } from '@/shared/constants';
import { mergeProfiles } from '@/sync/profile';
import {
  HANDOFF_CONNECT,
  HANDOFF_HELLO,
  connectUrl,
  handleExternalMessage,
  mintHandoffNonce,
} from '@/background/handoff';
import type { ExternalSender, HandoffReply } from '@/background/handoff';

const TRUSTED: ExternalSender = { origin: WEB_APP_URL, frameId: 0, tab: { id: 7 } };

const ext = (): ReturnType<typeof installBrowserMock> =>
  (globalThis as unknown as { browser: ReturnType<typeof installBrowserMock> }).browser;

async function send(message: unknown, sender: ExternalSender = TRUSTED): Promise<HandoffReply | null> {
  return new Promise((resolve) => {
    const kept = handleExternalMessage(message, sender, (reply) => resolve(reply));
    if (!kept) resolve(null);
  });
}

beforeEach(() => {
  resetBrowserMock();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('network stubbed out in unit tests');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeProfiles', () => {
  it('keeps the newer copy of a profile that exists on both sides', () => {
    const local = makeProfile({ id: 'a', label: 'Local', updatedAt: 100 });
    const remote = makeProfile({ id: 'a', label: 'Remote', updatedAt: 200 });

    const { merged, changed } = mergeProfiles([local], [remote]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.label).toBe('Remote');
    expect(changed).toBe(1);
  });

  it('keeps the local copy when it is newer, and reports no change', () => {
    const local = makeProfile({ id: 'a', label: 'Local', updatedAt: 300 });
    const remote = makeProfile({ id: 'a', label: 'Remote', updatedAt: 200 });

    const { merged, changed } = mergeProfiles([local], [remote]);
    expect(merged[0]?.label).toBe('Local');
    expect(changed).toBe(0);
  });

  it('prefers the local copy on an exact timestamp tie', () => {
    const local = makeProfile({ id: 'a', label: 'Local', updatedAt: 500 });
    const remote = makeProfile({ id: 'a', label: 'Remote', updatedAt: 500 });
    expect(mergeProfiles([local], [remote]).merged[0]?.label).toBe('Local');
  });

  it('unions profiles that exist on only one side rather than deleting them', () => {
    const local = makeProfile({ id: 'a', updatedAt: 1, isDefault: true });
    const remote = makeProfile({ id: 'b', updatedAt: 2, isDefault: false });

    const { merged } = mergeProfiles([local], [remote]);
    expect(merged.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('leaves exactly one default when both sides marked a different one', () => {
    const local = makeProfile({ id: 'a', updatedAt: 100, isDefault: true });
    const remote = makeProfile({ id: 'b', updatedAt: 900, isDefault: true });

    const { merged } = mergeProfiles([local], [remote]);
    const defaults = merged.filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe('b');
  });

  it('promotes a default when the merge would otherwise leave none', () => {
    const local = makeProfile({ id: 'a', updatedAt: 100, isDefault: false });
    const remote = makeProfile({ id: 'b', updatedAt: 900, isDefault: false });

    const { merged } = mergeProfiles([local], [remote]);
    expect(merged.filter((p) => p.isDefault)).toHaveLength(1);
  });

  it('handles both sides being empty', () => {
    expect(mergeProfiles([], []).merged).toEqual([]);
  });
});

describe('handleExternalMessage · who is allowed to talk to us', () => {
  it('accepts the production origin', async () => {
    const reply = await send({ type: HANDOFF_HELLO });
    expect(reply?.ok).toBe(true);
    expect(reply?.installed).toBe(true);
  });

  it('refuses an unknown origin outright', async () => {
    const reply = await send({ type: HANDOFF_HELLO }, { ...TRUSTED, origin: 'https://evil.example' });
    expect(reply).toBeNull();
  });

  it('refuses a lookalike origin that merely starts with an allowed one', async () => {
    const reply = await send(
      { type: HANDOFF_HELLO },
      { ...TRUSTED, origin: `${WEB_APP_URL}.evil.example` },
    );
    expect(reply).toBeNull();
  });

  it('refuses a subframe, so our page iframed onto a hostile site cannot pair', async () => {
    const reply = await send({ type: HANDOFF_HELLO }, { ...TRUSTED, frameId: 3 });
    expect(reply).toBeNull();
  });

  it('refuses a sender with no tab', async () => {
    const reply = await send({ type: HANDOFF_HELLO }, { origin: WEB_APP_URL, frameId: 0 });
    expect(reply).toBeNull();
  });

  it('ignores message shapes it does not own', async () => {
    expect(await send({ type: 'SOMETHING_ELSE' })).toBeNull();
    expect(await send(null)).toBeNull();
    expect(await send('a string')).toBeNull();
  });

  it('lists localhost among the allowed origins for development', () => {
    expect(HANDOFF_ALLOWED_ORIGINS).toContain('http://localhost:3000');
  });
});

describe('handleExternalMessage · the nonce', () => {
  it('HELLO mints a nonce and stores it in session storage, not local', async () => {
    const reply = await send({ type: HANDOFF_HELLO });
    expect(typeof reply?.nonce).toBe('string');

    const session = await ext().storage.session.get(HANDOFF_NONCE_KEY);
    expect(session[HANDOFF_NONCE_KEY]).toBeDefined();

    const local = await ext().storage.local.get(HANDOFF_NONCE_KEY);
    expect(local[HANDOFF_NONCE_KEY]).toBeUndefined();
  });

  it('rejects a CONNECT carrying the wrong nonce', async () => {
    await mintHandoffNonce();
    const reply = await send({
      type: HANDOFF_CONNECT,
      nonce: 'not-the-one',
      pairCode: 'ABCD2345',
      vaultKey: generateVaultKey(),
    });
    expect(reply?.ok).toBe(false);
    expect(reply?.error?.code).toBe('BAD_NONCE');
  });

  it('rejects a CONNECT when no nonce is pending at all', async () => {
    const reply = await send({
      type: HANDOFF_CONNECT,
      nonce: 'anything',
      pairCode: 'ABCD2345',
      vaultKey: generateVaultKey(),
    });
    expect(reply?.ok).toBe(false);
    expect(reply?.error?.code).toBe('BAD_NONCE');
  });

  it('burns the nonce on use, so a replay of the same message fails', async () => {
    const nonce = await mintHandoffNonce();
    const body = {
      type: HANDOFF_CONNECT,
      nonce,
      pairCode: 'ABCD2345',
      vaultKey: generateVaultKey(),
    };

    const first = await send(body);
    expect(first?.error?.code).not.toBe('BAD_NONCE');

    const second = await send(body);
    expect(second?.error?.code).toBe('BAD_NONCE');
  });

  it('refuses a CONNECT whose vault key is not a 256-bit key', async () => {
    const nonce = await mintHandoffNonce();
    const reply = await send({
      type: HANDOFF_CONNECT,
      nonce,
      pairCode: 'ABCD2345',
      vaultKey: 'obviously-not-a-key',
    });
    expect(reply?.ok).toBe(false);
    expect(reply?.error?.code).toBe('BAD_VAULT_KEY');
  });

  it('refuses a CONNECT with no pairing code', async () => {
    const nonce = await mintHandoffNonce();
    const reply = await send({ type: HANDOFF_CONNECT, nonce, pairCode: '   ', vaultKey: generateVaultKey() });
    expect(reply?.ok).toBe(false);
    expect(reply?.error?.code).toBe('BAD_REQUEST');
  });
});

describe('connectUrl', () => {
  it('points at the web connect page and carries a fresh nonce', async () => {
    const url = new URL(await connectUrl());
    expect(url.origin).toBe(WEB_APP_URL);
    expect(url.pathname).toBe('/extension/connect');
    expect(url.searchParams.get('n')).toBeTruthy();
    expect(url.searchParams.get('v')).toBeTruthy();
  });

  it('mints a different nonce each time', async () => {
    const first = new URL(await connectUrl()).searchParams.get('n');
    const second = new URL(await connectUrl()).searchParams.get('n');
    expect(first).not.toBe(second);
  });
});

describe('vault keys are what the handshake carries', () => {
  it('generates keys the extension will accept', () => {
    expect(isVaultKey(generateVaultKey())).toBe(true);
  });
});
