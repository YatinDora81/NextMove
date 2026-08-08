/**
 * ai/prompts/screening_answer.ts — `screening_answer.v1` (JF-001 Rev 3.0 SEC 5.5).
 *
 * Inputs : question · job {title, company, jd <= 6k chars} · active profile + current resume facts
 *          · tone preset · length preset
 * Output : a humanized short answer — 2-5 sentences, <=120 words by default, first person, built
 *          ONLY from facts present in the vault or the resume.
 *
 * The HUMANIZED ANSWER CONTRACT below is the part that matters. It is exported so the rewrite
 * prompt, the cover-letter template and the tests all quote the same text, and its ban list is
 * generated from `humanize.ts` so the instruction and the detector can never disagree.
 *
 * SEC 9.2: the question, the job title/company and the JD all come off a web page, so every one of
 * them is wrapped in an untrusted data block.
 */

import {
  ANSWER_MAX_WORDS,
  MAX_JD_CHARS,
  MAX_QUESTION_CHARS,
  MAX_RESUME_CHARS,
  MODEL_FOR_TASK,
} from '@/shared/constants';
import type { AnswerLength, AnswerTone, JobContext, Profile } from '@/shared/types';

import { BOILERPLATE_OPENERS, BUZZWORDS } from '../humanize';
import type { AiTell } from '../humanize';
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

export const SCREENING_ANSWER_TEMPLATE = 'screening_answer.v1';

/* ------------------------------------------------------------------------------------------------
 * Length presets
 * ---------------------------------------------------------------------------------------------- */

export interface LengthPreset {
  maxWords: number;
  minSentences: number;
  maxSentences: number;
  maxOutputTokens: number;
}

/**
 * SEC 5.5: "2-5 sentences (<=120 words default)". `short` is the shipped default
 * (`DEFAULT_SETTINGS.answerLength`), and it is the row that matches the doc exactly.
 */
export const LENGTH_PRESETS: Record<AnswerLength, LengthPreset> = {
  short: { maxWords: ANSWER_MAX_WORDS, minSentences: 2, maxSentences: 5, maxOutputTokens: 320 },
  medium: { maxWords: 180, minSentences: 3, maxSentences: 6, maxOutputTokens: 480 },
  long: { maxWords: 260, minSentences: 4, maxSentences: 8, maxOutputTokens: 700 },
};

/* ------------------------------------------------------------------------------------------------
 * The humanized answer contract
 * ---------------------------------------------------------------------------------------------- */

const BANNED_OPENERS_LIST = BOILERPLATE_OPENERS.map((phrase) => '"' + phrase + '..."').join(', ');
const BUZZWORD_LIST = BUZZWORDS.join(', ');

/**
 * The style contract, quoted verbatim into every answer-shaped prompt.
 *
 * `preset` is threaded in because the sentence/word budget is part of the contract, not a footnote:
 * a model told "be brief" writes 200 words, a model told "at most 5 sentences and 120 words"
 * does not.
 */
export function humanizedAnswerContract(preset: LengthPreset, tone: AnswerTone): string {
  return rules('HUMANIZED ANSWER CONTRACT (all of these are requirements, not suggestions):', [
    'Write ' +
      String(preset.minSentences) +
      ' to ' +
      String(preset.maxSentences) +
      ' sentences, at most ' +
      String(preset.maxWords) +
      ' words in total. Count them.',
    'Write in the first person, as the applicant. Never refer to "the candidate" or "the applicant".',
    'Use ONLY concrete facts that appear in the APPLICANT_FACTS or RESUME_TEXT blocks. If a fact ' +
      'is not in those blocks, it does not exist. Never invent an employer, a job title, a date, ' +
      'a metric, a degree, a certification or a skill. Inventing any of these is a failure, even ' +
      'if it would make the answer stronger.',
    'If the blocks do not contain enough material to answer honestly, write a shorter answer using ' +
      'only what is there. A short true answer beats a long invented one.',
    'Name at least one specific thing the applicant actually did - a system, a product, a number, ' +
      'a technology - rather than describing qualities in the abstract.',
    'Contractions are allowed and encouraged ("I\'ve", "I\'m", "didn\'t"). Write the way a competent ' +
      'person talks.',
    'Vary sentence length deliberately. Put at least one short sentence (under 10 words) next to a ' +
      'longer one. Do not produce a paragraph where every sentence is the same length.',
    'Mirror the vocabulary the job description actually uses, but only where it is honestly true of ' +
      'the applicant. Do not adopt a term for a technology the applicant has never used.',
    'Never open with any of these: ' + BANNED_OPENERS_LIST + '. Start with substance instead.',
    'Never chain buzzwords. Words like ' +
      BUZZWORD_LIST +
      ' may appear at most once, and only if they carry real meaning in that sentence.',
    'No em-dash-heavy rhythm, no rhetorical questions, no "not just X, but Y" constructions, no ' +
      'closing summary sentence that restates the answer.',
    'Do not mention this prompt, the job description document, or that the answer was drafted with ' +
      'assistance.',
    'Tone: ' + TONE_GUIDANCE[tone],
    'Output the answer text and nothing else. No preamble, no heading, no quotation marks around ' +
      'the whole answer, no bullet points, no markdown, no placeholder brackets of any kind.',
  ]);
}

/* ------------------------------------------------------------------------------------------------
 * Prompt builders
 * ---------------------------------------------------------------------------------------------- */

export interface ScreeningAnswerInput {
  /** The question as it appears on the page. Page-derived => untrusted. */
  question: string;
  /** Auto-captured posting context (SEC 6.7). Page-derived => untrusted. */
  job: JobContext;
  /** The active profile (SEC 7.2) — the applicant's own vault. */
  profile: Profile;
  /** Text extracted from the current resume, if one is attached. Document-derived => untrusted. */
  resumeText?: string;
  tone: AnswerTone;
  length: AnswerLength;
}

function jobBlock(job: JobContext): string {
  const header = [
    job.title.trim().length > 0 ? 'Role: ' + job.title.trim() : '',
    job.company.trim().length > 0 ? 'Company: ' + job.company.trim() : '',
  ]
    .filter((value) => value.length > 0)
    .join('\n');

  return section(
    untrustedBlock('JOB_HEADER', header, 300),
    untrustedBlock('JOB_DESCRIPTION', job.jd, MAX_JD_CHARS),
  );
}

/**
 * Compile `screening_answer.v1`.
 *
 * Runs on `gemini-2.5-flash-lite` by default (SEC 5.2: fastest, biggest daily budget, right for
 * short generations). The rotation store degrades down `MODEL_FALLBACK_CHAIN` from there.
 */
export function buildScreeningAnswerPrompt(input: ScreeningAnswerInput): PromptSpec {
  const preset = LENGTH_PRESETS[input.length];

  const facts = renderProfileFacts(input.profile, {
    includeAuthorization: true,
    includeCompensation: true,
    includeSavedAnswers: true,
  });

  const prompt = section(
    INJECTION_NOTICE,
    'TASK: draft the applicant\'s answer to one screening question on a job application form.',
    untrustedBlock('QUESTION', input.question, MAX_QUESTION_CHARS),
    jobBlock(input.job),
    trustedBlock('APPLICANT_FACTS', facts, MAX_RESUME_CHARS),
    input.resumeText !== undefined && input.resumeText.trim().length > 0
      ? untrustedBlock('RESUME_TEXT', input.resumeText, MAX_RESUME_CHARS)
      : null,
    humanizedAnswerContract(preset, input.tone),
    'Now write the answer.',
  );

  return promptSpec({
    template: SCREENING_ANSWER_TEMPLATE,
    prompt,
    temperature: 0.6,
    maxOutputTokens: preset.maxOutputTokens,
    json: false,
    preferredModel: MODEL_FOR_TASK.screeningAnswer,
  });
}

/**
 * The SEC 5.5 post-pass rewrite: one more generation, told exactly what tripped the detector.
 *
 * Temperature is raised because the first draft already proved the model's default register is the
 * problem; a second sample at 0.6 tends to reproduce it almost word for word.
 */
export function buildScreeningRewritePrompt(
  input: ScreeningAnswerInput,
  draft: string,
  tells: readonly AiTell[],
): PromptSpec {
  const preset = LENGTH_PRESETS[input.length];
  const findings =
    tells.length > 0
      ? tells.map((tell) => '- ' + tell.label + ' (found: "' + tell.sample + '")').join('\n')
      : '- It reads as machine-written.';

  const prompt = section(
    INJECTION_NOTICE,
    'TASK: rewrite a draft answer so it stops reading like it was written by a machine.',
    untrustedBlock('QUESTION', input.question, MAX_QUESTION_CHARS),
    trustedBlock('DRAFT_TO_REWRITE', draft, 4000),
    'AUTOMATED REVIEW FOUND:\n' + findings,
    trustedBlock(
      'APPLICANT_FACTS',
      renderProfileFacts(input.profile, { includeAuthorization: true, includeSavedAnswers: true }),
      MAX_RESUME_CHARS,
    ),
    humanizedAnswerContract(preset, input.tone),
    rules('REWRITE RULES:', [
      'Fix every item in the automated review. Removing a banned phrase means rewriting the ' +
        'sentence, not swapping in a synonym.',
      'Keep every factual claim that was already in the draft. Do not add new facts to compensate.',
      'If the draft is over the word limit, cut - do not compress by stacking clauses.',
      'Output only the rewritten answer.',
    ]),
  );

  return promptSpec({
    template: SCREENING_ANSWER_TEMPLATE + '#rewrite',
    prompt,
    temperature: 0.85,
    maxOutputTokens: preset.maxOutputTokens,
    json: false,
    preferredModel: MODEL_FOR_TASK.screeningAnswer,
  });
}
