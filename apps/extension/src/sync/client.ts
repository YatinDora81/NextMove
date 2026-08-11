import { z } from 'zod';

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

export type SyncErrorCode =
  | 'not-paired'
  | 'unauthorized'
  | 'invalid-code'
  | 'version-conflict'
  /**
   * The server refused ONE row because another of this account's rows already tracks that posting
   * (`@@unique([userId, urlKey])`). Kept separate from `version-conflict` because the two need
   * opposite handling: a profile version conflict has to stop the caller and be merged, while this
   * one is a permanent verdict on a single row that the rest of a batch must survive.
   */
  | 'duplicate-url'
  | 'rate-limited'
  | 'bad-request'
  | 'not-found'
  | 'server'
  | 'network'
  | 'timeout'
  | 'bad-response'
  | 'guard'
  | 'crypto';

export interface SyncError {
  code: SyncErrorCode;
  message: string;
  status?: number;
  retryAt?: number;
  repairRequired?: boolean;
}

export interface VersionConflictError extends SyncError {
  code: 'version-conflict';
  localVersion: number;
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

export function toBusError(error: SyncError): BusError {
  const map: Readonly<Record<SyncErrorCode, BusErrorCode>> = {
    'not-paired': 'NOT_PAIRED',
    unauthorized: 'NOT_PAIRED',
    'invalid-code': 'BAD_REQUEST',
    'version-conflict': 'SYNC_CONFLICT',
    'duplicate-url': 'SYNC_CONFLICT',
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

let stateChain: Promise<unknown> = Promise.resolve();

let tokenCache: { ct: string; iv: string; token: string } | null = null;

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

export async function status(): Promise<SyncState> {
  return readSyncState();
}

export async function isPaired(): Promise<boolean> {
  const state = await readSyncState();
  return state.paired && state.tokenCt !== null && state.tokenIv !== null;
}

async function markUnpaired(reason: string): Promise<SyncState> {
  tokenCache = null;
  vaultKeyCache = null;
  return mutateSyncState((current) => ({
    ...current,
    paired: false,
    deviceId: null,
    tokenCt: null,
    tokenIv: null,
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

export async function hasVaultKey(): Promise<boolean> {
  const state = await readSyncState();
  return state.vaultKeyCt !== null && state.vaultKeyIv !== null;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestSpec {
  method: HttpMethod;
  path: string;
  auth: boolean;
  query?: Readonly<Record<string, string | number | null | undefined>>;
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
    if (!authed) return 'invalid-code';
    return 'unauthorized';
  }
  // Both of the API's 409s carry a `data.code`, and they are not interchangeable: DUPLICATE_URL is
  // about one job-application row, everything else (a profile VERSION_CONFLICT, CLIENT_ID_TAKEN)
  // is a conflict the caller has to stop and resolve.
  if (status === 409) return serverCode === 'DUPLICATE_URL' ? 'duplicate-url' : 'version-conflict';
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

  const unreachable =
    code === 'not-found' && (spec.path === SYNC_ROUTES.pair || spec.path === SYNC_ROUTES.devices);

  const error: SyncError = {
    code,
    status: res.status,
    message: unreachable
      ? `The NextMove sync service did not recognise ${spec.method} ${spec.path}. The server is ` +
        'reachable but does not have this endpoint, so it is likely out of date or the extension ' +
        'is pointed at the wrong host. This is not a problem with your pairing code.'
      : res.message.length > 0
        ? res.message
        : `Sync request failed (HTTP ${res.status}) on ${spec.method} ${spec.path}.`,
  };
  if (code === 'unauthorized' || code === 'invalid-code') error.repairRequired = true;
  if (res.retryAt !== null) error.retryAt = res.retryAt;

  return { ok: false, error, res };
}

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

export async function unpair(): Promise<SyncState> {
  const current = await readSyncState();
  if (current.paired && current.deviceId !== null) {
    await send({ method: 'DELETE', path: SYNC_ROUTES.device(current.deviceId), auth: true });
  }
  tokenCache = null;
  // Every record in this map describes one account's server rows — the ids it holds them under and
  // which of them it refuses. Carrying that into a re-pair with a DIFFERENT account addresses one
  // user's applications with another user's identities, which the server rejects outright.
  await browser.storage.local.remove(STORAGE_KEY_APPLICATION_SYNC);
  return mutateSyncState(() => ({ ...DEFAULT_SYNC_STATE, deviceName: current.deviceName }));
}


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

export async function applyPulledMappings(
  rows: readonly siteMappingRowSchemaType[],
): Promise<MappingStore> {
  const merged = foldMappingRows(rows, await readLocalMappings());
  await browser.storage.local.set({ [STORAGE_KEY_MAPPINGS]: merged });
  return merged;
}

export interface ApplicationPage {
  rows: jobApplicationRowSchemaType[];
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
 * One row's round trip, with BOTH identities kept apart on purpose.
 *
 * The server resolves an upsert by `clientId` first and by the posting's url second, and the url
 * branch answers with the matched row's *original* `clientId` — the id every other install of this
 * account already addresses that application by. So after a reinstall (fresh local ids, postings
 * the account already tracks) `row.clientId` is routinely NOT the id we sent.
 *
 * `requestedClientId` is therefore the only key a caller may use to find the local row this
 * acknowledgement belongs to. Matching on `row.clientId` drops the acknowledgement on the floor,
 * which is what makes an unsynced row unsyncable forever.
 */
export interface PushedApplication {
  /** The clientId this device sent. Still the primary key of the local row. */
  requestedClientId: string;
  /** The row as the server stored it. `row.clientId` may be the server's own id, not ours. */
  row: jobApplicationRowSchemaType;
}

export interface PushApplicationsResult {
  /** How many rows the server accepted — i.e. `saved.length`. */
  pushed: number;
  saved: PushedApplication[];
  /**
   * clientIds the server refused with DUPLICATE_URL. Deliberately not counted as pushed and
   * deliberately not treated as a batch failure: see `pushApplications`.
   */
  duplicateUrls: string[];
}

export async function pushApplications(
  rows: readonly jobApplicationRowSchemaType[],
): Promise<SyncResult<PushApplicationsResult>> {
  if (!(await isPaired())) return notPaired();

  const saved: PushedApplication[] = [];
  const duplicateUrls: string[] = [];
  for (const row of rows) {
    const result = await pushApplication(row);
    if (!result.ok) {
      if (result.error.code === 'bad-request' || result.error.code === 'guard') continue;
      // A duplicate-url refusal is a verdict on this row alone — the account already tracks that
      // posting under another row. Failing the batch on it would park every row queued behind it,
      // for good, on a request that cannot start succeeding on its own. Skip it and keep going;
      // it stays unsynced, so it lands by itself once the user resolves the duplicate on the web.
      if (result.error.code === 'duplicate-url') {
        duplicateUrls.push(row.clientId);
        continue;
      }
      return fail(result.error);
    }
    saved.push({ requestedClientId: row.clientId, row: result.data });
  }
  return ok({ pushed: saved.length, saved, duplicateUrls });
}

/* ------------------------------------------------------------------------------------------------
 * Applications · where the local row and the server row agree on one identity
 *
 * `ApplicationRow.id` is the Dexie primary key AND a live handle: the content script keeps the id
 * `TRACKER_LOG_FILL` gave it for the rest of the page's life and later posts `TRACKER_MARK_APPLIED`
 * with it, and the dashboard addresses rows by it. Re-keying a row in place to the clientId the
 * server answered with would strand those handles — `markApplied()` resolves by id and returns null
 * for a row that moved — and so silently drop an OBSERVED status flip (INV-1). Adoption therefore
 * happens BESIDE the row, in this map: the row keeps its local id forever and the map decides which
 * clientId goes ON THE WIRE for it, which is the only identity the server ever sees.
 *
 * Without it, a row the server matched by url (it answers with its own original clientId) misses
 * BOTH server lookups the next time its url changes locally — the clientId is unknown there and the
 * new urlKey matches nothing — and the server creates a SECOND row, orphaning the first on the
 * Applied page. That is the duplicate `@@unique([userId, urlKey])` exists to prevent.
 * ---------------------------------------------------------------------------------------------- */

const STORAGE_KEY_APPLICATION_SYNC = 'jf.sync.applications';

/**
 * Consecutive DUPLICATE_URL refusals a row gets before it is parked instead of retried.
 *
 * The server's verdict is permanent until a human changes something, so an unbounded retry is a
 * write per row per alarm tick, forever, for an outcome that cannot improve on its own.
 */
export const APPLICATION_PUSH_MAX_ATTEMPTS = 3;

const applicationSyncRecordSchema = z.object({
  /** The clientId the SERVER holds this row under. Equal to the local id until the two diverge. */
  remoteClientId: z.string().min(1),
  /** Length of the current DUPLICATE_URL refusal streak. Reset by any successful push. */
  refusals: z.number().int().nonnegative(),
  /** When the streak hit the ceiling and the row was parked; null while it is still being tried. */
  blockedAt: z.number().int().nonnegative().nullable(),
});

const applicationSyncMapSchema = z.record(z.string(), applicationSyncRecordSchema);

export type ApplicationSyncRecord = z.infer<typeof applicationSyncRecordSchema>;
export type ApplicationSyncMap = z.infer<typeof applicationSyncMapSchema>;

/** A row the server refuses to accept, and which is no longer being retried. */
export interface BlockedApplication {
  /** `ApplicationRow.id` — what the tracker UI addresses the row by. */
  localId: string;
  remoteClientId: string;
  refusals: number;
  blockedAt: number;
}

let applicationChain: Promise<unknown> = Promise.resolve();

export async function readApplicationSyncMap(): Promise<ApplicationSyncMap> {
  const stored = await browser.storage.local.get(STORAGE_KEY_APPLICATION_SYNC);
  const parsed = applicationSyncMapSchema.safeParse(stored[STORAGE_KEY_APPLICATION_SYNC] ?? {});
  return parsed.success ? parsed.data : {};
}

async function mutateApplicationSyncMap(
  update: (current: ApplicationSyncMap) => ApplicationSyncMap,
): Promise<ApplicationSyncMap> {
  const run = applicationChain.then(async () => {
    const next = applicationSyncMapSchema.parse(update(await readApplicationSyncMap()));
    await browser.storage.local.set({ [STORAGE_KEY_APPLICATION_SYNC]: next });
    return next;
  });
  applicationChain = run.catch(() => undefined);
  return run;
}

/**
 * The clientId to address the server with for a local row — its adopted identity, else its own id.
 *
 * Every request that names one row (`POST` upsert, `PATCH`, `DELETE`) has to go through this, or it
 * addresses an id the server has never heard of.
 *
 * This mapping is many-to-one, and callers must treat it that way. The server's upsert falls back
 * to matching on the posting's url when a clientId is unknown to it, so two local rows for one
 * posting — the same job under two profiles, since `findExisting` is profile-scoped, or a
 * `www.`/`https` pair the server's url reduction collapses and ours does not — both adopt the same
 * remote id. Anything that indexes local rows BY this value has to hold a list, or one row is
 * silently dropped and never stamped as synced.
 */
export function wireClientIdFor(map: ApplicationSyncMap, localId: string): string {
  return map[localId]?.remoteClientId ?? localId;
}



export async function remoteClientIdFor(localId: string): Promise<string> {
  return wireClientIdFor(await readApplicationSyncMap(), localId);
}

/** True while the row is parked: refused to the ceiling and untouched since. */
export function isApplicationPushBlocked(
  record: ApplicationSyncRecord | undefined,
  updatedAt: number,
): boolean {
  if (record === undefined || record.blockedAt === null) return false;
  // A local edit is the only signal we get that the user has acted on the duplicate, so it is what
  // lets a parked row leave the terminal state — there is no "retry everything" button to press.
  return updatedAt <= record.blockedAt;
}

/** The server accepted the row: remember the identity it answered with and end any refusal streak. */
export async function noteApplicationPushed(
  localId: string,
  remoteClientId: string,
): Promise<void> {
  const current = await readApplicationSyncMap();
  const existing = current[localId];
  // A row whose id the server kept needs no entry at all — most rows, most of the time.
  if (existing === undefined && remoteClientId === localId) return;
  if (
    existing !== undefined &&
    existing.remoteClientId === remoteClientId &&
    existing.refusals === 0 &&
    existing.blockedAt === null
  ) {
    return;
  }
  await mutateApplicationSyncMap((map) => ({
    ...map,
    [localId]: { remoteClientId, refusals: 0, blockedAt: null },
  }));
}

/**
 * Count one DUPLICATE_URL refusal against a row, parking it once the streak reaches the ceiling.
 * Returns whether the row is parked as of this refusal.
 *
 * `updatedAt` restarts the streak rather than resuming it when the row was edited after it was
 * parked: an edited row has earned a fresh run of attempts, not the one attempt a resumed streak
 * would give it.
 */
export async function noteApplicationRefused(
  localId: string,
  updatedAt: number,
): Promise<boolean> {
  const at = Date.now();
  const next = await mutateApplicationSyncMap((current) => {
    const existing = current[localId];
    const rearmed =
      existing !== undefined &&
      existing.blockedAt !== null &&
      !isApplicationPushBlocked(existing, updatedAt);
    const refusals = (rearmed ? 0 : (existing?.refusals ?? 0)) + 1;
    return {
      ...current,
      [localId]: {
        remoteClientId: existing?.remoteClientId ?? localId,
        refusals,
        blockedAt: refusals >= APPLICATION_PUSH_MAX_ATTEMPTS ? at : null,
      },
    };
  });
  const record = next[localId];
  return record !== undefined && record.blockedAt !== null;
}

/** Every row the server has permanently refused. This is the state a UI should surface. */
export async function listBlockedApplications(): Promise<BlockedApplication[]> {
  const map = await readApplicationSyncMap();
  const blocked: BlockedApplication[] = [];
  for (const [localId, record] of Object.entries(map)) {
    if (record.blockedAt === null) continue;
    blocked.push({
      localId,
      remoteClientId: record.remoteClientId,
      refusals: record.refusals,
      blockedAt: record.blockedAt,
    });
  }
  return blocked.sort((a, b) => b.blockedAt - a.blockedAt);
}

/** Drop the sync identity of rows that no longer exist locally, so the map cannot grow forever. */
export async function forgetApplicationSyncRecords(localIds: readonly string[]): Promise<void> {
  if (localIds.length === 0) return;
  const current = await readApplicationSyncMap();
  if (!localIds.some((id) => current[id] !== undefined)) return;
  await mutateApplicationSyncMap((map) => {
    const next: ApplicationSyncMap = { ...map };
    for (const id of localIds) delete next[id];
    return next;
  });
}

export async function forgetAllApplicationSyncRecords(): Promise<void> {
  await mutateApplicationSyncMap(() => ({}));
}

/**
 * `id` is the tracker row's LOCAL id; it is resolved to the identity the server holds for that row.
 * Resolution is idempotent — an id that is not a local key (an id the server itself handed us) is
 * passed through — so neither kind of caller can address a row the server has never heard of.
 */
export async function patchApplication(
  id: string,
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
    path: SYNC_ROUTES.jobApplication(await remoteClientIdFor(id)),
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

/** `id` is resolved the same way `patchApplication` resolves it. */
export async function deleteApplication(id: string): Promise<SyncResult<{ deleted: true }>> {
  if (!(await isPaired())) return notPaired();

  const attempt = await send({
    method: 'DELETE',
    path: SYNC_ROUTES.jobApplication(await remoteClientIdFor(id)),
    auth: true,
  });
  if (!attempt.ok) {
    if (attempt.error.code === 'not-found') return ok({ deleted: true });
    return fail(attempt.error);
  }
  return ok({ deleted: true });
}

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
