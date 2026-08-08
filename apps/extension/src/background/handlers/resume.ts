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

export const RESUME_ATTACH_MAX_BYTES = 10 * 1024 * 1024;

const COVER_LETTER_TAGS: ReadonlySet<string> = new Set(['coverletter', 'cover letter']);

const COVER_LETTER_PATHS: ReadonlySet<string> = new Set(['coverletter', 'answers.coverletter']);

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[-_]+/g, '');
}

function isCoverLetterRecord(record: ResumeRecord): boolean {
  return record.tags.some((tag) => COVER_LETTER_TAGS.has(normalizeTag(tag)));
}

export function wantsCoverLetter(path: string | null | undefined): boolean {
  if (typeof path !== 'string') return false;
  return COVER_LETTER_PATHS.has(path.trim().toLowerCase().replace(/[-_]+/g, ''));
}

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

export interface ResumeSelection {
  chosen: ResumeRecord | null;
  how: ResumeChoice;
  alternatives: ResumeRecord[];
}

export function selectResume(
  candidates: readonly ResumeRecord[],
  profileId: string | null,
  coverLetter: boolean,
): ResumeSelection {
  const pool = candidates.filter((record) =>
    coverLetter ? isCoverLetterRecord(record) : !isCoverLetterRecord(record),
  );
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

type ResumeHandlers = Pick<MessageHandlers, 'RESUME_GET'>;

const resumeGet: ResumeHandlers['RESUME_GET'] = async (payload) => {
  const coverLetter = wantsCoverLetter(payload.path);

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
