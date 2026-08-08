/**
 * ai/prompts/index.ts — the SEC 5.5 template registry.
 *
 * Three prompt templates plus a matcher assist, which is exactly why SEC 03 lists "No LangChain"
 * under deliberate exclusions. Everything here is a pure function from typed input to a
 * `PromptSpec`; nothing in this folder performs I/O, touches storage, or knows a key exists.
 *
 * Every template routes its page-derived text through `common.ts`, so SEC 9.2 prompt-injection
 * hygiene is applied uniformly and cannot be forgotten in a new template.
 */

export {
  INJECTION_NOTICE,
  TONE_GUIDANCE,
  parseJsonLoosely,
  promptSpec,
  renderProfileFacts,
  rules,
  sanitizeUntrusted,
  section,
  stripCodeFence,
  truncate,
  trustedBlock,
  untrustedBlock,
} from './common';
export type { ProfileFactOptions, PromptSpec } from './common';

export {
  LENGTH_PRESETS,
  SCREENING_ANSWER_TEMPLATE,
  buildScreeningAnswerPrompt,
  buildScreeningRewritePrompt,
  humanizedAnswerContract,
} from './screening_answer';
export type { LengthPreset, ScreeningAnswerInput } from './screening_answer';

export {
  COVER_LETTER_PRESETS,
  COVER_LETTER_TEMPLATE,
  buildCoverLetterPrompt,
  buildCoverLetterRepairPrompt,
} from './cover_letter';
export type { CoverLetterInput, CoverLetterLengthPreset } from './cover_letter';

export {
  RESUME_EXTRACT_TEMPLATE,
  buildResumeExtractPrompt,
  buildResumeExtractRepairPrompt,
} from './resume_extract';
export type { ResumeExtractInput } from './resume_extract';

export {
  FIELD_DISAMBIGUATE_TEMPLATE,
  buildFieldDisambiguatePrompt,
  readProfilePath,
} from './field_disambiguate';
export type { FieldDisambiguateInput } from './field_disambiguate';

/** Every template id of record (SEC 5.5), for telemetry-free local counters and for tests. */
export const PROMPT_TEMPLATES = [
  'screening_answer.v1',
  'cover_letter.v1',
  'resume_extract.v1',
  'field_disambiguate.v1',
] as const;

export type PromptTemplateId = (typeof PROMPT_TEMPLATES)[number];
