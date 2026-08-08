/**
 * ui/completeness.ts — the F-01 "profile completeness meter".
 *
 * A single percentage is useless on its own; what a job seeker needs is *which* missing field will
 * cost them a fill. So the meter is computed as weighted sections, and every unmet check carries
 * the human label the UI shows next to it ("Phone number", "At least one role").
 *
 * The weights are ordered by how often an ATS actually asks for the thing (SEC 7.2 is the field
 * list; the weighting is a product judgement): identity and work history dominate, EEO is worth
 * little because `declineToState` satisfies it outright.
 */

import type { Profile } from '@/shared/types';

export interface CompletenessCheck {
  label: string;
  done: boolean;
}

export interface CompletenessSection {
  id: string;
  label: string;
  /** Contribution to the overall score, in points. All weights sum to 100. */
  weight: number;
  checks: CompletenessCheck[];
  /** 0–1 share of this section's checks that are satisfied. */
  ratio: number;
}

export interface Completeness {
  /** 0–100, rounded. */
  score: number;
  sections: CompletenessSection[];
  /** Labels of every unmet check, ordered by section weight — the "what to do next" list. */
  missing: string[];
}

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function section(
  id: string,
  label: string,
  weight: number,
  checks: CompletenessCheck[],
): CompletenessSection {
  const done = checks.filter((check) => check.done).length;
  return { id, label, weight, checks, ratio: checks.length === 0 ? 1 : done / checks.length };
}

/**
 * Score a profile. `null` scores 0 with every section listed as missing, which is exactly what a
 * brand-new install should see.
 */
export function computeCompleteness(profile: Profile | null): Completeness {
  const p = profile;
  const work = p?.work ?? [];
  const education = p?.education ?? [];
  const firstWork = work[0];
  const firstEducation = education[0];

  const sections: CompletenessSection[] = [
    section('personal', 'Personal details', 22, [
      { label: 'First name', done: filled(p?.personal.firstName) },
      { label: 'Last name', done: filled(p?.personal.lastName) },
      { label: 'Email address', done: filled(p?.personal.email) },
      { label: 'Phone number', done: filled(p?.personal.phone) },
      { label: 'City', done: filled(p?.personal.address.city) },
      { label: 'Country', done: filled(p?.personal.address.country) },
    ]),
    section('address', 'Postal address', 6, [
      { label: 'Street address', done: filled(p?.personal.address.line1) },
      { label: 'State or region', done: filled(p?.personal.address.state) },
      { label: 'Postal code', done: filled(p?.personal.address.postalCode) },
    ]),
    section('links', 'Links', 8, [
      { label: 'LinkedIn URL', done: filled(p?.links.linkedin) },
      {
        label: 'GitHub or portfolio URL',
        done: filled(p?.links.github) || filled(p?.links.portfolio),
      },
    ]),
    section('summary', 'Summary', 7, [
      { label: 'A short summary Gemini can quote from', done: filled(p?.summary) },
    ]),
    section('work', 'Work history', 21, [
      { label: 'At least one role', done: work.length > 0 },
      { label: 'Job title on your latest role', done: filled(firstWork?.title) },
      { label: 'Company on your latest role', done: filled(firstWork?.company) },
      { label: 'Start date on your latest role', done: filled(firstWork?.start) },
      {
        label: 'Bullet points on your latest role (they feed AI answers)',
        done: (firstWork?.bullets ?? []).some((bullet) => filled(bullet)),
      },
    ]),
    section('education', 'Education', 10, [
      { label: 'At least one school', done: education.length > 0 },
      { label: 'Degree', done: filled(firstEducation?.degree) },
      { label: 'Field of study', done: filled(firstEducation?.field) },
    ]),
    section('skills', 'Skills', 9, [
      { label: 'At least three skills', done: (p?.skills ?? []).filter(filled).length >= 3 },
      { label: 'At least eight skills', done: (p?.skills ?? []).filter(filled).length >= 8 },
    ]),
    section('authorization', 'Work authorization', 9, [
      {
        label: 'Countries you are authorized to work in',
        done: (p?.authorization.authorizedIn ?? []).some(filled),
      },
      {
        label: 'Sponsorship answer for at least one country',
        done: Object.keys(p?.authorization.needsSponsorship ?? {}).length > 0,
      },
    ]),
    section('eeo', 'EEO / diversity', 4, [
      {
        label: 'EEO answers (or decline to state)',
        done:
          p?.eeo.declineToState === true ||
          filled(p?.eeo.gender) ||
          filled(p?.eeo.ethnicity) ||
          filled(p?.eeo.veteran) ||
          filled(p?.eeo.disability),
      },
    ]),
    section('compensation', 'Compensation & notice', 4, [
      {
        label: 'Expected compensation',
        done: (p?.compensation.expected.amount ?? 0) > 0 && filled(p?.compensation.expected.currency),
      },
    ]),
  ];

  const total = sections.reduce((sum, s) => sum + s.weight, 0);
  const earned = sections.reduce((sum, s) => sum + s.weight * s.ratio, 0);

  const missing: string[] = [];
  for (const s of [...sections].sort((a, b) => b.weight - a.weight)) {
    for (const check of s.checks) {
      if (!check.done) missing.push(check.label);
    }
  }

  return {
    score: total === 0 ? 0 : Math.round((earned / total) * 100),
    sections,
    missing,
  };
}
