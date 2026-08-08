/**
 * background/handlers/resume.ts — F-05, the service-worker half of "Resume Auto-Attach".
 *
 * JF-001 Rev 3.0:
 *   F-05      "Stored resume blob (IndexedDB) attached to `<input type=file>` via DataTransfer.
 *              Multiple resumes; per-profile default; picker if ambiguous."
 *   SEC 6.4   the `file` row — DataTransfer injection, dropzone `drop` fallback.
 *   SEC 7.1   `resumes` lives in IndexedDB (Dexie `"jobfill"`), because blobs are MBs.
 *   SEC 8.3   10 MB ceiling on a resume file.
 *
 * ── Why this handler has to exist at all ────────────────────────────────────────────────────────
 * `platform/db` is a Dexie handle on `indexedDB`, and `indexedDB` is per-realm. Evaluated inside a
 * content script it resolves to the HOST PAGE's IndexedDB — greenhouse.io's, not ours — so the
 * `resumes` table is not merely empty there, it is a different database belonging to someone else.
 * The service worker is the extension's own realm, so this is the only place the bytes can be read
 * from. `RESUME_GET` is the pipe.
 *
 * ── Why the bytes are base64 ────────────────────────────────────────────────────────────────────
 * `chrome.runtime` messaging serialises with **JSON**, not the structured clone algorithm. A
 * `Blob`, a `File`, an `ArrayBuffer` and a `Uint8Array` all arrive at the far end as `{}` or as an
 * index-keyed object. Base64 is boring, lossless and survives.
 *
 * ── INV-2 ───────────────────────────────────────────────────────────────────────────────────────
 * Deliberately NOT in `GESTURE_REQUIRED`. INV-2 exists to make Gemini spend impossible without a
 * fresh user gesture; this handler reads local IndexedDB, leases no key, and touches no network.
 *
 * ── INV-3 ───────────────────────────────────────────────────────────────────────────────────────
 * Entirely local. Attaching a resume works with the NextMove backend switched off, forever.
 */

import { createLogger } from '@/platform/logger';
import { listResumes } from '@/platform/db';
import { getActiveProfile } from '@/platform/storage';
import { errReply, okReply } from '@/shared/messages';
import type {
  MessageHandlers,
  ResumeAlternative,
  ResumeBytes,
  ResumeChoice,
} from '@/shared/messages';
import type { ResumeRecord } from '@/shared/types';

const log = createLogger('bg:resume');

/**
 * SEC 8.3's resume ceiling ("10 MB cap"), applied here as a transport limit too: a 40 MB blob
 * base64-encodes to ~53 MB of JSON string and would stall the worker before it ever reached the
 * page. Above the cap the caller gets a typed refusal it can show the user, not a hang.
 */
export const RESUME_ATTACH_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Tags that mark a stored file as a cover letter rather than a resume (SEC 6.5's `coverLetter`
 * derived path). Normalised on both sides so `Cover Letter`, `cover-letter` and `cover_letter` are
 * one thing.
 */
const COVER_LETTER_TAGS: ReadonlySet<string> = new Set(['coverletter', 'cover letter']);

/** Profile paths that address a cover-letter file rather than the resume. */
const COVER_LETTER_PATHS: ReadonlySet<string> = new Set(['coverletter', 'answers.coverletter']);

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[-_]+/g, '');
}

function isCoverLetterRecord(record: ResumeRecord): boolean {
  return record.tags.some((tag) => COVER_LETTER_TAGS.has(normalizeTag(tag)));
}

/** Does this profile path address the cover-letter slot? `resume` and everything else do not. */
export function wantsCoverLetter(path: string | null | undefined): boolean {
  if (typeof path !== 'string') return false;
  return COVER_LETTER_PATHS.has(path.trim().toLowerCase().replace(/[-_]+/g, ''));
}

/* ------------------------------------------------------------------------------------------------
 * base64
 * ---------------------------------------------------------------------------------------------- */

/**
 * `btoa` over a binary string. Chunked, because `String.fromCharCode(...bytes)` on a multi-MB array
 * blows the argument-list limit and throws `RangeError: Maximum call stack size exceeded` — which
 * would have made this work for the 4 KB test fixture and fail for every real resume.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32 KiB of arguments per call — comfortably under every engine's limit
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** The inverse, for the content-script side and for tests. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Selection (F-05: per-profile default, picker if ambiguous)
 * ---------------------------------------------------------------------------------------------- */

export interface ResumeSelection {
  chosen: ResumeRecord | null;
  how: ResumeChoice;
  alternatives: ResumeRecord[];
}

/**
 * Pick the file to attach out of everything stored for this profile.
 *
 * `listResumes(profileId)` already returns "this profile's files plus the shared ones", newest
 * first. The order of preference mirrors `platform/db.getDefaultResume` and F-05's wording:
 *
 *   1. a default belonging to THIS profile   — the per-profile default, the strongest signal
 *   2. any default (i.e. a shared default)
 *   3. the most recently added candidate     — reported as `most-recent`, never as a default
 *
 * A tie broken by recency is a guess, so it is labelled as one and the runners-up come back with
 * it. The caller surfaces that; nothing here pretends the user chose.
 */
export function selectResume(
  candidates: readonly ResumeRecord[],
  profileId: string | null,
  coverLetter: boolean,
): ResumeSelection {
  const pool = candidates.filter((record) =>
    coverLetter ? isCoverLetterRecord(record) : !isCoverLetterRecord(record),
  );
  // Newest first. `listResumes` sorts already; re-sorting keeps this function honest in isolation.
  const sorted = [...pool].sort((a, b) => b.addedAt - a.addedAt);
  if (sorted.length === 0) return { chosen: null, how: 'none', alternatives: [] };

  const scopedDefault = sorted.find((r) => r.isDefault && r.profileId === profileId);
  const anyDefault = sorted.find((r) => r.isDefault);
  const chosen = scopedDefault ?? anyDefault ?? sorted[0] ?? null;
  if (chosen === null) return { chosen: null, how: 'none', alternatives: [] };

  const how: ResumeChoice =
    scopedDefault !== undefined || anyDefault !== undefined
      ? 'default'
      : sorted.length === 1
        ? 'only'
        : 'most-recent';

  return {
    chosen,
    how,
    alternatives: how === 'default' || how === 'only' ? [] : sorted.filter((r) => r.id !== chosen.id),
  };
}

function toAlternative(record: ResumeRecord): ResumeAlternative {
  return { id: record.id, name: record.name, addedAt: record.addedAt };
}

/* ------------------------------------------------------------------------------------------------
 * The handler
 * ---------------------------------------------------------------------------------------------- */

type ResumeHandlers = Pick<MessageHandlers, 'RESUME_GET'>;

const resumeGet: ResumeHandlers['RESUME_GET'] = async (payload) => {
  const coverLetter = wantsCoverLetter(payload.path);

  // `profileId: null` ⇒ the active profile, exactly as PROFILE_GET reads it. Resolving it here
  // (rather than passing null through) is what makes the *per-profile* default in F-05 real.
  let profileId = payload.profileId;
  if (profileId === null) {
    const active = await getActiveProfile();
    profileId = active?.id ?? null;
  }

  let stored: ResumeRecord[];
  try {
    stored = await listResumes(profileId);
  } catch (error) {
    log.error('could not read the resumes table', error);
    return errReply('INTERNAL', 'NextMove could not open its local file store.');
  }

  const selection = selectResume(stored, profileId, coverLetter);
  if (selection.chosen === null) {
    // Not an error: "you have not stored a cover letter" is a normal, honest answer. The fill
    // engine turns it into `no-resume` → a skipped field the overlay flags for the human (INV-4).
    return okReply({ resume: null, how: 'none' as const, alternatives: [] });
  }

  const record = selection.chosen;
  const declared = record.blob?.size ?? record.size;
  if (declared > RESUME_ATTACH_MAX_BYTES) {
    log.warn(`refusing to attach "${record.name}": ${String(declared)} bytes exceeds the cap`);
    return errReply(
      'BAD_REQUEST',
      `"${record.name}" is ${(declared / (1024 * 1024)).toFixed(1)} MB. NextMove attaches files up ` +
        `to ${String(RESUME_ATTACH_MAX_BYTES / (1024 * 1024))} MB — most ATS refuse anything larger anyway.`,
    );
  }

  let bytes: string;
  let size: number;
  try {
    const buffer = await record.blob.arrayBuffer();
    const view = new Uint8Array(buffer);
    // Re-check post-read: `size` on the row is metadata and could disagree with the blob.
    if (view.byteLength > RESUME_ATTACH_MAX_BYTES) {
      return errReply('BAD_REQUEST', `"${record.name}" is larger than NextMove can attach.`);
    }
    size = view.byteLength;
    bytes = bytesToBase64(view);
  } catch (error) {
    log.error(`could not read the bytes of resume ${record.id}`, error);
    return errReply('INTERNAL', 'That stored file could not be read back from this device.');
  }

  const resume: ResumeBytes = {
    id: record.id,
    name: record.name,
    mime: record.mime.trim().length > 0 ? record.mime : record.blob.type,
    size,
    bytes,
  };

  log.debug(
    `RESUME_GET → "${record.name}" (${String(size)} bytes, chosen by ${selection.how})`,
  );

  return okReply({
    resume,
    how: selection.how,
    alternatives: selection.alternatives.map(toAlternative),
  });
};

export const resumeHandlers: ResumeHandlers = {
  RESUME_GET: resumeGet,
};
