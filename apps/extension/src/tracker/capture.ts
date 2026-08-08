/**
 * tracker/capture.ts — auto-capture for the Application Tracker (JF-001 Rev 3.0 SEC 6.7, F-12).
 *
 * "How company & role fill themselves." A priority chain, FIRST CONFIDENT SOURCE WINS; both values
 * stay editable on the logged row afterwards:
 *
 *   1. JSON-LD          every `script[type="application/ld+json"]` is parsed looking for a
 *                       schema.org JobPosting (handling `@graph` and arrays) → `title` +
 *                       `hiringOrganization.name`. Most ATS embed this for Google Jobs, which makes
 *                       it the highest-trust source on the page.
 *   2. Adapter capture  the selectors the matched ATS adapter declares in its `capture` block
 *                       (e.g. Workday's `[data-automation-id="jobPostingHeader"]`).
 *   3. Heuristics       `og:title` / `og:site_name` / `document.title`, split on the usual
 *                       separators ("Frontend Engineer – Acme – Lever"), with the ATS brand name
 *                       stripped out; the host name is a last-resort company hint.
 *
 * ── SEC 9.2 · PAGE TEXT IS UNTRUSTED ─────────────────────────────────────────────────────────────
 * Everything here reads `textContent` / attribute values only. No markup is ever assigned back to
 * the DOM, no `innerHTML` is read or written, and `extractJobDescription()` — whose output becomes
 * AI context — is hard-capped at `MAX_JD_CHARS` before it can reach a prompt.
 *
 * ── INV-1 ────────────────────────────────────────────────────────────────────────────────────────
 * Pure reading. This module never clicks, focuses, submits or otherwise touches the page.
 */

import { MAX_JD_CHARS } from '@/shared/constants';
import type { JobContext } from '@/shared/types';

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

export type CaptureSource = 'json-ld' | 'adapter' | 'heuristic' | 'url' | 'none';

export interface CapturedJob {
  company: string;
  role: string;
  /** The highest-trust tier that contributed a value. */
  source: CaptureSource;
  /** 0–1. Both values captured ⇒ the weaker tier's confidence; only one ⇒ heavily discounted. */
  confidence: number;
}

/**
 * The adapter's `capture` block (SEC 6.7 step 2). Structurally compatible with
 * `ResolvedAdapterConfig['capture']`, so a resolved adapter config can be passed straight in.
 */
export interface CaptureSelectors {
  company?: readonly string[];
  role?: readonly string[];
}

export interface JsonLdJobPosting {
  title: string;
  company: string;
  /** Raw `description` from the posting — HTML in practice; flattened before use. */
  description: string;
}

/** Per-tier confidence. JSON-LD is machine-readable and publisher-authored, hence highest. */
export const CAPTURE_CONFIDENCE = {
  jsonLd: 0.95,
  adapter: 0.8,
  ogMeta: 0.6,
  documentTitle: 0.45,
  url: 0.3,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Small DOM/text helpers (textContent only — SEC 9.2)
 * ---------------------------------------------------------------------------------------------- */

const SKIP_TAGS: ReadonlySet<string> = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'SECTION', 'ARTICLE', 'TD', 'TR', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HEADER',
  'FOOTER', 'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD',
  'FORM', 'LABEL', 'LEGEND', 'FIELDSET', 'HR',
]);

function collapse(text: string): string {
  return (text ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}

function tidyBlockText(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = slice.lastIndexOf(' ');
  const body = cut > max * 0.8 ? slice.slice(0, cut) : slice;
  return `${body.trimEnd()} …`;
}

/**
 * Flatten an element's text WITHOUT touching innerHTML and without dragging in `<script>` /
 * `<style>` payloads (which `Node.textContent` would happily include). Block-level boundaries
 * become newlines so a job description stays readable when it reaches a prompt.
 */
export function elementText(root: Node, cap = MAX_JD_CHARS * 2): string {
  const doc: Document | null =
    root.nodeType === 9 ? (root as Document) : (root.ownerDocument ?? null);
  if (doc === null || typeof doc.createTreeWalker !== 'function') return '';

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  let length = 0;
  let current = walker.nextNode();
  while (current !== null && length < cap) {
    const value = (current.nodeValue ?? '').replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim();
    if (value.length > 0) {
      parts.push(value);
      length += value.length + 1;
      const parent = current.parentElement;
      if (parent !== null && BLOCK_TAGS.has(parent.tagName)) parts.push('\n');
    }
    current = walker.nextNode();
  }
  return tidyBlockText(parts.join(' '));
}

function firstText(doc: Document, selectors: readonly string[] | undefined): string {
  if (selectors === undefined) return '';
  for (const selector of selectors) {
    if (typeof selector !== 'string' || selector.trim().length === 0) continue;
    let el: Element | null = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      // A malformed selector shipped in remote config must not break capture (F-14).
      continue;
    }
    if (el === null) continue;
    // <meta> carries its value in `content`; every other element carries it as text (SEC 9.2 —
    // textContent only, never innerHTML). Attributes are a fallback for empty wrapper elements.
    const text =
      el.tagName === 'META'
        ? collapse(el.getAttribute('content') ?? '')
        : collapse(el.textContent ?? '') ||
          collapse(el.getAttribute('data-company') ?? el.getAttribute('title') ?? '');
    if (text.length > 0) return text;
  }
  return '';
}

function meta(doc: Document, ...selectors: string[]): string {
  for (const selector of selectors) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      continue;
    }
    const value = collapse(el?.getAttribute('content') ?? '');
    if (value.length > 0) return value;
  }
  return '';
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.7 step 1 — JSON-LD
 * ---------------------------------------------------------------------------------------------- */

const JSON_LD_MAX_NODES = 400;
const JSON_LD_MAX_DEPTH = 8;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function typeMatchesJobPosting(value: unknown): boolean {
  if (typeof value === 'string') return /jobposting/i.test(value);
  if (Array.isArray(value)) return value.some((entry) => typeMatchesJobPosting(entry));
  return false;
}

function organizationName(value: unknown): string {
  if (typeof value === 'string') return collapse(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = organizationName(entry);
      if (name.length > 0) return name;
    }
    return '';
  }
  const record = asRecord(value);
  if (record === null) return '';
  const name = record.name ?? record.legalName ?? record.alternateName;
  return typeof name === 'string' ? collapse(name) : '';
}

/** Collect every object in an arbitrarily nested JSON-LD payload, honouring `@graph` and arrays. */
function flattenLd(value: unknown, out: Record<string, unknown>[], depth: number): void {
  if (out.length >= JSON_LD_MAX_NODES || depth > JSON_LD_MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const entry of value) flattenLd(entry, out, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  out.push(record);
  const graph = record['@graph'];
  if (graph !== undefined) flattenLd(graph, out, depth + 1);
  const items = record.itemListElement;
  if (items !== undefined) flattenLd(items, out, depth + 1);
  const item = record.item;
  if (item !== undefined) flattenLd(item, out, depth + 1);
  const main = record.mainEntity;
  if (main !== undefined) flattenLd(main, out, depth + 1);
}

/**
 * SEC 6.7 step 1. Every `application/ld+json` block on the page, parsed defensively (a single
 * malformed block on a page must never break capture) and reduced to the JobPosting entries.
 */
export function parseJsonLdJobPostings(doc: Document): JsonLdJobPosting[] {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  const postings: JsonLdJobPosting[] = [];

  for (const script of scripts) {
    // SEC 9.2: textContent only. The block is data; it is never evaluated.
    const source = script.textContent ?? '';
    if (source.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      continue;
    }

    const nodes: Record<string, unknown>[] = [];
    flattenLd(parsed, nodes, 0);

    for (const node of nodes) {
      if (!typeMatchesJobPosting(node['@type'])) continue;
      const rawTitle = node.title ?? node.name;
      const title = typeof rawTitle === 'string' ? collapse(rawTitle) : '';
      const company =
        organizationName(node.hiringOrganization) || organizationName(node.employmentAgency);
      const description = typeof node.description === 'string' ? node.description : '';
      if (title.length === 0 && company.length === 0 && description.length === 0) continue;
      postings.push({ title, company, description });
    }
  }
  return postings;
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.7 step 3 — heuristics
 * ---------------------------------------------------------------------------------------------- */

/**
 * Brand words that show up as a segment of a page title but are never the employer. Stripping them
 * is what turns "Frontend Engineer – Acme – Lever" into ("Acme", "Frontend Engineer").
 */
export const ATS_BRAND_WORDS: readonly string[] = [
  'greenhouse',
  'lever',
  'workday',
  'myworkdayjobs',
  'icims',
  'ashby',
  'ashbyhq',
  'smartrecruiters',
  'taleo',
  'oracle taleo',
  'jobvite',
  'workable',
  'breezyhr',
  'breezy',
  'bamboohr',
  'recruitee',
  'teamtailor',
  'successfactors',
  'jazzhr',
  'rippling',
  'linkedin',
  'indeed',
  'glassdoor',
  'job application',
  'job applications',
  'application form',
  'apply',
  'apply now',
  'careers',
  'career',
  'jobs',
  'job',
  'job board',
  'job openings',
  'current openings',
  'open positions',
  'hiring',
  'we are hiring',
  'join us',
  'home',
];

const ROLE_WORDS: readonly string[] = [
  'engineer', 'developer', 'manager', 'designer', 'analyst', 'intern', 'internship',
  'scientist', 'lead', 'architect', 'director', 'specialist', 'consultant', 'associate',
  'coordinator', 'administrator', 'technician', 'executive', 'officer', 'representative',
  'senior', 'junior', 'staff', 'principal', 'head', 'vp', 'president', 'accountant',
  'recruiter', 'marketer', 'writer', 'researcher', 'operations', 'sales', 'support',
  'product', 'program', 'project', 'full stack', 'fullstack', 'frontend', 'front end',
  'backend', 'back end', 'devops', 'sre', 'qa', 'sdet', 'apprentice', 'trainee', 'nurse',
  'teacher', 'counsel', 'paralegal', 'therapist', 'chef', 'driver', 'clerk',
];

/** Split a page title on the separators publishers actually use, keeping hyphenated words intact. */
export function splitTitleSegments(title: string): string[] {
  return collapse(title)
    .split(/\s*[|·•⋅»]\s*|\s+[–—]\s+|\s+-\s+|\s*:\s+/)
    .map((segment) => collapse(segment))
    .filter((segment) => segment.length > 0);
}

function isBrandSegment(segment: string): boolean {
  const value = segment.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (value.length === 0) return true;
  return ATS_BRAND_WORDS.includes(value);
}

/** Remove ATS/job-board branding segments from a split page title (SEC 6.7 step 3). */
export function stripAtsBrand(segments: readonly string[]): string[] {
  const kept = segments.filter((segment) => !isBrandSegment(segment));
  return kept.length > 0 ? kept : [...segments];
}

function looksLikeRole(segment: string): boolean {
  const value = segment.toLowerCase();
  return ROLE_WORDS.some((word) => value.includes(word));
}

function sameCompany(a: string, b: string): boolean {
  const norm = (v: string): string => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const left = norm(a);
  const right = norm(b);
  if (left.length === 0 || right.length === 0) return false;
  return left === right || left.includes(right) || right.includes(left);
}

const GENERIC_HOST_LABELS: ReadonlySet<string> = new Set([
  'www', 'jobs', 'job', 'careers', 'career', 'apply', 'boards', 'board', 'my', 'hire',
  'hiring', 'talent', 'recruiting', 'people', 'work', 'join', 'app', 'web', 'secure',
]);

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[_+]+/g, '-')
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Last-resort company hint from the URL. Every major ATS puts the employer's slug in the host or
 * the first path segment (`boards.greenhouse.io/acme`, `acme.wd1.myworkdayjobs.com`), which is
 * still a better guess than nothing — but it is scored lowest in the chain.
 */
export function companyFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.').filter((label) => label.length > 0);
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  const firstSegment = segments[0] ?? '';

  const pathSlugHosts = [
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
    'jobs.lever.co',
    'jobs.ashbyhq.com',
    'apply.workable.com',
    'jobs.jobvite.com',
    'careers.smartrecruiters.com',
    'jobs.smartrecruiters.com',
    'boards.eu.greenhouse.io',
  ];
  if (pathSlugHosts.includes(host) && firstSegment.length > 0) {
    return titleCaseSlug(decodeURIComponent(firstSegment));
  }

  if (host.endsWith('myworkdayjobs.com') || host.endsWith('icims.com') || host.endsWith('taleo.net')) {
    const first = labels[0] ?? '';
    if (first.length > 0 && !GENERIC_HOST_LABELS.has(first)) return titleCaseSlug(first);
    if (firstSegment.length > 0) return titleCaseSlug(decodeURIComponent(firstSegment));
    return '';
  }

  // careers.acme.com → "Acme"; acme.com → "Acme".
  for (let i = labels.length - 2; i >= 0; i -= 1) {
    const label = labels[i];
    if (label === undefined) continue;
    if (GENERIC_HOST_LABELS.has(label)) continue;
    return titleCaseSlug(label);
  }
  return '';
}

interface TitleGuess {
  company: string;
  role: string;
}

/**
 * Turn one title line into (company, role). Handles the Greenhouse
 * "Job Application for X at Y" wording, the generic "Role at Company" wording, and the
 * separator-delimited forms, using `og:site_name` as the tiebreak when we have it.
 */
export function parseTitleLine(title: string, siteName: string): TitleGuess {
  const cleaned = collapse(title);
  if (cleaned.length === 0) return { company: '', role: '' };

  const greenhouse = /^job application for\s+(.+?)\s+at\s+(.+)$/i.exec(cleaned);
  if (greenhouse !== null) {
    return { role: collapse(greenhouse[1] ?? ''), company: collapse(greenhouse[2] ?? '') };
  }

  const segments = stripAtsBrand(splitTitleSegments(cleaned));

  if (segments.length === 1) {
    const only = segments[0] ?? '';
    const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(only);
    if (at !== null) {
      return { role: collapse(at[1] ?? ''), company: collapse(at[2] ?? '') };
    }
    return { role: only, company: siteName };
  }

  if (segments.length === 0) return { company: siteName, role: '' };

  // If one segment is the site name, that is the company and the rest is the role.
  if (siteName.length > 0) {
    const index = segments.findIndex((segment) => sameCompany(segment, siteName));
    if (index >= 0) {
      const rest = segments.filter((_segment, i) => i !== index);
      const role = rest.slice().sort((a, b) => b.length - a.length)[0] ?? '';
      return { company: segments[index] ?? siteName, role };
    }
  }

  const first = segments[0] ?? '';
  const last = segments[segments.length - 1] ?? '';
  const middle = segments.length > 2 ? segments.slice(1, -1) : [];

  const firstIsRole = looksLikeRole(first);
  const lastIsRole = looksLikeRole(last);

  if (firstIsRole && !lastIsRole) return { role: first, company: last };
  if (lastIsRole && !firstIsRole) return { role: last, company: first };
  if (middle.length > 0) {
    const roleish = middle.find((segment) => looksLikeRole(segment));
    if (roleish !== undefined) return { role: roleish, company: first };
  }
  // "Role – Company" is by far the most common ordering; fall back to it.
  return { role: first, company: last };
}

function captureFromHeuristics(doc: Document): {
  ogGuess: TitleGuess;
  titleGuess: TitleGuess;
  siteName: string;
} {
  const siteName =
    meta(doc, 'meta[property="og:site_name"]', 'meta[name="og:site_name"]', 'meta[name="application-name"]') ||
    firstText(doc, ['[itemprop="hiringOrganization"] [itemprop="name"]', '[itemprop="hiringOrganization"]']);

  const ogTitle = meta(doc, 'meta[property="og:title"]', 'meta[name="og:title"]', 'meta[name="twitter:title"]');
  const ogGuess = ogTitle.length > 0 ? parseTitleLine(ogTitle, siteName) : { company: '', role: '' };
  const titleGuess = parseTitleLine(doc.title ?? '', siteName);

  // `og:site_name` is the publisher naming itself — a strong company signal when the title split
  // did not produce one. The URL slug is deliberately NOT consulted here: it is its own, lower,
  // tier in the chain so it can never borrow a heuristic tier's confidence.
  if (ogGuess.company.length === 0 && siteName.length > 0) ogGuess.company = siteName;
  if (titleGuess.company.length === 0 && siteName.length > 0) titleGuess.company = siteName;

  return { ogGuess, titleGuess, siteName };
}

/* ------------------------------------------------------------------------------------------------
 * The priority chain (SEC 6.7)
 * ---------------------------------------------------------------------------------------------- */

interface CaptureTier {
  source: CaptureSource;
  confidence: number;
  company: string;
  role: string;
}

/**
 * SEC 6.7 auto-capture. Walks the priority chain and returns the first confident answer, filling
 * any remaining gap from a lower tier. Both values are editable on the logged row afterwards —
 * nothing here is treated as authoritative by the tracker.
 */
export function captureJobContext(
  doc: Document,
  url: string,
  selectors?: CaptureSelectors | null,
): CapturedJob {
  const postings = parseJsonLdJobPostings(doc);
  const posting = postings.find((p) => p.title.length > 0 && p.company.length > 0) ?? postings[0];

  const heuristics = captureFromHeuristics(doc);

  const tiers: CaptureTier[] = [
    {
      source: 'json-ld',
      confidence: CAPTURE_CONFIDENCE.jsonLd,
      company: posting?.company ?? '',
      role: posting?.title ?? '',
    },
    {
      source: 'adapter',
      confidence: CAPTURE_CONFIDENCE.adapter,
      company: firstText(doc, selectors?.company),
      role: firstText(doc, selectors?.role),
    },
    {
      source: 'heuristic',
      confidence: CAPTURE_CONFIDENCE.ogMeta,
      company: heuristics.ogGuess.company,
      role: heuristics.ogGuess.role,
    },
    {
      source: 'heuristic',
      confidence: CAPTURE_CONFIDENCE.documentTitle,
      company: heuristics.titleGuess.company,
      role: heuristics.titleGuess.role,
    },
    {
      source: 'url',
      confidence: CAPTURE_CONFIDENCE.url,
      company: companyFromUrl(url),
      role: '',
    },
  ];

  let company = '';
  let role = '';
  let companyConfidence = 0;
  let roleConfidence = 0;
  let winner = tiers.length;

  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (tier === undefined) continue;
    if (company.length === 0 && tier.company.length > 0) {
      company = tier.company;
      companyConfidence = tier.confidence;
      winner = Math.min(winner, i);
    }
    if (role.length === 0 && tier.role.length > 0) {
      role = tier.role;
      roleConfidence = tier.confidence;
      winner = Math.min(winner, i);
    }
    if (company.length > 0 && role.length > 0) break;
  }

  const winningTier = tiers[winner];
  const source: CaptureSource = winningTier === undefined ? 'none' : winningTier.source;

  let confidence: number;
  if (company.length > 0 && role.length > 0) {
    confidence = Math.min(companyConfidence, roleConfidence);
  } else if (company.length > 0 || role.length > 0) {
    // A half-capture still needs the user's eyes on it before the row is trusted.
    confidence = Math.max(companyConfidence, roleConfidence) * 0.6;
  } else {
    confidence = 0;
  }

  return {
    company,
    role,
    source: company.length === 0 && role.length === 0 ? 'none' : source,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Job description — the text used as AI context
 * ---------------------------------------------------------------------------------------------- */

const JD_SELECTORS: readonly string[] = [
  '[data-automation-id="jobPostingDescription"]',
  '[data-automation-id="jobPostingPage"]',
  '[data-testid="jobDescriptionText"]',
  '[data-qa="job-description"]',
  '[itemprop="description"]',
  '#job_description',
  '#job-description',
  '#jobDescriptionText',
  '.job-description',
  '.jobDescription',
  '.job__description',
  '.posting-description',
  '.opening',
  '#content .job',
  '#content',
  'article',
  'main',
];

const JD_MIN_USEFUL_CHARS = 200;

/**
 * The job-description text handed to the AI layer as context (SEC 5.5 caps it at `MAX_JD_CHARS`
 * before it can reach a prompt; we cap it here too so an oversized JD never sits in memory or in
 * a bus message).
 *
 * SEC 9.2: page text is untrusted. This reads `textContent` only — never `innerHTML` — and skips
 * `<script>`/`<style>` payloads so their contents cannot be smuggled into a prompt. The AI layer
 * additionally wraps this text in a delimited data block with an instruction to ignore any
 * instructions found inside it (prompt-injection hygiene lives in `src/ai/prompts/common.ts`).
 */
export function extractJobDescription(doc: Document, maxChars: number = MAX_JD_CHARS): string {
  const cap = maxChars > 0 ? maxChars : MAX_JD_CHARS;

  // Strict priority order: the FIRST selector that yields a useful amount of text wins. Taking the
  // longest instead would let `main` / `article` (i.e. the whole page, nav and footer included)
  // beat a precise `.job-description` hit.
  let best = '';
  let longest = '';
  for (const selector of JD_SELECTORS) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      continue;
    }
    if (el === null) continue;
    const text = elementText(el, cap * 2);
    if (text.length >= JD_MIN_USEFUL_CHARS) {
      best = text;
      break;
    }
    if (text.length > longest.length) longest = text;
  }
  if (best.length === 0) best = longest;

  if (best.length < JD_MIN_USEFUL_CHARS) {
    // JSON-LD `description` is HTML; flatten it with the same textContent-only discipline.
    const posting = parseJsonLdJobPostings(doc).find((p) => p.description.trim().length > 0);
    if (posting !== undefined) {
      const flattened = flattenHtmlFragment(doc, posting.description);
      if (flattened.length > best.length) best = flattened;
    }
  }

  if (best.length < JD_MIN_USEFUL_CHARS && doc.body !== null) {
    best = elementText(doc.body, cap * 2);
  }

  return truncate(tidyBlockText(best), cap);
}

/**
 * Flatten an HTML string to text without ever inserting it into the live document. `DOMParser`
 * builds an inert document: scripts do not run and subresources are not fetched (SEC 9.2). When it
 * is unavailable we fall back to tag stripping, which is safe because the result is only ever
 * treated as text.
 */
function flattenHtmlFragment(doc: Document, html: string): string {
  const view = doc.defaultView;
  const ParserCtor: typeof DOMParser | undefined =
    view !== null && view !== undefined
      ? (view as unknown as { DOMParser?: typeof DOMParser }).DOMParser
      : typeof DOMParser === 'undefined'
        ? undefined
        : DOMParser;

  if (ParserCtor !== undefined) {
    try {
      const inert = new ParserCtor().parseFromString(html, 'text/html');
      if (inert.body !== null) return elementText(inert.body);
    } catch {
      // fall through to the string fallback
    }
  }

  return tidyBlockText(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'"),
  );
}

/**
 * One call for the content script: the SEC 6.7 capture plus the JD, shaped as the `JobContext`
 * every AI prompt and the tracker both consume.
 */
export function buildJobContext(
  doc: Document,
  url: string,
  selectors?: CaptureSelectors | null,
): JobContext {
  const captured = captureJobContext(doc, url, selectors);
  return {
    title: captured.role,
    company: captured.company,
    jd: extractJobDescription(doc),
    url,
  };
}
