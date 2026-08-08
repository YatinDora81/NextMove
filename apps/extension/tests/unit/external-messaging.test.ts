import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, resetBrowserMock } from '../setup';

installBrowserMock();

import { generateVaultKey } from '@repo/vault';

import { WEB_APP_URL } from '@/shared/constants';
import { installRouter, resetRouter } from '@/background/router';
import { HANDOFF_CONNECT, HANDOFF_HELLO, handleExternalMessage } from '@/background/handoff';

const ext = (): ReturnType<typeof installBrowserMock> =>
  (globalThis as unknown as { browser: ReturnType<typeof installBrowserMock> }).browser;

const TRUSTED = { origin: WEB_APP_URL, frameId: 0, tab: { id: 7 } };

function bootBackground(): void {
  installRouter();
  ext().runtime.onMessageExternal.addListener(
    handleExternalMessage as unknown as (...args: unknown[]) => unknown,
  );
}

beforeEach(() => {
  resetRouter();
  resetBrowserMock();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('network stubbed out in unit tests');
    }),
  );
});

describe('external messaging, wired the way the service worker wires it', () => {
  it('answers HELLO from the web app instead of refusing it', async () => {
    bootBackground();

    const reply = (await ext().__emitExternalMessage({ type: HANDOFF_HELLO }, TRUSTED)) as
      | { ok?: boolean; installed?: boolean; nonce?: string; error?: { message?: string } }
      | undefined;

    expect(JSON.stringify(reply ?? null)).not.toMatch(/does not accept external messages/i);
    expect(reply?.installed).toBe(true);
    expect(reply?.ok).toBe(true);
    expect(typeof reply?.nonce).toBe('string');
  });

  it('lets CONNECT reach the handoff rather than being swallowed by another listener', async () => {
    bootBackground();

    const hello = (await ext().__emitExternalMessage({ type: HANDOFF_HELLO }, TRUSTED)) as {
      nonce?: string;
    };
    const reply = (await ext().__emitExternalMessage(
      {
        type: HANDOFF_CONNECT,
        nonce: hello.nonce,
        pairCode: 'ABCD2345',
        vaultKey: generateVaultKey(),
      },
      TRUSTED,
    )) as { installed?: boolean; error?: { code?: string } } | undefined;

    expect(reply?.installed).toBe(true);
    expect(reply?.error?.code).not.toBe('BAD_NONCE');
    expect(reply?.error?.code).not.toBe('BAD_REQUEST');
  });

  it('still refuses a foreign origin once the router is installed', async () => {
    bootBackground();

    const reply = await ext().__emitExternalMessage(
      { type: HANDOFF_HELLO },
      { ...TRUSTED, origin: 'https://evil.example' },
    );

    expect(reply).toBeUndefined();
  });

  it('registers no external listener of its own', () => {
    installRouter();

    expect(ext().runtime.onMessage.hasListener).toBeTruthy();
    expect(
      ext().runtime.onMessageExternal.hasListener(
        handleExternalMessage as unknown as (...args: unknown[]) => unknown,
      ),
    ).toBe(false);
  });
});
