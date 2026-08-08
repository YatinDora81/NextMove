/**
 * ai/resume-extract.ts — the PDF/DOCX readers (pdfjs-dist + mammoth).
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────
 * This file is imported by the **Options page and nothing else**. It is deliberately unreachable
 * from `ai/index.ts`, and therefore from `src/background/**`.
 *
 * The MV3 service worker is bundled as a single file: WXT/rolldown inline dynamic imports into the
 * worker entry, because a classic-script service worker cannot load sibling chunks at runtime. So a
 * `await import('pdfjs-dist')` inside any module the worker's graph can reach is NOT a split point
 * for the worker — it is a 2 MB static inclusion. Chrome re-parses the whole worker script on every
 * wake-up, and MV3 workers wake constantly. Keeping the parsers out of that graph is the only fix.
 *
 * ── WHY THE OPTIONS PAGE IS THE RIGHT HOME (SEC 4.3 Flow C) ─────────────────────────────────────
 * "User uploads resume in Options → blob stored in IndexedDB immediately (local only) → pdf.js /
 * mammoth extracts raw text locally → User clicks 'Build profile with Gemini'". Extraction is a
 * local, user-context operation. The only thing the worker adds is the Gemini call, so the only
 * thing that has to cross the bus is the extracted TEXT (`RESUME_PARSE`).
 *
 * Nothing in this file performs network I/O, and nothing in it can: the resume blob never leaves
 * IndexedDB, and the libraries are loaded on demand so that a page that never parses a resume never
 * pays for them.
 */

import { MAX_RESUME_CHARS } from '@/shared/constants';

import { normalizeExtractedText } from './resume-text';

/* ------------------------------------------------------------------------------------------------
 * Extraction
 * ---------------------------------------------------------------------------------------------- */

export type ResumeTextSource = 'pdf' | 'docx' | 'text';

export interface ExtractedResumeText {
  text: string;
  source: ResumeTextSource;
  /** PDF page count; `0` for other formats. */
  pages: number;
  chars: number;
  /** `true` when the text was clipped to `MAX_RESUME_CHARS` before being returned. */
  truncated: boolean;
}

export type ResumeInput = Blob | ArrayBuffer | Uint8Array;

async function toArrayBuffer(input: ResumeInput): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) {
    const copy = new ArrayBuffer(input.byteLength);
    new Uint8Array(copy).set(input);
    return copy;
  }
  return input.arrayBuffer();
}

/** Magic bytes beat file extensions: `%PDF-` and the ZIP header every OOXML file starts with. */
function sniff(buffer: ArrayBuffer, mime: string, name: string): ResumeTextSource {
  const head = new Uint8Array(buffer.slice(0, 4));
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05)) return 'docx';

  const lowerMime = mime.toLowerCase();
  if (lowerMime.includes('pdf')) return 'pdf';
  if (lowerMime.includes('wordprocessingml') || lowerMime.includes('msword')) return 'docx';

  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) return 'docx';

  return 'text';
}

let pdfjsModule: Promise<typeof import('pdfjs-dist')> | null = null;

/**
 * Load pdf.js with its parser wired to the current thread.
 *
 * Importing the worker bundle for its side effect sets `globalThis.pdfjsWorker`, which makes
 * `PDFWorker` take its "fake worker" branch: no `new Worker(...)`, no `workerSrc`, no dynamic
 * import of a chrome-extension URL. Under the extension CSP (`script-src 'self'`) that is the
 * arrangement that needs no `web_accessible_resources` entry and no worker asset to be emitted at
 * a stable URL, so it survives every WXT hashing change.
 *
 * Both imports are dynamic on purpose: in a *page* context rolldown honours them as real split
 * points (`chunks/pdf-*.js`, `chunks/pdf.worker-*.js`), so opening Options costs nothing until the
 * user actually parses a resume.
 */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsModule === null) {
    pdfjsModule = (async () => {
      await import('pdfjs-dist/build/pdf.worker.mjs');
      return import('pdfjs-dist');
    })();
  }
  return pdfjsModule;
}

/** Extract the text layer of a PDF. Scanned/image-only PDFs legitimately yield an empty string. */
export async function extractPdfText(input: ResumeInput): Promise<{ text: string; pages: number }> {
  const buffer = await toArrayBuffer(input);
  const pdfjs = await loadPdfjs();

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // No fonts are rendered — we only want the text layer, and font machinery needs a DOM.
    disableFontFace: true,
    useSystemFonts: false,
    // Everything is already in memory; pdf.js must never reach the network from here.
    useWorkerFetch: false,
    verbosity: 0,
  });

  const doc = await task.promise;
  const lines: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let line = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          line += item.str;
          if (item.hasEOL) {
            lines.push(line);
            line = '';
          }
        }
        if (line.length > 0) lines.push(line);
        // A blank line between pages keeps section detection from welding two pages together.
        lines.push('');
      } finally {
        page.cleanup();
      }
    }
    return { text: lines.join('\n'), pages: doc.numPages };
  } finally {
    // Releases the (main-thread) worker transport and the parsed document's memory.
    await task.destroy();
  }
}

/** Extract the raw text of a .docx. Mammoth's browser build is pure JS — no network, no DOM. */
export async function extractDocxText(input: ResumeInput): Promise<string> {
  const buffer = await toArrayBuffer(input);
  const loaded = await import('mammoth');
  // Mammoth is CJS; bundler interop puts the named exports on the namespace, on `default`, or both.
  const extract = loaded.extractRawText ?? loaded.default?.extractRawText;
  if (typeof extract !== 'function') {
    throw new Error('The DOCX reader failed to load. Try uploading a PDF instead.');
  }
  const result = await extract({ arrayBuffer: buffer });
  return result.value;
}

/**
 * The single entry point the Options page uses (SEC 4.3 Flow C, step 2).
 *
 * `mime`/`name` are hints only — the magic bytes decide, because ATS downloads routinely arrive as
 * `application/octet-stream`.
 */
export async function extractResumeText(
  input: ResumeInput,
  hint: { mime?: string; name?: string } = {},
): Promise<ExtractedResumeText> {
  const buffer = await toArrayBuffer(input);
  const mime = hint.mime ?? (input instanceof Blob ? input.type : '');
  const source = sniff(buffer, mime, hint.name ?? '');

  let raw: string;
  let pages = 0;

  if (source === 'pdf') {
    const result = await extractPdfText(buffer);
    raw = result.text;
    pages = result.pages;
  } else if (source === 'docx') {
    raw = await extractDocxText(buffer);
  } else {
    raw = new TextDecoder().decode(buffer);
  }

  const normalized = normalizeExtractedText(raw);
  const truncated = normalized.length > MAX_RESUME_CHARS;

  return {
    text: truncated ? normalized.slice(0, MAX_RESUME_CHARS) : normalized,
    source,
    pages,
    chars: normalized.length,
    truncated,
  };
}
