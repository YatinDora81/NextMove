/**
 * tests/unit/file-attach.test.ts — F-05 "Resume Auto-Attach", end to end minus the browser.
 *
 * JF-001 Rev 3.0 · F-05 · SEC 6.4 (the `file` row) · SEC 4.3 Flow A step 5 · SEC 7.1 · SEC 8.3
 * · INV-1 · INV-3 · INV-4.
 *
 * The feature is a chain of four links, and until this suite existed every one of them was broken
 * in a way the others hid:
 *
 *   1. `core/scanner.ts`   — a `display:none` file input behind a dropzone was never offered at all,
 *                            so SEC 6.4's "dispatch `drop` on the zone" half had no reachable input.
 *   2. `core/matcher.ts`   — the empty-value demotion fired on every file field, because the resume
 *                            bytes live in IndexedDB and `Profile` has no `resume` key (SEC 7.1).
 *                            98-point adapter hits were demoted to `suggest` before dispatch.
 *   3. `RESUME_GET`        — no message carried resume bytes toward a content script, and a content
 *                            script's `platform/db` is the HOST PAGE's IndexedDB, not ours.
 *   4. `FillEngine.resume` — one cached answer per RUN meant Greenhouse's `#cover_letter` was fed
 *                            whatever `#resume` resolved to.
 *
 * Each block below pins one link, and the last block drives all four together through `runFill`.
 *
 * ENVIRONMENT: happy-dom implements `DataTransfer`, `DragEvent`, `Blob.arrayBuffer`, `btoa`/`atob`
 * and `input.files = dt.files`, so the whole SEC 6.4 strategy is genuinely exercised here — only
 * the MAIN-world bridge is bypassed (`preferLocal: true`), which is what the Playwright layer
 * covers (`tests/e2e/file-attach.spec.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FieldMatcher } from '@/core/matcher';
import { isVisible, scanForms } from '@/core/scanner';
import { runFill } from '@/core/fill';
import { fillFile, findDropzone } from '@/core/fill/strategies/file';
import { contextOf, REASON, type ResumeAttachment } from '@/core/fill/types';
import type { ReplyOf } from '@/shared/messages';
import type { FieldNode, MatchResult, ProfilePath, ResumeRecord } from '@/shared/types';

import {
  base64ToBytes,
  bytesToBase64,
  selectResume,
  wantsCoverLetter,
  RESUME_ATTACH_MAX_BYTES,
} from '@/background/handlers/resume';

import { makeEmptyProfile, makeProfile, unloadFixture } from '../setup';

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

const RESUME_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff]);

function makeResume(overrides: Partial<ResumeRecord> = {}): ResumeRecord {
  const bytes = (overrides.blob ? null : RESUME_BYTES) as Uint8Array | null;
  const blob =
    overrides.blob ?? new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  return {
    id: 'res_1',
    profileId: 'prof_test_0001',
    name: 'asha-varma-resume.pdf',
    mime: 'application/pdf',
    size: blob.size,
    blob,
    tags: [],
    isDefault: true,
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function attachmentOf(record: ResumeRecord): ResumeAttachment {
  return { name: record.name, mime: record.mime, blob: record.blob };
}

/** Put markup in the live happy-dom document — `getComputedStyle` needs a `defaultView`. */
function render(html: string): void {
  document.open();
  document.write(`<!doctype html><html><head></head><body>${html}</body></html>`);
  document.close();
}

/** Scan + match with an explicit adapter field map, exactly as the content script does. */
function matchesFor(
  fieldMap: Record<string, ProfilePath>,
  profile = makeProfile(),
): { nodes: FieldNode[]; results: MatchResult[] } {
  const nodes = scanForms(document).fields;
  const matcher = new FieldMatcher({ profile, adapterFieldMap: fieldMap });
  return { nodes, results: matcher.match(nodes) };
}

beforeEach(() => {
  unloadFixture();
});

/* ------------------------------------------------------------------------------------------------
 * Link 1 — the scanner must offer the input the dropzone hides
 * ---------------------------------------------------------------------------------------------- */

describe('SEC 6.4 · a file input behind a dropzone is a reachable field', () => {
  it('a display:none file input with a visible dropzone ancestor is visible', () => {
    render(`
      <form>
        <label for="cv">Attach your resume</label>
        <div class="dropzone" data-testid="resume-drop-zone">
          <span>Drop a file here</span>
          <input type="file" id="cv" name="resume" style="display:none" />
        </div>
      </form>
    `);

    const input = document.getElementById('cv') as HTMLInputElement;
    expect(isVisible(input)).toBe(true);

    const ids = scanForms(document).fields.map((node) => node.sig.id);
    expect(ids).toContain('cv');
  });

  it('a display:none file input with nothing visible attached to it stays hidden', () => {
    render(`
      <form>
        <div style="display:none">
          <input type="file" id="orphan" name="resume" style="display:none" />
        </div>
      </form>
    `);

    expect(isVisible(document.getElementById('orphan') as Element)).toBe(false);
    const ids = scanForms(document).fields.map((node) => node.sig.id);
    expect(ids).not.toContain('orphan');
  });

  it('the exemption is file-only — a display:none text input is still hidden', () => {
    render(`
      <form>
        <label for="secret">First name</label>
        <div class="dropzone">
          <input type="text" id="secret" name="first_name" style="display:none" />
        </div>
      </form>
    `);

    expect(isVisible(document.getElementById('secret') as Element)).toBe(false);
    const ids = scanForms(document).fields.map((node) => node.sig.id);
    expect(ids).not.toContain('secret');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Link 2 — the matcher must stop demoting file fields
 * ---------------------------------------------------------------------------------------------- */

describe('INV-4 · the empty-value demotion exempts file fields, and only file fields', () => {
  const FIELD_MAP: Record<string, ProfilePath> = {
    '#resume': 'resume',
    '#first_name': 'personal.firstName',
  };

  beforeEach(() => {
    render(`
      <form id="application_form">
        <label for="first_name">First name</label>
        <input type="text" id="first_name" name="first_name" />
        <label for="resume">Resume/CV</label>
        <div class="dropzone"><input type="file" id="resume" name="resume" /></div>
      </form>
    `);
  });

  it('reaches the engine as `fill` even though the vault holds no resume', () => {
    const { results } = matchesFor(FIELD_MAP, makeProfile());
    const resume = results.find((result) => result.node.sig.id === 'resume');

    expect(resume?.path).toBe('resume');
    expect(resume?.node.sig.inputType).toBe('file');
    // 98 (adapter) + 5 (input-type agreement) → clamped to 100.
    expect(resume?.score).toBe(100);
    expect(resume?.action).toBe('fill');
  });

  it('still reaches the engine as `fill` with a completely empty profile', () => {
    // A file field carries no evidence about the vault either way — an empty vault says nothing
    // about whether this input is really the resume slot.
    const { results } = matchesFor(FIELD_MAP, makeEmptyProfile());
    expect(results.find((r) => r.node.sig.id === 'resume')?.action).toBe('fill');
  });

  it('a text field with no vault value is still demoted, exactly as before', () => {
    const { results } = matchesFor(FIELD_MAP, makeEmptyProfile());
    const firstName = results.find((result) => result.node.sig.id === 'first_name');
    expect(firstName?.score).toBe(98);
    expect(firstName?.action).toBe('suggest');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Link 3 — RESUME_GET: selection, transport encoding and the SEC 8.3 cap
 * ---------------------------------------------------------------------------------------------- */

describe('F-05 · which stored file the worker picks', () => {
  it('prefers the default belonging to THIS profile over a shared default', () => {
    const scoped = makeResume({ id: 'a', profileId: 'p1', isDefault: true, addedAt: 1 });
    const shared = makeResume({ id: 'b', profileId: null, isDefault: true, addedAt: 999 });

    const picked = selectResume([shared, scoped], 'p1', false);
    expect(picked.chosen?.id).toBe('a');
    expect(picked.how).toBe('default');
    expect(picked.alternatives).toHaveLength(0);
  });

  it('falls back to a shared default when the profile has none of its own', () => {
    const shared = makeResume({ id: 'b', profileId: null, isDefault: true, addedAt: 5 });
    const other = makeResume({ id: 'c', profileId: 'p1', isDefault: false, addedAt: 900 });

    const picked = selectResume([other, shared], 'p1', false);
    expect(picked.chosen?.id).toBe('b');
    expect(picked.how).toBe('default');
  });

  it('with several candidates and no default, takes the newest and SAYS it guessed', () => {
    const older = makeResume({ id: 'old', isDefault: false, addedAt: 10 });
    const newer = makeResume({ id: 'new', isDefault: false, addedAt: 20 });

    const picked = selectResume([older, newer], 'prof_test_0001', false);
    expect(picked.chosen?.id).toBe('new');
    // Not `default` and not `only` — the caller is expected to surface this rather than let the
    // user assume they chose it (F-05: "picker if ambiguous").
    expect(picked.how).toBe('most-recent');
    expect(picked.alternatives.map((r) => r.id)).toEqual(['old']);
  });

  it('a lone un-defaulted file is not ambiguous', () => {
    const picked = selectResume([makeResume({ isDefault: false })], 'prof_test_0001', false);
    expect(picked.how).toBe('only');
    expect(picked.alternatives).toHaveLength(0);
  });

  it('keeps the cover-letter slot and the resume slot apart', () => {
    const resume = makeResume({ id: 'r', name: 'resume.pdf', tags: [], isDefault: true });
    const cover = makeResume({ id: 'c', name: 'cover.pdf', tags: ['Cover-Letter'], isDefault: true });

    expect(selectResume([resume, cover], 'prof_test_0001', false).chosen?.id).toBe('r');
    expect(selectResume([resume, cover], 'prof_test_0001', true).chosen?.id).toBe('c');

    // Nothing tagged as a cover letter ⇒ nothing to attach, and we say so instead of substituting
    // the resume. The engine turns this into `no-resume`, i.e. a field flagged for the human.
    const noCover = selectResume([resume], 'prof_test_0001', true);
    expect(noCover.chosen).toBeNull();
    expect(noCover.how).toBe('none');
  });

  it('recognises both spellings of the cover-letter profile path', () => {
    expect(wantsCoverLetter('coverLetter')).toBe(true);
    expect(wantsCoverLetter('answers.coverLetter')).toBe(true);
    expect(wantsCoverLetter('resume')).toBe(false);
    expect(wantsCoverLetter(null)).toBe(false);
    expect(wantsCoverLetter(undefined)).toBe(false);
  });
});

/**
 * The handler is re-imported per case behind `vi.resetModules()`, because this file also imports
 * it statically for its pure helpers — without the reset, `vi.doMock` would be registered against
 * an already-cached module and the real `platform/db` (Dexie, which happy-dom cannot open at all)
 * would answer instead.
 */
const HANDLER_CTX = {
  type: 'RESUME_GET',
  reqId: 'req-test',
  gesture: null,
  tabId: 1,
  frameId: 0,
  url: 'https://boards.greenhouse.io/northwindlabs/jobs/4210001',
  origin: 'content',
} as const;

async function callResumeGet(
  payload: { profileId: string | null; path?: string | null },
  stored: readonly ResumeRecord[],
): Promise<ReplyOf<'RESUME_GET'>> {
  vi.resetModules();
  vi.doMock('@/platform/db', () => ({ listResumes: async () => [...stored] }));
  vi.doMock('@/platform/storage', () => ({ getActiveProfile: async () => makeProfile() }));
  try {
    const mod = await import('@/background/handlers/resume');
    return await mod.resumeHandlers.RESUME_GET(payload, HANDLER_CTX);
  } finally {
    vi.doUnmock('@/platform/db');
    vi.doUnmock('@/platform/storage');
    vi.resetModules();
  }
}

describe('RESUME_GET · the bytes survive a JSON-only transport', () => {
  it('base64 round-trips arbitrary binary, including bytes JSON would mangle', () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(decoded.byteLength).toBe(bytes.byteLength);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('encodes a multi-megabyte file without blowing the argument-list limit', () => {
    // `String.fromCharCode(...bytes)` on a 2 MB array throws RangeError; the chunked encoder is
    // the difference between "works for the test fixture" and "works for a real resume".
    const big = new Uint8Array(2 * 1024 * 1024).fill(0x41);
    const encoded = bytesToBase64(big);
    expect(base64ToBytes(encoded).byteLength).toBe(big.byteLength);
  });

  it('returns the file, base64-encoded, with the choice it made', async () => {
    const reply = await callResumeGet({ profileId: null }, [makeResume()]);

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.data.resume?.name).toBe('asha-varma-resume.pdf');
    expect(reply.data.resume?.mime).toBe('application/pdf');
    expect(reply.data.resume?.size).toBe(RESUME_BYTES.byteLength);
    expect(reply.data.how).toBe('default');
    // The exact bytes, not an approximation of them — a corrupt PDF is worse than no PDF.
    expect(Array.from(base64ToBytes(reply.data.resume?.bytes ?? ''))).toEqual(
      Array.from(RESUME_BYTES),
    );
  });

  it('routes the cover-letter path to a cover-letter-tagged file', async () => {
    const resume = makeResume({ id: 'r', name: 'resume.pdf', isDefault: true });
    const cover = makeResume({ id: 'c', name: 'cover.pdf', tags: ['cover-letter'], isDefault: true });

    const asResume = await callResumeGet({ profileId: null, path: 'resume' }, [resume, cover]);
    const asCover = await callResumeGet({ profileId: null, path: 'answers.coverLetter' }, [
      resume,
      cover,
    ]);

    expect(asResume.ok && asResume.data.resume?.name).toBe('resume.pdf');
    expect(asCover.ok && asCover.data.resume?.name).toBe('cover.pdf');
  });

  it('refuses a file over the SEC 8.3 10 MB cap instead of stalling the worker', async () => {
    const record = makeResume({ size: RESUME_ATTACH_MAX_BYTES + 1, name: 'portfolio.pdf' });
    // `blob.size` is what the handler trusts; the row's `size` is only metadata.
    Object.defineProperty(record.blob, 'size', { value: RESUME_ATTACH_MAX_BYTES + 1 });

    const reply = await callResumeGet({ profileId: 'prof_test_0001' }, [record]);

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.code).toBe('BAD_REQUEST');
    expect(reply.error.message).toMatch(/portfolio\.pdf/);
  });

  it('an empty store is an honest `none`, not an error', async () => {
    const reply = await callResumeGet({ profileId: null }, []);

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.data.resume).toBeNull();
    expect(reply.data.how).toBe('none');
    expect(reply.data.alternatives).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Link 4 — the strategy itself (SEC 6.4)
 * ---------------------------------------------------------------------------------------------- */

describe('SEC 6.4 · fillFile', () => {
  it('attaches via DataTransfer and proves it with input.files.length', async () => {
    render('<form><input type="file" id="cv" name="resume" /></form>');
    const input = document.getElementById('cv') as HTMLInputElement;

    let sawChange = false;
    input.addEventListener('change', () => {
      sawChange = true;
    });

    const result = await fillFile(input, attachmentOf(makeResume()), contextOf({ preferLocal: true }));

    expect(result).toEqual({ ok: true, verified: true });
    expect(input.files?.length).toBe(1);
    expect(input.files?.[0]?.name).toBe('asha-varma-resume.pdf');
    expect(input.files?.[0]?.type).toBe('application/pdf');
    expect(sawChange).toBe(true);
  });

  /**
   * ENVIRONMENT LIMIT, stated rather than papered over: happy-dom's `DragEvent` constructor
   * ignores `init.dataTransfer` and substitutes an empty one, so a listener here cannot read
   * `event.dataTransfer.files` however correctly the strategy fills it in. What this layer CAN
   * prove is everything either side of that gap — the zone is resolved, `drop` really reaches it
   * carrying the full drag sequence, and a chip rendered by the page is accepted as commit proof.
   * The `dataTransfer.files` handoff itself is asserted for real in `tests/e2e/file-attach.spec.ts`
   * against `/live/upload-dropzone.html`, which is a Chromium tab.
   */
  it('drops on the zone that hides the input, and takes the filename chip as proof', async () => {
    render(`
      <form>
        <label for="cover">Attach your cover letter</label>
        <div class="dropzone" id="zone">
          <input type="file" id="cover" name="cover_letter" style="display:none" />
        </div>
        <div id="chip" data-attached="0"></div>
      </form>
    `);

    const input = document.getElementById('cover') as HTMLInputElement;
    const zone = document.getElementById('zone') as HTMLElement;
    const chip = document.getElementById('chip') as HTMLElement;

    const seen: string[] = [];
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.addEventListener(type, (event) => {
        seen.push(event.type);
        if (event.type !== 'drop') return;
        // Stands in for `event.dataTransfer.files[0].name` — see the note above.
        chip.textContent = 'marlowe-cover-letter.pdf';
        chip.setAttribute('data-attached', '1');
      });
    }

    // Force the direct-DataTransfer half to fail so only the drop path can produce a pass.
    Object.defineProperty(input, 'files', { get: () => null, set: () => undefined });

    const attachment = attachmentOf(makeResume({ name: 'marlowe-cover-letter.pdf' }));
    const result = await fillFile(input, attachment, contextOf({ preferLocal: true }));

    expect(seen).toEqual(['dragenter', 'dragover', 'drop']);
    expect(chip.getAttribute('data-attached')).toBe('1');
    expect(result).toEqual({ ok: true, verified: true });
  });

  it('resolves the visible zone, not the styled-away input, as the drop target', () => {
    render(`
      <form>
        <div class="dropzone" id="zone">
          <input type="file" id="cover" style="display:none" />
        </div>
      </form>
    `);
    const zone = findDropzone(document.getElementById('cover') as Element, []);
    expect(zone?.id).toBe('zone');
  });

  it('reports `no-resume` — never a fill — when nothing is stored (INV-4)', async () => {
    render('<form><input type="file" id="cv" name="resume" /></form>');
    const input = document.getElementById('cv') as HTMLInputElement;

    const result = await fillFile(input, null, contextOf({ preferLocal: true }));

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(REASON.noResume);
    expect(input.files?.length ?? 0).toBe(0);
  });

  it('reports `value-not-committed` when the page swallows the file (INV-4)', async () => {
    render('<form><div class="dropzone" id="zone"><input type="file" id="cv" style="display:none" /></div></form>');
    const input = document.getElementById('cv') as HTMLInputElement;
    // Nothing listens for `drop` and `input.files` refuses to hold anything: the page never
    // acknowledged the attachment, so the engine must NOT claim it filled the field.
    Object.defineProperty(input, 'files', { get: () => null, set: () => undefined });

    const result = await fillFile(
      input,
      attachmentOf(makeResume({ name: 'zzqx-unmatchable-name.pdf' })),
      contextOf({ preferLocal: true }),
    );

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(REASON.notCommitted);
  });

  it('INV-1 · refuses to treat a submit control as a file field', async () => {
    render('<form><button type="submit" id="send">Send application</button></form>');
    const button = document.getElementById('send') as HTMLElement;

    const result = await fillFile(button, attachmentOf(makeResume()), contextOf({ preferLocal: true }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REASON.submitControl);
  });
});

/* ------------------------------------------------------------------------------------------------
 * All four links together — what the content script actually runs
 * ---------------------------------------------------------------------------------------------- */

describe('SEC 4.3 Flow A · runFill attaches the resume the resolver supplies', () => {
  const FIELD_MAP: Record<string, ProfilePath> = {
    '#resume': 'resume',
    '#cover_letter': 'coverLetter',
    '#first_name': 'personal.firstName',
  };

  const FORM = `
    <form id="application_form">
      <label for="first_name">First name</label>
      <input type="text" id="first_name" name="first_name" />
      <fieldset id="resume_fieldset">
        <label for="resume">Resume/CV</label>
        <div class="dropzone"><input type="file" id="resume" name="resume" /></div>
      </fieldset>
      <fieldset id="cover_letter_fieldset">
        <label for="cover_letter">Cover Letter</label>
        <div class="dropzone"><input type="file" id="cover_letter" name="cover_letter" /></div>
      </fieldset>
      <button type="submit" id="submit_app">Submit application</button>
    </form>
  `;

  it('resolves lazily, per target, and verifies the write', async () => {
    render(FORM);
    const { results } = matchesFor(FIELD_MAP);

    const asked: Array<ProfilePath | null> = [];
    const report = await runFill(results, {
      profile: makeProfile(),
      atsId: 'greenhouse',
      url: 'https://boards.greenhouse.io/x/jobs/1',
      humanPacing: false,
      preferLocal: true,
      resolveResume: async (path) => {
        asked.push(path);
        // Only a resume is stored — no cover letter. That is the common case, and the correct
        // answer for the cover-letter slot is "nothing", not "the resume".
        return path === 'resume' ? attachmentOf(makeResume()) : null;
      },
    });

    // One read per target, not one per run and not one per field.
    expect(asked).toEqual(['resume', 'coverLetter']);

    const resumeInput = document.getElementById('resume') as HTMLInputElement;
    const coverInput = document.getElementById('cover_letter') as HTMLInputElement;

    expect(resumeInput.files?.length).toBe(1);
    expect(resumeInput.files?.[0]?.name).toBe('asha-varma-resume.pdf');
    expect(coverInput.files?.length ?? 0).toBe(0);

    const perField = new Map(report.perField.map((row) => [row.hash, row]));
    const resumeNode = results.find((r) => r.node.sig.id === 'resume');
    const coverNode = results.find((r) => r.node.sig.id === 'cover_letter');

    expect(perField.get(resumeNode?.node.sig.hash ?? '')?.action).toBe('fill');
    expect(perField.get(coverNode?.node.sig.hash ?? '')?.action).toBe('skip');
    expect(report.errors).toBe(0);
  });

  it('never touches IndexedDB for a form with no file field', async () => {
    render(`
      <form id="application_form">
        <label for="first_name">First name</label>
        <input type="text" id="first_name" name="first_name" />
      </form>
    `);
    const { results } = matchesFor({ '#first_name': 'personal.firstName' });

    const resolveResume = vi.fn(async () => null);
    await runFill(results, {
      profile: makeProfile(),
      atsId: 'generic',
      url: 'https://careers.example.invalid/apply',
      humanPacing: false,
      preferLocal: true,
      resolveResume,
    });

    expect(resolveResume).not.toHaveBeenCalled();
  });

  it('with no resume stored the field is skipped and flagged — never reported as filled', async () => {
    render(FORM);
    const { results } = matchesFor(FIELD_MAP);

    const report = await runFill(results, {
      profile: makeProfile(),
      atsId: 'greenhouse',
      url: 'https://boards.greenhouse.io/x/jobs/1',
      humanPacing: false,
      preferLocal: true,
      resolveResume: async () => null,
    });

    const resumeInput = document.getElementById('resume') as HTMLInputElement;
    expect(resumeInput.files?.length ?? 0).toBe(0);

    const resumeNode = results.find((r) => r.node.sig.id === 'resume');
    const row = report.perField.find((entry) => entry.hash === resumeNode?.node.sig.hash);
    expect(row?.action).toBe('skip');
    expect(report.filled).toBe(1); // first_name only
  });

  it('a resolver that throws degrades to `no-resume` rather than killing the run', async () => {
    render(FORM);
    const { results } = matchesFor(FIELD_MAP);

    const report = await runFill(results, {
      profile: makeProfile(),
      atsId: 'greenhouse',
      url: 'https://boards.greenhouse.io/x/jobs/1',
      humanPacing: false,
      preferLocal: true,
      resolveResume: async () => {
        throw new Error('the service worker was asleep');
      },
    });

    expect(report.errors).toBe(0);
    expect(report.filled).toBe(1);
    expect((document.getElementById('resume') as HTMLInputElement).files?.length ?? 0).toBe(0);
  });

  it('INV-1 · the submit button is never a fill target on a form with attachments', async () => {
    render(FORM);
    const { nodes } = matchesFor(FIELD_MAP);
    expect(nodes.map((node) => node.sig.id)).not.toContain('submit_app');
  });
});
