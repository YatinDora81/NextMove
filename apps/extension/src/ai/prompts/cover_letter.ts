/**
 * ai/prompts/cover_letter.ts — `cover_letter.v1` (JF-001 Rev 3.0 SEC 5.5).
 *
 * Inputs : profile core · job context · tone · length preset
 * Output : 3-5 paragraph letter, NO placeholder brackets, JSON `{subject?, body}` validated by
 *          `coverLetterOutputSchema` (shared/schema.ts).
 *
 * Runs on `gemini-2.5-flash` (SEC 5.2: "better long-form quality; used where output length and
 * structure matter"). Same humanized style contract as the screening answer, plus the two rules
 * that are specific to letters: no `[Hiring Manager]`-style placeholders, and no letterhead.
 */

import { MAX_JD_CHARS, MAX_RESUME_CHARS, MODEL_FOR_TASK } from '@/shared/constants';
import type { AnswerTone, CoverLetterPreset, JobContext, Profile } from '@/shared/types';

import { BOILERPLATE_OPENERS, BUZZWORDS } from '../humanize';
import {
  INJECTION_NOTICE,
  TONE_GUIDANCE,
  promptSpec,
  renderProfileFacts,
  rules,
  section,
  trustedBlock,
  untrustedBlock,
} from './common';
import type { PromptSpec } from './common';

export const COVER_LETTER_TEMPLATE = 'cover_letter.v1';

export interface CoverLetterLengthPreset {
  minParagraphs: number;
  maxParagraphs: number;
  maxWords: number;
  maxOutputTokens: number;
}

/** SEC 5.5 fixes the letter at 3-5 paragraphs; the preset moves the word budget inside that. */
export const COVER_LETTER_PRESETS: Record<CoverLetterPreset, CoverLetterLengthPreset> = {
  short: { minParagraphs: 3, maxParagraphs: 3, maxWords: 180, maxOutputTokens: 500 },
  standard: { minParagraphs: 3, maxParagraphs: 4, maxWords: 280, maxOutputTokens: 800 },
  detailed: { minParagraphs: 4, maxParagraphs: 5, maxWords: 400, maxOutputTokens: 1100 },
};

export interface CoverLetterInput {
  job: JobContext;
  profile: Profile;
  resumeText?: string;
  tone: AnswerTone;
  preset: CoverLetterPreset;
}

const OUTPUT_CONTRACT = [
  'OUTPUT FORMAT (this is a hard requirement):',
  'Return a single JSON object and nothing else. No markdown, no code fence, no commentary.',
  'Shape: {"subject": string, "body": string}',
  '- "subject" is a one-line email subject, at most 80 characters. Omit the key entirely if the ' +
    'letter is being pasted into a form field rather than sent as an email.',
  '- "body" is the letter itself. Separate paragraphs with a single blank line ("\\n\\n").',
  '- "body" must NOT contain a date line, a postal address, a letterhead, or a signature block ' +
    'beyond a simple closing line with the applicant\'s real name.',
].join('\n');

function coverLetterStyleContract(preset: CoverLetterLengthPreset, tone: AnswerTone): string {
  return rules('LETTER CONTRACT (all requirements, not suggestions):', [
    'Write ' +
      String(preset.minParagraphs) +
      ' to ' +
      String(preset.maxParagraphs) +
      ' paragraphs, at most ' +
      String(preset.maxWords) +
      ' words in total.',
    'First person, as the applicant. Address the reader as "you" or the team by name if the job ' +
      'description names one; otherwise use a neutral greeting such as "Hello," - never "To Whom ' +
      'It May Concern".',
    'NO PLACEHOLDER BRACKETS ANYWHERE. Never write [Company Name], [Your Name], {{role}}, ' +
      '<hiring manager> or any similar token. Every value must be a real value taken from the ' +
      'blocks above, or the sentence must be rewritten so the value is not needed.',
    'Use ONLY facts present in APPLICANT_FACTS or RESUME_TEXT. Never invent an employer, a date, ' +
      'a metric, a degree or a skill. If you cannot support a claim from those blocks, drop it.',
    'Paragraph 1: why this specific role, anchored in one concrete thing from the job description ' +
      'and one concrete thing the applicant has actually done. No throat-clearing.',
    'Middle paragraphs: the strongest one or two pieces of evidence, with specifics - a system, a ' +
      'number, a technology, an outcome.',
    'Final paragraph: a short, plain close. No "I look forward to hearing from you at your ' +
      'earliest convenience".',
    'Never open with any of these: ' +
      BOILERPLATE_OPENERS.map((phrase) => '"' + phrase + '..."').join(', ') +
      '.',
    'Never chain buzzwords. Words like ' + BUZZWORDS.join(', ') + ' may appear at most once each.',
    'Contractions are allowed. Vary sentence length. Do not end with a sentence that summarises ' +
      'the letter.',
    'Tone: ' + TONE_GUIDANCE[tone],
  ]);
}

/** Compile `cover_letter.v1`. */
export function buildCoverLetterPrompt(input: CoverLetterInput): PromptSpec {
  const preset = COVER_LETTER_PRESETS[input.preset];

  const header = [
    input.job.title.trim().length > 0 ? 'Role: ' + input.job.title.trim() : '',
    input.job.company.trim().length > 0 ? 'Company: ' + input.job.company.trim() : '',
  ]
    .filter((value) => value.length > 0)
    .join('\n');

  const prompt = section(
    INJECTION_NOTICE,
    'TASK: write a cover letter for the applicant, for the role described below.',
    untrustedBlock('JOB_HEADER', header, 300),
    untrustedBlock('JOB_DESCRIPTION', input.job.jd, MAX_JD_CHARS),
    trustedBlock(
      'APPLICANT_FACTS',
      renderProfileFacts(input.profile, {
        maxRoles: 5,
        maxBulletsPerRole: 5,
        includeAuthorization: true,
        includeSavedAnswers: true,
      }),
      MAX_RESUME_CHARS,
    ),
    input.resumeText !== undefined && input.resumeText.trim().length > 0
      ? untrustedBlock('RESUME_TEXT', input.resumeText, MAX_RESUME_CHARS)
      : null,
    coverLetterStyleContract(preset, input.tone),
    OUTPUT_CONTRACT,
  );

  return promptSpec({
    template: COVER_LETTER_TEMPLATE,
    prompt,
    temperature: 0.7,
    maxOutputTokens: preset.maxOutputTokens,
    json: true,
    preferredModel: MODEL_FOR_TASK.coverLetter,
  });
}

/**
 * SEC 5.6 "Output fails Zod → one repair prompt". Cheap and narrow on purpose: the model is shown
 * only its own output and the validator's complaint, so the repair cannot drift into a rewrite.
 */
export function buildCoverLetterRepairPrompt(rawOutput: string, problem: string): PromptSpec {
  const prompt = section(
    'The following text was supposed to be a single JSON object of shape {"subject": string, ' +
      '"body": string}, but it failed validation.',
    trustedBlock('INVALID_OUTPUT', rawOutput, 8000),
    'VALIDATOR SAID:\n' + problem,
    rules('REPAIR RULES:', [
      'Return the corrected JSON object and nothing else. No markdown, no code fence, no commentary.',
      'Keep the letter text exactly as it was wherever it was already valid. Do not rewrite prose.',
      'If the text contains placeholder brackets such as [Company Name], remove them by rewriting ' +
        'only the affected sentence so no placeholder remains.',
      'Escape newlines inside the "body" string as \\n so the JSON parses.',
    ]),
  );

  return promptSpec({
    template: COVER_LETTER_TEMPLATE + '#repair',
    prompt,
    temperature: 0,
    maxOutputTokens: 1200,
    json: true,
    preferredModel: MODEL_FOR_TASK.coverLetter,
  });
}
