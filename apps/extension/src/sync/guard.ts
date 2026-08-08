/**
 * sync/guard.ts — the hard allowlist for anything that leaves this device over Phase-2 sync.
 *
 * INV-5: "Extension-vault keys never leave the device (except TLS direct to Google). Never log,
 *         never sync, never send a key to the NextMove API."
 * SEC 7.4 ("What is deliberately absent from the cloud schema"): "No model ever stores an
 *         *extension*-vault key … No `AnswerBank` sync in v1 — answers stay on device. No
 *         plaintext profile columns."
 * F-15:   "API keys and the Answer Bank are **never** synced."
 *
 * Those are product promises. This file is where they become mechanical. `assertSyncSafe` runs on
 * every request body in `sync/client.ts` immediately before `fetch`, and it *throws* rather than
 * filtering — a body we did not intend to send is a bug, and a silently-scrubbed body would hide
 * it. There is no bypass flag and no `force` parameter, on purpose.
 *
 * Three independent passes, cheapest first:
 *   1. Forbidden-key scan  — any property name that belongs to a key record, the Answer Bank, or a
 *                            plaintext profile aborts the request, wherever it is nested.
 *   2. Key-shape scan      — any string value matching a Gemini API key aborts the request.
 *   3. Shape allowlist     — the body must be one of the five @repo/types sync contracts, and every
 *                            single property must appear in that contract's allowlist. Unknown
 *                            field ⇒ throw. This is what makes it an allowlist and not a blocklist.
 *
 * Pass 3 also proves the profile envelope is genuinely sealed: `ciphertext` must carry the
 * `sync/e2e.ts` header, so a plaintext vault can never be posted through the E2E route by mistake.
 */

import {
  jobApplicationPatchSchema,
  jobApplicationRowSchema,
  pairRequestSchema,
  profileBlobEnvelopeSchema,
  siteMappingsPutSchema,
} from '@repo/types/ExtensionTypes';

import { VAULT_IV_BYTES } from '@/shared/constants';
import { E2E_MAGIC, hasSealedHeader, isBase64OfLength } from '@/sync/e2e';

/* ------------------------------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------------------------- */

export type SyncGuardReason =
  /** A Gemini key, its AES envelope, or its rotation ledger appeared in the body (INV-5). */
  | 'key-material'
  /** An Answer Bank record appeared in the body (SEC 7.4 — answers stay on device). */
  | 'answer-bank'
  /** A plaintext profile field appeared in the body (SEC 7.4 — no plaintext profile columns). */
  | 'plaintext-profile'
  /** A property that is not part of the matched @repo/types contract. */
  | 'unknown-field'
  /** The body does not match any known sync contract at all. */
  | 'unclassified'
  /** The profile envelope's ciphertext did not come out of `sync/e2e.ts`. */
  | 'not-sealed'
  /** Nesting deeper than any sync contract can legitimately be — probably a cycle. */
  | 'too-deep'
  /** Dates, Blobs, Maps, functions, class instances — nothing JSON-safe. */
  | 'non-serializable';

export class SyncGuardError extends Error {
  readonly reason: SyncGuardReason;
  /** JSON-path-ish location of the offending value, e.g. `body.mappings[3].profilePath`. */
  readonly path: string;

  constructor(reason: SyncGuardReason, path: string, message: string) {
    super(`${message} (at ${path})`);
    this.name = 'SyncGuardError';
    this.reason = reason;
    this.path = path;
  }
}

export function isSyncGuardError(value: unknown): value is SyncGuardError {
  return value instanceof SyncGuardError;
}

/* ------------------------------------------------------------------------------------------------
 * Pass 1 — forbidden property names
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every one of these is a property name that exists somewhere in `shared/types.ts` on a record
 * that must never be synced. None of them collides with a legal sync body key (see
 * `ALLOWLISTS` below) — that is checked by `tests/unit/sync-guard` and by inspection here.
 */
const FORBIDDEN_KEYS: Readonly<Record<string, SyncGuardReason>> = {
  // GeminiKeyRecord / GeminiKeyPublic / KeyState — INV-5.
  ct: 'key-material',
  iv: 'key-material',
  key: 'key-material',
  keys: 'key-material',
  apiKey: 'key-material',
  api_key: 'key-material',
  geminiKey: 'key-material',
  gemini_key: 'key-material',
  masked: 'key-material',
  last4: 'key-material',
  strikes: 'key-material',
  cooldownUntil: 'key-material',
  daily: 'key-material',
  rpm: 'key-material',
  secret: 'key-material',
  passphrase: 'key-material',
  token: 'key-material',
  tokenCt: 'key-material',
  tokenIv: 'key-material',

  // AnswerRecord / AnswerHit — SEC 7.4: no AnswerBank sync in v1.
  qNorm: 'answer-bank',
  qRaw: 'answer-bank',
  answerBank: 'answer-bank',
  timesUsed: 'answer-bank',
  template: 'answer-bank',
  reusable: 'answer-bank',
  similarity: 'answer-bank',

  // Profile (SEC 7.2) — may only cross the wire inside an E2E envelope.
  profile: 'plaintext-profile',
  profiles: 'plaintext-profile',
  vault: 'plaintext-profile',
  personal: 'plaintext-profile',
  links: 'plaintext-profile',
  work: 'plaintext-profile',
  education: 'plaintext-profile',
  skills: 'plaintext-profile',
  authorization: 'plaintext-profile',
  eeo: 'plaintext-profile',
  compensation: 'plaintext-profile',
  answers: 'plaintext-profile',
  summary: 'plaintext-profile',
  firstName: 'plaintext-profile',
  lastName: 'plaintext-profile',
  email: 'plaintext-profile',
  phone: 'plaintext-profile',
  address: 'plaintext-profile',
  postalCode: 'plaintext-profile',
  visaStatus: 'plaintext-profile',
  needsSponsorship: 'plaintext-profile',
  declineToState: 'plaintext-profile',
  noticePeriodDays: 'plaintext-profile',
  ethnicity: 'plaintext-profile',
  gender: 'plaintext-profile',
  veteran: 'plaintext-profile',
  disability: 'plaintext-profile',
  gpa: 'plaintext-profile',
  resume: 'plaintext-profile',
  resumes: 'plaintext-profile',
  blob: 'plaintext-profile',
};

const FORBIDDEN_MESSAGE: Readonly<Record<SyncGuardReason, string>> = {
  'key-material': 'Refusing to sync key material — extension-vault keys never leave the device (INV-5).',
  'answer-bank': 'Refusing to sync an Answer Bank record — answers stay on device (SEC 7.4).',
  'plaintext-profile':
    'Refusing to sync a plaintext profile field — the vault only crosses the wire E2E-encrypted (SEC 7.4).',
  'unknown-field': 'Property is not part of the matched sync contract.',
  unclassified: 'Body does not match any @repo/types sync contract.',
  'not-sealed': 'Profile ciphertext was not produced by sync/e2e.ts.',
  'too-deep': 'Body is nested deeper than any sync contract allows.',
  'non-serializable': 'Value is not JSON-serializable.',
};

/**
 * Google AI Studio keys are `AIza` + 35 URL-safe characters. The loose `{10,}` tail catches
 * truncated / redacted variants too — anything key-shaped aborts, we do not try to be precise.
 */
export const GEMINI_KEY_PATTERN = /AIza[\w-]{10,}/;

export function isKeyShaped(value: string): boolean {
  return GEMINI_KEY_PATTERN.test(value);
}

/* ------------------------------------------------------------------------------------------------
 * Pass 3 — the shape allowlist
 * ---------------------------------------------------------------------------------------------- */

export const SYNC_BODY_KINDS = [
  'pair-request',
  'profile-envelope',
  'site-mappings',
  'job-application',
  'job-application-patch',
] as const;

export type SyncBodyKind = (typeof SYNC_BODY_KINDS)[number];

/**
 * `true` — a scalar (or array of scalars) leaf that is scanned for key shapes.
 * `'opaque'` — a base64 leaf produced by `sync/e2e.ts`; exempt from the key-shape regex because
 *              AES-GCM output is uniformly random and would otherwise false-positive on `AIza…`
 *              roughly once in 11 000 pushes. Its integrity is proved structurally instead, by
 *              `hasSealedHeader` / `isBase64OfLength` in `assertEnvelopeIsSealed`.
 * object — a nested allowlist; arrays reuse the same node for every element.
 */
type AllowNode = true | 'opaque' | { readonly [key: string]: AllowNode };

const JOB_APPLICATION_FIELDS: Readonly<Record<string, AllowNode>> = {
  company: true,
  role: true,
  url: true,
  ats: true,
  status: true,
  appliedAt: true,
  notes: true,
  fillStats: { filled: true, total: true },
  history: { at: true, to: true },
};

const ALLOWLISTS: Readonly<Record<SyncBodyKind, Readonly<Record<string, AllowNode>>>> = {
  'pair-request': { code: true, deviceName: true },
  'profile-envelope': { ciphertext: 'opaque', nonce: 'opaque', version: true },
  'site-mappings': { mappings: { domain: true, sigHash: true, profilePath: true } },
  'job-application': { clientId: true, ...JOB_APPLICATION_FIELDS },
  'job-application-patch': { ...JOB_APPLICATION_FIELDS },
};

const MAX_DEPTH = 8;

/* ------------------------------------------------------------------------------------------------
 * Walkers
 * ---------------------------------------------------------------------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Pass 1 + 2: recursive scan for forbidden names and key-shaped strings, contract-independent. */
function scanForbidden(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new SyncGuardError('too-deep', path, FORBIDDEN_MESSAGE['too-deep']);
  }
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (isKeyShaped(value)) {
      // INV-5, enforced: a Gemini key never reaches the NextMove API, not even inside a note.
      throw new SyncGuardError('key-material', path, FORBIDDEN_MESSAGE['key-material']);
    }
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value !== 'object') {
    throw new SyncGuardError('non-serializable', path, FORBIDDEN_MESSAGE['non-serializable']);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbidden(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isPlainObject(value)) {
    throw new SyncGuardError('non-serializable', path, FORBIDDEN_MESSAGE['non-serializable']);
  }

  for (const [name, child] of Object.entries(value)) {
    const reason = FORBIDDEN_KEYS[name];
    if (reason !== undefined) {
      throw new SyncGuardError(reason, `${path}.${name}`, FORBIDDEN_MESSAGE[reason]);
    }
    scanForbidden(child, `${path}.${name}`, depth + 1);
  }
}

/** Pass 3: every property must exist in the contract's allowlist. */
function walkAllowlist(value: unknown, node: AllowNode, path: string, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new SyncGuardError('too-deep', path, FORBIDDEN_MESSAGE['too-deep']);
  }
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkAllowlist(item, node, `${path}[${index}]`, depth + 1));
    return;
  }

  if (isPlainObject(value)) {
    if (node === true || node === 'opaque') {
      throw new SyncGuardError(
        'unknown-field',
        path,
        'Nested object where the contract expects a scalar.',
      );
    }
    for (const [name, child] of Object.entries(value)) {
      const childNode = Object.prototype.hasOwnProperty.call(node, name) ? node[name] : undefined;
      if (childNode === undefined) {
        throw new SyncGuardError(
          'unknown-field',
          `${path}.${name}`,
          FORBIDDEN_MESSAGE['unknown-field'],
        );
      }
      walkAllowlist(child, childNode, `${path}.${name}`, depth + 1);
    }
    return;
  }

  if (typeof value === 'object') {
    throw new SyncGuardError('non-serializable', path, FORBIDDEN_MESSAGE['non-serializable']);
  }
  if (node !== true && node !== 'opaque') {
    throw new SyncGuardError('unknown-field', path, 'Scalar where the contract expects an object.');
  }
}

/* ------------------------------------------------------------------------------------------------
 * Classification + the public entry point
 * ---------------------------------------------------------------------------------------------- */

/** Shape-discriminates a body against the five @repo/types sync contracts. `null` ⇒ not one. */
export function classifySyncBody(payload: unknown): SyncBodyKind | null {
  if (!isPlainObject(payload)) return null;
  const has = (name: string): boolean => Object.prototype.hasOwnProperty.call(payload, name);

  if (has('ciphertext') && has('nonce')) return 'profile-envelope';
  if (has('mappings')) return 'site-mappings';
  if (has('code') && has('deviceName')) return 'pair-request';
  if (has('clientId')) return 'job-application';

  // A PATCH body carries only a subset of the row fields and no clientId (it is in the path).
  const patchFields = ALLOWLISTS['job-application-patch'];
  const names = Object.keys(payload);
  if (names.length > 0 && names.every((name) => Object.prototype.hasOwnProperty.call(patchFields, name))) {
    return 'job-application-patch';
  }
  return null;
}

/** Structural proof that a `profile-envelope` really is E2E ciphertext and not a raw vault. */
function assertEnvelopeIsSealed(payload: Record<string, unknown>): void {
  const ciphertext = payload['ciphertext'];
  const nonce = payload['nonce'];

  if (typeof ciphertext !== 'string' || !hasSealedHeader(ciphertext, E2E_MAGIC)) {
    throw new SyncGuardError('not-sealed', 'body.ciphertext', FORBIDDEN_MESSAGE['not-sealed']);
  }
  if (typeof nonce !== 'string' || !isBase64OfLength(nonce, VAULT_IV_BYTES)) {
    throw new SyncGuardError(
      'not-sealed',
      'body.nonce',
      `Envelope nonce must be base64 of exactly ${VAULT_IV_BYTES} bytes.`,
    );
  }
}

/** Zod validation against the shared contract — the same schema the Express controller parses. */
function assertMatchesContract(kind: SyncBodyKind, payload: unknown): void {
  const parsed =
    kind === 'pair-request'
      ? pairRequestSchema.safeParse(payload)
      : kind === 'profile-envelope'
        ? profileBlobEnvelopeSchema.safeParse(payload)
        : kind === 'site-mappings'
          ? siteMappingsPutSchema.safeParse(payload)
          : kind === 'job-application'
            ? jobApplicationRowSchema.safeParse(payload)
            : jobApplicationPatchSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SyncGuardError(
      'unclassified',
      'body',
      `Body failed its @repo/types contract (${kind}): ${parsed.error.message}`,
    );
  }
}

/**
 * The single gate every outbound sync body passes through. Returns the contract it matched so the
 * caller can log/telemeter it; throws `SyncGuardError` for anything else.
 *
 * INV-5 / SEC 7.4 — enforced here, not promised in a doc.
 */
export function assertSyncSafe(payload: unknown): SyncBodyKind {
  if (!isPlainObject(payload)) {
    throw new SyncGuardError('unclassified', 'body', 'Sync bodies must be plain JSON objects.');
  }

  // Pass 1 + 2 — nothing forbidden anywhere in the tree, at any depth.
  scanForbidden(payload, 'body', 0);

  // Pass 3 — must be a known contract, and only its fields.
  const kind = classifySyncBody(payload);
  if (kind === null) {
    throw new SyncGuardError('unclassified', 'body', FORBIDDEN_MESSAGE.unclassified);
  }
  if (kind === 'profile-envelope') assertEnvelopeIsSealed(payload);

  const allowlist = ALLOWLISTS[kind];
  for (const [name, child] of Object.entries(payload)) {
    const node = Object.prototype.hasOwnProperty.call(allowlist, name) ? allowlist[name] : undefined;
    if (node === undefined) {
      throw new SyncGuardError('unknown-field', `body.${name}`, FORBIDDEN_MESSAGE['unknown-field']);
    }
    walkAllowlist(child, node, `body.${name}`, 1);
  }

  assertMatchesContract(kind, payload);
  return kind;
}

/** Non-throwing form for UI previews ("what would we send?"). */
export function checkSyncSafe(
  payload: unknown,
): { safe: true; kind: SyncBodyKind } | { safe: false; error: SyncGuardError } {
  try {
    return { safe: true, kind: assertSyncSafe(payload) };
  } catch (error) {
    if (isSyncGuardError(error)) return { safe: false, error };
    throw error;
  }
}
