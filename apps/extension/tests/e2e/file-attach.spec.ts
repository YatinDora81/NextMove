/**
 * file-attach.spec.ts — SEC 11 e2e: "Full fill flow per adapter incl. … file attach".
 *
 * ── What this file used to record ───────────────────────────────────────────────────────────────
 *
 * Until F-05 was wired up, this suite documented a resume that was never attached — not on any
 * adapter, not through either half of SEC 6.4's file strategy, and not because of one bug. The
 * path was unreachable end to end from a content script at four independent layers:
 *
 *   1. `core/matcher.ts` demoted every file field to `suggest` before the engine could dispatch,
 *      because `resume` has no value in the SEC 7.2 `Profile` (the bytes live in IndexedDB).
 *   2. `entrypoints/content.ts` built its `FillEngineOptions` with neither `resume` nor
 *      `resolveResume`, so `fillFile` was always reached with `attachment === null`.
 *   3. There was no message that could carry resume bytes toward a content script — and
 *      `platform/db` inside a content script is the HOST PAGE's IndexedDB, not the extension's.
 *   4. `core/scanner.ts` never offered a `display:none` file input, so the dropzone half of
 *      SEC 6.4 had no reachable input at all.
 *
 * ── What it records now ─────────────────────────────────────────────────────────────────────────
 *
 * All four are fixed (`RESUME_GET` + `resolveResume` + the file-field demotion exemption + the
 * dropzone visibility rule), so the assertions have moved with the behaviour:
 *
 *   · WITH a stored resume  → `input.files.length === 1` on every adapter, and the async-uploader
 *     dropzone renders its filename chip. These are the two specs SEC 11 asks for; they were
 *     `test.fixme` and are now the acceptance criteria for F-05.
 *   · WITHOUT a stored resume → the file input stays empty and the field is flagged red for the
 *     human. This is the previous suite's claim, re-pointed at the honest new outcome: the field
 *     is now SKIPPED with `no-resume` rather than demoted to a yellow suggestion, because the
 *     engine reached it, tried, and could not do it — which is a different and more accurate
 *     statement than "we did not try" (INV-4).
 *
 * ── Seeding ────────────────────────────────────────────────────────────────────────────────────
 * Resume blobs live in Dexie (`jobfill.resumes`, SEC 7.1) and there is no bus message that WRITES
 * one — the Options page holds the only writer, behind a real `<input type=file>`. So the seed here
 * goes straight into the extension's own IndexedDB from an extension page, which shares the origin
 * with the service worker. The row is the exact `ResumeRecord` shape `platform/db` declares; the
 * worker then reads it back through the shipped `listResumes` / `RESUME_GET` path, so everything
 * downstream of the write is the real product.
 */

import { expect, test } from './helpers/extension';
import type { JobFill } from './helpers/extension';
import { E2E_PROFILE_ID } from './helpers/profile';

/* ------------------------------------------------------------------------------------------------
 * Seeding a resume into the extension's IndexedDB
 * ---------------------------------------------------------------------------------------------- */

interface SeedResume {
  id: string;
  profileId: string | null;
  name: string;
  mime: string;
  /** Plain byte array — `page.evaluate` arguments are JSON, so a Blob cannot cross. */
  bytes: number[];
  tags: string[];
  isDefault: boolean;
  addedAt: number;
}

/** A tiny well-formed-enough PDF. Nothing parses it; only its bytes and its name are asserted. */
function pdfBytes(marker: string): number[] {
  const text = `%PDF-1.7\n% ${marker}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

const RESUME: SeedResume = {
  id: 'e2e-resume-default',
  profileId: E2E_PROFILE_ID,
  name: 'riya-kulkarni-resume.pdf',
  mime: 'application/pdf',
  bytes: pdfBytes('e2e resume'),
  tags: [],
  isDefault: true,
  addedAt: Date.UTC(2026, 0, 10, 9, 0, 0),
};

const COVER_LETTER: SeedResume = {
  id: 'e2e-cover-letter',
  profileId: E2E_PROFILE_ID,
  name: 'marlowe-freight-cover-letter.pdf',
  mime: 'application/pdf',
  bytes: pdfBytes('e2e cover letter'),
  tags: ['cover-letter'],
  isDefault: true,
  addedAt: Date.UTC(2026, 0, 11, 9, 0, 0),
};

/**
 * Write one `ResumeRecord` into `jobfill.resumes`.
 *
 * The bus call first is not decoration: `indexedDB.open('jobfill')` with no version number creates
 * an EMPTY version-1 database when none exists, and Dexie would then find its own object stores
 * missing. `ANSWERS_LIST` touches `db.answerBank` in the service worker, which is what makes Dexie
 * create the database — with its real schema — before this page opens it.
 */
async function seedResume(jobfill: JobFill, record: SeedResume): Promise<void> {
  await jobfill.send('ANSWERS_LIST', {});

  const ui = await jobfill.ui();
  const problem = await ui.evaluate(async (row: SeedResume) => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('jobfill');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
      });

    const deadline = Date.now() + 10_000;
    for (;;) {
      const db = await open();
      if (db.objectStoreNames.contains('resumes')) {
        const bytes = new Uint8Array(row.bytes);
        const value = {
          id: row.id,
          profileId: row.profileId,
          name: row.name,
          mime: row.mime,
          size: bytes.byteLength,
          blob: new Blob([bytes], { type: row.mime }),
          tags: row.tags,
          isDefault: row.isDefault,
          addedAt: row.addedAt,
        };
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('resumes', 'readwrite');
            tx.objectStore('resumes').put(value);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('resumes write failed'));
            tx.onabort = () => reject(tx.error ?? new Error('resumes write aborted'));
          });
        } finally {
          db.close();
        }
        return null;
      }
      db.close();
      if (Date.now() > deadline) {
        return 'the jobfill database exists but has no `resumes` object store';
      }
      await new Promise<void>((done) => {
        setTimeout(done, 100);
      });
    }
  }, record);

  if (problem !== null) {
    throw new Error(`could not seed a resume for this test: ${problem}`);
  }
}

/** `input.files.length`, or `-1` when the selector did not resolve to a file input at all. */
async function attachedCount(fixture: { page: import('@playwright/test').Page }, selector: string) {
  return fixture.page.locator(selector).evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) return -1;
    return el.files?.length ?? -1;
  });
}

async function attachedName(fixture: { page: import('@playwright/test').Page }, selector: string) {
  return fixture.page.locator(selector).evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) return null;
    return el.files?.[0]?.name ?? null;
  });
}

/* ------------------------------------------------------------------------------------------------
 * The corpus
 * ---------------------------------------------------------------------------------------------- */

const RESUME_FIELDS = [
  { fixture: '/corpus/greenhouse/standard.html', resume: '#resume', others: ['#cover_letter'] },
  { fixture: '/corpus/lever/standard.html', resume: '#resume-upload-input', others: [] },
  { fixture: '/corpus/ashby/standard.html', resume: '#_systemfield_resume', others: [] },
  { fixture: '/live/upload-dropzone.html', resume: '#resume-plain', others: [] },
] as const;

test.beforeEach(async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
});

/* ------------------------------------------------------------------------------------------------
 * F-05 · with a stored resume, the file is really attached
 * ---------------------------------------------------------------------------------------------- */

for (const { fixture, resume, others } of RESUME_FIELDS) {
  test(`the stored resume is attached on ${fixture}`, async ({ jobfill }) => {
    await seedResume(jobfill, RESUME);

    const page = await jobfill.openFixture(fixture);
    const report = await page.fill();
    expect(report.errors).toBe(0);

    // SEC 6.4's first verification: `input.files.length`. This is the whole point of F-05.
    expect(await attachedCount(page, resume), `${resume} received no file`).toBe(1);
    expect(await attachedName(page, resume)).toBe(RESUME.name);

    // …and the overlay says so, rather than the run quietly claiming a field it did not touch.
    const filled = await page.overlay.texts('.jf-row--filled');
    expect(
      filled.some((row) => /resume/i.test(row)),
      `no filled row reported the resume field. Rows: ${JSON.stringify(filled)}`,
    ).toBe(true);

    // A cover-letter slot with no stored cover letter stays empty: F-05 attaches the file the user
    // stored for that target, and never substitutes the resume for it.
    for (const selector of others) {
      expect(await attachedCount(page, selector), `${selector} was given a file it should not have`)
        .toBe(0);
    }
  });
}

/* ------------------------------------------------------------------------------------------------
 * INV-4 · with nothing stored, nothing is attached and nothing is claimed
 * ---------------------------------------------------------------------------------------------- */

for (const { fixture, resume, others } of RESUME_FIELDS) {
  test(`with no resume stored, ${fixture} is handed to the human, never faked`, async ({
    jobfill,
  }) => {
    const page = await jobfill.openFixture(fixture);
    const report = await page.fill();
    expect(report.errors).toBe(0);

    for (const selector of [resume, ...others]) {
      expect(await attachedCount(page, selector), `${selector} unexpectedly has a file attached`)
        .toBe(0);
    }

    // The field is not silently dropped either — it is flagged red so the human knows to attach it
    // (INV-4: flag what we cannot do rather than pretend). The engine DID reach it and reported
    // `no-resume`, which is a skip, not a suggestion: there is nothing for the user to accept.
    const rows = await page.overlay.texts('.jf-row--unmatched');
    expect(
      rows.some((row) => /resume/i.test(row)),
      `no "needs you" row offered the resume field on ${fixture}. Rows: ${JSON.stringify(rows)}`,
    ).toBe(true);

    const badges = await page.overlay.texts('.jf-marker--unmatched .jf-marker__badge');
    expect(badges).toContain('Needs you');
  });
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.4 · the two halves of the file strategy, on the fixture built for them
 * ---------------------------------------------------------------------------------------------- */

test('the resume is attached to a plain <input type=file> via DataTransfer', async ({ jobfill }) => {
  await seedResume(jobfill, RESUME);

  const fixture = await jobfill.openFixture('/live/upload-dropzone.html');
  await fixture.fill();

  const files = await fixture.page.locator('#resume-plain').evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) return -1;
    return el.files?.length ?? -1;
  });
  expect(files).toBe(1);

  const name = await fixture.page.locator('#resume-plain').evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) return null;
    return el.files?.[0]?.name ?? null;
  });
  expect(name).not.toBeNull();
  expect(name ?? '').toMatch(/\.(pdf|docx?|txt)$/i);
});

/**
 * The dropzone half.
 *
 * `/live/upload-dropzone.html`'s cover-letter zone is the async-uploader shape SEC 6.4 describes:
 * the real input is `display:none`, the zone listens for `drop`, and the widget renders a filename
 * chip instead of ever populating `input.files`. Two things had to change for this to be reachable:
 * `core/scanner.ts` now offers a styled-away file input that has a visible zone, and
 * `strategies/file.ts` now always dispatches the drop for such an input rather than stopping at a
 * successful `input.files` assignment nothing was listening to.
 */
test('a dropzone-hidden input is fed by a drop and confirmed by its filename chip', async ({
  jobfill,
}) => {
  // The hidden input is the COVER LETTER slot on this fixture, so that is what has to be stored —
  // F-05 attaches per target, and a resume is not a cover letter.
  await seedResume(jobfill, COVER_LETTER);

  const fixture = await jobfill.openFixture('/live/upload-dropzone.html');
  await fixture.fill();

  await expect(fixture.page.locator('#resume-chip')).toHaveAttribute('data-attached', '1');
  await expect(fixture.page.locator('#resume-chip')).not.toBeEmpty();
});

/* ------------------------------------------------------------------------------------------------
 * F-05 · "multiple resumes; per-profile default; picker if ambiguous"
 * ---------------------------------------------------------------------------------------------- */

test('the per-profile default wins over an older shared file', async ({ jobfill }) => {
  await seedResume(jobfill, {
    ...RESUME,
    id: 'e2e-resume-shared',
    profileId: null,
    name: 'old-shared-resume.pdf',
    isDefault: false,
    addedAt: Date.UTC(2026, 0, 12, 9, 0, 0), // NEWER than the default, and still must lose
  });
  await seedResume(jobfill, RESUME);

  const page = await jobfill.openFixture('/corpus/greenhouse/standard.html');
  await page.fill();

  expect(await attachedName(page, '#resume')).toBe(RESUME.name);
});
