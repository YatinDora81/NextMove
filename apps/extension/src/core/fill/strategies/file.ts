/**
 * core/fill/strategies/file.ts — resume / cover-letter attachment.
 *
 * JF-001 Rev 3.0 · SEC 6.4: "DataTransfer injection. If the ATS hides the input behind a dropzone,
 * dispatch `drop` with the same DataTransfer on the zone. Verify via `input.files.length` or
 * filename chip in DOM."
 *
 * The blob comes from IndexedDB (`ResumeRecord.blob`, SEC 7.1/7.3) — resume bytes never leave the
 * device, and the only thing that ever reaches Gemini is extracted text (SEC 03). The engine hands
 * this strategy a `ResumeAttachment`, which `ResumeRecord` satisfies structurally; the caller owns
 * the `platform/db` read so this file stays free of storage dependencies.
 */

import { attachFile as bridgeAttachFile, readCommitted } from '../bridge';
import {
  assertNotSubmitControl,
  cssEscape,
  isAborted,
  isFileInput,
  isVisible,
  rootOf,
  sleep,
} from '../dom';
import { normalize } from '../matching';
import {
  REASON,
  failed,
  filled,
  unverified,
  type ResumeAttachment,
  type StrategyContext,
  type StrategyResult,
} from '../types';

/** How long we let an async uploader render its filename chip before giving up. */
const CHIP_WAIT_MS = 2_500;
const CHIP_POLL_MS = 100;

const DEFAULT_DROPZONE_SELECTORS = [
  '[data-automation-id*="attachment" i]',
  '[data-automation-id*="fileUpload" i]',
  '[data-testid*="drop" i]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[class*="droparea" i]',
  '[class*="file-upload" i]',
  '[class*="fileupload" i]',
  '[class*="attachment" i]',
  '[aria-label*="drop" i]',
];

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
};

function mimeFor(attachment: ResumeAttachment): string {
  if (attachment.mime.trim().length > 0) return attachment.mime.trim();
  if (attachment.blob.type.length > 0) return attachment.blob.type;
  const ext = attachment.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** Build a real `File` from the IndexedDB blob so the page sees an ordinary user upload. */
export function fileFromResume(attachment: ResumeAttachment): File {
  const name = attachment.name.trim().length > 0 ? attachment.name.trim() : 'resume.pdf';
  return new File([attachment.blob], name, {
    type: mimeFor(attachment),
    lastModified: Date.now(),
  });
}

/**
 * The element that listens for `drop` when the real `<input type=file>` is hidden. Adapter-declared
 * selectors win; otherwise we walk up from the input looking for a zone-shaped ancestor.
 */
export function findDropzone(input: Element, extraSelectors: readonly string[]): HTMLElement | null {
  const root = rootOf(input);

  for (const selector of extraSelectors) {
    try {
      const declared = root.querySelector<HTMLElement>(selector);
      if (declared) return declared;
    } catch {
      continue; // malformed remote-config selector — ignore, never throw
    }
  }

  for (const selector of DEFAULT_DROPZONE_SELECTORS) {
    const zone = input.closest<HTMLElement>(selector);
    if (zone) return zone;
  }

  const id = input.getAttribute('id');
  if (id !== null && id.length > 0) {
    const label = root.querySelector<HTMLElement>(`label[for="${cssEscape(id)}"]`);
    if (label && isVisible(label)) return label;
  }

  const wrapping = input.closest('label');
  if (wrapping instanceof HTMLElement && isVisible(wrapping)) return wrapping;

  // Last resort: the nearest visible ancestor. A drop on it bubbles to whatever is listening.
  let parent = input.parentElement;
  for (let depth = 0; parent && depth < 4; depth++) {
    if (isVisible(parent)) return parent;
    parent = parent.parentElement;
  }
  return null;
}

/** `input.files.length` — the strongest possible proof the attachment landed. */
function inputHasFile(el: Element, fileName: string): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const files = el.files;
  if (!files || files.length === 0) return false;
  for (let i = 0; i < files.length; i++) {
    const file: File | undefined = files[i];
    if (file && normalize(file.name) === normalize(fileName)) return true;
  }
  return files.length > 0;
}

/** Async uploaders show the filename in a chip instead of populating `input.files`. */
async function awaitFilenameChip(
  input: Element,
  fileName: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const stem = normalize(fileName.replace(/\.[a-z0-9]{1,5}$/i, ''));
  if (stem.length < 3) return false;

  const scope =
    input.closest('form, [data-automation-id], [class*="attachment" i], [class*="upload" i]') ??
    input.parentElement ??
    rootOf(input);

  const deadline = Date.now() + CHIP_WAIT_MS;
  while (Date.now() < deadline) {
    if (isAborted(signal)) return false;
    const text = normalize(scope.textContent ?? '');
    if (text.includes(stem)) return true;
    await sleep(CHIP_POLL_MS, signal);
  }
  return false;
}

/**
 * Attach `attachment` to a file input, falling back to a `drop` on the zone that hides it.
 *
 * INV-1: a file input is never a submit control, but the guard runs unconditionally — and the
 * dropzone we resolve is checked too, since a badly-chosen ancestor could be a button.
 */
export async function fillFile(
  el: Element,
  attachment: ResumeAttachment | null,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  try {
    assertNotSubmitControl(el, 'attach a file to'); // INV-1
  } catch {
    return failed(REASON.submitControl);
  }

  if (!attachment) return failed(REASON.noResume);
  if (attachment.blob.size === 0) return failed(REASON.noResume);
  if (!isFileInput(el)) return failed(REASON.notFillable);
  if (el.disabled) return failed(REASON.notFillable);

  const file = fileFromResume(attachment);

  if (inputHasFile(el, file.name)) return filled();

  const callOptions = ctx.preferLocal === true ? { preferLocal: true } : undefined;

  // Pass 1: DataTransfer straight onto the input.
  const direct = await bridgeAttachFile(el, file, null, callOptions);
  if (direct.ok) await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
  let landed = inputHasFile(el, file.name);

  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  /**
   * Pass 2: the zone around a decorative input is what actually listens.
   *
   * Note the second reason this runs. Assigning `input.files` on a `display:none` input SUCCEEDS in
   * every browser — so pass 1 "verifies" and, before this, we returned `filled()` and never touched
   * the zone. But a hidden input is decorative by definition: the widget in front of it listens for
   * `drop` and reads `event.dataTransfer`, and never reads `input.files` at all. The file was
   * therefore sitting in a control nothing was watching, and the application was submitted with no
   * attachment while the overlay reported a green "Filled". That is precisely the kind of claim
   * INV-4 exists to forbid, so a styled-away input always gets the drop as well.
   */
  const decorative = !isVisible(el);
  const dropzone = !landed || decorative ? findDropzone(el, ctx.quirks.dropzoneSelectors) : null;
  if (dropzone) {
    try {
      assertNotSubmitControl(dropzone, 'drop a file on'); // INV-1
      const dropped = await bridgeAttachFile(el, file, dropzone, callOptions);
      if (dropped.ok) {
        await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
        if (!landed) landed = inputHasFile(el, file.name);
        if (!landed && (await awaitFilenameChip(el, file.name, ctx.signal))) landed = true;
      }
    } catch {
      // Refused the dropzone on INV-1 grounds; fall through to the verification below.
    }
  }

  if (landed || inputHasFile(el, file.name)) return filled();
  if (await awaitFilenameChip(el, file.name, ctx.signal)) return filled();

  // INV-4: the page never acknowledged the file, so the overlay must tell the user to attach it.
  return unverified(REASON.notCommitted);
}

/** What the page currently believes is attached — used by the overlay's review panel. */
export async function readAttachedName(el: Element, ctx: StrategyContext): Promise<string | null> {
  if (el instanceof HTMLInputElement && el.files && el.files.length > 0) {
    return el.files[0]?.name ?? null;
  }
  const raw = await readCommitted(el, ctx.preferLocal === true ? { preferLocal: true } : undefined);
  if (raw === null || raw.length === 0) return null;
  // Browsers report a fake path for file inputs; keep only the basename.
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] ?? null;
}
