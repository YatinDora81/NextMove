/**
 * ui/profilePaths.ts — the suggestion list for "map this field to…" (F-13).
 *
 * `ProfilePath` is a free-form dot path into the SEC 7.2 vault ("personal.firstName",
 * "work[0].title", "authorization.needsSponsorship.US"), so this list is a convenience, never a
 * constraint: the mappings editor offers it through a `<datalist>` and still accepts anything the
 * user types, because indexed and per-country paths are open-ended by design.
 */

export interface ProfilePathOption {
  path: string;
  label: string;
  group: string;
}

export const PROFILE_PATH_OPTIONS: readonly ProfilePathOption[] = [
  { path: 'summary', label: 'Summary', group: 'Profile' },
  { path: 'skills', label: 'Skills', group: 'Profile' },

  { path: 'personal.firstName', label: 'First name', group: 'Personal' },
  { path: 'personal.lastName', label: 'Last name', group: 'Personal' },
  { path: 'personal.email', label: 'Email', group: 'Personal' },
  { path: 'personal.phone', label: 'Phone', group: 'Personal' },

  { path: 'personal.address.line1', label: 'Address line 1', group: 'Address' },
  { path: 'personal.address.line2', label: 'Address line 2', group: 'Address' },
  { path: 'personal.address.city', label: 'City', group: 'Address' },
  { path: 'personal.address.state', label: 'State / region', group: 'Address' },
  { path: 'personal.address.postalCode', label: 'Postal code', group: 'Address' },
  { path: 'personal.address.country', label: 'Country', group: 'Address' },

  { path: 'links.linkedin', label: 'LinkedIn', group: 'Links' },
  { path: 'links.github', label: 'GitHub', group: 'Links' },
  { path: 'links.portfolio', label: 'Portfolio', group: 'Links' },

  { path: 'work[0].title', label: 'Most recent job title', group: 'Work' },
  { path: 'work[0].company', label: 'Most recent employer', group: 'Work' },
  { path: 'work[0].location', label: 'Most recent location', group: 'Work' },
  { path: 'work[0].start', label: 'Most recent start date', group: 'Work' },
  { path: 'work[0].end', label: 'Most recent end date', group: 'Work' },

  { path: 'education[0].school', label: 'School', group: 'Education' },
  { path: 'education[0].degree', label: 'Degree', group: 'Education' },
  { path: 'education[0].field', label: 'Field of study', group: 'Education' },
  { path: 'education[0].start', label: 'Education start', group: 'Education' },
  { path: 'education[0].end', label: 'Education end', group: 'Education' },
  { path: 'education[0].gpa', label: 'GPA / grade', group: 'Education' },

  { path: 'authorization.visaStatus', label: 'Visa status', group: 'Authorization' },
  { path: 'authorization.willingToRelocate', label: 'Willing to relocate', group: 'Authorization' },
  { path: 'authorization.remotePreference', label: 'Remote preference', group: 'Authorization' },
  { path: 'authorization.authorizedIn', label: 'Authorized to work in', group: 'Authorization' },
  {
    path: 'authorization.needsSponsorship.US',
    label: 'Needs sponsorship (US) — swap the code per country',
    group: 'Authorization',
  },

  { path: 'eeo.gender', label: 'Gender', group: 'EEO' },
  { path: 'eeo.ethnicity', label: 'Ethnicity', group: 'EEO' },
  { path: 'eeo.veteran', label: 'Veteran status', group: 'EEO' },
  { path: 'eeo.disability', label: 'Disability status', group: 'EEO' },

  { path: 'compensation.expected.amount', label: 'Expected amount', group: 'Compensation' },
  { path: 'compensation.expected.currency', label: 'Currency', group: 'Compensation' },
  { path: 'compensation.expected.period', label: 'Period', group: 'Compensation' },
  { path: 'compensation.noticePeriodDays', label: 'Notice period (days)', group: 'Compensation' },
];

const BY_PATH = new Map(PROFILE_PATH_OPTIONS.map((option) => [option.path, option] as const));

/** Human label for a stored path, falling back to the raw path for anything hand-written. */
export function describeProfilePath(path: string): string {
  return BY_PATH.get(path)?.label ?? path;
}
