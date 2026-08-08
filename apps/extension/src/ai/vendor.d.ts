/**
 * ai/vendor.d.ts — ambient declarations for the two untyped/subpath vendor modules the local
 * resume extractor loads (SEC 03: "Resume text extraction — pdfjs-dist · mammoth (DOCX). Fully
 * local extraction; only the extracted text goes to Gemini").
 *
 * Scoped to `src/ai/**` because that is the only place either library is used. Neither ships the
 * declarations we need: `mammoth` publishes no `.d.ts` at all, and `pdfjs-dist` types only its
 * main entry, not the worker subpath.
 */

declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothResult<T> {
    value: T;
    messages: MammothMessage[];
  }

  export interface MammothInput {
    arrayBuffer: ArrayBuffer;
  }

  export function extractRawText(input: MammothInput): Promise<MammothResult<string>>;
  export function convertToHtml(input: MammothInput): Promise<MammothResult<string>>;

  const mammoth: {
    extractRawText: typeof extractRawText;
    convertToHtml: typeof convertToHtml;
  };
  export default mammoth;
}

/**
 * The pdf.js worker bundle. Importing it for side effects installs
 * `globalThis.pdfjsWorker = { WorkerMessageHandler }`, which is what lets pdf.js run its parser on
 * the calling thread instead of spawning a `Worker` — the only option inside an MV3 service
 * worker, where the `Worker` constructor does not exist.
 */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
