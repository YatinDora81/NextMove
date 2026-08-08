/**
 * background/handlers/keys.ts — the key manager bus surface (JF-001 Rev 3.0 SEC 5.3 / 5.4 / 5.6).
 *
 * `KEYS_ADD` · `KEYS_TEST` · `KEYS_DELETE` · `KEYS_STATUS`, all driven from Options → AI (and, for
 * `KEYS_STATUS`, from the popup's key-health glance, SEC 4.2).
 *
 * ── INV-5, enforced rather than promised ────────────────────────────────────────────────────────
 * A plaintext key exists in exactly one direction here — INBOUND, on `KEYS_ADD`, for exactly as
 * long as it takes `ai/vault.addKey` to validate it against Google and seal it. This module:
 *   - never logs `payload.key` (and `platform/logger` would redact an `AIza…` string anyway);
 *   - never puts key material in a reply — `GeminiKeyPublic` carries a precomputed mask, and
 *     `PoolSnapshot` carries only `{keyId, status, retryAt}`;
 *   - never persists anything itself: the vault is the only writer of `jf.keys`.
 * There is no "reveal" path, by design (SEC 5.3).
 *
 * ── Why these are NOT gesture-gated ─────────────────────────────────────────────────────────────
 * `GESTURE_REQUIRED` is the closed set of messages that can spend a *generation* (SEC 6.6). Key
 * management is a settings operation reachable only from trusted extension UI, and its one network
 * call — the `models.list` validation ping — is the cheapest request Google exposes and spends no
 * generation quota. INV-2 is about speculative AI traffic; there is none here.
 *
 * SEC 5.2 requires Google's rejection message to be surfaced VERBATIM, because the auth-key
 * migration ("unrestricted legacy keys are already being rejected") means the user usually needs
 * Google's own words to know what to fix.
 */

import { addKey, deleteKey, testKey } from '@/ai/vault';
import { poolStatus } from '@/ai/rotation-store';
import { createLogger } from '@/platform/logger';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';

import { refreshKeyBadge } from '@/background/badge';

const log = createLogger('bg:keys');

type KeyHandlers = Pick<MessageHandlers, 'KEYS_ADD' | 'KEYS_TEST' | 'KEYS_DELETE' | 'KEYS_STATUS'>;

/**
 * SEC 5.3 "Add key": validate against Google FIRST, then encrypt. An invalid key never reaches
 * storage, and the user sees Google's own explanation of why.
 */
const keysAdd: KeyHandlers['KEYS_ADD'] = async (payload) => {
  const label = payload.label.trim();
  if (payload.key.trim().length === 0) {
    return errReply('BAD_REQUEST', 'Paste a key first.');
  }

  // INV-5: `payload.key` is never logged, never echoed, and is dropped the moment `addKey` returns.
  const result = await addKey(payload.key, label);
  if (!result.ok) {
    // SEC 5.2: Google's rejection, verbatim.
    log.warn('a key was rejected during validation');
    return errReply('KEY_INVALID', result.message);
  }

  const status = await poolStatus();
  await refreshKeyBadge();
  log.info(`key "${result.record.label}" added (${result.record.masked})`);
  return okReply({ record: result.record, pool: status.pool });
};

/**
 * Re-run the SEC 5.3 validation ping for one stored key and flip DEAD ↔ ACTIVE.
 *
 * This is the user's escape hatch from the "Key revoked/invalid" row of SEC 5.6: a key that was
 * quarantined because the account was briefly over quota, or because the user had not yet added the
 * "Gemini API only" restriction, comes straight back to ACTIVE once they fix it.
 */
const keysTest: KeyHandlers['KEYS_TEST'] = async (payload) => {
  const result = await testKey(payload.id);
  await refreshKeyBadge();
  return okReply(result);
};

/** SEC 5.3 "Delete is instant and shreds ciphertext" — the shredding lives in `ai/vault`. */
const keysDelete: KeyHandlers['KEYS_DELETE'] = async (payload) => {
  const deleted = await deleteKey(payload.id);
  if (!deleted) {
    return errReply('NOT_FOUND', 'That key is no longer in the vault.');
  }
  await refreshKeyBadge();
  log.info('key deleted and its ciphertext shredded');
  return okReply({ deleted: true as const });
};

/**
 * The pool-health snapshot the popup and Options render (SEC 5.6).
 *
 * Measured against the model that would actually serve the next request, so a `retryAt` countdown
 * means "ready again for the thing you are about to ask for" rather than an abstract number.
 * An empty vault is not an error: `{keys: [], pool: [], model: null}` is the signal to render the
 * ✨ affordances disabled with the "Add a free Gemini key (2 min)" hint.
 */
const keysStatus: KeyHandlers['KEYS_STATUS'] = async (payload) => {
  const status = await poolStatus(payload.model);
  return okReply({ keys: status.keys, pool: status.pool, model: status.model });
};

export const keyHandlers: KeyHandlers = {
  KEYS_ADD: keysAdd,
  KEYS_TEST: keysTest,
  KEYS_DELETE: keysDelete,
  KEYS_STATUS: keysStatus,
};
