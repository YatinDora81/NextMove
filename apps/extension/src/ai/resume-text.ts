/**
 * ai/resume-text.ts — resume TEXT → `ProfileDraft`: the F-02 regex fallback parser.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 5.6     "Output fails Zod → one repair prompt → else fallback (regex parser)".
 *   F-02        the regex parser is also the whole story when no key is configured — a user with
 *               no Gemini key still gets a populated profile, just a rougher one (INV-3).
 *
 * ── ZERO DEPENDENCIES, ON PURPOSE ───────────────────────────────────────────────────────────────
 * This module is reachable from `ai/index.ts` and therefore from the MV3 service worker, which is
 * bundled as ONE file (WXT inlines dynamic imports into a classic-script worker). Anything imported
 * from here — statically *or* dynamically — is parsed by Chrome on every worker wake-up.
 *
 * So the PDF/DOCX readers do not live here. They live in `ai/resume-extract.ts`, which only the
 * Options page imports, exactly as SEC 4.3 Flow C describes: extraction is local and happens in the
 * user's own page context, and only the extracted TEXT crosses the bus to the worker. Do not import
 * `./resume-extract` from this file or from `./index.ts`; that would put pdfjs-dist and mammoth
 * straight back into the worker.
 *
 * Everything below is plain string work: no I/O, no network, no DOM, no vendor library.
 */

import { MAX_RESUME_CHARS } from '@/shared/constants';
import type {
  EducationEntry,
  ProfileDraft,
  WorkEntry,
} from '@/shared/types';

/** Collapse the whitespace zoo that PDF text layers produce, without destroying line structure. */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------------------------------------
 * F-02 — the regex fallback parser
 * ---------------------------------------------------------------------------------------------- */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_-]+\/?/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i;
const POSTAL_RE = /\b(?:\d{6}|\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/;
/**
 * Deliberately greedy about grouping punctuation so "(512) 555-0173" survives intact, and
 * deliberately dumb about validity — the digit-count filter at the call site does that job.
 */
const PHONE_RE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,5})[\s.-]?\d{2,5}[\s.-]?\d{2,5}(?:[\s.-]?\d{2,4})?/g;

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

const DATE_TOKEN = String.raw`(?:[A-Za-z]{3,9}\.?\s+)?(?:\d{1,2}[/.-])?(?:19|20)\d{2}`;
const DATE_RANGE_RE = new RegExp(
  String.raw`(${DATE_TOKEN})\s*(?:-|–|—|to|until|through|→)\s*(${DATE_TOKEN}|present|current|now|date)`,
  'i',
);

const BULLET_RE = /^\s*(?:[-*•‣▪●·◦⁃∙>+])\s+/;

const COMPANY_HINT_RE =
  /\b(?:inc\.?|llc|ltd\.?|limited|pvt\.?|private|corp\.?|corporation|gmbh|s\.?a\.?|b\.?v\.?|plc|technologies|technology|systems|solutions|labs|laboratories|software|consulting|services|group|holdings|studios|media|bank|university)\b/i;

const TITLE_HINT_RE =
  /\b(?:engineer|developer|programmer|manager|analyst|designer|intern|internship|consultant|scientist|architect|lead|director|head|founder|co-founder|administrator|specialist|associate|assistant|officer|executive|coordinator|technician|researcher|instructor|teacher|writer|editor|marketer|recruiter|accountant|strategist|president|principal|partner|trainee|apprentice)\b/i;

const DEGREE_RE =
  /\b(?:b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|bachelor(?:'s)?|bs|ba|b\.?a\.?|m\.?\s?tech|m\.?\s?sc|master(?:'s)?|ms|m\.?s\.?|mba|m\.?b\.?a\.?|ph\.?\s?d|doctorate|diploma|associate(?:'s)? degree|high school|secondary|hsc|ssc|12th|10th)\b/i;

const SCHOOL_RE =
  /\b(?:university|college|institute|school|academy|polytechnic|iit|nit|iiit|bits)\b/i;

interface Section {
  key: SectionKey;
  lines: string[];
}

type SectionKey =
  | 'header'
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'other';

const SECTION_PATTERNS: ReadonlyArray<{ key: SectionKey; pattern: RegExp }> = [
  {
    key: 'summary',
    pattern: /^(?:professional\s+)?(?:summary|profile|objective|about(?:\s+me)?|overview)\b/i,
  },
  {
    key: 'experience',
    pattern:
      /^(?:work|professional|employment|relevant|industry)?\s*(?:experience|history|employment)\b/i,
  },
  { key: 'education', pattern: /^education(?:al background)?\b|^academics?\b|^qualifications?\b/i },
  {
    key: 'skills',
    pattern: /^(?:technical\s+|core\s+|key\s+)?(?:skills|competencies|technologies|tech stack)\b/i,
  },
  { key: 'projects', pattern: /^(?:personal\s+|academic\s+|selected\s+)?projects?\b/i },
  {
    key: 'certifications',
    pattern: /^(?:certifications?|licenses?|courses?|awards?|achievements?|publications?)\b/i,
  },
];

/** A heading is a short line, not a bullet, that names a known section. */
function sectionKeyOf(line: string): SectionKey | null {
  const cleaned = line.replace(/[:–—-]+\s*$/, '').trim();
  if (cleaned.length === 0 || cleaned.length > 48) return null;
  if (BULLET_RE.test(line)) return null;
  if (/\d{4}/.test(cleaned) && !/^education/i.test(cleaned)) return null;
  for (const candidate of SECTION_PATTERNS) {
    if (candidate.pattern.test(cleaned)) return candidate.key;
  }
  return null;
}

function splitIntoSections(lines: readonly string[]): Section[] {
  const sections: Section[] = [{ key: 'header', lines: [] }];
  for (const line of lines) {
    const key = sectionKeyOf(line);
    if (key !== null) {
      sections.push({ key, lines: [] });
      continue;
    }
    const current = sections[sections.length - 1];
    if (current !== undefined) current.lines.push(line);
  }
  return sections;
}

function linesOf(sections: readonly Section[], key: SectionKey): string[] {
  const collected: string[] = [];
  for (const sec of sections) {
    if (sec.key === key) collected.push(...sec.lines);
  }
  return collected;
}

/** "Jan 2023" / "01/2023" / "2023" → "2023-01". Returns `''` when nothing usable is present. */
export function toYearMonth(token: string): string {
  const text = token.trim().toLowerCase();
  if (text.length === 0) return '';

  const yearMatch = /(19|20)\d{2}/.exec(text);
  if (yearMatch === null) return '';
  const year = yearMatch[0];

  const monthWord = /([a-z]{3,9})\.?\s*(?:19|20)\d{2}/.exec(text);
  if (monthWord !== null && monthWord[1] !== undefined) {
    const month = MONTHS[monthWord[1]];
    if (month !== undefined) return year + '-' + month;
  }

  const numeric = /(\d{1,2})[/.-](?:19|20)\d{2}/.exec(text);
  if (numeric !== null && numeric[1] !== undefined) {
    const value = Number(numeric[1]);
    if (value >= 1 && value <= 12) return year + '-' + (value < 10 ? '0' : '') + String(value);
  }

  return year + '-01';
}

function isCurrentToken(token: string): boolean {
  return /present|current|now|date/i.test(token);
}

interface ParsedRange {
  start: string;
  end: string | null;
  current: boolean;
  /** The matched substring, so callers can strip it out of a header line. */
  matched: string;
}

function parseDateRange(line: string): ParsedRange | null {
  const match = DATE_RANGE_RE.exec(line);
  if (match === null) return null;
  const startToken = match[1] ?? '';
  const endToken = match[2] ?? '';
  const current = isCurrentToken(endToken);
  return {
    start: toYearMonth(startToken),
    end: current ? null : toYearMonth(endToken),
    current,
    matched: match[0],
  };
}

function cleanFragment(value: string): string {
  return value
    .replace(/^[\s|,;:–—-]+/, '')
    .replace(/[\s|,;:–—-]+$/, '')
    .trim();
}

function splitFragments(line: string): string[] {
  return line
    .split(/\s*(?:\||•|·|–|—|\s-\s|,)\s*/)
    .map(cleanFragment)
    .filter((fragment) => fragment.length > 0);
}

interface RoleHeader {
  title: string;
  company: string;
  location: string;
}

/**
 * Pull a title / company / location out of a role header. Resumes are wildly inconsistent here, so
 * this scores fragments by hint words and only falls back to positional guessing when nothing
 * matches — which is the honest behaviour for a fallback parser (the AI path does this properly).
 */
function parseRoleHeader(text: string): RoleHeader {
  const fragments = splitFragments(text.replace(/\s+at\s+/i, ' | '));
  let title = '';
  let company = '';
  let location = '';

  for (const fragment of fragments) {
    if (location.length === 0 && /^(?:remote|hybrid|on-?site)$/i.test(fragment)) {
      location = fragment;
      continue;
    }
    if (company.length === 0 && COMPANY_HINT_RE.test(fragment)) {
      company = fragment;
      continue;
    }
    if (title.length === 0 && TITLE_HINT_RE.test(fragment)) {
      title = fragment;
      continue;
    }
  }

  const leftovers = fragments.filter(
    (fragment) => fragment !== title && fragment !== company && fragment !== location,
  );

  if (title.length === 0 && leftovers.length > 0) {
    title = leftovers.shift() ?? '';
  }
  if (company.length === 0 && leftovers.length > 0) {
    company = leftovers.shift() ?? '';
  }
  if (location.length === 0 && leftovers.length > 0) {
    const tail = leftovers[leftovers.length - 1];
    const beforeTail = leftovers.length > 1 ? leftovers[leftovers.length - 2] : undefined;
    if (tail !== undefined && /^[A-Za-z .'-]{2,40}$/.test(tail)) {
      // "Austin" + "TX" were split apart by the comma; put the city back on its state.
      location =
        beforeTail !== undefined && /^[A-Z]{2}$|^[A-Z][a-z]+$/.test(tail) && /^[A-Z][A-Za-z .'-]+$/.test(beforeTail)
          ? beforeTail + ', ' + tail
          : tail;
    }
  }

  return { title, company, location };
}

function parseWorkEntries(lines: readonly string[]): WorkEntry[] {
  const entries: WorkEntry[] = [];
  let pending: { header: RoleHeader; range: ParsedRange; bullets: string[] } | null = null;
  /**
   * Non-bullet lines seen since the last bullet. A role header nearly always sits directly above
   * its date line, so the most recent held line is the header candidate; anything older is prose
   * belonging to the entry that is still open.
   */
  let held: string[] = [];

  const drainHeldInto = (target: string[]): void => {
    for (const line of held) target.push(line);
    held = [];
  };

  const flush = (): void => {
    if (pending === null) return;
    const { header, range, bullets } = pending;
    if (header.title.length > 0 || header.company.length > 0 || bullets.length > 0) {
      entries.push({
        title: header.title,
        company: header.company,
        location: header.location,
        start: range.start,
        end: range.end,
        current: range.current,
        bullets,
      });
    }
    pending = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const range = parseDateRange(line);
    if (range !== null) {
      const inline = cleanFragment(line.replace(range.matched, ' '));
      // The header is either on this line next to the dates, or on the line just above it.
      const headerFromAbove = inline.length > 2 ? '' : (held.pop() ?? '');
      if (pending !== null) drainHeldInto(pending.bullets);
      held = [];
      flush();
      pending = {
        header: parseRoleHeader(inline.length > 2 ? inline : headerFromAbove),
        range,
        bullets: [],
      };
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (pending === null) {
        held = [];
        continue;
      }
      drainHeldInto(pending.bullets);
      pending.bullets.push(line.replace(BULLET_RE, '').trim());
      continue;
    }

    if (pending !== null && pending.bullets.length === 0 && held.length === 0) {
      // A continuation of the header (company or title on its own line, before any bullets).
      const extra = parseRoleHeader(line);
      if (pending.header.company.length === 0 && extra.company.length > 0) {
        pending.header.company = extra.company;
        continue;
      }
      if (pending.header.title.length === 0 && extra.title.length > 0) {
        pending.header.title = extra.title;
        continue;
      }
    }

    held.push(line);
    // Only the newest few lines can still be a header; older ones are prose for the open entry.
    while (held.length > 3) {
      const oldest = held.shift();
      if (oldest !== undefined && pending !== null) pending.bullets.push(oldest);
    }
  }

  if (pending !== null) drainHeldInto(pending.bullets);
  flush();
  return entries;
}

function parseEducationEntries(lines: readonly string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  let current: EducationEntry | null = null;

  const flush = (): void => {
    if (current === null) return;
    if (current.school.length > 0 || current.degree.length > 0) entries.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const isSchoolLine = SCHOOL_RE.test(line);
    const degreeMatch = DEGREE_RE.exec(line);

    if (isSchoolLine || (degreeMatch !== null && current === null)) {
      if (current !== null && (isSchoolLine ? current.school.length > 0 : current.degree.length > 0)) {
        flush();
      }
      if (current === null) {
        current = { school: '', degree: '', field: '', start: '', end: null, gpa: '' };
      }
    }

    if (current === null) continue;

    const range = parseDateRange(line);
    if (range !== null) {
      if (current.start.length === 0) current.start = range.start;
      current.end = range.end;
    } else {
      const yearOnly = /\b(19|20)\d{2}\b/.exec(line);
      if (yearOnly !== null && current.end === null && current.start.length === 0) {
        current.end = yearOnly[0] + '-01';
      }
    }

    const gpa = /\b(?:c?gpa|grade|percentage)\b[^0-9]{0,8}([0-9]{1,3}(?:\.[0-9]{1,2})?(?:\s*\/\s*[0-9]{1,3}(?:\.[0-9]{1,2})?)?%?)/i.exec(
      line,
    );
    if (gpa !== null && gpa[1] !== undefined && current.gpa.length === 0) {
      current.gpa = gpa[1].replace(/\s+/g, '');
    }

    if (isSchoolLine && current.school.length === 0) {
      const school = splitFragments(line).find((fragment) => SCHOOL_RE.test(fragment));
      current.school = school ?? cleanFragment(line);
    }

    if (degreeMatch !== null && current.degree.length === 0) {
      current.degree = degreeMatch[0].replace(/\s+/g, ' ').trim();
      const field = /\b(?:in|of)\s+([A-Za-z&,\s]{3,50})/i.exec(line.slice(degreeMatch.index));
      if (field !== null && field[1] !== undefined) {
        current.field = cleanFragment(field[1]).replace(/\s{2,}/g, ' ');
      } else {
        // "BA, Design" / "B.Tech | Computer Science" - the field is simply the next fragment.
        const fragments = splitFragments(line);
        const degreeIndex = fragments.findIndex((fragment) => DEGREE_RE.test(fragment));
        const next = degreeIndex === -1 ? undefined : fragments[degreeIndex + 1];
        if (next !== undefined && /^[A-Za-z][A-Za-z &'-]{2,49}$/.test(next) && !SCHOOL_RE.test(next)) {
          current.field = next;
        }
      }
    }
  }

  flush();
  return entries;
}

function parseSkills(lines: readonly string[]): string[] {
  const skills: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.replace(BULLET_RE, '');
    // Drop a leading category label ("Languages:", "Frameworks —").
    const body = line.replace(/^[A-Za-z /&+#.-]{2,30}\s*[:–—]\s*/, '');
    for (const token of body.split(/[,;|•·/]|\s{2,}/)) {
      const skill = cleanFragment(token).replace(/\.$/, '');
      if (skill.length < 2 || skill.length > 40) continue;
      if (/^\d+$/.test(skill)) continue;
      const key = skill.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
      if (skills.length >= 80) return skills;
    }
  }

  return skills;
}

/** A name line: 2-4 capitalised words, no digits, no punctuation that a name would never have. */
function looksLikeName(line: string): boolean {
  const text = line.trim();
  if (text.length < 3 || text.length > 60) return false;
  if (/[0-9@|/\\]/.test(text)) return false;
  if (/\b(?:resume|curriculum vitae|cv)\b/i.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][A-Za-z'.-]*$/.test(word) || /^[A-Z.]{1,3}$/.test(word));
}

/** Resume headers are often shouted. "JORDAN" -> "Jordan"; "McRae" and "O'Neil" are left alone. */
function titleCase(word: string): string {
  if (word.length < 2 || word !== word.toUpperCase()) return word;
  return word
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_match, prefix: string, letter: string) => prefix + letter.toUpperCase());
}

function firstMatch(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match === null ? '' : match[0];
}

/**
 * F-02 — build a `ProfileDraft` from resume text with no model involved.
 *
 * This is deliberately conservative: it fills what it can prove from the text and leaves
 * everything else empty rather than guessing, exactly like the AI path is instructed to. It never
 * populates the EEO block — inferring gender or ethnicity from a name would be both wrong and
 * unlawful in most of the jurisdictions this ships to.
 */
export function parseProfileFromText(rawText: string): ProfileDraft {
  const text = normalizeExtractedText(rawText).slice(0, MAX_RESUME_CHARS);
  const lines = text.split('\n');
  const sections = splitIntoSections(lines);

  const email = firstMatch(text, EMAIL_RE);
  const linkedin = firstMatch(text, LINKEDIN_RE);
  const github = firstMatch(text, GITHUB_RE);

  const phoneCandidates = text.match(PHONE_RE);
  let phone = '';
  if (phoneCandidates !== null) {
    for (const candidate of phoneCandidates) {
      const digits = candidate.replace(/\D/g, '');
      // 10-15 digits is E.164's real-world range; anything else is a date or an ID.
      if (digits.length >= 10 && digits.length <= 15) {
        phone = candidate.trim();
        break;
      }
    }
  }

  const otherLinks: string[] = [];
  const urls = text.match(URL_RE);
  if (urls !== null) {
    for (const url of urls) {
      const trimmed = url.replace(/[.,;)]+$/, '');
      if (LINKEDIN_RE.test(trimmed) || GITHUB_RE.test(trimmed)) continue;
      if (otherLinks.includes(trimmed)) continue;
      otherLinks.push(trimmed);
      if (otherLinks.length >= 5) break;
    }
  }
  const portfolio = otherLinks.shift() ?? '';

  const headerLines = linesOf(sections, 'header');
  let firstName = '';
  let lastName = '';
  for (const line of headerLines.slice(0, 8)) {
    if (!looksLikeName(line)) continue;
    const words = line.trim().split(/\s+/);
    firstName = titleCase(words[0] ?? '');
    lastName = words.length > 1 ? titleCase(words[words.length - 1] ?? '') : '';
    break;
  }

  // City / State on a header line: "Bengaluru, KA" or "Austin, Texas".
  let city = '';
  let state = '';
  for (const line of headerLines.slice(0, 8)) {
    if (EMAIL_RE.test(line) || /https?:|www\./i.test(line)) continue;
    const match = /^([A-Z][A-Za-z .'-]{1,28}),\s*([A-Z][A-Za-z .'-]{1,28})$/.exec(line.trim());
    if (match !== null) {
      city = match[1] ?? '';
      state = match[2] ?? '';
      break;
    }
  }
  // A postal code, but never one hallucinated out of a phone number or a date.
  let postalCode = '';
  for (const rawLine of headerLines.slice(0, 8)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (EMAIL_RE.test(line) || /https?:|www\.|\+\d/i.test(line)) continue;
    if ((line.match(/\d/g) ?? []).length > 8) continue;
    const found = firstMatch(line, POSTAL_RE);
    if (found.length > 0) {
      postalCode = found;
      break;
    }
  }

  const summaryLines = linesOf(sections, 'summary').filter((line) => line.trim().length > 0);
  let summary = summaryLines.join(' ').trim();
  if (summary.length === 0) {
    // No SUMMARY heading: take the first substantial prose line under the contact block.
    const candidate = headerLines.find(
      (line) => line.trim().split(/\s+/).length >= 12 && !EMAIL_RE.test(line),
    );
    summary = candidate === undefined ? '' : candidate.trim();
  }
  if (summary.length > 600) summary = summary.slice(0, 600).trimEnd();

  const experienceLines = [...linesOf(sections, 'experience'), ...linesOf(sections, 'projects')];
  const work = parseWorkEntries(experienceLines);
  const education = parseEducationEntries(linesOf(sections, 'education'));
  const skills = parseSkills(linesOf(sections, 'skills'));

  return {
    summary,
    personal: {
      firstName,
      lastName,
      email,
      phone,
      address: { line1: '', line2: '', city, state, postalCode, country: '' },
    },
    links: { linkedin, github, portfolio, other: otherLinks },
    work,
    education,
    skills,
    authorization: {
      authorizedIn: [],
      needsSponsorship: {},
      visaStatus: '',
      willingToRelocate: false,
      remotePreference: 'flexible',
    },
    // Never inferred. Ever.
    eeo: { gender: '', ethnicity: '', veteran: '', disability: '', declineToState: false },
    compensation: {
      expected: { amount: 0, currency: '', period: 'year' },
      noticePeriodDays: 0,
    },
    answers: [],
  };
}

/** How much the regex parser actually found — drives the "review these fields" hint in Options. */
export function draftCompleteness(draft: ProfileDraft): number {
  const checks: boolean[] = [
    draft.personal.firstName.length > 0,
    draft.personal.lastName.length > 0,
    draft.personal.email.length > 0,
    draft.personal.phone.length > 0,
    draft.links.linkedin.length > 0 || draft.links.github.length > 0,
    draft.work.length > 0,
    draft.education.length > 0,
    draft.skills.length > 0,
    (draft.summary ?? '').length > 0,
  ];
  const hits = checks.filter(Boolean).length;
  return Math.round((hits / checks.length) * 100);
}
