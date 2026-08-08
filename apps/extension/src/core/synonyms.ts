/**
 * core/synonyms.ts — the versioned field-alias dictionary.
 *
 * Implements JF-001 Rev 3.0 SEC 6.3:
 *   "Synonym dictionary is a versioned map ProfilePath → string[] shipped in synonyms.ts,
 *    ~40 paths × 5–15 aliases each, extendable via remote config for new languages."
 *
 * Every alias below is a phrasing that a real ATS actually renders — Greenhouse, Lever, Workday,
 * iCIMS, Ashby, SmartRecruiters, Taleo and the long tail of bespoke career pages. Aliases are
 * written in natural form; `FieldMatcher` compares them through `similarity.normalizeText`, so
 * case, punctuation, accents and camel/snake casing are all irrelevant here.
 *
 * ORDERING IS PART OF THE CONTRACT. Paths are declared most-specific first and the matcher breaks
 * score ties by declaration order, so the golden expectation suite is stable across runs. Do not
 * reorder entries casually.
 *
 * F-14: `mergeSynonyms()` folds `remoteConfig.synonyms` on top of this table so a new locale or a
 * newly discovered ATS phrasing can ship as CDN *data* within hours — MV3 forbids remote code, but
 * this is a string table, which is data (SEC 4.4 decision of record).
 */

import type { ProfilePath } from '@/shared/types';

/**
 * Bumped whenever an alias changes meaning. Remote config may only *extend* a dictionary whose
 * major version it recognises; `mergeSynonyms` records the resulting composite version so the
 * options UI can show which table produced a match.
 */
export const SYNONYMS_VERSION = '1.0.0';

/* ------------------------------------------------------------------------------------------------
 * Virtual profile paths
 *
 * A handful of paths below are NOT literal keys of the SEC 7.2 `Profile` object. They are resolved
 * by `matcher.resolveProfileValue()`:
 *   personal.fullName    → `${personal.firstName} ${personal.lastName}`
 *   answers.<slug>       → the best entry in `profile.answers[]` for that canonical question
 * They live here because the matcher has to be able to *name* the thing an ATS is asking for
 * before it can decide whether the vault can answer it.
 * ---------------------------------------------------------------------------------------------- */

/** Canonical question text for each `answers.<slug>` virtual path. */
export const QUESTION_PATHS: Readonly<Record<ProfilePath, string>> = {
  'answers.coverLetter': 'cover letter',
  'answers.whyCompany': 'why do you want to work here',
  'answers.howDidYouHear': 'how did you hear about us',
  'answers.references': 'references',
  'answers.additionalInfo': 'additional information',
};

/* ------------------------------------------------------------------------------------------------
 * The dictionary
 * ---------------------------------------------------------------------------------------------- */

export type SynonymDictionary = Readonly<Record<ProfilePath, readonly string[]>>;

export const SYNONYMS: SynonymDictionary = {
  /* ---- identity ---------------------------------------------------------------------------- */

  'personal.firstName': [
    'first name',
    'firstname',
    'given name',
    'forename',
    'fname',
    'legal first name',
    'applicant first name',
    'candidate first name',
    'preferred name',
    'first',
    'prenom',
    'vorname',
    'nombre',
  ],

  'personal.lastName': [
    'last name',
    'lastname',
    'surname',
    'family name',
    'lname',
    'legal last name',
    'applicant last name',
    'candidate last name',
    'second name',
    'last',
    'nom de famille',
    'nachname',
    'apellido',
  ],

  'personal.fullName': [
    'full name',
    'full legal name',
    'legal name',
    'your name',
    'applicant name',
    'candidate name',
    'name in full',
    'complete name',
    'name as it appears on your id',
    'name',
  ],

  'personal.email': [
    'email address',
    'e mail address',
    'email',
    'e mail',
    'your email',
    'contact email',
    'primary email',
    'personal email',
    'email id',
    'emailaddress',
    'correo electronico',
  ],

  'personal.phone': [
    'phone number',
    'mobile number',
    'cell phone',
    'telephone number',
    'contact number',
    'phone',
    'mobile',
    'cell',
    'telephone',
    'primary phone',
    'daytime phone',
    'contact phone',
    'tel',
    'whatsapp number',
  ],

  /* ---- address ----------------------------------------------------------------------------- */

  'personal.address.line1': [
    'address line 1',
    'street address',
    'address line one',
    'mailing address',
    'home address',
    'current address',
    'residential address',
    'street',
    'addr 1',
    'address 1',
    'address',
  ],

  'personal.address.line2': [
    'address line 2',
    'address line two',
    'apartment suite unit',
    'apt suite',
    'apartment',
    'suite',
    'unit number',
    'addr 2',
    'address 2',
    'floor',
    'building',
  ],

  'personal.address.city': [
    'city',
    'town',
    'city town',
    'city or town',
    'current city',
    'city of residence',
    'locality',
    'municipality',
    'where are you located',
    'location',
    'ville',
    'stadt',
  ],

  'personal.address.state': [
    'state province',
    'state or province',
    'state region',
    'province',
    'state',
    'region',
    'county',
    'prefecture',
    'address level 1',
    'state territory',
  ],

  'personal.address.postalCode': [
    'zip code',
    'postal code',
    'zip postal code',
    'postcode',
    'pin code',
    'pincode',
    'zipcode',
    'zip',
    'postal',
    'post code',
    'code postal',
  ],

  'personal.address.country': [
    'country',
    'country region',
    'country of residence',
    'country or region',
    'current country',
    'country name',
    'nation',
    'pays',
    'land',
    'pais',
  ],

  /* ---- links ------------------------------------------------------------------------------- */

  'links.linkedin': [
    'linkedin profile url',
    'linkedin profile',
    'linkedin url',
    'linkedin link',
    'linkedin',
    'linked in',
    'linkedin com in',
    'li profile',
  ],

  'links.github': [
    'github profile url',
    'github profile',
    'github url',
    'github username',
    'github',
    'git hub',
    'gitlab',
    'source control profile',
  ],

  'links.portfolio': [
    'portfolio url',
    'portfolio website',
    'personal website',
    'portfolio link',
    'website url',
    'portfolio',
    'personal site',
    'homepage',
    'blog url',
    'website',
    'web site',
  ],

  'links.other': [
    'other website',
    'other url',
    'other profile',
    'additional website',
    'additional link',
    'social media profile',
    'twitter handle',
    'twitter',
    'x profile',
    'dribbble',
    'behance',
    'stack overflow',
    'other links',
  ],

  /* ---- current role ------------------------------------------------------------------------ */

  'work[0].title': [
    'current job title',
    'most recent job title',
    'current title',
    'current role',
    'current position',
    'present job title',
    'most recent title',
    'job title',
    'position title',
    'your title',
    'occupation',
    'designation',
    'title',
  ],

  'work[0].company': [
    'current company',
    'current employer',
    'most recent employer',
    'most recent company',
    'present employer',
    'employer name',
    'company name',
    'current organization',
    'organisation name',
    'employer',
    'company',
    'organization',
  ],

  'work[0].location': [
    'work location',
    'job location',
    'employer location',
    'company location',
    'office location',
    'current work location',
  ],

  'work[0].start': [
    'employment start date',
    'job start date',
    'start date',
    'from date',
    'date started',
    'employed from',
    'start month year',
  ],

  'work[0].end': [
    'employment end date',
    'job end date',
    'end date',
    'to date',
    'date ended',
    'employed until',
    'last working day',
  ],

  /* ---- education --------------------------------------------------------------------------- */

  'education[0].school': [
    'school name',
    'university name',
    'college name',
    'name of institution',
    'educational institution',
    'institution',
    'university',
    'college',
    'school',
    'alma mater',
    'academic institution',
  ],

  'education[0].degree': [
    'degree earned',
    'degree type',
    'highest degree',
    'level of education',
    'highest level of education',
    'qualification',
    'degree',
    'diploma',
    'education level',
  ],

  'education[0].field': [
    'field of study',
    'major or field of study',
    'area of study',
    'course of study',
    'specialization',
    'concentration',
    'discipline',
    'major',
    'branch',
    'stream',
    'subject',
  ],

  'education[0].start': [
    'education start date',
    'school start date',
    'enrollment date',
    'attended from',
    'start year',
    'from year',
  ],

  'education[0].end': [
    'graduation date',
    'expected graduation date',
    'date of graduation',
    'year of graduation',
    'education end date',
    'graduation year',
    'completion date',
    'attended to',
    'end year',
    'passing year',
  ],

  'education[0].gpa': [
    'grade point average',
    'cumulative gpa',
    'gpa',
    'cgpa',
    'academic score',
    'aggregate percentage',
    'marks percentage',
    'grade',
    'percentage',
  ],

  /* ---- profile body ------------------------------------------------------------------------ */

  skills: [
    'technical skills',
    'key skills',
    'core competencies',
    'areas of expertise',
    'relevant skills',
    'skill set',
    'tech stack',
    'technologies',
    'proficiencies',
    'tools and technologies',
    'skills',
  ],

  summary: [
    'professional summary',
    'profile summary',
    'personal statement',
    'career objective',
    'about yourself',
    'tell us about yourself',
    'elevator pitch',
    'brief bio',
    'objective',
    'summary',
    'bio',
  ],

  /* ---- work authorization ------------------------------------------------------------------ */

  'authorization.authorizedIn': [
    'are you legally authorized to work',
    'legally authorized to work',
    'authorized to work',
    'work authorization',
    'employment authorization',
    'eligible to work',
    'work eligibility',
    'right to work',
    'legally eligible to work',
    'authorised to work',
    'work permit',
    'do you have the legal right to work',
  ],

  'authorization.needsSponsorship': [
    'will you now or in the future require sponsorship',
    'do you require sponsorship',
    'require visa sponsorship',
    'need sponsorship',
    'visa sponsorship',
    'immigration sponsorship',
    'sponsorship required',
    'sponsorship now or in the future',
    'h1b sponsorship',
    'require employment sponsorship',
    'sponsorship',
  ],

  'authorization.visaStatus': [
    'current visa status',
    'immigration status',
    'visa status',
    'work visa type',
    'visa type',
    'citizenship status',
    'residency status',
    'work permit type',
    'employment eligibility status',
  ],

  'authorization.willingToRelocate': [
    'are you willing to relocate',
    'willing to relocate',
    'open to relocation',
    'would you relocate',
    'willingness to relocate',
    'relocation required',
    'can you relocate',
    'relocate',
    'relocation',
  ],

  'authorization.remotePreference': [
    'work location preference',
    'remote work preference',
    'are you open to remote work',
    'preferred work arrangement',
    'work arrangement',
    'onsite or remote',
    'remote hybrid or onsite',
    'work setup preference',
    'remote preference',
    'work model',
  ],

  /* ---- EEO / voluntary self-identification -------------------------------------------------- */

  'eeo.gender': [
    'gender identity',
    'i identify my gender as',
    'what is your gender',
    'gender',
    'sex',
    'gender optional',
  ],

  'eeo.ethnicity': [
    'race ethnicity',
    'ethnic background',
    'racial identity',
    'hispanic or latino',
    'ethnicity',
    'race',
    'ethnic group',
    'please identify your race',
  ],

  'eeo.veteran': [
    'protected veteran status',
    'are you a protected veteran',
    'veteran status',
    'military service',
    'us veteran status',
    'veteran',
    'military veteran',
  ],

  'eeo.disability': [
    'voluntary self identification of disability',
    'do you have a disability',
    'disability status',
    'please check one of the boxes below disability',
    'disability',
    'differently abled',
    'physically challenged',
  ],

  /* ---- compensation & availability ---------------------------------------------------------- */

  'compensation.expected.amount': [
    'what are your salary expectations',
    'salary expectations',
    'expected salary',
    'desired salary',
    'expected compensation',
    'desired compensation',
    'salary requirements',
    'expected ctc',
    'target salary',
    'compensation expectation',
    'expected pay',
    'desired pay rate',
  ],

  'compensation.expected.currency': [
    'salary currency',
    'compensation currency',
    'preferred currency',
    'currency of expected salary',
    'pay currency',
    'currency',
  ],

  'compensation.expected.period': [
    'salary period',
    'compensation frequency',
    'pay frequency',
    'pay period',
    'salary basis',
    'per year or per hour',
    'rate type',
  ],

  'compensation.noticePeriodDays': [
    'what is your notice period',
    'notice period',
    'how soon can you join',
    'earliest start date',
    'when can you start',
    'availability to start',
    'available start date',
    'joining time',
    'days notice',
    'availability',
  ],

  /* ---- free-text questions (virtual `answers.*` paths) -------------------------------------- */

  'answers.coverLetter': [
    'cover letter',
    'covering letter',
    'letter of interest',
    'motivation letter',
    'cover note',
    'message to the hiring manager',
    'note to hiring team',
    'introduce yourself to the team',
  ],

  'answers.whyCompany': [
    'why do you want to work here',
    'why are you interested in this role',
    'what interests you about this position',
    'why do you want to join us',
    'why this company',
    'why us',
    'what excites you about this opportunity',
  ],

  'answers.howDidYouHear': [
    'how did you hear about us',
    'how did you hear about this position',
    'how did you find this job',
    'where did you hear about this role',
    'how did you learn about this opportunity',
    'referral source',
    'how did you hear about this opening',
    'where did you find this posting',
  ],

  'answers.references': [
    'professional references',
    'reference contact information',
    'may we contact your references',
    'reference name',
    'referee details',
    'references',
    'referees',
  ],

  'answers.additionalInfo': [
    'is there anything else you would like us to know',
    'additional information',
    'anything else you would like to share',
    'other information',
    'additional comments',
    'comments',
  ],
};

/* ------------------------------------------------------------------------------------------------
 * Generic tokens
 * ---------------------------------------------------------------------------------------------- */

/**
 * Single-word aliases so common they would otherwise swallow half the form: "name" would claim
 * `last_name`, "title" would claim `job_title_of_reference`, "source" would claim `utm_source`.
 *
 * The matcher still uses them, but demands an EXACT token-sequence match on the field's
 * name/id/placeholder rather than mere containment, and excludes them from window-based fuzzy
 * matching. See `matcher.ts` — this set is why "Company Name" does not fill with the applicant's
 * full name.
 */
export const GENERIC_ALIAS_TOKENS: ReadonlySet<string> = new Set([
  'name',
  'title',
  'company',
  'organization',
  'employer',
  'address',
  'city',
  'town',
  'state',
  'region',
  'county',
  'country',
  'nation',
  'zip',
  'postal',
  'phone',
  'tel',
  'mobile',
  'cell',
  'email',
  'website',
  'school',
  'college',
  'university',
  'institution',
  'degree',
  'diploma',
  'major',
  'branch',
  'stream',
  'subject',
  'grade',
  'percentage',
  'skills',
  'summary',
  'bio',
  'objective',
  'source',
  'gender',
  'sex',
  'race',
  'ethnicity',
  'veteran',
  'disability',
  'currency',
  'availability',
  'location',
  'building',
  'floor',
  'suite',
  'unit',
  'street',
  'last',
  'first',
  'references',
  'referees',
  'comments',
  'relocate',
  'relocation',
  'sponsorship',
  'twitter',
]);

/* ------------------------------------------------------------------------------------------------
 * Merging (F-14 remote config)
 * ---------------------------------------------------------------------------------------------- */

/** A dictionary plus the provenance the options UI shows next to a match. */
export interface MergedSynonyms {
  dictionary: Record<ProfilePath, string[]>;
  /** `"1.0.0"` for the shipped table, `"1.0.0+remote:2.3.1"` once remote config has been folded in. */
  version: string;
  /** Paths that only exist because of remote config — useful when debugging a bad CDN push. */
  addedPaths: string[];
  /** Aliases contributed by remote config, per path. */
  addedAliases: number;
}

/**
 * Fold remote-config aliases on top of the shipped dictionary (F-14).
 *
 * Rules, in order:
 *   - the shipped aliases always come first, so a remote push can never *demote* a known phrasing;
 *   - duplicates are removed by normalized comparison, not by raw string equality;
 *   - blank / non-string entries are dropped rather than trusted;
 *   - remote may introduce entirely new paths (a locale table, a newly seen ATS phrasing), and
 *     those are reported in `addedPaths` so the UI can say where a match came from.
 *
 * The input is already Zod-checked upstream (`remoteAdapterConfigSchema` in `@repo/types`); this
 * function still defends itself, because a CDN response is an untrusted boundary (SEC 14.2).
 */
export function mergeSynonyms(
  base: SynonymDictionary = SYNONYMS,
  extra?: Readonly<Record<string, readonly string[]>> | null,
  remoteVersion?: string | null,
): MergedSynonyms {
  const dictionary: Record<ProfilePath, string[]> = {};
  for (const [path, aliases] of Object.entries(base)) {
    dictionary[path] = dedupeAliases(aliases);
  }

  const addedPaths: string[] = [];
  let addedAliases = 0;

  if (extra) {
    for (const [path, aliases] of Object.entries(extra)) {
      if (typeof path !== 'string' || path.length === 0) continue;
      if (!Array.isArray(aliases)) continue;

      const existing = dictionary[path];
      if (existing === undefined) {
        const fresh = dedupeAliases(aliases);
        if (fresh.length === 0) continue;
        dictionary[path] = fresh;
        addedPaths.push(path);
        addedAliases += fresh.length;
        continue;
      }

      const seen = new Set(existing.map(aliasKey));
      for (const alias of aliases) {
        if (typeof alias !== 'string') continue;
        const trimmed = alias.trim();
        if (trimmed.length === 0) continue;
        const key = aliasKey(trimmed);
        if (key.length === 0 || seen.has(key)) continue;
        seen.add(key);
        existing.push(trimmed);
        addedAliases++;
      }
    }
  }

  const version =
    extra && remoteVersion ? `${SYNONYMS_VERSION}+remote:${remoteVersion}` : SYNONYMS_VERSION;

  return { dictionary, version, addedPaths, addedAliases };
}

function dedupeAliases(aliases: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    if (typeof alias !== 'string') continue;
    const trimmed = alias.trim();
    if (trimmed.length === 0) continue;
    const key = aliasKey(trimmed);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Cheap normalization used only for de-duplication inside this module. */
function aliasKey(alias: string): string {
  return alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Every path the shipped dictionary knows how to talk about, in declaration order. */
export const SYNONYM_PATHS: readonly ProfilePath[] = Object.keys(SYNONYMS);

/* ------------------------------------------------------------------------------------------------
 * Value dictionaries — used by `matcher.formatValueForField` and the FillEngine's select strategy
 * ---------------------------------------------------------------------------------------------- */

/** Option texts an ATS uses to mean "yes". Ordered by how often they are the literal option. */
export const AFFIRMATIVE_VALUES: readonly string[] = [
  'Yes',
  'Y',
  'True',
  '1',
  'I agree',
  'Agree',
  'Accept',
  'Confirmed',
];

/** Option texts an ATS uses to mean "no". */
export const NEGATIVE_VALUES: readonly string[] = [
  'No',
  'N',
  'False',
  '0',
  'I do not agree',
  'Disagree',
  'Decline',
];

/** EEO "I would rather not say" phrasings (SEC 7.2 `eeo.declineToState`). */
export const DECLINE_VALUES: readonly string[] = [
  'Decline to self identify',
  'I do not wish to answer',
  'Prefer not to say',
  'Prefer not to disclose',
  'Decline to state',
  'I do not wish to disclose',
  'Do not wish to answer',
  'Not specified',
];

/** Display texts for `authorization.remotePreference`. */
export const REMOTE_PREFERENCE_VALUES: Readonly<Record<string, readonly string[]>> = {
  onsite: ['On-site', 'Onsite', 'In office', 'In-person', 'Office'],
  hybrid: ['Hybrid', 'Partially remote', 'Flexible/Hybrid'],
  remote: ['Remote', 'Fully remote', 'Work from home', '100% remote'],
  flexible: ['Flexible', 'No preference', 'Open to any', 'Any'],
};

/** Display texts for `compensation.expected.period`. */
export const COMPENSATION_PERIOD_VALUES: Readonly<Record<string, readonly string[]>> = {
  hour: ['Per hour', 'Hourly', 'Hour'],
  day: ['Per day', 'Daily', 'Day'],
  month: ['Per month', 'Monthly', 'Month'],
  year: ['Per year', 'Annually', 'Annual', 'Yearly', 'Year', 'Per annum'],
};

/* ------------------------------------------------------------------------------------------------
 * ISO-3166 tables
 *
 * SEC 6.4 requires country/state normalization for `<select>` fills: "USA" ≈ "United States" ≈
 * "US". This is the lookup table behind that. It covers the countries that actually appear in
 * job-application dropdowns; anything unknown passes through untouched rather than being guessed at.
 * ---------------------------------------------------------------------------------------------- */

export interface CountryRecord {
  /** ISO-3166-1 alpha-2. */
  code: string;
  /** ISO-3166-1 alpha-3 — some ATS dropdowns are keyed on it. */
  alpha3: string;
  /** The name most dropdowns render. */
  name: string;
  /** Every other spelling worth recognising. */
  aliases: readonly string[];
}

export const COUNTRIES: readonly CountryRecord[] = [
  { code: 'US', alpha3: 'USA', name: 'United States', aliases: ['United States of America', 'USA', 'U.S.', 'U.S.A.', 'America'] },
  { code: 'IN', alpha3: 'IND', name: 'India', aliases: ['Republic of India', 'Bharat'] },
  { code: 'GB', alpha3: 'GBR', name: 'United Kingdom', aliases: ['UK', 'Great Britain', 'England', 'Britain', 'United Kingdom of Great Britain and Northern Ireland'] },
  { code: 'CA', alpha3: 'CAN', name: 'Canada', aliases: [] },
  { code: 'AU', alpha3: 'AUS', name: 'Australia', aliases: [] },
  { code: 'DE', alpha3: 'DEU', name: 'Germany', aliases: ['Deutschland'] },
  { code: 'FR', alpha3: 'FRA', name: 'France', aliases: [] },
  { code: 'NL', alpha3: 'NLD', name: 'Netherlands', aliases: ['The Netherlands', 'Holland'] },
  { code: 'IE', alpha3: 'IRL', name: 'Ireland', aliases: ['Republic of Ireland'] },
  { code: 'ES', alpha3: 'ESP', name: 'Spain', aliases: ['España'] },
  { code: 'IT', alpha3: 'ITA', name: 'Italy', aliases: ['Italia'] },
  { code: 'PT', alpha3: 'PRT', name: 'Portugal', aliases: [] },
  { code: 'PL', alpha3: 'POL', name: 'Poland', aliases: ['Polska'] },
  { code: 'SE', alpha3: 'SWE', name: 'Sweden', aliases: [] },
  { code: 'NO', alpha3: 'NOR', name: 'Norway', aliases: [] },
  { code: 'DK', alpha3: 'DNK', name: 'Denmark', aliases: [] },
  { code: 'FI', alpha3: 'FIN', name: 'Finland', aliases: [] },
  { code: 'CH', alpha3: 'CHE', name: 'Switzerland', aliases: [] },
  { code: 'AT', alpha3: 'AUT', name: 'Austria', aliases: [] },
  { code: 'BE', alpha3: 'BEL', name: 'Belgium', aliases: [] },
  { code: 'CZ', alpha3: 'CZE', name: 'Czechia', aliases: ['Czech Republic'] },
  { code: 'RO', alpha3: 'ROU', name: 'Romania', aliases: [] },
  { code: 'GR', alpha3: 'GRC', name: 'Greece', aliases: [] },
  { code: 'HU', alpha3: 'HUN', name: 'Hungary', aliases: [] },
  { code: 'UA', alpha3: 'UKR', name: 'Ukraine', aliases: [] },
  { code: 'RU', alpha3: 'RUS', name: 'Russia', aliases: ['Russian Federation'] },
  { code: 'TR', alpha3: 'TUR', name: 'Türkiye', aliases: ['Turkey', 'Turkiye'] },
  { code: 'IL', alpha3: 'ISR', name: 'Israel', aliases: [] },
  { code: 'AE', alpha3: 'ARE', name: 'United Arab Emirates', aliases: ['UAE', 'Emirates'] },
  { code: 'SA', alpha3: 'SAU', name: 'Saudi Arabia', aliases: ['KSA'] },
  { code: 'QA', alpha3: 'QAT', name: 'Qatar', aliases: [] },
  { code: 'EG', alpha3: 'EGY', name: 'Egypt', aliases: [] },
  { code: 'ZA', alpha3: 'ZAF', name: 'South Africa', aliases: [] },
  { code: 'NG', alpha3: 'NGA', name: 'Nigeria', aliases: [] },
  { code: 'KE', alpha3: 'KEN', name: 'Kenya', aliases: [] },
  { code: 'GH', alpha3: 'GHA', name: 'Ghana', aliases: [] },
  { code: 'BR', alpha3: 'BRA', name: 'Brazil', aliases: ['Brasil'] },
  { code: 'MX', alpha3: 'MEX', name: 'Mexico', aliases: ['México'] },
  { code: 'AR', alpha3: 'ARG', name: 'Argentina', aliases: [] },
  { code: 'CL', alpha3: 'CHL', name: 'Chile', aliases: [] },
  { code: 'CO', alpha3: 'COL', name: 'Colombia', aliases: [] },
  { code: 'PE', alpha3: 'PER', name: 'Peru', aliases: [] },
  { code: 'CN', alpha3: 'CHN', name: 'China', aliases: ["People's Republic of China", 'PRC'] },
  { code: 'JP', alpha3: 'JPN', name: 'Japan', aliases: [] },
  { code: 'KR', alpha3: 'KOR', name: 'South Korea', aliases: ['Korea, Republic of', 'Republic of Korea', 'Korea'] },
  { code: 'SG', alpha3: 'SGP', name: 'Singapore', aliases: [] },
  { code: 'MY', alpha3: 'MYS', name: 'Malaysia', aliases: [] },
  { code: 'ID', alpha3: 'IDN', name: 'Indonesia', aliases: [] },
  { code: 'TH', alpha3: 'THA', name: 'Thailand', aliases: [] },
  { code: 'VN', alpha3: 'VNM', name: 'Vietnam', aliases: ['Viet Nam'] },
  { code: 'PH', alpha3: 'PHL', name: 'Philippines', aliases: ['The Philippines'] },
  { code: 'HK', alpha3: 'HKG', name: 'Hong Kong', aliases: ['Hong Kong SAR China'] },
  { code: 'TW', alpha3: 'TWN', name: 'Taiwan', aliases: ['Chinese Taipei'] },
  { code: 'PK', alpha3: 'PAK', name: 'Pakistan', aliases: [] },
  { code: 'BD', alpha3: 'BGD', name: 'Bangladesh', aliases: [] },
  { code: 'LK', alpha3: 'LKA', name: 'Sri Lanka', aliases: [] },
  { code: 'NP', alpha3: 'NPL', name: 'Nepal', aliases: [] },
  { code: 'NZ', alpha3: 'NZL', name: 'New Zealand', aliases: [] },
];

export interface SubdivisionRecord {
  /** ISO-3166-1 alpha-2 of the parent country. */
  country: string;
  /** Subdivision code as an ATS dropdown renders it ("CA", "ON", "MH"). */
  code: string;
  name: string;
}

/**
 * US states + DC + Puerto Rico, and Canadian provinces/territories. These are the two dropdowns
 * that actually gate a fill: everywhere else, "state" is a free-text field and passes through.
 */
export const SUBDIVISIONS: readonly SubdivisionRecord[] = [
  { country: 'US', code: 'AL', name: 'Alabama' },
  { country: 'US', code: 'AK', name: 'Alaska' },
  { country: 'US', code: 'AZ', name: 'Arizona' },
  { country: 'US', code: 'AR', name: 'Arkansas' },
  { country: 'US', code: 'CA', name: 'California' },
  { country: 'US', code: 'CO', name: 'Colorado' },
  { country: 'US', code: 'CT', name: 'Connecticut' },
  { country: 'US', code: 'DE', name: 'Delaware' },
  { country: 'US', code: 'DC', name: 'District of Columbia' },
  { country: 'US', code: 'FL', name: 'Florida' },
  { country: 'US', code: 'GA', name: 'Georgia' },
  { country: 'US', code: 'HI', name: 'Hawaii' },
  { country: 'US', code: 'ID', name: 'Idaho' },
  { country: 'US', code: 'IL', name: 'Illinois' },
  { country: 'US', code: 'IN', name: 'Indiana' },
  { country: 'US', code: 'IA', name: 'Iowa' },
  { country: 'US', code: 'KS', name: 'Kansas' },
  { country: 'US', code: 'KY', name: 'Kentucky' },
  { country: 'US', code: 'LA', name: 'Louisiana' },
  { country: 'US', code: 'ME', name: 'Maine' },
  { country: 'US', code: 'MD', name: 'Maryland' },
  { country: 'US', code: 'MA', name: 'Massachusetts' },
  { country: 'US', code: 'MI', name: 'Michigan' },
  { country: 'US', code: 'MN', name: 'Minnesota' },
  { country: 'US', code: 'MS', name: 'Mississippi' },
  { country: 'US', code: 'MO', name: 'Missouri' },
  { country: 'US', code: 'MT', name: 'Montana' },
  { country: 'US', code: 'NE', name: 'Nebraska' },
  { country: 'US', code: 'NV', name: 'Nevada' },
  { country: 'US', code: 'NH', name: 'New Hampshire' },
  { country: 'US', code: 'NJ', name: 'New Jersey' },
  { country: 'US', code: 'NM', name: 'New Mexico' },
  { country: 'US', code: 'NY', name: 'New York' },
  { country: 'US', code: 'NC', name: 'North Carolina' },
  { country: 'US', code: 'ND', name: 'North Dakota' },
  { country: 'US', code: 'OH', name: 'Ohio' },
  { country: 'US', code: 'OK', name: 'Oklahoma' },
  { country: 'US', code: 'OR', name: 'Oregon' },
  { country: 'US', code: 'PA', name: 'Pennsylvania' },
  { country: 'US', code: 'PR', name: 'Puerto Rico' },
  { country: 'US', code: 'RI', name: 'Rhode Island' },
  { country: 'US', code: 'SC', name: 'South Carolina' },
  { country: 'US', code: 'SD', name: 'South Dakota' },
  { country: 'US', code: 'TN', name: 'Tennessee' },
  { country: 'US', code: 'TX', name: 'Texas' },
  { country: 'US', code: 'UT', name: 'Utah' },
  { country: 'US', code: 'VT', name: 'Vermont' },
  { country: 'US', code: 'VA', name: 'Virginia' },
  { country: 'US', code: 'WA', name: 'Washington' },
  { country: 'US', code: 'WV', name: 'West Virginia' },
  { country: 'US', code: 'WI', name: 'Wisconsin' },
  { country: 'US', code: 'WY', name: 'Wyoming' },
  { country: 'CA', code: 'AB', name: 'Alberta' },
  { country: 'CA', code: 'BC', name: 'British Columbia' },
  { country: 'CA', code: 'MB', name: 'Manitoba' },
  { country: 'CA', code: 'NB', name: 'New Brunswick' },
  { country: 'CA', code: 'NL', name: 'Newfoundland and Labrador' },
  { country: 'CA', code: 'NS', name: 'Nova Scotia' },
  { country: 'CA', code: 'NT', name: 'Northwest Territories' },
  { country: 'CA', code: 'NU', name: 'Nunavut' },
  { country: 'CA', code: 'ON', name: 'Ontario' },
  { country: 'CA', code: 'PE', name: 'Prince Edward Island' },
  { country: 'CA', code: 'QC', name: 'Quebec' },
  { country: 'CA', code: 'SK', name: 'Saskatchewan' },
  { country: 'CA', code: 'YT', name: 'Yukon' },
];

/* ---- lazily built indexes ------------------------------------------------------------------- */

function tableKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

let countryIndex: Map<string, CountryRecord> | null = null;

function getCountryIndex(): Map<string, CountryRecord> {
  if (countryIndex !== null) return countryIndex;
  const index = new Map<string, CountryRecord>();
  for (const record of COUNTRIES) {
    for (const key of [record.code, record.alpha3, record.name, ...record.aliases]) {
      const normalized = tableKey(key);
      if (normalized.length > 0 && !index.has(normalized)) index.set(normalized, record);
    }
  }
  countryIndex = index;
  return index;
}

/** Resolve any spelling of a country ("usa", "U.S.A.", "United States of America") to one record. */
export function lookupCountry(value: string): CountryRecord | null {
  if (typeof value !== 'string') return null;
  const key = tableKey(value);
  if (key.length === 0) return null;
  return getCountryIndex().get(key) ?? null;
}

/** Every spelling of a country an ATS dropdown might use, most-likely first. */
export function countryVariants(record: CountryRecord): string[] {
  return [record.name, record.code, record.alpha3, ...record.aliases];
}

let subdivisionIndex: Map<string, SubdivisionRecord[]> | null = null;

function getSubdivisionIndex(): Map<string, SubdivisionRecord[]> {
  if (subdivisionIndex !== null) return subdivisionIndex;
  const index = new Map<string, SubdivisionRecord[]>();
  for (const record of SUBDIVISIONS) {
    for (const key of [record.code, record.name]) {
      const normalized = tableKey(key);
      if (normalized.length === 0) continue;
      const bucket = index.get(normalized);
      if (bucket === undefined) index.set(normalized, [record]);
      else bucket.push(record);
    }
  }
  subdivisionIndex = index;
  return index;
}

/**
 * Resolve a state/province by name or code. `country` disambiguates the codes that collide
 * across our two tables (US-NL does not exist, but CA-NB / US-NE style near-misses do, and
 * "CA" alone is both California and the country Canada — hence the explicit hint).
 */
export function lookupSubdivision(value: string, country?: string): SubdivisionRecord | null {
  if (typeof value !== 'string') return null;
  const key = tableKey(value);
  if (key.length === 0) return null;
  const bucket = getSubdivisionIndex().get(key);
  if (bucket === undefined || bucket.length === 0) return null;
  if (country) {
    const wanted = tableKey(country);
    const scoped = bucket.find((record) => tableKey(record.country) === wanted);
    if (scoped !== undefined) return scoped;
    const resolved = lookupCountry(country);
    if (resolved !== null) {
      const byResolved = bucket.find((record) => record.country === resolved.code);
      if (byResolved !== undefined) return byResolved;
      // The hinted country has no subdivision table — do not silently answer with another country's.
      if (resolved.code !== 'US' && resolved.code !== 'CA') return null;
    }
  }
  return bucket[0] ?? null;
}

/** Every spelling of a subdivision an ATS dropdown might use, most-likely first. */
export function subdivisionVariants(record: SubdivisionRecord): string[] {
  return [record.name, record.code, `${record.country}-${record.code}`];
}
