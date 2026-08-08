/**
 * sync/client.ts — the Phase-2 sync client (JF-001 Rev 3.0 SEC 8.2 / 8.3 / 8.4, F-15).
 *
 * A thin, fully-typed HTTP client against the existing NextMove API. It adds no new service and no
 * new host permission: `API_BASE_URL` is already in `wxt.config.ts` host_permissions because the
 * same origin serves `adapters.json` (SEC 8.2 step 5 — "CORS, not permissions").
 *
 * The rules this file exists to keep:
 *
 *   INV-3  **Local-first.** Every exported entry point returns a typed `not-paired` result when the
 *          user has never paired. v1 works with this entire module switched off; nothing here is on
 *          a path that a fill, a match, an answer or a tracker write can block on.
 *   INV-5  Nothing leaves this device until `assertSyncSafe` (sync/guard.ts) has approved the body.
 *          There is no way to reach `fetch` from here that skips the guard.
 *   INV-6  This module talks to the NextMove API only. It never imports `src/ai/**` and never sees
 *          a Gemini key; the AI lane is a different lane entirely.
 *   SEC 8.2 The device JWT is stored AES-GCM-encrypted (`sealDeviceToken`), never in plaintext.
 *   SEC 8.3 `PUT /api/sync/profile` carries an optimistic `version`. A 409 surfaces a typed
 *          `VersionConflictError` **carrying the remote envelope**, so the caller can decrypt and
 *          merge. This client never retries a conflicting write and never overwrites silently.
 *   SEC 8.4 A 401 (expired 7-day token, or a device revoked from web Settings) marks the device
 *          unpaired and asks for re-pairing instead of retrying forever.
 *
 * Every request and response body is one of the shared Zod contracts in `@repo/types/ExtensionTypes`
 * — the same objects the Express controllers parse. FE, BE and extension cannot drift.
 */

import {
  jobApplicationPatchSchema,
  jobApplicationRowSchema,
  pairRequestSchema,
  pairResponseSchema,
  profileBlobEnvelopeSchema,
  siteMappingRowSchema,
} from '@repo/types/ExtensionTypes';
import type {
  jobApplicationPatchSchemaType,
  jobApplicationRowSchemaType,
  profileBlobEnvelopeSchemaType,
  siteMappingRowSchemaType,
} from '@repo/types/ExtensionTypes';

import {
  API_BASE_URL,
  DEFAULT_SYNC_STATE,
  STORAGE_KEY_MAPPINGS,
  STORAGE_KEY_SYNC,
  SYNC_MAX_MAPPINGS,
  SYNC_TIMEOUT_MS,
} from '@/shared/constants';
import type { BusError, BusErrorCode } from '@/shared/messages';
import { mappingStoreSchema, syncStateSchema } from '@/shared/schema';
import type { MappingStore, SyncState } from '@/shared/types';
import { openDeviceToken, openVaultKey, sealDeviceToken, sealVaultKey } from '@/sync/e2e';
import { assertSyncSafe, isSyncGuardError } from '@/sync/guard';

/* ------------------------------------------------------------------------------------------------
 * Result / error vocabulary
 * ---------------------------------------------------------------------------------------------- */

export type SyncErrorCode =
  /** INV-3: the user never opted in. Not an error condition — the expected steady state in v1. */
  | 'not-paired'
  /** 401/403. The device token expired or the device row was revoked; re-pairing is required. */
  | 'unauthorized'
  /** `POST /api/devices/pair` rejected the code (expired, already used, or mistyped). */
  | 'invalid-code'
  /** 409 from `PUT /api/sync/profile` — always a `VersionConflictError`. */
  | 'version-conflict'
  /** 429. `retryAt` carries the Retry-After deadline when the server sent one. */
  | 'rate-limited'
  /** 400, or a body this client refused to build. */
  | 'bad-request'
  /** 404. */
  | 'not-found'
  /** 5xx, or a `{ success: false }` envelope with no recognised code. */
  | 'server'
  /** DNS / offline / CORS / TLS. INV-3 means this must never be fatal to anything but sync. */
  | 'network'
  /** Exceeded `SYNC_TIMEOUT_MS`. */
  | 'timeout'
  /** The server replied with something that does not match its own @repo/types contract. */
  | 'bad-response'
  /** `sync/guard.ts` refused the outbound body (INV-5). */
  | 'guard'
  /** The device token could not be sealed/opened. */
  | 'crypto';

export interface SyncError {
  code: SyncErrorCode;
  message: string;
  /** HTTP status, when there was one. */
  status?: number;
  /** epoch ms; set for `rate-limited` when the server sent `Retry-After`. */
  retryAt?: number;
  /** True when the UI must prompt the user to pair again (SEC 8.4). */
  repairRequired?: boolean;
}

/**
 * SEC 8.3 — a stale `PUT /api/sync/profile`. `remote` is the envelope currently on the server so
 * the caller can `openProfileVault` it and merge; this client never resolves the conflict for you.
 */
export interface VersionConflictError extends SyncError {
  code: 'version-conflict';
  localVersion: number;
  /** null when the remote envelope could not be re-read (offline mid-conflict). */
  remoteVersion: number | null;
  remote: profileBlobEnvelopeSchemaType | null;
}

export type SyncResult<T> = { ok: true; data: T } | { ok: false; error: SyncError };

export function isVersionConflict(error: SyncError): error is VersionConflictError {
  return error.code === 'version-conflict';
}

const NOT_PAIRED_MESSAGE =
  'This device is not paired with a NextMove account. Sync is opt-in — everything else works offline (INV-3).';

function ok<T>(data: T): SyncResult<T> {
  return { ok: true, data };
}

function fail<T>(error: SyncError): SyncResult<T> {
  return { ok: false, error };
}

function notPaired<T>(): SyncResult<T> {
  return fail<T>({ code: 'not-paired', message: NOT_PAIRED_MESSAGE });
}

/** Bridges a `SyncError` onto the bus error vocabulary in `shared/messages.ts` (SEC 6.6). */
export function toBusError(error: SyncError): BusError {
  const map: Readonly<Record<SyncErrorCode, BusErrorCode>> = {
    'not-paired': 'NOT_PAIRED',
    unauthorized: 'NOT_PAIRED',
    'invalid-code': 'BAD_REQUEST',
    'version-conflict': 'SYNC_CONFLICT',
    'rate-limited': 'NETWORK',
    'bad-request': 'BAD_REQUEST',
    'not-found': 'NOT_FOUND',
    server: 'INTERNAL',
    network: 'NETWORK',
    timeout: 'TIMEOUT',
    'bad-response': 'VALIDATION_FAILED',
    guard: 'VALIDATION_FAILED',
    crypto: 'INTERNAL',
  };
  const busError: BusError = { code: map[error.code], message: error.message };
  if (typeof error.retryAt === 'number' && Number.isFinite(error.retryAt)) {
    busError.retryAt = error.retryAt;
  }
  return busError;
}

/* ------------------------------------------------------------------------------------------------
 * Routes (SEC 8.3)
 * ---------------------------------------------------------------------------------------------- */

export const SYNC_ROUTES = {
  pair: '/api/devices/pair',
  devices: '/api/devices',
  device: (id: string): string => `/api/devices/${encodeURIComponent(id)}`,
  profile: '/api/sync/profile',
  mappings: '/api/sync/mappings',
  jobApplications: '/api/job-applications',
  jobApplication: (clientId: string): string =>
    `/api/job-applications/${encodeURIComponent(clientId)}`,
} as const;

/* ------------------------------------------------------------------------------------------------
 * `jf.sync` state (SEC 7.1 / 8.2)
 * ---------------------------------------------------------------------------------------------- */

/** Serialises read-modify-write cycles so two concurrent syncs cannot lose each other's updates. */
let stateChain: Promise<unknown> = Promise.resolve();

/** In-memory unwrapped device JWT — avoids re-opening the sealed blob on every single request. */
let tokenCache: { ct: string; iv: string; token: string } | null = null;

/** Same idea for the vault key. Both caches are per-service-worker-lifetime and never persisted. */
let vaultKeyCache: { ct: string; iv: string; key: string } | null = null;

export async function readSyncState(): Promise<SyncState> {
  const stored = await browser.storage.local.get(STORAGE_KEY_SYNC);
  const parsed = syncStateSchema.safeParse(stored[STORAGE_KEY_SYNC] ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_SYNC_STATE };
}

async function mutateSyncState(update: (current: SyncState) => SyncState): Promise<SyncState> {
  const run = stateChain.then(async () => {
    const current = await readSyncState();
    const next = syncStateSchema.parse(update(current));
    await browser.storage.local.set({ [STORAGE_KEY_SYNC]: next });
    return next;
  });
  stateChain = run.catch(() => undefined);
  return run;
}

/** SEC 8.3 — `SYNC_STATUS`. Safe to call at any time, paired or not. */
export async function status(): Promise<SyncState> {
  return readSyncState();
}

export async function isPaired(): Promise<boolean> {
  const state = await readSyncState();
  return state.paired && state.tokenCt !== null && state.tokenIv !== null;
}

/**
 * SEC 8.4 — a 401 means the 7-day token expired or the device was revoked in web Settings. We drop
 * the credential and surface `repairRequired` instead of hammering the API with a dead token.
 */
async function markUnpaired(reason: string): Promise<SyncState> {
  tokenCache = null;
  vaultKeyCache = null;
  return mutateSyncState((current) => ({
    ...current,
    paired: false,
    deviceId: null,
    tokenCt: null,
    tokenIv: null,
    // The vault key deliberately survives. A 401 means this device's 7-day JWT expired or was
    // revoked — it says nothing about the account's vault, which is still sealed under the same
    // key. Keeping it means re-pairing restores the profile without the web having to hand the key
    // over a second time. An explicit `unpair()` does clear it, via DEFAULT_SYNC_STATE.
    profileVersion: 0,
    lastError: reason,
  }));
}

async function readDeviceToken(): Promise<string | null> {
  const state = await readSyncState();
  if (!state.paired || state.tokenCt === null || state.tokenIv === null) return null;

  const cached = tokenCache;
  if (cached !== null && cached.ct === state.tokenCt && cached.iv === state.tokenIv) {
    return cached.token;
  }
  try {
    const token = await openDeviceToken({ ciphertext: state.tokenCt, nonce: state.tokenIv });
    tokenCache = { ct: state.tokenCt, iv: state.tokenIv, token };
    return token;
  } catch {
    await markUnpaired('Stored device token could not be decrypted — please pair this device again.');
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * The E2E vault key (SEC 7.4)
 * ---------------------------------------------------------------------------------------------- */

/**
 * This install's copy of the key that opens the account's `ProfileBlob`.
 *
 * `null` means one of two very different things and the caller has to care which: either this
 * device has never been handed a key (pair again from the web, which re-sends it), or the account
 * genuinely has no vault yet (mint one with `generateVaultKey()` and push). `pullProfileBlob()`
 * returning `null` is what distinguishes them.
 */
export async function readVaultKey(): Promise<string | null> {
  const state = await readSyncState();
  if (state.vaultKeyCt === null || state.vaultKeyIv === null) return null;

  const cached = vaultKeyCache;
  if (cached !== null && cached.ct === state.vaultKeyCt && cached.iv === state.vaultKeyIv) {
    return cached.key;
  }
  try {
    const key = await openVaultKey({ ciphertext: state.vaultKeyCt, nonce: state.vaultKeyIv });
    vaultKeyCache = { ct: state.vaultKeyCt, iv: state.vaultKeyIv, key };
    return key;
  } catch {
    // A key we cannot open is worse than no key: it would make every pull look like a wrong-key
    // failure forever. Drop it and let the next pairing supply a fresh one.
    await mutateSyncState((current) => ({
      ...current,
      vaultKeyCt: null,
      vaultKeyIv: null,
      lastError: 'The stored vault key could not be decrypted. Reconnect to restore your profile.',
    }));
    vaultKeyCache = null;
    return null;
  }
}

/** Seals `keyB64` at rest and stores it in `jf.sync`. Rejects anything that is not a 256-bit key. */
export async function writeVaultKey(keyB64: string): Promise<SyncResult<true>> {
  let sealed: { ciphertext: string; nonce: string };
  try {
    sealed = await sealVaultKey(keyB64);
  } catch (error) {
    return fail({
      code: 'crypto',
      message: `Could not encrypt the vault key, refusing to store it in plaintext: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  vaultKeyCache = { ct: sealed.ciphertext, iv: sealed.nonce, key: keyB64 };
  await mutateSyncState((current) => ({
    ...current,
    vaultKeyCt: sealed.ciphertext,
    vaultKeyIv: sealed.nonce,
  }));
  return ok(true);
}

/** True when this install holds a vault key. Cheap — does not open it. */
export async function hasVaultKey(): Promise<boolean> {
  const state = await readSyncState();
  return state.vaultKeyCt !== null && state.vaultKeyIv !== null;
}

/* ------------------------------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------------------------------- */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestSpec {
  method: HttpMethod;
  path: string;
  auth: boolean;
  query?: Readonly<Record<string, string | number | null | undefined>>;
  /** Passed through `assertSyncSafe` before it is serialised. */
  body?: unknown;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  success: boolean;
  data: unknown;
  message: string;
  serverCode: string | null;
  retryAt: number | null;
}

type Attempt =
  | { ok: true; res: RawResponse }
  | { ok: false; error: SyncError; res: RawResponse | null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUrl(spec: RequestSpec): string {
  const url = new URL(spec.path, API_BASE_URL);
  if (spec.query !== undefined) {
    for (const [name, value] of Object.entries(spec.query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(name, String(value));
    }
  }
  return url.toString();
}

function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1_000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : at;
}

/** The API's standard `{ success, data, message }` envelope (repo convention, SEC 8.4). */
function readEnvelope(status: number, payload: unknown, retryAt: number | null): RawResponse {
  const httpOk = status >= 200 && status < 300;

  if (isPlainObject(payload) && 'success' in payload) {
    const data = payload['data'] ?? null;
    const rawMessage = payload['message'];
    const serverCode =
      isPlainObject(data) && typeof data['code'] === 'string' ? data['code'] : null;
    return {
      status,
      success: payload['success'] === true && httpOk,
      data,
      message: typeof rawMessage === 'string' ? rawMessage : '',
      serverCode,
      retryAt,
    };
  }
  return { status, success: httpOk, data: payload ?? null, message: '', serverCode: null, retryAt };
}

function codeForStatus(status: number, serverCode: string | null, authed: boolean): SyncErrorCode {
  if (status === 401 || status === 403) {
    // On the public pairing route a 401 means the *code* was bad, not that we lost a credential.
    if (!authed) return 'invalid-code';
    return 'unauthorized';
  }
  if (status === 409) return 'version-conflict';
  if (status === 429) return 'rate-limited';
  if (status === 404) return 'not-found';
  if (status === 400 || status === 422) return 'bad-request';
  if (status >= 500) return 'server';

  switch (serverCode) {
    case 'INVALID_OR_EXPIRED_CODE':
      return 'invalid-code';
    case 'VERSION_CONFLICT':
      return 'version-conflict';
    case 'RATE_LIMITED':
      return 'rate-limited';
    case 'DEVICE_REVOKED':
      return authed ? 'unauthorized' : 'invalid-code';
    default:
      return 'server';
  }
}

async function send(spec: RequestSpec): Promise<Attempt> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (spec.auth) {
    const token = await readDeviceToken();
    if (token === null) {
      return { ok: false, error: { code: 'not-paired', message: NOT_PAIRED_MESSAGE }, res: null };
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  let bodyText: string | undefined;
  if (spec.body !== undefined) {
    // INV-5 / SEC 7.4 — the only path to the network, and it goes through the allowlist.
    try {
      assertSyncSafe(spec.body);
    } catch (error) {
      if (isSyncGuardError(error)) {
        return { ok: false, error: { code: 'guard', message: error.message }, res: null };
      }
      throw error;
    }
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(spec.body);
  }

  const controller = new AbortController();
  const timeoutMs = spec.timeoutMs ?? SYNC_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    const init: RequestInit = {
      method: spec.method,
      headers,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    };
    if (bodyText !== undefined) init.body = bodyText;
    response = await fetch(buildUrl(spec), init);
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      res: null,
      error: aborted
        ? { code: 'timeout', message: `Sync request timed out after ${timeoutMs} ms.` }
        : {
            code: 'network',
            message: `Could not reach the NextMove API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
    };
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown = null;
  try {
    const text = await response.text();
    if (text.length > 0) payload = JSON.parse(text) as unknown;
  } catch {
    payload = null;
  }

  const res = readEnvelope(
    response.status,
    payload,
    parseRetryAfter(response.headers.get('Retry-After'), Date.now()),
  );

  if (res.success) return { ok: true, res };

  const code = codeForStatus(res.status, res.serverCode, spec.auth);
  if (code === 'unauthorized' && spec.auth) {
    await markUnpaired('Your NextMove session for this device ended. Pair again to resume sync.');
  }

  const error: SyncError = {
    code,
    status: res.status,
    message:
      res.message.length > 0
        ? res.message
        : `Sync request failed (HTTP ${res.status}) on ${spec.method} ${spec.path}.`,
  };
  if (code === 'unauthorized' || code === 'invalid-code') error.repairRequired = true;
  if (res.retryAt !== null) error.retryAt = res.retryAt;

  return { ok: false, error, res };
}

/* ------------------------------------------------------------------------------------------------
 * SEC 8.2 — pairing
 * ---------------------------------------------------------------------------------------------- */

/** "Chrome · macOS" — capped at the 60 chars `pairRequestSchema` allows. */
export function defaultDeviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const engine = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : 'Browser';
  const platform = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'device';
  return `${engine} · ${platform}`.slice(0, 60);
}

/**
 * SEC 8.2 steps 3–4. Exchanges the 8-char code the user copied out of NextMove web for a
 * device-bound 7-day JWT, then stores that JWT **AES-GCM-encrypted** — `chrome.storage.local` never
 * holds it in plaintext. Returns the new `SyncState`; the caller flips `settings.syncEnabled`.
 */
export async function requestPairing(
  code: string,
  deviceName: string = defaultDeviceName(),
): Promise<SyncResult<SyncState>> {
  const body = pairRequestSchema.safeParse({ code: code.trim().toUpperCase(), deviceName });
  if (!body.success) {
    return fail({ code: 'bad-request', message: body.error.issues[0]?.message ?? 'Invalid pairing request.' });
  }

  const attempt = await send({ method: 'POST', path: SYNC_ROUTES.pair, auth: false, body: body.data });
  if (!attempt.ok) {
    await mutateSyncState((current) => ({ ...current, lastError: attempt.error.message }));
    return fail(attempt.error);
  }

  const parsed = pairResponseSchema.safeParse(attempt.res.data);
  if (!parsed.success) {
    return fail({
      code: 'bad-response',
      message: `Pairing succeeded but the response did not match pairResponseSchema: ${parsed.error.message}`,
    });
  }

  let sealed: { ciphertext: string; nonce: string };
  try {
    sealed = await sealDeviceToken(parsed.data.token);
  } catch (error) {
    return fail({
      code: 'crypto',
      message: `Could not encrypt the device token, refusing to store it in plaintext: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  tokenCache = { ct: sealed.ciphertext, iv: sealed.nonce, token: parsed.data.token };

  // profileVersion resets: this install has not yet seen the account's ProfileBlob, so the first
  // pull establishes the true optimistic-lock baseline (SEC 8.3).
  const next = await mutateSyncState((current) => ({
    ...current,
    paired: true,
    deviceId: parsed.data.device.id,
    deviceName: parsed.data.device.name ?? body.data.deviceName,
    email: current.email,
    tokenCt: sealed.ciphertext,
    tokenIv: sealed.nonce,
    profileVersion: 0,
    lastSyncAt: Date.now(),
    lastError: null,
  }));
  return ok(next);
}

/**
 * Revokes this install. Best-effort `DELETE /api/devices/:id` first — but the local credential is
 * dropped either way, so "disconnect" always succeeds from the user's point of view (INV-3).
 */
export async function unpair(): Promise<SyncState> {
  const current = await readSyncState();
  if (current.paired && current.deviceId !== null) {
    await send({ method: 'DELETE', path: SYNC_ROUTES.device(current.deviceId), auth: true });
  }
  tokenCache = null;
  return mutateSyncState(() => ({ ...DEFAULT_SYNC_STATE, deviceName: current.deviceName }));
}

/* ------------------------------------------------------------------------------------------------
 * SEC 8.3 — profile blob (E2E, optimistic locking)
 * ---------------------------------------------------------------------------------------------- */

/** Accepts the envelope bare or wrapped, and validates it against the shared contract. */
function coerceEnvelope(data: unknown): profileBlobEnvelopeSchemaType | null {
  const candidates: unknown[] = [data];
  if (isPlainObject(data)) {
    candidates.push(data['profile'], data['blob'], data['envelope']);
  }
  for (const candidate of candidates) {
    const parsed = profileBlobEnvelopeSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * `GET /api/sync/profile`. `null` means the account has no ProfileBlob yet (first device).
 * Decrypt the result with `openProfileVault(envelope, passphrase)` — this client never holds the
 * passphrase and cannot read what it just downloaded.
 */
export async function pullProfileBlob(): Promise<SyncResult<profileBlobEnvelopeSchemaType | null>> {
  if (!(await isPaired())) return notPaired();

  const attempt = await send({ method: 'GET', path: SYNC_ROUTES.profile, auth: true });
  if (!attempt.ok) {
    if (attempt.error.code === 'not-found') return ok(null);
    return fail(attempt.error);
  }
  if (attempt.res.data === null) return ok(null);

  const envelope = coerceEnvelope(attempt.res.data);
  if (envelope === null) {
    return fail({
      code: 'bad-response',
      message: 'GET /api/sync/profile did not return a profileBlobEnvelope.',
    });
  }
  await mutateSyncState((current) => ({
    ...current,
    profileVersion: envelope.version,
    lastSyncAt: Date.now(),
    lastError: null,
  }));
  return ok(envelope);
}

async function buildVersionConflict(
  localVersion: number,
  res: RawResponse | null,
  message: string,
): Promise<VersionConflictError> {
  let remote = res === null ? null : coerceEnvelope(res.data);
  if (remote === null) {
    // The 409 body did not carry the winning envelope — fetch it so the caller can still merge.
    const pulled = await pullProfileBlob();
    if (pulled.ok) remote = pulled.data;
  }
  return {
    code: 'version-conflict',
    status: 409,
    message,
    localVersion,
    remoteVersion: remote === null ? null : remote.version,
    remote,
  };
}

/**
 * `PUT /api/sync/profile` with the SEC 8.3 optimistic lock.
 *
 * Build `envelope` with `sealProfileVault(vault, passphrase, state.profileVersion + 1)`. A stale
 * version comes back as a `VersionConflictError` carrying the server's current envelope — decrypt,
 * merge, re-seal at `remoteVersion + 1`, push again. This function never retries on your behalf and
 * never overwrites the server copy blindly.
 */
export async function pushProfileBlob(
  envelope: profileBlobEnvelopeSchemaType,
): Promise<SyncResult<{ version: number }>> {
  if (!(await isPaired())) return notPaired();

  const body = profileBlobEnvelopeSchema.safeParse(envelope);
  if (!body.success) {
    return fail({
      code: 'bad-request',
      message: `Refusing to push a malformed envelope: ${body.error.message}`,
    });
  }

  const attempt = await send({
    method: 'PUT',
    path: SYNC_ROUTES.profile,
    auth: true,
    body: body.data,
  });

  if (!attempt.ok) {
    if (attempt.error.code === 'version-conflict') {
      const conflict = await buildVersionConflict(
        body.data.version,
        attempt.res,
        attempt.error.message.length > 0
          ? attempt.error.message
          : 'Another device wrote a newer profile. Merge before pushing again.',
      );
      await mutateSyncState((current) => ({
        ...current,
        profileVersion: conflict.remoteVersion ?? current.profileVersion,
        lastError: conflict.message,
      }));
      return fail(conflict);
    }
    return fail(attempt.error);
  }

  const accepted = coerceEnvelope(attempt.res.data);
  const reported =
    accepted !== null
      ? accepted.version
      : isPlainObject(attempt.res.data) && typeof attempt.res.data['version'] === 'number'
        ? attempt.res.data['version']
        : body.data.version;

  await mutateSyncState((current) => ({
    ...current,
    profileVersion: reported,
    lastSyncAt: Date.now(),
    lastError: null,
  }));
  return ok({ version: reported });
}

/* ------------------------------------------------------------------------------------------------
 * SEC 8.3 — site mappings (F-13 roams with the user, last-write-wins per (domain, sigHash))
 * ---------------------------------------------------------------------------------------------- */

/** `jf.mappings` (domain → sigHash → path) flattened into the wire rows. */
export function flattenMappingStore(store: MappingStore): siteMappingRowSchemaType[] {
  const rows: siteMappingRowSchemaType[] = [];
  for (const [domain, bySignature] of Object.entries(store)) {
    for (const [sigHash, profilePath] of Object.entries(bySignature)) {
      if (domain.length === 0 || sigHash.length === 0 || profilePath.length === 0) continue;
      rows.push({ domain, sigHash, profilePath });
    }
  }
  return rows;
}

/** Folds wire rows back into a `MappingStore`; later rows win, mirroring the server's semantics. */
export function foldMappingRows(
  rows: readonly siteMappingRowSchemaType[],
  into: MappingStore = {},
): MappingStore {
  const merged: MappingStore = { ...into };
  for (const row of rows) {
    const existing = merged[row.domain];
    merged[row.domain] = { ...(existing ?? {}), [row.sigHash]: row.profilePath };
  }
  return merged;
}

export async function readLocalMappings(): Promise<MappingStore> {
  const stored = await browser.storage.local.get(STORAGE_KEY_MAPPINGS);
  const parsed = mappingStoreSchema.safeParse(stored[STORAGE_KEY_MAPPINGS] ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * `PUT /api/sync/mappings`. With no argument it flattens the local `jf.mappings` store. Batched at
 * `SYNC_MAX_MAPPINGS` because `siteMappingsPutSchema` caps a single body at 5 000 rows; the server
 * merges per (domain, sigHash), so several PUTs are equivalent to one large one.
 */
export async function pushMappings(
  rows?: readonly siteMappingRowSchemaType[],
): Promise<SyncResult<{ pushed: number }>> {
  if (!(await isPaired())) return notPaired();

  const source = rows ?? flattenMappingStore(await readLocalMappings());
  const valid: siteMappingRowSchemaType[] = [];
  for (const row of source) {
    const parsed = siteMappingRowSchema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
  }
  if (valid.length === 0) return ok({ pushed: 0 });

  let pushed = 0;
  for (let offset = 0; offset < valid.length; offset += SYNC_MAX_MAPPINGS) {
    const batch = valid.slice(offset, offset + SYNC_MAX_MAPPINGS);
    const attempt = await send({
      method: 'PUT',
      path: SYNC_ROUTES.mappings,
      auth: true,
      body: { mappings: batch },
    });
    if (!attempt.ok) return fail(attempt.error);
    pushed += batch.length;
  }

  await mutateSyncState((current) => ({ ...current, lastSyncAt: Date.now(), lastError: null }));
  return ok({ pushed });
}

/** `GET /api/sync/mappings`. Returns wire rows; merging into `jf.mappings` is a separate step. */
export async function pullMappings(): Promise<SyncResult<siteMappingRowSchemaType[]>> {
  if (!(await isPaired())) return notPaired();

  const attempt = await send({ method: 'GET', path: SYNC_ROUTES.mappings, auth: true });
  if (!attempt.ok) return fail(attempt.error);

  const raw = attempt.res.data;
  const list: unknown = Array.isArray(raw)
    ? raw
    : isPlainObject(raw)
      ? (raw['mappings'] ?? raw['rows'] ?? [])
      : [];
  if (!Array.isArray(list)) {
    return fail({ code: 'bad-response', message: 'GET /api/sync/mappings did not return an array.' });
  }

  const rows: siteMappingRowSchemaType[] = [];
  for (const item of list) {
    const parsed = siteMappingRowSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
  }
  await mutateSyncState((current) => ({ ...current, lastSyncAt: Date.now(), lastError: null }));
  return ok(rows);
}

/** Merges pulled rows into `jf.mappings` (last-write-wins) and returns the merged store. */
export async function applyPulledMappings(
  rows: readonly siteMappingRowSchemaType[],
): Promise<MappingStore> {
  const merged = foldMappingRows(rows, await readLocalMappings());
  await browser.storage.local.set({ [STORAGE_KEY_MAPPINGS]: merged });
  return merged;
}

/* ------------------------------------------------------------------------------------------------
 * SEC 8.3 — job applications (CRUD, idempotent on clientId, cursor-paginated)
 * ---------------------------------------------------------------------------------------------- */

export interface ApplicationPage {
  rows: jobApplicationRowSchemaType[];
  /** Opaque cursor for the next page; `null` when the last page has been read. */
  nextCursor: string | null;
}

function coerceApplicationRow(data: unknown): jobApplicationRowSchemaType | null {
  const candidates: unknown[] = [data];
  if (isPlainObject(data)) candidates.push(data['application'], data['row'], data['jobApplication']);
  for (const candidate of candidates) {
    const parsed = jobApplicationRowSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * `POST /api/job-applications`. **Idempotent on `clientId`** (SEC 8.3): the extension's row id is
 * the natural key, so replaying a push after a dropped connection updates rather than duplicates.
 */
export async function pushApplication(
  row: jobApplicationRowSchemaType,
): Promise<SyncResult<jobApplicationRowSchemaType>> {
  if (!(await isPaired())) return notPaired();

  const body = jobApplicationRowSchema.safeParse(row);
  if (!body.success) {
    return fail({
      code: 'bad-request',
      message: `Refusing to push a malformed application row: ${body.error.message}`,
    });
  }

  const attempt = await send({
    method: 'POST',
    path: SYNC_ROUTES.jobApplications,
    auth: true,
    body: body.data,
  });
  if (!attempt.ok) return fail(attempt.error);

  const saved = coerceApplicationRow(attempt.res.data) ?? body.data;
  await mutateSyncState((current) => ({ ...current, lastSyncAt: Date.now(), lastError: null }));
  return ok(saved);
}

/**
 * Sequential because `clientId` idempotency makes retries cheap and the API is rate-limited to
 * 60/min/user (SEC 8.4). Stops at the first fatal error and reports what actually landed.
 */
export async function pushApplications(
  rows: readonly jobApplicationRowSchemaType[],
): Promise<SyncResult<{ pushed: number; rows: jobApplicationRowSchemaType[] }>> {
  if (!(await isPaired())) return notPaired();

  const saved: jobApplicationRowSchemaType[] = [];
  for (const row of rows) {
    const result = await pushApplication(row);
    if (!result.ok) {
      if (result.error.code === 'bad-request' || result.error.code === 'guard') continue;
      return fail(result.error);
    }
    saved.push(result.data);
  }
  return ok({ pushed: saved.length, rows: saved });
}

/** `PATCH /api/job-applications/:clientId`. Only the keys you pass are written. */
export async function patchApplication(
  clientId: string,
  patch: jobApplicationPatchSchemaType,
): Promise<SyncResult<jobApplicationRowSchemaType>> {
  if (!(await isPaired())) return notPaired();

  const body = jobApplicationPatchSchema.safeParse(patch);
  if (!body.success) {
    return fail({ code: 'bad-request', message: `Invalid patch: ${body.error.message}` });
  }
  if (Object.keys(body.data).length === 0) {
    return fail({ code: 'bad-request', message: 'Refusing to send an empty PATCH body.' });
  }

  const attempt = await send({
    method: 'PATCH',
    path: SYNC_ROUTES.jobApplication(clientId),
    auth: true,
    body: body.data,
  });
  if (!attempt.ok) return fail(attempt.error);

  const saved = coerceApplicationRow(attempt.res.data);
  if (saved === null) {
    return fail({
      code: 'bad-response',
      message: 'PATCH /api/job-applications did not return a jobApplicationRow.',
    });
  }
  await mutateSyncState((current) => ({ ...current, lastSyncAt: Date.now(), lastError: null }));
  return ok(saved);
}

export async function deleteApplication(clientId: string): Promise<SyncResult<{ deleted: true }>> {
  if (!(await isPaired())) return notPaired();

  const attempt = await send({
    method: 'DELETE',
    path: SYNC_ROUTES.jobApplication(clientId),
    auth: true,
  });
  if (!attempt.ok) {
    // Already gone on the server is the outcome the caller wanted.
    if (attempt.error.code === 'not-found') return ok({ deleted: true });
    return fail(attempt.error);
  }
  return ok({ deleted: true });
}

/** `GET /api/job-applications?cursor=&limit=` — one cursor-paginated page (SEC 8.3). */
export async function listApplications(
  options: { cursor?: string | null; limit?: number } = {},
): Promise<SyncResult<ApplicationPage>> {
  if (!(await isPaired())) return notPaired();

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const attempt = await send({
    method: 'GET',
    path: SYNC_ROUTES.jobApplications,
    auth: true,
    query: { cursor: options.cursor ?? undefined, limit },
  });
  if (!attempt.ok) return fail(attempt.error);

  const raw = attempt.res.data;
  const list: unknown = Array.isArray(raw)
    ? raw
    : isPlainObject(raw)
      ? (raw['rows'] ?? raw['applications'] ?? raw['items'] ?? [])
      : [];
  if (!Array.isArray(list)) {
    return fail({
      code: 'bad-response',
      message: 'GET /api/job-applications did not return an array of rows.',
    });
  }

  const rows: jobApplicationRowSchemaType[] = [];
  for (const item of list) {
    const parsed = jobApplicationRowSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
  }

  let nextCursor: string | null = null;
  if (isPlainObject(raw)) {
    const candidate = raw['nextCursor'] ?? raw['cursor'];
    if (typeof candidate === 'string' && candidate.length > 0) nextCursor = candidate;
  }

  await mutateSyncState((current) => ({ ...current, lastSyncAt: Date.now(), lastError: null }));
  return ok({ rows, nextCursor });
}

/**
 * Walks every page. `maxPages` is a hard stop so a server that always returns a cursor cannot spin
 * the service worker forever.
 */
export async function listAllApplications(
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<SyncResult<jobApplicationRowSchemaType[]>> {
  if (!(await isPaired())) return notPaired();

  const maxPages = Math.min(Math.max(options.maxPages ?? 50, 1), 500);
  const all: jobApplicationRowSchemaType[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const result: SyncResult<ApplicationPage> = await listApplications({
      cursor,
      ...(options.pageSize === undefined ? {} : { limit: options.pageSize }),
    });
    if (!result.ok) return fail(result.error);

    for (const row of result.data.rows) {
      if (seen.has(row.clientId)) continue;
      seen.add(row.clientId);
      all.push(row);
    }
    if (result.data.nextCursor === null || result.data.nextCursor === cursor) break;
    cursor = result.data.nextCursor;
  }
  return ok(all);
}
