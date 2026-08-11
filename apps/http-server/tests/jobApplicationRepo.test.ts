/**
 * tests/jobApplicationRepo.test.ts — JF-001 SEC 7.4 / 8.3.
 *
 * The url fallback in `upsertByClientId` exists so a reinstalled extension does not grow a second
 * Applied card for a posting the user already tracks. It reaches a row the pushing client has
 * *never seen*: the server copy may carry a status the user set on the web, notes they typed there
 * and a history neither of them can reconstruct. This suite pins the rule that the fallback merges
 * that row rather than replacing it, and that the `clientId` path — the client's own row — keeps
 * its create-or-replace semantics.
 *
 * Prisma is faked rather than mocked field-by-field: a tiny in-memory table with the two unique
 * indexes the schema declares, so the retry path sees the same `P2002` shape Postgres produces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { jobAppStatusSchemaType, jobApplicationRowSchemaType } from '@repo/types/ExtensionTypes';

/** One row of the fake `JobApplication` table — the columns the repository reads or writes. */
interface StoredRow {
  id: string;
  userId: string;
  clientId: string;
  company: string;
  role: string;
  url: string | null;
  urlKey: string | null;
  ats: string | null;
  status: jobAppStatusSchemaType;
  appliedAt: Date | null;
  notes: string | null;
  fillStats: unknown;
  history: unknown;
  updatedAt: Date;
}

/**
 * `vi.mock` is hoisted above the imports, so the store it hands to the repository has to be created
 * in a hoisted block too — otherwise the module under test would bind to an undefined client.
 */
const fake = vi.hoisted(() => {
  const DB_NULL = { __dbNull: true } as const;
  const rows: StoredRow[] = [];

  /** Prisma's shape for a unique-constraint violation, as `isUrlKeyConflict` reads it. */
  const uniqueViolation = (target: string[]): Error & { code: string; meta: { target: string[] } } =>
    Object.assign(new Error(`Unique constraint failed on the fields: (${target.join(',')})`), {
      code: 'P2002',
      meta: { target },
    });

  const assertUnique = (candidate: StoredRow, ignoreId: string | null): void => {
    for (const row of rows) {
      if (row.id === ignoreId) continue;
      if (row.clientId === candidate.clientId) throw uniqueViolation(['clientId']);
      // Partial index: url-less rows are not in it at all, so they never collide.
      if (
        candidate.urlKey !== null &&
        row.userId === candidate.userId &&
        row.urlKey === candidate.urlKey
      ) {
        throw uniqueViolation(['userId', 'urlKey']);
      }
    }
  };

  /** Prisma writes `Prisma.DbNull` into a nullable Json column; the database stores SQL NULL. */
  const unwrap = (value: unknown): unknown => (value === DB_NULL ? null : value);

  const applyData = (target: StoredRow, data: Record<string, unknown>): StoredRow => {
    const next: StoredRow = { ...target, updatedAt: new Date() };
    for (const [key, value] of Object.entries(data)) {
      (next as unknown as Record<string, unknown>)[key] = unwrap(value);
    }
    return next;
  };

  const jobApplication = {
    findUnique: (args: { where: { clientId: string } }): Promise<StoredRow | null> =>
      Promise.resolve(rows.find((row) => row.clientId === args.where.clientId) ?? null),
    findFirst: (args: { where: { userId: string; urlKey: string } }): Promise<StoredRow | null> =>
      Promise.resolve(
        rows.find((row) => row.userId === args.where.userId && row.urlKey === args.where.urlKey) ??
          null,
      ),
    update: (args: { where: { id: string }; data: Record<string, unknown> }): Promise<StoredRow> => {
      const index = rows.findIndex((row) => row.id === args.where.id);
      const current = rows[index];
      if (current === undefined) return Promise.reject(new Error('P2025: row not found'));
      const next = applyData(current, args.data);
      assertUnique(next, current.id);
      rows[index] = next;
      return Promise.resolve(next);
    },
    create: (args: { data: Record<string, unknown> }): Promise<StoredRow> => {
      const seed: StoredRow = {
        id: `srv-${rows.length + 1}`,
        userId: '',
        clientId: '',
        company: '',
        role: '',
        url: null,
        urlKey: null,
        ats: null,
        status: 'APPLIED',
        appliedAt: null,
        notes: null,
        fillStats: null,
        history: null,
        updatedAt: new Date(),
      };
      const next = applyData(seed, args.data);
      assertUnique(next, null);
      rows.push(next);
      return Promise.resolve(next);
    },
  };

  const client = {
    jobApplication,
    $transaction: <T>(run: (tx: { jobApplication: typeof jobApplication }) => Promise<T>): Promise<T> =>
      run({ jobApplication }),
  };

  return { DB_NULL, rows, client };
});

vi.mock('@repo/db/db', () => ({
  default: { DbNull: fake.DB_NULL },
  prismaClient: fake.client,
}));

const { default: jobApplicationRepo, mergeUrlMatchedWrite, normalizeUrlKey } = await import(
  '@/repository/jobApplicationRepo.js'
);

const USER = 'user-merge-1';
const POSTING = 'https://boards.greenhouse.io/acme/jobs/12';
/** The same posting as the extension sees it on a later visit: a fresh campaign tag, no fragment. */
const POSTING_WITH_TAG = 'https://boards.greenhouse.io/acme/jobs/12?gh_src=fresh-install#apply';

const APPLIED_AT = new Date('2026-07-01T09:00:00.000Z');

/** The row as the web app left it: advanced to INTERVIEW, annotated, with a real audit trail. */
const seedWebRow = (overrides: Partial<StoredRow> = {}): StoredRow => {
  const row: StoredRow = {
    id: 'srv-web',
    userId: USER,
    clientId: 'client-web',
    company: 'Acme',
    role: 'Backend Engineer',
    url: POSTING,
    urlKey: normalizeUrlKey(POSTING),
    ats: 'greenhouse',
    status: 'INTERVIEW',
    appliedAt: APPLIED_AT,
    notes: 'Recruiter call Tuesday 3pm — ask about the on-call rota.',
    fillStats: { filled: 9, total: 10 },
    history: [
      { at: 1_750_000_000_000, to: 'APPLIED' },
      { at: 1_750_600_000_000, to: 'INTERVIEW' },
    ],
    updatedAt: new Date('2026-07-05T09:00:00.000Z'),
    ...overrides,
  };
  fake.rows.push(row);
  return row;
};

/** What a freshly reinstalled extension pushes: a new clientId, a draft row, nothing else known. */
const freshInstallPush = (
  overrides: Partial<jobApplicationRowSchemaType> = {},
): jobApplicationRowSchemaType => ({
  clientId: 'client-reinstalled',
  company: 'Acme',
  role: 'Backend Engineer',
  url: POSTING_WITH_TAG,
  ats: 'greenhouse',
  status: 'DRAFT',
  appliedAt: null,
  notes: null,
  fillStats: { filled: 4, total: 10 },
  history: [{ at: 1_760_000_000_000, to: 'DRAFT' }],
  ...overrides,
});

const storedRow = (id: string): StoredRow => {
  const row = fake.rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`expected a stored row with id ${id}`);
  return row;
};

beforeEach(() => {
  fake.rows.length = 0;
});

describe('upsertByClientId · the url fallback merges, it does not replace', () => {
  it('does not walk an INTERVIEW row back to DRAFT when a reinstalled client pushes', async () => {
    seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(result.created).toBe(false);
    expect(fake.rows).toHaveLength(1);
    expect(result.record.status).toBe('INTERVIEW');
    expect(storedRow('srv-web').status).toBe('INTERVIEW');
  });

  it('keeps notes the user typed on the web, which the pushing client has never seen', async () => {
    const seeded = seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(result.record.notes).toBe(seeded.notes);
  });

  it('keeps the status history the server holds and folds the client entries into it', async () => {
    seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(result.record.history).toEqual([
      { at: 1_750_000_000_000, to: 'APPLIED' },
      { at: 1_750_600_000_000, to: 'INTERVIEW' },
      { at: 1_760_000_000_000, to: 'DRAFT' },
    ]);
  });

  it('never re-stamps appliedAt — days-to-response is measured from it', async () => {
    seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(
      USER,
      freshInstallPush({ appliedAt: '2026-08-09T12:00:00.000Z' }),
    );

    expect(result.record.appliedAt).toBe(APPLIED_AT.toISOString());
  });

  it('keeps the better fill statistics rather than the most recent ones', async () => {
    seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(result.record.fillStats).toEqual({ filled: 9, total: 10 });
  });

  it('leaves the matched row addressable by the clientId other installs still use', async () => {
    seedWebRow();

    await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(storedRow('srv-web').clientId).toBe('client-web');
  });

  it('still promotes a DRAFT row, stamping appliedAt and appending to the history', async () => {
    seedWebRow({ status: 'DRAFT', appliedAt: null, notes: null, history: [] });

    const before = Date.now();
    const result = await jobApplicationRepo.upsertByClientId(
      USER,
      freshInstallPush({ status: 'APPLIED', notes: 'applied from the new laptop' }),
    );

    expect(result.record.status).toBe('APPLIED');
    expect(result.record.notes).toBe('applied from the new laptop');
    const appliedAt = result.record.appliedAt;
    expect(appliedAt).not.toBeNull();
    expect(new Date(appliedAt ?? '').getTime()).toBeGreaterThanOrEqual(before);
    expect(result.record.history?.at(-1)?.to).toBe('APPLIED');
  });

  it('takes the incoming url, so the row tracks the link the client last saw', async () => {
    seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(result.record.url).toBe(POSTING_WITH_TAG);
    // The tag and the fragment are per-visit noise: the identity the row is deduplicated on cannot
    // move, or the next push would miss this row and duplicate the card.
    expect(storedRow('srv-web').urlKey).toBe(normalizeUrlKey(POSTING));
  });
});

describe('mergeUrlMatchedWrite · the rule on its own, with the clock held still', () => {
  const AT = new Date('2026-08-11T10:00:00.000Z');

  /** A `DRAFT` server row: the only state a push is allowed to move a row out of. */
  const draftRow = (): Parameters<typeof mergeUrlMatchedWrite>[0] => ({
    id: 'srv-web',
    company: 'Acme',
    role: 'Backend Engineer',
    url: POSTING,
    ats: 'greenhouse',
    status: 'DRAFT',
    appliedAt: null,
    notes: null,
    fillStats: null,
    history: [{ at: 1_750_000_000_000, to: 'DRAFT' }],
  });

  it('stamps appliedAt at the moment of the promotion, not from the client clock', () => {
    const data = mergeUrlMatchedWrite(
      draftRow(),
      freshInstallPush({ status: 'APPLIED', appliedAt: null }),
      AT,
    );

    expect(data.status).toBe('APPLIED');
    expect(data.appliedAt).toEqual(AT);
    expect(data.history).toEqual([
      { at: 1_750_000_000_000, to: 'DRAFT' },
      { at: 1_760_000_000_000, to: 'DRAFT' },
      { at: AT.getTime(), to: 'APPLIED' },
    ]);
  });

  it('is idempotent — the extension re-pushes every row on every sync', () => {
    const first = mergeUrlMatchedWrite(draftRow(), freshInstallPush({ status: 'APPLIED' }), AT);
    const settled = { ...draftRow(), status: 'APPLIED' as const, history: first.history };

    const second = mergeUrlMatchedWrite(settled, freshInstallPush({ status: 'APPLIED' }), AT);

    expect(second.history).toEqual(first.history);
  });
});

describe('upsertByClientId · the clientId path keeps create-or-replace semantics', () => {
  it('replaces the row wholesale when the client owns it', async () => {
    seedWebRow();

    const result = await jobApplicationRepo.upsertByClientId(
      USER,
      freshInstallPush({ clientId: 'client-web', notes: null, history: [] }),
    );

    expect(result.created).toBe(false);
    // The client is the authority on its own row: this is the path a status *correction* travels.
    expect(result.record.status).toBe('DRAFT');
    expect(result.record.notes).toBeNull();
  });

  it('inserts when neither the clientId nor the url matches', async () => {
    const result = await jobApplicationRepo.upsertByClientId(USER, freshInstallPush());

    expect(result.created).toBe(true);
    expect(fake.rows).toHaveLength(1);
  });

  it('refuses a clientId registered to another account', async () => {
    seedWebRow({ userId: 'someone-else' });

    await expect(
      jobApplicationRepo.upsertByClientId(USER, freshInstallPush({ clientId: 'client-web' })),
    ).rejects.toMatchObject({ code: 'CLIENT_ID_TAKEN' });
  });
});
