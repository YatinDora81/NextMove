/**
 * ui/diff.ts — the field-by-field accept model behind SEC 4.3 Flow C step 5.
 *
 * "Diff view: user accepts/edits each extracted field → saved to vault."
 *
 * A resume draft is never applied wholesale. Every difference between the current vault and the
 * `resume_extract.v1` output becomes one `DiffEntry` the user can tick or leave alone, and each
 * entry carries its own `apply` so accepting "Skills" cannot accidentally overwrite "Phone".
 *
 * Empty draft values never overwrite a filled vault value: an extraction that missed your phone
 * number must not delete the one you typed in by hand.
 */

import type { EducationEntry, Profile, ProfileDraft, WorkEntry } from '@/shared/types';

export interface DiffEntry {
  id: string;
  /** Human label for the accept row, e.g. "Email" or "Work history". */
  label: string;
  /** Rendered current value ('' when unset). */
  current: string;
  /** Rendered incoming value. */
  next: string;
  changed: boolean;
  /** Returns a new profile with just this entry applied. */
  apply: (profile: Profile) => Profile;
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function describeWork(entry: WorkEntry): string {
  const when = `${entry.start || '?'} – ${entry.current ? 'now' : entry.end || '?'}`;
  const head = [entry.title, entry.company].filter((part) => part !== '').join(' · ');
  const bullets = entry.bullets.filter((bullet) => bullet.trim() !== '');
  return `${head || 'Untitled role'} (${when})${bullets.length > 0 ? `\n  • ${bullets.join('\n  • ')}` : ''}`;
}

function describeEducation(entry: EducationEntry): string {
  const when = `${entry.start || '?'} – ${entry.end || '?'}`;
  const head = [entry.school, entry.degree, entry.field].filter((part) => part !== '').join(' · ');
  return `${head || 'Untitled entry'} (${when})`;
}

/** One scalar string field. Skipped entirely when the draft has nothing to offer. */
function scalar(
  id: string,
  label: string,
  current: string,
  next: string,
  apply: (profile: Profile, value: string) => Profile,
): DiffEntry | null {
  const incoming = text(next);
  if (incoming === '') return null;
  const existing = text(current);
  return {
    id,
    label,
    current: existing,
    next: incoming,
    changed: existing !== incoming,
    apply: (profile) => apply(profile, incoming),
  };
}

/**
 * Build the accept list. Order is the order the user reads it in, which is roughly the order an
 * application form asks for things.
 */
export function buildDiff(profile: Profile, draft: ProfileDraft): DiffEntry[] {
  const entries: Array<DiffEntry | null> = [];

  entries.push(
    scalar('summary', 'Summary', profile.summary ?? '', draft.summary ?? '', (p, value) => ({
      ...p,
      summary: value,
    })),
  );

  const personalFields = [
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
  ] as const;
  for (const [key, label] of personalFields) {
    entries.push(
      scalar(`personal.${key}`, label, profile.personal[key], draft.personal[key], (p, value) => ({
        ...p,
        personal: { ...p.personal, [key]: value },
      })),
    );
  }

  const addressFields = [
    ['line1', 'Address line 1'],
    ['line2', 'Address line 2'],
    ['city', 'City'],
    ['state', 'State / region'],
    ['postalCode', 'Postal code'],
    ['country', 'Country'],
  ] as const;
  for (const [key, label] of addressFields) {
    entries.push(
      scalar(
        `address.${key}`,
        label,
        profile.personal.address[key],
        draft.personal.address[key],
        (p, value) => ({
          ...p,
          personal: { ...p.personal, address: { ...p.personal.address, [key]: value } },
        }),
      ),
    );
  }

  const linkFields = [
    ['linkedin', 'LinkedIn'],
    ['github', 'GitHub'],
    ['portfolio', 'Portfolio'],
  ] as const;
  for (const [key, label] of linkFields) {
    entries.push(
      scalar(`links.${key}`, label, profile.links[key], draft.links[key], (p, value) => ({
        ...p,
        links: { ...p.links, [key]: value },
      })),
    );
  }

  // Skills merge rather than replace — a resume rarely lists everything you would tick on a form.
  const draftSkills = draft.skills.map((skill) => skill.trim()).filter((skill) => skill !== '');
  if (draftSkills.length > 0) {
    const merged = [...profile.skills];
    for (const skill of draftSkills) {
      if (!merged.some((existing) => existing.toLowerCase() === skill.toLowerCase())) {
        merged.push(skill);
      }
    }
    entries.push({
      id: 'skills',
      label: `Skills (${draftSkills.length} found)`,
      current: profile.skills.join(', '),
      next: merged.join(', '),
      changed: merged.length !== profile.skills.length,
      apply: (p) => ({ ...p, skills: merged }),
    });
  }

  if (draft.work.length > 0) {
    const nextWork = draft.work.map((entry) => ({ ...entry, bullets: [...entry.bullets] }));
    entries.push({
      id: 'work',
      label: `Work history (${nextWork.length} ${nextWork.length === 1 ? 'role' : 'roles'})`,
      current: profile.work.map(describeWork).join('\n'),
      next: nextWork.map(describeWork).join('\n'),
      changed: JSON.stringify(profile.work) !== JSON.stringify(nextWork),
      apply: (p) => ({ ...p, work: nextWork }),
    });
  }

  if (draft.education.length > 0) {
    const nextEducation = draft.education.map((entry) => ({ ...entry }));
    entries.push({
      id: 'education',
      label: `Education (${nextEducation.length} ${nextEducation.length === 1 ? 'entry' : 'entries'})`,
      current: profile.education.map(describeEducation).join('\n'),
      next: nextEducation.map(describeEducation).join('\n'),
      changed: JSON.stringify(profile.education) !== JSON.stringify(nextEducation),
      apply: (p) => ({ ...p, education: nextEducation }),
    });
  }

  entries.push(
    scalar(
      'authorization.visaStatus',
      'Visa status',
      profile.authorization.visaStatus,
      draft.authorization.visaStatus,
      (p, value) => ({ ...p, authorization: { ...p.authorization, visaStatus: value } }),
    ),
  );

  const draftAuthorized = draft.authorization.authorizedIn.filter((code) => code.trim() !== '');
  if (draftAuthorized.length > 0) {
    const merged = [...new Set([...profile.authorization.authorizedIn, ...draftAuthorized])];
    entries.push({
      id: 'authorization.authorizedIn',
      label: 'Authorized to work in',
      current: profile.authorization.authorizedIn.join(', '),
      next: merged.join(', '),
      changed: merged.length !== profile.authorization.authorizedIn.length,
      apply: (p) => ({ ...p, authorization: { ...p.authorization, authorizedIn: merged } }),
    });
  }

  if (draft.answers.length > 0) {
    const nextAnswers = draft.answers.map((answer) => ({ ...answer }));
    entries.push({
      id: 'answers',
      label: `Custom questions (${nextAnswers.length})`,
      current: profile.answers.map((answer) => `${answer.q} — ${answer.a}`).join('\n'),
      next: nextAnswers.map((answer) => `${answer.q} — ${answer.a}`).join('\n'),
      changed: JSON.stringify(profile.answers) !== JSON.stringify(nextAnswers),
      apply: (p) => ({ ...p, answers: nextAnswers }),
    });
  }

  return entries.filter((entry): entry is DiffEntry => entry !== null);
}
