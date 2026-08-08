/**
 * ai/prompts/resume_extract.ts — `resume_extract.v1` (JF-001 Rev 3.0 SEC 5.5, Flow C).
 *
 * Input  : raw resume text (<= 20k chars), extracted locally by `ai/resume-text.ts`. The blob
 *          itself never leaves IndexedDB; only this text is sent, and only after an explicit
 *          "Build profile with Gemini" click (INV-2, SEC 4.3 Flow C).
 * Output : strict JSON matching `resumeExtractOutputSchema` (= `profileSchema` minus the identity
 *          fields the client assigns). Zod-validated; one repair retry on invalid JSON (SEC 5.6),
 *          then the regex fallback parser in `ai/resume-text.ts` (F-02).
 *
 * The schema below is written out by hand rather than generated, because the model needs the
 * *semantics* of each field ("YYYY-MM", "ISO-3166 alpha-2 when known") far more than it needs a
 * JSON-Schema dump. It is pinned to `shared/schema.ts` by the extraction tests.
 */

import { MAX_RESUME_CHARS, MODEL_FOR_TASK } from '@/shared/constants';

import { INJECTION_NOTICE, promptSpec, rules, section, trustedBlock, untrustedBlock } from './common';
import type { PromptSpec } from './common';

export const RESUME_EXTRACT_TEMPLATE = 'resume_extract.v1';

/**
 * The exact shape `resumeExtractOutputSchema` accepts. Every key is REQUIRED except `summary`;
 * there are no optional objects and no nullable fields other than `work[].end` and
 * `education[].end`. Absent information is the empty string / empty array / `false` / `0` — never
 * `null`, never a guess.
 */
const OUTPUT_SHAPE = `{
  "summary": string,                      // 1-2 sentence professional summary, or "" if the resume has none
  "personal": {
    "firstName": string,
    "lastName": string,
    "email": string,
    "phone": string,
    "address": {
      "line1": string, "line2": string, "city": string, "state": string,
      "postalCode": string,
      "country": string                   // ISO-3166 alpha-2 ("IN", "US") when you are sure, else the name as written, else ""
    }
  },
  "links": {
    "linkedin": string,                   // full URL or ""
    "github": string,
    "portfolio": string,
    "other": string[]                     // any remaining URLs, [] if none
  },
  "work": [
    {
      "title": string,
      "company": string,
      "location": string,
      "start": string,                    // "YYYY-MM"; use "YYYY-01" if only a year is given; "" if truly absent
      "end": string | null,               // "YYYY-MM", or null when this is the current role
      "current": boolean,                 // true only if the resume says so ("Present", "Current")
      "bullets": string[]                 // the achievement lines for this role, verbatim, trimmed
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string,                   // "B.Tech", "BSc", "MBA" - as written
      "field": string,                    // "Computer Science"
      "start": string,                    // "YYYY-MM" or ""
      "end": string | null,
      "gpa": string                       // free text exactly as written: "8.4/10", "3.9", ""
    }
  ],
  "skills": string[],                     // individual skills, de-duplicated, no category headings
  "authorization": {
    "authorizedIn": string[],             // country codes ONLY if the resume states it, else []
    "needsSponsorship": {},               // leave as {} - the resume almost never says this
    "visaStatus": string,                 // "" unless the resume states one
    "willingToRelocate": false,           // false unless the resume explicitly says otherwise
    "remotePreference": "flexible"        // one of: "onsite" | "hybrid" | "remote" | "flexible"
  },
  "eeo": {
    "gender": "", "ethnicity": "", "veteran": "", "disability": "",
    "declineToState": false               // NEVER infer any of these from a name or a photo caption
  },
  "compensation": {
    "expected": { "amount": 0, "currency": "", "period": "year" },  // period: "hour"|"day"|"month"|"year"
    "noticePeriodDays": 0
  },
  "answers": []                           // always [] - this template does not write answers
}`;

export interface ResumeExtractInput {
  /** Locally extracted text. Document-derived => untrusted (SEC 9.2). */
  text: string;
}

/**
 * Compile `resume_extract.v1`.
 *
 * Temperature 0: this is transcription, not writing. `gemini-2.5-flash` per SEC 5.2 because the
 * output is long and structured, and the token budget is raised well above the shipped default for
 * the same reason.
 */
export function buildResumeExtractPrompt(input: ResumeExtractInput): PromptSpec {
  const prompt = section(
    INJECTION_NOTICE,
    'TASK: convert one resume into a structured profile record. You are transcribing, not writing.',
    untrustedBlock('RESUME_TEXT', input.text, MAX_RESUME_CHARS),
    'RETURN EXACTLY THIS JSON SHAPE (comments are explanation only - do not include them):\n' +
      OUTPUT_SHAPE,
    rules('EXTRACTION RULES:', [
      'Return a single JSON object and nothing else. No markdown, no code fence, no commentary.',
      'Every key shown above must be present, including empty ones. Do not add keys that are not ' +
        'shown.',
      'Copy facts; never infer, embellish, expand an acronym, or "improve" a job title. If the ' +
        'resume does not say it, the value is "" (string), [] (array), false (boolean) or 0 (number).',
      'Never invent an email address, a phone number, a URL, a date, a GPA or an employer.',
      'Keep bullet text substantially as written - trim whitespace and leading bullet glyphs only. ' +
        'Do not rewrite, shorten or merge bullets.',
      'Dates: normalise to "YYYY-MM". "Jan 2023" is "2023-01". "2023" alone is "2023-01". A range ' +
        'ending in "Present" or "Current" sets "end": null and "current": true.',
      'Order "work" and "education" newest first.',
      'Split skills on commas, slashes, bullets and newlines. Drop category headings such as ' +
        '"Languages:" and keep only the skills themselves.',
      'Leave the "eeo" block exactly as shown. Never infer gender, ethnicity, veteran or disability ' +
        'status from a name, a photo caption, a school or a country.',
      'If the text is not a resume at all, return the shape with every field empty rather than ' +
        'inventing a person.',
    ]),
  );

  return promptSpec({
    template: RESUME_EXTRACT_TEMPLATE,
    prompt,
    temperature: 0,
    maxOutputTokens: 4096,
    json: true,
    preferredModel: MODEL_FOR_TASK.resumeExtract,
  });
}

/**
 * SEC 5.6: one repair prompt ("fix to valid JSON") before the regex fallback takes over.
 *
 * It deliberately does NOT resend the resume — the repair must fix structure, not re-extract, and
 * re-sending 20k chars for a missing brace would be a poor use of a free-tier request.
 */
export function buildResumeExtractRepairPrompt(rawOutput: string, problem: string): PromptSpec {
  const prompt = section(
    'The following text was supposed to be one JSON object describing a resume, but it failed ' +
      'validation.',
    trustedBlock('INVALID_OUTPUT', rawOutput, 16000),
    'VALIDATOR SAID:\n' + problem,
    'THE REQUIRED SHAPE:\n' + OUTPUT_SHAPE,
    rules('REPAIR RULES:', [
      'Return the corrected JSON object and nothing else. No markdown, no code fence, no commentary.',
      'Preserve every value that was already present and valid. Do not re-extract and do not add ' +
        'facts.',
      'Add any missing key with its empty value: "" for strings, [] for arrays, {} for ' +
        '"needsSponsorship", false for booleans, 0 for numbers.',
      'Remove any key that is not part of the shape.',
      'Fix types: "current" and "willingToRelocate" and "declineToState" are booleans; "amount" ' +
        'and "noticePeriodDays" are numbers; "end" is a string or null, never the word "Present".',
      '"remotePreference" must be one of "onsite", "hybrid", "remote", "flexible". "period" must ' +
        'be one of "hour", "day", "month", "year".',
    ]),
  );

  return promptSpec({
    template: RESUME_EXTRACT_TEMPLATE + '#repair',
    prompt,
    temperature: 0,
    maxOutputTokens: 4096,
    json: true,
    preferredModel: MODEL_FOR_TASK.resumeExtract,
  });
}
