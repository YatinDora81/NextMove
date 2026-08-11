import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureWebCrypto, installBrowserMock, makeProfile, resetBrowserMock } from '../setup';

installBrowserMock();

import { generateVaultKey, isVaultKey } from '@repo/vault';
import { jobApplicationRowSchema } from '@repo/types/ExtensionTypes';

import {
  DEFAULT_SYNC_STATE,
  HANDOFF_NONCE_KEY,
  HANDOFF_ALLOWED_ORIGINS,
  STORAGE_KEY_SYNC,
  WEB_APP_URL,
} from '@/shared/constants';
import type { MessageContext } from '@/shared/messages';
import type { ApplicationRow } from '@/shared/types';
import { mergeProfiles } from '@/sync/profile';
import {
  APPLICATION_PUSH_MAX_ATTEMPTS,
  listBlockedApplications,
  noteApplicationPushed,
  patchApplication,
  pushApplications,
  readApplicationSyncMap,
} from '@/sync/client';
import { sealDeviceToken } from '@/sync/e2e';
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

/* ------------------------------------------------------------------------------------------------
 * Applications push — SEC 8.3
 *
 * The server's upsert resolves a push by `clientId` first and by the posting's url second, and the
 * url branch deliberately answers with the matched row's ORIGINAL `clientId` (see
 * `jobApplicationRepo.runUpsert`: rewriting it would strand every other install's PATCHes). So the
 * id that comes back is NOT reliably the id we sent, and the push path may not assume it is.
 * ---------------------------------------------------------------------------------------------- */

const PUSH_CTX: MessageContext = {
  type: 'SYNC_PUSH',
  reqId: 'test-req',
  gesture: null,
  tabId: null,
  frameId: null,
  url: null,
  origin: 'background',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FakeServerOptions {
  /** Postings this account already tracks: url → the `clientId` the server keeps for it. */
  existing?: Readonly<Record<string, string>>;
  /** clientIds the server refuses with 409 DUPLICATE_URL, as `@@unique([userId, urlKey])` would. */
  refuse?: readonly string[];
}

interface ServerRow {
  clientId: string;
  url: string | null;
}

interface FakeServer {
  /** Every clientId POSTed to /api/job-applications, in order, across all ticks. */
  posts: string[];
  /** The rows the account holds, as the Applied page would list them. */
  rows: () => ServerRow[];
  fetch: (input: unknown, init?: RequestInit) => Promise<Response>;
}

/**
 * A stand-in for `POST /api/job-applications` that resolves an upsert the way
 * `jobApplicationRepo.runUpsert` does: `clientId` first, the posting's url second, create third.
 *
 * Modelling the clientId branch is what makes this a fixture and not a mirror of the extension's
 * assumptions — it is the branch a row can only reach once the extension addresses the server by
 * the id the SERVER assigned, and the branch whose absence silently doubles the Applied page.
 */
function fakeApiServer(options: FakeServerOptions = {}): FakeServer {
  const held = new Map<string, string | null>();
  for (const [url, clientId] of Object.entries(options.existing ?? {})) held.set(clientId, url);
  const refused = new Set<string>(options.refuse ?? []);
  const posts: string[] = [];

  const ownerOfUrl = (url: string | null): string | null => {
    if (url === null) return null;
    for (const [clientId, heldUrl] of held) {
      if (heldUrl === url) return clientId;
    }
    return null;
  };

  return {
    posts,
    rows: () => [...held.entries()].map(([clientId, url]) => ({ clientId, url })),
    fetch: async (_input: unknown, init?: RequestInit): Promise<Response> => {
      const row = jobApplicationRowSchema.parse(JSON.parse(String(init?.body ?? '{}')));
      posts.push(row.clientId);

      if (refused.has(row.clientId)) {
        return jsonResponse(409, {
          success: false,
          data: { code: 'DUPLICATE_URL' },
          message: 'You are already tracking an application for that job posting.',
        });
      }

      // `clientId` hit: the row is updated in place, url included. Nothing new is created.
      // Otherwise the url decides, and the matched row keeps its ORIGINAL clientId.
      const url = row.url ?? null;
      const owner = held.has(row.clientId) ? row.clientId : (ownerOfUrl(url) ?? row.clientId);
      held.set(owner, url);
      return jsonResponse(200, {
        success: true,
        data: { ...row, clientId: owner },
        message: 'Job application updated successfully',
      });
    },
  };
}

async function pairThisDevice(seal: typeof sealDeviceToken = sealDeviceToken): Promise<void> {
  const sealed = await seal('device-token-for-tests');
  await ext().storage.local.set({
    [STORAGE_KEY_SYNC]: {
      ...DEFAULT_SYNC_STATE,
      paired: true,
      deviceId: 'dev_test',
      tokenCt: sealed.ciphertext,
      tokenIv: sealed.nonce,
    },
  });
}

function wireRow(clientId: string, url: string): ReturnType<typeof jobApplicationRowSchema.parse> {
  return jobApplicationRowSchema.parse({
    clientId,
    company: 'Northwind Labs',
    role: 'Data Engineer',
    url,
    ats: 'greenhouse',
    status: 'APPLIED',
    appliedAt: null,
    notes: null,
    fillStats: { filled: 3, total: 4 },
    history: [],
  });
}

function localRow(id: string, url: string): ApplicationRow {
  return {
    id,
    company: 'Northwind Labs',
    role: 'Data Engineer',
    url,
    ats: 'greenhouse',
    profileId: 'prof_test_0001',
    status: 'applied',
    appliedAt: 1_000,
    fillStats: { filled: 3, total: 4 },
    notes: '',
    history: [],
    updatedAt: 1_000,
    syncedAt: null,
  };
}

describe('pushApplications · a row the server refuses must not wedge the batch', () => {
  beforeEach(async () => {
    ensureWebCrypto();
    await pairThisDevice();
  });

  it('skips a DUPLICATE_URL 409 and keeps pushing the rows behind it', async () => {
    const server = fakeApiServer({ refuse: ['app_dup'] });
    vi.stubGlobal('fetch', vi.fn(server.fetch));

    const result = await pushApplications([
      wireRow('app_a', 'https://jobs.example/a'),
      wireRow('app_dup', 'https://jobs.example/dup'),
      wireRow('app_b', 'https://jobs.example/b'),
    ]);

    if (!result.ok) throw new Error(`expected the batch to survive, got ${result.error.code}`);
    expect(server.posts).toEqual(['app_a', 'app_dup', 'app_b']);
    expect(result.data.saved.map((entry) => entry.requestedClientId)).toEqual(['app_a', 'app_b']);
    expect(result.data.pushed).toBe(2);
    expect(result.data.duplicateUrls).toEqual(['app_dup']);
  });

  it('reports the id the server kept alongside the id we sent', async () => {
    const server = fakeApiServer({ existing: { 'https://jobs.example/a': 'srv_a' } });
    vi.stubGlobal('fetch', vi.fn(server.fetch));

    const result = await pushApplications([wireRow('app_a', 'https://jobs.example/a')]);
    if (!result.ok) throw new Error(`expected the push to succeed, got ${result.error.code}`);

    expect(result.data.saved[0]?.requestedClientId).toBe('app_a');
    expect(result.data.saved[0]?.row.clientId).toBe('srv_a');
  });

  it('addresses a later PATCH by the id the server assigned, not by the local one', async () => {
    await noteApplicationPushed('app_a', 'srv_a');

    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
        seen.push(String(input));
        const patch = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse(200, {
          success: true,
          data: { ...wireRow('srv_a', 'https://jobs.example/a'), ...patch },
          message: 'Job application updated successfully',
        });
      }),
    );

    // `app_a` is the tracker's own id. The server only ever knew this row as `srv_a`, so a request
    // that spelled the local id would 404 — and used to.
    const result = await patchApplication('app_a', { status: 'INTERVIEW' });
    if (!result.ok) throw new Error(`expected the patch to succeed, got ${result.error.code}`);
    expect(seen[0] ?? '').toContain('/api/job-applications/srv_a');
  });
});

describe('SYNC_PUSH · applications settle after one tick', () => {
  afterEach(() => {
    vi.doUnmock('@/platform/db');
    vi.resetModules();
  });

  /**
   * Dexie cannot run under happy-dom, so `@/platform/db` is backed by the in-memory table from
   * `tests/setup.ts`. Everything else on the path — the handler, `sync/client.ts`, the guard, the
   * device-token round trip — is the real thing, which is the point: the bug lived in the seam
   * between the handler and the client.
   */
  async function loadPushPath(server: FakeServer, rows: readonly ApplicationRow[]): Promise<{
    push: (typeof import('@/background/handlers/sync'))['syncHandlers']['SYNC_PUSH'];
    stored: () => ApplicationRow[];
    /** Edit a tracker row the way the dashboard would: new field, new `updatedAt`. */
    edit: (id: string, patch: Partial<ApplicationRow>) => Promise<void>;
  }> {
    vi.resetModules();
    vi.doMock('@/platform/db', async () => {
      const { memoryDb } = await import('../setup');
      return {
        db: memoryDb,
        putApplication: async (row: ApplicationRow): Promise<string> =>
          memoryDb.applications.put(row as ApplicationRow & Record<string, unknown>),
        // Mirrors the real predicate: never stamped, or edited since the stamp.
        listUnsyncedApplications: async (): Promise<ApplicationRow[]> => {
          const all = await memoryDb.applications.toArray();
          return all.filter((row) => {
            const syncedAt = row.syncedAt ?? null;
            return syncedAt === null || (row.updatedAt ?? 0) > syncedAt;
          });
        },
      };
    });

    const { memoryDb, resetMemoryDb } = await import('../setup');
    await resetMemoryDb();
    memoryDb.applications.__seed(rows.map((row) => row as ApplicationRow & Record<string, unknown>));

    // Seal the device token with the SAME module instance the handler will decrypt it with.
    const e2e = await import('@/sync/e2e');
    await pairThisDevice(e2e.sealDeviceToken);
    const storage = await import('@/platform/storage');
    await storage.patchSettings({ syncEnabled: true });

    vi.stubGlobal('fetch', vi.fn(server.fetch));
    const { syncHandlers } = await import('@/background/handlers/sync');
    return {
      push: syncHandlers.SYNC_PUSH,
      stored: () => memoryDb.applications.__rows(),
      edit: async (id: string, patch: Partial<ApplicationRow>): Promise<void> => {
        const row = await memoryDb.applications.get(id);
        if (row === undefined) throw new Error(`no local row ${id}`);
        await memoryDb.applications.put({ ...row, ...patch });
      },
    };
  }

  beforeEach(() => {
    ensureWebCrypto();
  });

  it('pushes zero rows on the second tick, even when the server answers with its own clientIds', async () => {
    // A reinstall: every local row carries a fresh clientId, every posting is already on the
    // server under the id the previous install minted.
    const server = fakeApiServer({
      existing: {
        'https://jobs.example/1': 'srv_1',
        'https://jobs.example/2': 'srv_2',
        'https://jobs.example/3': 'srv_3',
      },
    });
    const { push, stored } = await loadPushPath(server, [
      localRow('app_1', 'https://jobs.example/1'),
      localRow('app_2', 'https://jobs.example/2'),
      localRow('app_3', 'https://jobs.example/3'),
    ]);

    const first = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!first.ok) throw new Error(`first tick failed: ${first.error.code} ${first.error.message}`);
    expect(first.data.pushed.applications).toBe(3);
    expect(server.posts).toEqual(['app_1', 'app_2', 'app_3']);
    expect(stored().every((row) => (row.syncedAt ?? 0) > 0)).toBe(true);

    const second = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!second.ok) throw new Error(`second tick failed: ${second.error.code}`);
    expect(second.data.pushed.applications).toBe(0);
    // The whole point: nothing was re-pushed.
    expect(server.posts).toEqual(['app_1', 'app_2', 'app_3']);
  });

  it('still stamps the rows around a duplicate-url refusal', async () => {
    const server = fakeApiServer({ refuse: ['app_2'] });
    const { push, stored } = await loadPushPath(server, [
      localRow('app_1', 'https://jobs.example/1'),
      localRow('app_2', 'https://jobs.example/2'),
      localRow('app_3', 'https://jobs.example/3'),
    ]);

    const first = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!first.ok) throw new Error(`first tick failed: ${first.error.code} ${first.error.message}`);
    expect(first.data.pushed.applications).toBe(2);

    const unsynced = stored().filter((row) => (row.syncedAt ?? null) === null);
    expect(unsynced.map((row) => row.id)).toEqual(['app_2']);

    // The refused row is retried — the user can resolve the duplicate on the web and it lands —
    // but it is the ONLY row that goes back on the wire.
    const second = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!second.ok) throw new Error(`second tick failed: ${second.error.code}`);
    expect(server.posts).toEqual(['app_1', 'app_2', 'app_3', 'app_2']);
  });

  /* ----------------------------------------------------------------------------------------------
   * (1) The local row has to converge on the identity the server assigned.
   *
   * A row the server matched BY URL comes back under the server's own clientId. If the extension
   * keeps addressing it by the local id, the next local url edit misses both server lookups — the
   * clientId is unknown there and the new urlKey matches nothing — and the server CREATES a second
   * row. The original is then orphaned on the Applied page: the exact duplicate
   * `@@unique([userId, urlKey])` exists to prevent.
   * -------------------------------------------------------------------------------------------- */
  it('edits the row the server already had instead of creating a second one', async () => {
    const server = fakeApiServer({ existing: { 'https://jobs.example/1': 'srv_1' } });
    const { push, edit } = await loadPushPath(server, [localRow('app_1', 'https://jobs.example/1')]);

    const first = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!first.ok) throw new Error(`first tick failed: ${first.error.code} ${first.error.message}`);
    expect(server.posts).toEqual(['app_1']);
    expect(server.rows()).toEqual([{ clientId: 'srv_1', url: 'https://jobs.example/1' }]);

    // The user fixes the link on the card (or the posting moved): same application, new urlKey.
    // `updatedAt` past the stamp is what puts the row back in `listUnsyncedApplications()`.
    await edit('app_1', {
      url: 'https://jobs.example/1-canonical',
      updatedAt: Date.now() + 1_000,
    });

    const second = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!second.ok) throw new Error(`second tick failed: ${second.error.code}`);
    expect(second.data.pushed.applications).toBe(1);

    // Addressed by the id the SERVER assigned, so the clientId lookup hits and the row moves
    // rather than a second one appearing beside it.
    expect(server.rows()).toEqual([{ clientId: 'srv_1', url: 'https://jobs.example/1-canonical' }]);
    expect(server.posts).toEqual(['app_1', 'srv_1']);
  });

  /**
   * The cost of adopting the server's id: it is many-to-one. `findExisting` is profile-scoped, so
   * applying to one posting under two profiles keeps two LOCAL rows, and the server — which holds
   * one row per (user, url) — answers both with the same clientId. Both then adopt it.
   *
   * From the SECOND push on, both rows go to the batch builder under the same wire id. Indexing the
   * acknowledgements by that id with a plain `Map<string, ApplicationRow>` drops all but the last
   * of them, and the dropped one is never stamped — `listUnsyncedApplications` keeps returning it
   * and the alarm re-pushes it every tick, forever. That is the re-push loop coming back through
   * the side door, and it is why the map holds a list.
   */
  it('settles BOTH local rows when two of them adopt one server application', async () => {
    const server = fakeApiServer({ existing: { 'https://jobs.example/1': 'srv_1' } });
    const { push, stored } = await loadPushPath(server, [
      localRow('app_a', 'https://jobs.example/1'),
      localRow('app_b', 'https://jobs.example/1'),
    ]);

    // Both rows have already met the server once and adopted the id it answered with. Stating that
    // directly beats pushing twice: the two stamps would land in the same millisecond and the
    // assertion below could not tell them apart.
    await noteApplicationPushed('app_a', 'srv_1');
    await noteApplicationPushed('app_b', 'srv_1');

    const tick = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!tick.ok) throw new Error(`push failed: ${tick.error.code} ${tick.error.message}`);

    // One request for the one server row — sending the same clientId twice in a batch is two
    // upserts of it where the second silently wins.
    expect(server.posts).toEqual(['srv_1']);

    // The property that used to fail: BOTH rows are settled by that one acknowledgement. With a
    // plain `Map<string, ApplicationRow>`, `app_a` was evicted by `app_b`, never stamped, and went
    // back on the wire on this tick and every tick after it.
    expect(stored().filter((row) => (row.syncedAt ?? null) === null)).toEqual([]);
  });



  it('keeps the local primary key, so live handles into the tracker still resolve', async () => {
    const server = fakeApiServer({ existing: { 'https://jobs.example/1': 'srv_1' } });
    const { push, stored } = await loadPushPath(server, [
      localRow('app_1', 'https://jobs.example/1'),
    ]);

    const first = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!first.ok) throw new Error(`first tick failed: ${first.error.code}`);

    // The content script is holding `app_1` for the rest of the page's life and will post
    // TRACKER_MARK_APPLIED with it. Re-keying the Dexie row to `srv_1` would strand that handle
    // and silently lose an OBSERVED status flip (INV-1), so adoption happens beside the row.
    expect(stored().map((row) => row.id)).toEqual(['app_1']);
    expect((await readApplicationSyncMap())['app_1']?.remoteClientId).toBe('srv_1');
  });

  /* ----------------------------------------------------------------------------------------------
   * (2) A row the server permanently refuses needs somewhere to rest.
   * -------------------------------------------------------------------------------------------- */
  it('stops re-POSTing a permanently refused row and reports it as blocked', async () => {
    const server = fakeApiServer({ refuse: ['app_2'] });
    const { push } = await loadPushPath(server, [localRow('app_2', 'https://jobs.example/2')]);

    let last = await push({ scopes: ['applications'] }, PUSH_CTX);
    for (let tick = 1; tick < 6; tick += 1) {
      last = await push({ scopes: ['applications'] }, PUSH_CTX);
      if (!last.ok) throw new Error(`tick ${String(tick)} failed: ${last.error.code}`);
    }
    if (!last.ok) throw new Error(`final tick failed: ${last.error.code}`);

    expect(server.posts).toHaveLength(APPLICATION_PUSH_MAX_ATTEMPTS);
    expect(new Set(server.posts)).toEqual(new Set(['app_2']));

    const blocked = await listBlockedApplications();
    expect(blocked.map((entry) => entry.localId)).toEqual(['app_2']);
    expect(blocked[0]?.refusals).toBe(APPLICATION_PUSH_MAX_ATTEMPTS);

    // …and the popup is not the only thing that could learn about it: the reply carries a sentence.
    expect(last.data.state.lastError ?? '').toMatch(/already tracks/i);
  });

  it('gives a blocked row a fresh run of attempts once the user edits it', async () => {
    const server = fakeApiServer({ refuse: ['app_2'] });
    const { push, edit } = await loadPushPath(server, [localRow('app_2', 'https://jobs.example/2')]);

    for (let tick = 0; tick < 5; tick += 1) await push({ scopes: ['applications'] }, PUSH_CTX);
    expect(server.posts).toHaveLength(APPLICATION_PUSH_MAX_ATTEMPTS);

    // Editing the row is the user telling us they did something about the duplicate.
    await edit('app_2', { notes: 'merged the duplicate on the web', updatedAt: Date.now() + 1_000 });

    const reply = await push({ scopes: ['applications'] }, PUSH_CTX);
    if (!reply.ok) throw new Error(`retry tick failed: ${reply.error.code}`);
    expect(server.posts).toHaveLength(APPLICATION_PUSH_MAX_ATTEMPTS + 1);
    // The streak restarts rather than resuming, so the row is out of the terminal state again.
    expect(await listBlockedApplications()).toEqual([]);
    expect((await readApplicationSyncMap())['app_2']?.refusals).toBe(1);
  });
});
