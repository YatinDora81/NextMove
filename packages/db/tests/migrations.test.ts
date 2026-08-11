/**
 * JF-001 · the migration chain, actually executed.
 *
 * There is no Postgres server in this repo's dev/CI environment, so for a long time the JF-001
 * migrations were only ever *read*. This suite runs them for real: @electric-sql/pglite is
 * PostgreSQL 18 compiled to WASM, so `migration.sql` is executed by the same parser, planner and
 * catalogue code that Neon would use in production.
 *
 * What is proved here:
 *   1. the whole chain applies, in Prisma's lexical order, from an empty database;
 *   2. the five new tables exist with the exact columns / keys / indexes / enums SEC 7.4 specifies;
 *   3. every new foreign key is `ON DELETE CASCADE` — asserted in the catalogue *and* behaviourally;
 *   4. the JF-001 migrations are additive-only (SEC 7.5: "Existing models are never edited by
 *      these migrations — additions only"), enforced by diffing information_schema before/after;
 *   5. the column defaults and uniqueness constraints behave the way the server code assumes;
 *   6. the `urlKey` backfill reduces a url to the same key `normalizeUrlKey` computes in the
 *      server, which is the identity the Applied page's deduplication is built on.
 *
 * Nothing here writes to a real database and nothing reads DATABASE_URL.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite, type Results } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Location of the chain
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);

/** The migrations JF-001 adds, in order. Everything sorting before them is the pre-existing chain. */
const JOBFILL_MIGRATION = '20260807000001_jobfill_sync_models';
const BYOK_MIGRATION = '20260807000002_web_byok_vault';
/** Adds `JobApplication.urlKey` + its partial unique index, and backfills the existing rows. */
const URL_DEDUPE_MIGRATION = '20260811000001_job_application_url_dedupe';
const JF001_MIGRATIONS = [JOBFILL_MIGRATION, BYOK_MIGRATION, URL_DEDUPE_MIGRATION] as const;

/** The chain that shipped before JF-001 (SEC 7.5 calls it "13 shipped"). */
const PRE_EXISTING_MIGRATION_COUNT = 13;

const NEW_TABLES = [
  'ProfileBlob',
  'JobApplication',
  'SiteMapping',
  'Device',
  'UserGeminiKey',
] as const;
type NewTable = (typeof NEW_TABLES)[number];

// ---------------------------------------------------------------------------
// Migration plumbing
// ---------------------------------------------------------------------------

/**
 * Prisma applies migrations in lexical directory order — the timestamp prefix *is* the ordering.
 * `Array.prototype.sort()` compares UTF-16 code units, which is exactly that order for these
 * ASCII names, so this reproduces `prisma migrate deploy` without shelling out to it.
 */
function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readMigrationSql(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
}

function describeSqlError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const code = typeof record['code'] === 'string' ? ` [SQLSTATE ${record['code']}]` : '';
    const detail = typeof record['detail'] === 'string' ? ` — ${record['detail']}` : '';
    const message = error instanceof Error ? error.message : String(error);
    return `${message}${code}${detail}`;
  }
  return String(error);
}

/** Executes one migration.sql, surfacing the migration name alongside the raw SQL error. */
async function applyMigration(db: PGlite, name: string): Promise<void> {
  try {
    await db.exec(readMigrationSql(name));
  } catch (error) {
    throw new Error(
      `migration "${name}" failed to apply: ${describeSqlError(error)}`,
      { cause: error },
    );
  }
}

/** A fresh in-memory PostgreSQL with `names` applied in the given order. Caller closes it. */
async function migratedDatabase(names: readonly string[]): Promise<PGlite> {
  const db = await PGlite.create();
  try {
    for (const name of names) {
      await applyMigration(db, name);
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}

function firstRow<T>(result: Results<T>, what: string): T {
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`expected at least one row for ${what}, got none`);
  }
  return row;
}

/**
 * Runs `statement` and returns the SQLSTATE + message Postgres rejected it with.
 * Fails loudly if the statement is *accepted* — an assertion that a constraint bites is worthless
 * if the "rejection" path can be reached by the statement quietly succeeding.
 */
async function expectRejection(
  run: () => Promise<unknown>,
  what: string,
): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
    return {
      code: typeof record['code'] === 'string' ? record['code'] : '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error(`expected Postgres to reject ${what}, but the statement succeeded`);
}

// ---------------------------------------------------------------------------
// Catalogue readers
// ---------------------------------------------------------------------------

const TIMESTAMP = 'timestamp without time zone';

interface ColumnShape {
  readonly dataType: string;
  readonly udtName: string;
  readonly nullable: boolean;
}

const notNull = (dataType: string, udtName: string = dataType): ColumnShape => ({
  dataType,
  udtName,
  nullable: false,
});
const nullable = (dataType: string, udtName: string = dataType): ColumnShape => ({
  dataType,
  udtName,
  nullable: true,
});
/** Enum-typed columns report `data_type = 'USER-DEFINED'`; the enum name lives in `udt_name`. */
const enumColumn = (typeName: string): ColumnShape => ({
  dataType: 'USER-DEFINED',
  udtName: typeName,
  nullable: false,
});

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

async function readColumns(db: PGlite, tables?: readonly string[]): Promise<ColumnRow[]> {
  const filter = tables === undefined ? '' : 'AND table_name = ANY($1)';
  const sql = `
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' ${filter}
    ORDER BY table_name, ordinal_position`;
  const result =
    tables === undefined
      ? await db.query<ColumnRow>(sql)
      : await db.query<ColumnRow>(sql, [[...tables]]);
  return result.rows;
}

/** `{ TableName: { columnName: ColumnShape } }` for the given tables. */
async function readColumnShapes(
  db: PGlite,
  tables: readonly string[],
): Promise<Record<string, Record<string, ColumnShape>>> {
  const shapes: Record<string, Record<string, ColumnShape>> = {};
  for (const table of tables) {
    shapes[table] = {};
  }
  for (const row of await readColumns(db, tables)) {
    const table = shapes[row.table_name] ?? (shapes[row.table_name] = {});
    table[row.column_name] = {
      dataType: row.data_type,
      udtName: row.udt_name,
      nullable: row.is_nullable === 'YES',
    };
  }
  return shapes;
}

interface IndexRow {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  is_partial: boolean;
  columns: string[] | null;
}

/**
 * Physical indexes, with their key columns *in order*. Prisma emits `@@unique`/`@unique` as bare
 * `CREATE UNIQUE INDEX` (not `ADD CONSTRAINT ... UNIQUE`), so uniqueness has to be read off
 * pg_index rather than pg_constraint — a contype='u' check would find nothing and pass vacuously.
 *
 * `is_partial` is read as "has a predicate at all" rather than as the predicate's text: the text is
 * whatever `pg_get_expr` chooses to print in a given PostgreSQL release, while the presence of a
 * predicate is the thing the schema depends on (see JobApplication_userId_urlKey_key, which
 * schema.prisma cannot declare as partial).
 */
async function readIndexes(db: PGlite, tables: readonly string[]): Promise<IndexRow[]> {
  const result = await db.query<IndexRow>(
    `SELECT rel.relname   AS table_name,
            cls.relname   AS index_name,
            idx.indisunique  AS is_unique,
            idx.indisprimary AS is_primary,
            (idx.indpred IS NOT NULL) AS is_partial,
            (SELECT array_agg(att.attname ORDER BY k.ord)
               FROM unnest(idx.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute att
                 ON att.attrelid = idx.indrelid AND att.attnum = k.attnum) AS columns
     FROM pg_index idx
     JOIN pg_class cls     ON cls.oid = idx.indexrelid
     JOIN pg_class rel     ON rel.oid = idx.indrelid
     JOIN pg_namespace ns  ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public' AND rel.relname = ANY($1)
     ORDER BY rel.relname, cls.relname`,
    [[...tables]],
  );
  return result.rows;
}

interface ForeignKeyRow {
  table_name: string;
  constraint_name: string;
  columns: string[] | null;
  ref_table: string | null;
  ref_columns: string[] | null;
  on_delete: string;
  on_update: string;
}

async function readForeignKeys(db: PGlite, tables: readonly string[]): Promise<ForeignKeyRow[]> {
  const result = await db.query<ForeignKeyRow>(
    `SELECT rel.relname AS table_name,
            con.conname  AS constraint_name,
            (SELECT array_agg(att.attname ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute att
                 ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns,
            ref.relname AS ref_table,
            (SELECT array_agg(att.attname ORDER BY k.ord)
               FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute att
                 ON att.attrelid = con.confrelid AND att.attnum = k.attnum) AS ref_columns,
            con.confdeltype AS on_delete,
            con.confupdtype AS on_update
     FROM pg_constraint con
     JOIN pg_class rel    ON rel.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     LEFT JOIN pg_class ref ON ref.oid = con.confrelid
     WHERE ns.nspname = 'public' AND con.contype = 'f' AND rel.relname = ANY($1)
     ORDER BY rel.relname, con.conname`,
    [[...tables]],
  );
  return result.rows;
}

interface EnumRow {
  type_name: string;
  labels: string[];
}

async function readEnums(db: PGlite): Promise<Map<string, string[]>> {
  const result = await db.query<EnumRow>(
    `SELECT typ.typname AS type_name,
            array_agg(enu.enumlabel ORDER BY enu.enumsortorder) AS labels
     FROM pg_type typ
     JOIN pg_enum enu     ON enu.enumtypid = typ.oid
     JOIN pg_namespace ns ON ns.oid = typ.typnamespace
     WHERE ns.nspname = 'public'
     GROUP BY typ.typname`,
  );
  return new Map(result.rows.map((row) => [row.type_name, row.labels]));
}

async function countRows(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "public".${JSON.stringify(table)}`,
  );
  return firstRow(result, `count of ${table}`).n;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-cascade-1';

async function insertUser(db: PGlite, id: string): Promise<void> {
  // `updatedAt` is NOT NULL with no database default — Prisma's `@updatedAt` is applied by the
  // client, not by Postgres — so every insert in this file supplies it explicitly.
  await db.query(`INSERT INTO "public"."Users" ("id", "email", "updatedAt") VALUES ($1, $2, NOW())`, [
    id,
    `${id}@example.test`,
  ]);
}

/** One row in each of the five new tables, owned by `userId`. */
async function insertOneChildPerTable(db: PGlite, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO "public"."ProfileBlob" ("id", "userId", "ciphertext", "nonce", "version", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    ['blob-1', userId, new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7]), 1],
  );
  await db.query(
    `INSERT INTO "public"."JobApplication" ("id", "userId", "clientId", "company", "role", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    ['app-1', userId, 'client-app-1', 'Acme', 'Backend Engineer'],
  );
  await db.query(
    `INSERT INTO "public"."SiteMapping" ("userId", "domain", "sigHash", "profilePath", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, 'boards.greenhouse.io', 'sig-abc', 'identity.email'],
  );
  await db.query(
    `INSERT INTO "public"."Device" ("id", "userId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())`,
    ['device-1', userId, 'Chrome · work laptop'],
  );
  await db.query(
    `INSERT INTO "public"."UserGeminiKey"
       ("id", "userId", "label", "ciphertext", "iv", "authTag", "last4", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      'key-1',
      userId,
      'personal',
      new Uint8Array([10, 11, 12]),
      new Uint8Array([13, 14, 15]),
      new Uint8Array([16, 17, 18]),
      'ab12',
    ],
  );
}

// ---------------------------------------------------------------------------
// Expected schema — SEC 7.4 / 15.3, transcribed from schema.prisma
// ---------------------------------------------------------------------------

const EXPECTED_COLUMNS: Record<NewTable, Record<string, ColumnShape>> = {
  ProfileBlob: {
    id: notNull('text'),
    userId: notNull('text'),
    ciphertext: notNull('bytea'),
    nonce: notNull('bytea'),
    version: notNull('integer', 'int4'),
    updatedAt: notNull(TIMESTAMP, 'timestamp'),
  },
  JobApplication: {
    id: notNull('text'),
    userId: notNull('text'),
    clientId: notNull('text'),
    company: notNull('text'),
    role: notNull('text'),
    url: nullable('text'),
    // `url` reduced to the server's "same posting, same user" key — nullable, because a url the
    // tracker could not reduce means no identity rather than a shared empty one.
    urlKey: nullable('text'),
    ats: nullable('text'),
    status: enumColumn('JobAppStatus'),
    appliedAt: nullable(TIMESTAMP, 'timestamp'),
    notes: nullable('text'),
    fillStats: nullable('jsonb'),
    history: nullable('jsonb'),
    updatedAt: notNull(TIMESTAMP, 'timestamp'),
  },
  SiteMapping: {
    userId: notNull('text'),
    domain: notNull('text'),
    sigHash: notNull('text'),
    profilePath: notNull('text'),
    updatedAt: notNull(TIMESTAMP, 'timestamp'),
  },
  Device: {
    id: notNull('text'),
    userId: notNull('text'),
    name: nullable('text'),
    lastSeen: nullable(TIMESTAMP, 'timestamp'),
    createdAt: notNull(TIMESTAMP, 'timestamp'),
    updatedAt: notNull(TIMESTAMP, 'timestamp'),
  },
  UserGeminiKey: {
    id: notNull('text'),
    userId: notNull('text'),
    label: notNull('text'),
    ciphertext: notNull('bytea'),
    iv: notNull('bytea'),
    authTag: notNull('bytea'),
    keyVersion: notNull('integer', 'int4'),
    last4: notNull('text'),
    status: enumColumn('AiKeyStatus'),
    strikes: notNull('integer', 'int4'),
    cooldownUntil: nullable(TIMESTAMP, 'timestamp'),
    lastUsedAt: nullable(TIMESTAMP, 'timestamp'),
    createdAt: notNull(TIMESTAMP, 'timestamp'),
    updatedAt: notNull(TIMESTAMP, 'timestamp'),
  },
};

const EXPECTED_PRIMARY_KEYS: Record<NewTable, readonly string[]> = {
  ProfileBlob: ['id'],
  JobApplication: ['id'],
  // SEC 7.4: SiteMapping has no surrogate id — the composite key IS the identity of a mapping.
  SiteMapping: ['userId', 'domain', 'sigHash'],
  Device: ['id'],
  UserGeminiKey: ['id'],
};

interface IndexShape {
  readonly table: NewTable;
  readonly unique: boolean;
  /** True when the index carries a `WHERE` predicate — see JobApplication_userId_urlKey_key. */
  readonly partial: boolean;
  readonly columns: readonly string[];
}

/** Every non-primary-key index the JF-001 migrations create, keyed by index name. */
const EXPECTED_SECONDARY_INDEXES: Record<string, IndexShape> = {
  ProfileBlob_userId_key: {
    table: 'ProfileBlob',
    unique: true,
    partial: false,
    columns: ['userId'],
  },
  JobApplication_clientId_key: {
    table: 'JobApplication',
    unique: true,
    partial: false,
    columns: ['clientId'],
  },
  // The server's "one row per posting per user" rule. `partial: true` is load-bearing: schema.prisma
  // can only declare a *total* `@@unique([userId, urlKey])`, so this expectation is what stops the
  // next `prisma migrate dev` drift-fix from quietly indexing every url-less row.
  JobApplication_userId_urlKey_key: {
    table: 'JobApplication',
    unique: true,
    partial: true,
    columns: ['userId', 'urlKey'],
  },
  JobApplication_userId_status_appliedAt_idx: {
    table: 'JobApplication',
    unique: false,
    partial: false,
    columns: ['userId', 'status', 'appliedAt'],
  },
  Device_userId_idx: { table: 'Device', unique: false, partial: false, columns: ['userId'] },
  UserGeminiKey_userId_status_idx: {
    table: 'UserGeminiKey',
    unique: false,
    partial: false,
    columns: ['userId', 'status'],
  },
};

const EXPECTED_ENUMS: Record<string, readonly string[]> = {
  JobAppStatus: ['DRAFT', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'GHOSTED'],
  AiKeyStatus: ['ACTIVE', 'COOLDOWN', 'EXHAUSTED', 'DEAD'],
};

// ---------------------------------------------------------------------------
// 1 · the chain applies from empty
// ---------------------------------------------------------------------------

describe('migration chain', () => {
  const migrations = listMigrations();

  it('is ordered with the JF-001 migrations appended to the 13 shipped ones', () => {
    expect(migrations).toEqual([...migrations].sort());

    const jobfillIndex = migrations.indexOf(JOBFILL_MIGRATION);
    expect(jobfillIndex, `${JOBFILL_MIGRATION} is missing from ${MIGRATIONS_DIR}`).toBeGreaterThan(-1);
    // The JF-001 migrations are consecutive and in this order — urlKey's backfill reads rows the
    // first of them creates, so it cannot sort before it.
    expect(migrations.slice(jobfillIndex, jobfillIndex + JF001_MIGRATIONS.length)).toEqual([
      ...JF001_MIGRATIONS,
    ]);
    expect(migrations.slice(0, jobfillIndex)).toHaveLength(PRE_EXISTING_MIGRATION_COUNT);

    for (const name of migrations) {
      expect(readMigrationSql(name).trim().length, `${name}/migration.sql is empty`).toBeGreaterThan(0);
    }
  });

  it('applies every migration, in order, against an empty PostgreSQL database', async () => {
    const db = await PGlite.create();
    try {
      const applied: string[] = [];
      for (const name of migrations) {
        // applyMigration rethrows with the migration name + SQLSTATE, so a failure here names
        // the exact migration that PostgreSQL refused.
        await applyMigration(db, name);
        applied.push(name);
      }
      expect(applied).toEqual(migrations);

      const tables = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      const tableNames = tables.rows.map((row) => row.table_name);
      expect(tableNames).toContain('Users');
      for (const table of NEW_TABLES) {
        expect(tableNames).toContain(table);
      }
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 2 + 3a · resulting schema shape
// ---------------------------------------------------------------------------

describe('schema produced by the JF-001 migrations', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migratedDatabase(listMigrations());
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates each new table with exactly the columns SEC 7.4 specifies', async () => {
    const actual = await readColumnShapes(db, NEW_TABLES);
    // toEqual on the whole map catches missing columns, wrong types, wrong nullability *and*
    // stray extra columns in one shot.
    expect(actual).toEqual(EXPECTED_COLUMNS);
  });

  it('creates the primary keys, including SiteMapping\'s composite key', async () => {
    const indexes = await readIndexes(db, NEW_TABLES);
    const primaryKeys: Record<string, string[]> = {};
    for (const index of indexes) {
      if (index.is_primary) {
        primaryKeys[index.table_name] = index.columns ?? [];
      }
    }
    expect(primaryKeys).toEqual(EXPECTED_PRIMARY_KEYS);
  });

  it('creates every unique constraint and secondary index', async () => {
    const indexes = await readIndexes(db, NEW_TABLES);
    const secondary: Record<string, IndexShape> = {};
    for (const index of indexes) {
      if (index.is_primary) continue;
      const table = index.table_name;
      if (!(NEW_TABLES as readonly string[]).includes(table)) continue;
      secondary[index.index_name] = {
        table: table as NewTable,
        unique: index.is_unique,
        partial: index.is_partial,
        columns: index.columns ?? [],
      };
    }
    expect(secondary).toEqual(EXPECTED_SECONDARY_INDEXES);
  });

  it('creates both enums with the exact labels, in order', async () => {
    const enums = await readEnums(db);
    for (const [typeName, labels] of Object.entries(EXPECTED_ENUMS)) {
      expect(enums.get(typeName), `enum "${typeName}" was not created`).toEqual([...labels]);
    }
  });

  it('points every new foreign key at Users(id) with ON DELETE CASCADE', async () => {
    const foreignKeys = await readForeignKeys(db, NEW_TABLES);

    // Exactly one FK per new table, no more.
    expect(foreignKeys.map((fk) => fk.table_name).sort()).toEqual([...NEW_TABLES].sort());

    for (const fk of foreignKeys) {
      expect(fk.columns, `${fk.constraint_name} should key off userId`).toEqual(['userId']);
      expect(fk.ref_table, `${fk.constraint_name} should reference Users`).toBe('Users');
      expect(fk.ref_columns, `${fk.constraint_name} should reference Users(id)`).toEqual(['id']);
      // pg_constraint.confdeltype / confupdtype: 'c' = CASCADE, 'a' = NO ACTION, 'r' = RESTRICT.
      expect(fk.on_delete, `${fk.constraint_name} must be ON DELETE CASCADE`).toBe('c');
      expect(fk.on_update, `${fk.constraint_name} must be ON UPDATE CASCADE`).toBe('c');
    }
  });
});

// ---------------------------------------------------------------------------
// 3b · cascade, proved behaviourally
// ---------------------------------------------------------------------------

describe('deleting a user cascades to every JF-001 table', () => {
  it('removes the ProfileBlob, JobApplication, SiteMapping, Device and UserGeminiKey rows', async () => {
    const db = await migratedDatabase(listMigrations());
    try {
      await insertUser(db, USER_ID);
      await insertOneChildPerTable(db, USER_ID);

      // Guard against a vacuous pass: the rows must genuinely be there first.
      for (const table of NEW_TABLES) {
        expect(await countRows(db, table), `${table} should hold the seeded row`).toBe(1);
      }

      await db.query(`DELETE FROM "public"."Users" WHERE "id" = $1`, [USER_ID]);

      expect(await countRows(db, 'Users')).toBe(0);
      for (const table of NEW_TABLES) {
        expect(
          await countRows(db, table),
          `${table} still has rows after the owning user was deleted — the FK is not ON DELETE CASCADE`,
        ).toBe(0);
      }
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 4 · additive-only (SEC 7.5)
// ---------------------------------------------------------------------------

interface ColumnSnapshot extends ColumnShape {
  readonly columnDefault: string | null;
}

function snapshotKey(table: string, column: string): string {
  return `${table}.${column}`;
}

function tableOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

async function snapshotSchema(db: PGlite): Promise<Map<string, ColumnSnapshot>> {
  const snapshot = new Map<string, ColumnSnapshot>();
  for (const row of await readColumns(db)) {
    snapshot.set(snapshotKey(row.table_name, row.column_name), {
      dataType: row.data_type,
      udtName: row.udt_name,
      nullable: row.is_nullable === 'YES',
      columnDefault: row.column_default,
    });
  }
  return snapshot;
}

function formatColumn(shape: ColumnSnapshot): string {
  return `${shape.udtName} ${shape.nullable ? 'NULL' : 'NOT NULL'} default=${shape.columnDefault ?? 'none'}`;
}

describe('the JF-001 migrations are additive-only (SEC 7.5)', () => {
  it('adds tables and columns without editing, retyping or dropping anything pre-existing', async () => {
    const migrations = listMigrations();
    const jobfillIndex = migrations.indexOf(JOBFILL_MIGRATION);
    const preExisting = migrations.slice(0, jobfillIndex);
    const jf001 = migrations.slice(jobfillIndex);
    expect(preExisting).toHaveLength(PRE_EXISTING_MIGRATION_COUNT);
    expect(jf001).toEqual([...JF001_MIGRATIONS]);

    const db = await migratedDatabase(preExisting);
    try {
      const before = await snapshotSchema(db);
      expect(before.size).toBeGreaterThan(0);

      for (const name of jf001) {
        await applyMigration(db, name);
      }
      const after = await snapshotSchema(db);

      const beforeTables = new Set([...before.keys()].map(tableOf));
      const afterTables = new Set([...after.keys()].map(tableOf));

      const droppedTables = [...beforeTables].filter((table) => !afterTables.has(table)).sort();
      expect(droppedTables, 'JF-001 dropped a pre-existing table').toEqual([]);

      const droppedColumns = [...before.keys()].filter((key) => !after.has(key)).sort();
      expect(droppedColumns, 'JF-001 dropped a pre-existing column').toEqual([]);

      const changedColumns: string[] = [];
      for (const [key, was] of before) {
        const now = after.get(key);
        if (now === undefined) continue;
        if (
          was.dataType !== now.dataType ||
          was.udtName !== now.udtName ||
          was.nullable !== now.nullable ||
          was.columnDefault !== now.columnDefault
        ) {
          changedColumns.push(`${key}: ${formatColumn(was)} -> ${formatColumn(now)}`);
        }
      }
      expect(changedColumns, 'JF-001 altered a pre-existing column').toEqual([]);

      // The only additions are whole new tables — no pre-existing table gains a column either.
      const addedTables = [...afterTables].filter((table) => !beforeTables.has(table)).sort();
      expect(addedTables).toEqual([...NEW_TABLES].sort());

      const addedColumnsInOldTables = [...after.keys()]
        .filter((key) => !before.has(key) && beforeTables.has(tableOf(key)))
        .sort();
      expect(
        addedColumnsInOldTables,
        'JF-001 added a column to a pre-existing table',
      ).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 5 · defaults and constraints
// ---------------------------------------------------------------------------

describe('defaults and constraints behave as the server code assumes', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migratedDatabase(listMigrations());
    await insertUser(db, 'user-defaults-1');
  });

  afterAll(async () => {
    await db.close();
  });

  it('defaults JobApplication.status to APPLIED', async () => {
    await db.query(
      `INSERT INTO "public"."JobApplication" ("id", "userId", "clientId", "company", "role", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      ['app-defaults', 'user-defaults-1', 'client-defaults', 'Acme', 'Backend Engineer'],
    );
    const row = firstRow(
      await db.query<{ status: string; url: string | null; fillStats: unknown }>(
        `SELECT "status", "url", "fillStats" FROM "public"."JobApplication" WHERE "id" = $1`,
        ['app-defaults'],
      ),
      'JobApplication defaults',
    );
    expect(row.status).toBe('APPLIED');
    expect(row.url).toBeNull();
    expect(row.fillStats).toBeNull();
  });

  it('defaults UserGeminiKey keyVersion to 1, strikes to 0 and status to ACTIVE', async () => {
    await db.query(
      `INSERT INTO "public"."UserGeminiKey"
         ("id", "userId", "label", "ciphertext", "iv", "authTag", "last4", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        'key-defaults',
        'user-defaults-1',
        'personal',
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
        'cd34',
      ],
    );
    const row = firstRow(
      await db.query<{
        keyVersion: number;
        strikes: number;
        status: string;
        cooldownUntil: unknown;
        lastUsedAt: unknown;
      }>(
        `SELECT "keyVersion", "strikes", "status", "cooldownUntil", "lastUsedAt"
         FROM "public"."UserGeminiKey" WHERE "id" = $1`,
        ['key-defaults'],
      ),
      'UserGeminiKey defaults',
    );
    expect(row.keyVersion).toBe(1);
    expect(row.strikes).toBe(0);
    expect(row.status).toBe('ACTIVE');
    expect(row.cooldownUntil).toBeNull();
    expect(row.lastUsedAt).toBeNull();
  });

  it('rejects a duplicate JobApplication.clientId (idempotent sync depends on this)', async () => {
    await db.query(
      `INSERT INTO "public"."JobApplication" ("id", "userId", "clientId", "company", "role", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      ['app-dup-a', 'user-defaults-1', 'client-dup', 'Acme', 'Backend Engineer'],
    );
    const rejection = await expectRejection(
      () =>
        db.query(
          `INSERT INTO "public"."JobApplication" ("id", "userId", "clientId", "company", "role", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          ['app-dup-b', 'user-defaults-1', 'client-dup', 'Acme', 'Backend Engineer'],
        ),
      'a second JobApplication row with an existing clientId',
    );
    expect(rejection.code).toBe('23505'); // unique_violation
    expect(rejection.message).toContain('JobApplication_clientId_key');
  });

  it('rejects a second row on the same (userId, urlKey) — one Applied card per posting', async () => {
    await db.query(
      `INSERT INTO "public"."JobApplication"
         ("id", "userId", "clientId", "company", "role", "url", "urlKey", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        'app-url-a',
        'user-defaults-1',
        'client-url-a',
        'Acme',
        'SRE',
        'https://www.indeed.com/viewjob?jk=111',
        'indeed.com/viewjob?jk=111',
      ],
    );
    const rejection = await expectRejection(
      () =>
        db.query(
          `INSERT INTO "public"."JobApplication"
             ("id", "userId", "clientId", "company", "role", "url", "urlKey", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            'app-url-b',
            'user-defaults-1',
            'client-url-b',
            'Acme',
            'SRE',
            'https://www.indeed.com/viewjob?jk=111&utm_source=email',
            'indeed.com/viewjob?jk=111',
          ],
        ),
      'a second JobApplication row on a urlKey the user already tracks',
    );
    expect(rejection.code).toBe('23505');
    expect(rejection.message).toContain('JobApplication_userId_urlKey_key');
  });

  it('lets one user keep many rows with no urlKey (the index is partial)', async () => {
    // Manually added applications and ATSs the tracker could not read a permalink from all land
    // here. They have no identity, so they must not be forced into sharing one.
    for (const suffix of ['a', 'b', 'c']) {
      await db.query(
        `INSERT INTO "public"."JobApplication" ("id", "userId", "clientId", "company", "role", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [`app-nokey-${suffix}`, 'user-defaults-1', `client-nokey-${suffix}`, 'Globex', 'Data Eng'],
      );
    }
    const count = firstRow(
      await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "public"."JobApplication"
         WHERE "userId" = $1 AND "urlKey" IS NULL`,
        ['user-defaults-1'],
      ),
      'url-less JobApplication rows',
    );
    expect(count.n).toBeGreaterThanOrEqual(3);
  });

  it('rejects a value that is not a JobAppStatus member', async () => {
    const rejection = await expectRejection(
      () =>
        db.query(
          `INSERT INTO "public"."JobApplication"
             ("id", "userId", "clientId", "company", "role", "status", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          ['app-bad-enum', 'user-defaults-1', 'client-bad-enum', 'Acme', 'Backend Engineer', 'SUBMITTED'],
        ),
      'a JobApplication row with an out-of-range status',
    );
    expect(rejection.code).toBe('22P02'); // invalid_text_representation
    expect(rejection.message).toContain('JobAppStatus');
  });

  it('rejects a value that is not an AiKeyStatus member', async () => {
    const rejection = await expectRejection(
      () =>
        db.query(
          `INSERT INTO "public"."UserGeminiKey"
             ("id", "userId", "label", "ciphertext", "iv", "authTag", "last4", "status", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            'key-bad-enum',
            'user-defaults-1',
            'personal',
            new Uint8Array([1]),
            new Uint8Array([2]),
            new Uint8Array([3]),
            'ef56',
            'THROTTLED',
          ],
        ),
      'a UserGeminiKey row with an out-of-range status',
    );
    expect(rejection.code).toBe('22P02');
    expect(rejection.message).toContain('AiKeyStatus');
  });

  it('requires updatedAt — Prisma @updatedAt is client-side, the column has no DB default', async () => {
    const rejection = await expectRejection(
      () =>
        db.query(
          `INSERT INTO "public"."JobApplication" ("id", "userId", "clientId", "company", "role")
           VALUES ($1, $2, $3, $4, $5)`,
          ['app-no-updated-at', 'user-defaults-1', 'client-no-updated-at', 'Acme', 'Backend Engineer'],
        ),
      'a JobApplication row with no updatedAt',
    );
    expect(rejection.code).toBe('23502'); // not_null_violation
    expect(rejection.message).toContain('updatedAt');
  });

  it('rejects a child row whose userId does not exist', async () => {
    const rejection = await expectRejection(
      () =>
        db.query(
          `INSERT INTO "public"."Device" ("id", "userId", "updatedAt") VALUES ($1, $2, NOW())`,
          ['device-orphan', 'no-such-user'],
        ),
      'a Device row pointing at a non-existent user',
    );
    expect(rejection.code).toBe('23503'); // foreign_key_violation
    expect(rejection.message).toContain('Device_userId_fkey');
  });
});

// ---------------------------------------------------------------------------
// 6 · the urlKey backfill agrees with the server's normalizeUrlKey
// ---------------------------------------------------------------------------

interface BackfillCase {
  readonly id: string;
  readonly url: string | null;
  readonly urlKey: string | null;
  readonly why: string;
}

/**
 * Transcribed from `normalizeUrlKey` in apps/http-server/src/repository/jobApplicationRepo.ts,
 * which is itself a mirror of `normalizeApplicationUrl` in apps/extension/src/tracker/service.ts.
 *
 * The three implementations are one identity written three times, and this table is where a drift
 * between them shows up: a backfilled key that does not match what the server computes on the next
 * push means the push misses the row it belongs to (a duplicate Applied card), while a key that is
 * *coarser* than the server's means the push matches a row that tracks a different posting and
 * overwrites it.
 */
const BACKFILL_CASES: readonly BackfillCase[] = [
  {
    id: 'bf-indeed-111',
    url: 'https://www.indeed.com/viewjob?jk=111',
    urlKey: 'indeed.com/viewjob?jk=111',
    why: 'Indeed carries the job id in ?jk=, so the query string is the posting',
  },
  {
    id: 'bf-indeed-222',
    url: 'https://www.indeed.com/viewjob?jk=222',
    urlKey: 'indeed.com/viewjob?jk=222',
    why: 'a second Indeed posting on the same path must not share the first one key',
  },
  {
    id: 'bf-taleo',
    url: 'https://acme.taleo.net/careersection/jobdetail.ftl?job=42&src=linkedin',
    urlKey: 'acme.taleo.net/careersection/jobdetail.ftl?job=42',
    why: 'Taleo ?job= survives, the ?src= referral tag does not',
  },
  {
    id: 'bf-successfactors',
    url: 'https://career5.successfactors.eu/careers?career_job_req_id=987&utm_source=x',
    urlKey: 'career5.successfactors.eu/careers?career_job_req_id=987',
    why: 'SuccessFactors ?career_job_req_id= survives, utm_* does not',
  },
  {
    id: 'bf-linkedin',
    url: 'https://www.linkedin.com/jobs/view?currentJobId=555&trk=guest_homepage',
    urlKey: 'linkedin.com/jobs/view?currentJobId=555',
    why: 'LinkedIn ?currentJobId= survives, ?trk= does not',
  },
  {
    id: 'bf-greenhouse',
    url: 'https://boards.greenhouse.io/acme/jobs/12?gh_src=abc&utm_campaign=x&ref=y',
    urlKey: 'boards.greenhouse.io/acme/jobs/12',
    why: 'a query made only of tracking params leaves no query at all',
  },
  {
    id: 'bf-sorted',
    url: 'https://Careers.example.com/apply?b=2&a=1#/step2',
    urlKey: 'careers.example.com/apply?a=1&b=2',
    why: 'params are sorted, the fragment is dropped and only the host is lowercased',
  },
  {
    id: 'bf-case-path',
    url: 'https://www.Example.com/Jobs/AbC/',
    urlKey: 'example.com/Jobs/AbC',
    why: 'www., scheme and trailing slash go; the case-sensitive path token stays',
  },
  {
    id: 'bf-empty-query',
    url: 'https://example.com/jobs?',
    urlKey: 'example.com/jobs',
    why: 'a bare ? is not a query',
  },
  {
    id: 'bf-unreducible',
    url: 'https://',
    urlKey: null,
    why: 'a url that reduces to nothing is no identity — it must stay NULL, not become an empty key',
  },
  {
    id: 'bf-whitespace-only',
    url: ' \t\n',
    urlKey: null,
    why: 'a url that is nothing but whitespace reduces to nothing, exactly as .trim() leaves it',
  },
  {
    id: 'bf-leading-tab',
    url: '\thttps://www.indeed.com/viewjob?jk=333',
    urlKey: 'indeed.com/viewjob?jk=333',
    why: 'normalizeUrlKey opens with .trim(), which is all whitespace and not only ASCII spaces',
  },
  {
    id: 'bf-plus-encoded-space',
    url: 'https://example.com/jobs?q=a+b',
    urlKey: 'example.com/jobs?q=a+b',
    why: 'query segments keep their exact bytes — see the URLSearchParams note below',
  },
  {
    id: 'bf-percent-encoded-space',
    url: 'https://example.com/jobs?q=a%20b',
    urlKey: 'example.com/jobs?q=a%20b',
    why: '…so %20 is deliberately a different key from +, which under-deduplicates and never over-',
  },
  {
    id: 'bf-valueless-param',
    url: 'https://example.com/jobs?flag',
    urlKey: 'example.com/jobs?flag',
    why: 'a bare flag keeps its exact bytes too, where URLSearchParams would render it flag=',
  },
  {
    id: 'bf-no-url',
    url: null,
    urlKey: null,
    why: 'a manually added application has no url to key off',
  },
];

/**
 * Surrounding whitespace is not part of a posting's identity: `normalizeUrlKey` opens with
 * `url.trim()`, so a url the tracker recorded with a stray tab or newline must key exactly as the
 * bare url does. One case per whitespace character both JavaScript's `trim()` and PostgreSQL's
 * `\s` recognise — a backfill that trims a narrower set writes keys the server can never emit
 * again, and the row silently stops being the one a push matches.
 *
 * Each case gets its own path so a mismatch shows up as a wrong key rather than as the dedupe pass
 * NULLing the losers of a duplicate group.
 */
const WHITESPACE_PADS = [' ', '\t', '\n', '\r', '\f', '\v', ' \t\n'] as const;

const WHITESPACE_CASES: readonly BackfillCase[] = WHITESPACE_PADS.map((pad, index) => ({
  id: `bf-ws-${index}`,
  url: `${pad}https://www.example.com/ws/${index}/${pad}`,
  urlKey: `example.com/ws/${index}`,
  why: `padded with ${JSON.stringify(pad)}`,
}));

/** Two urls that are genuinely the same posting: the backfill must let only one keep the key. */
const DUPLICATE_URLS: readonly { id: string; url: string }[] = [
  { id: 'bf-dup-older', url: 'https://jobs.lever.co/acme/abc-123?lever-source=Indeed' },
  { id: 'bf-dup-newer', url: 'https://www.jobs.lever.co/acme/abc-123/?utm_medium=email' },
];

const BACKFILL_USER = 'user-backfill-1';

async function insertPreBackfillRow(
  db: PGlite,
  id: string,
  url: string | null,
  updatedAt: string,
): Promise<void> {
  // No "urlKey" column yet — that is the point: these rows predate the migration under test.
  await db.query(
    `INSERT INTO "public"."JobApplication"
       ("id", "userId", "clientId", "company", "role", "url", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, BACKFILL_USER, `client-${id}`, 'Acme', 'Backend Engineer', url, updatedAt],
  );
}

describe('the urlKey backfill computes the key the server will compute', () => {
  let db: PGlite;

  beforeAll(async () => {
    const migrations = listMigrations();
    const beforeBackfill = migrations.slice(0, migrations.indexOf(URL_DEDUPE_MIGRATION));
    db = await migratedDatabase(beforeBackfill);
    await insertUser(db, BACKFILL_USER);
    for (const testCase of [...BACKFILL_CASES, ...WHITESPACE_CASES]) {
      await insertPreBackfillRow(db, testCase.id, testCase.url, '2026-08-01T00:00:00Z');
    }
    // Deliberately staggered: the dedupe pass keeps the freshest row of a duplicate group.
    await insertPreBackfillRow(db, 'bf-dup-older', DUPLICATE_URLS[0]?.url ?? null, '2026-08-01T00:00:00Z');
    await insertPreBackfillRow(db, 'bf-dup-newer', DUPLICATE_URLS[1]?.url ?? null, '2026-08-02T00:00:00Z');
    // The migration is what is under test here, so it runs *after* the rows exist.
    await applyMigration(db, URL_DEDUPE_MIGRATION);
  });

  afterAll(async () => {
    await db.close();
  });

  async function urlKeyOf(id: string): Promise<string | null> {
    const row = firstRow(
      await db.query<{ urlKey: string | null }>(
        `SELECT "urlKey" FROM "public"."JobApplication" WHERE "id" = $1`,
        [id],
      ),
      `urlKey of ${id}`,
    );
    return row.urlKey;
  }

  for (const testCase of BACKFILL_CASES) {
    it(`keys ${testCase.url ?? 'a row with no url'} — ${testCase.why}`, async () => {
      expect(await urlKeyOf(testCase.id)).toBe(testCase.urlKey);
    });
  }

  it('trims every whitespace character JavaScript trims, not just ASCII spaces', async () => {
    for (const testCase of WHITESPACE_CASES) {
      expect(await urlKeyOf(testCase.id), `${testCase.id} — ${testCase.why}`).toBe(testCase.urlKey);
    }
  });

  it('keeps two postings that differ only in the query string apart', async () => {
    // The failure this guards is not a missed de-duplication but a destroyed row: one key for both
    // postings lets the server's url fallback update the first application with the second one data.
    const first = await urlKeyOf('bf-indeed-111');
    const second = await urlKeyOf('bf-indeed-222');
    expect(first).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it('leaves the key on only the freshest row of a duplicate group', async () => {
    expect(await urlKeyOf('bf-dup-newer')).toBe('jobs.lever.co/acme/abc-123');
    // The older copy stays on the Applied page, it simply stops being the row a push will match.
    expect(await urlKeyOf('bf-dup-older')).toBeNull();
    const kept = firstRow(
      await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "public"."JobApplication" WHERE "id" IN ($1, $2)`,
        ['bf-dup-older', 'bf-dup-newer'],
      ),
      'rows in the duplicate group',
    );
    expect(kept.n, 'the backfill must never delete a row').toBe(2);
  });

  it('writes keys that survive being reduced again (the server re-keys on every push)', async () => {
    // A backfilled key is fed straight back into the identity on the next sync — the row's own key
    // is compared against `normalizeUrlKey(url)`. Reducing an already-reduced key must therefore
    // change nothing: no scheme, no "www.", no trailing slash, no fragment, params already sorted.
    const keys = await db.query<{ urlKey: string }>(
      `SELECT "urlKey" FROM "public"."JobApplication"
       WHERE "userId" = $1 AND "urlKey" IS NOT NULL`,
      [BACKFILL_USER],
    );
    expect(keys.rows.length).toBeGreaterThan(0);
    for (const { urlKey } of keys.rows) {
      expect(urlKey, `${urlKey} still carries a scheme`).not.toMatch(/^[a-z][a-z0-9+.-]*:\/\//i);
      expect(urlKey, `${urlKey} still carries a www.`).not.toMatch(/^www\./i);
      expect(urlKey, `${urlKey} still carries a fragment`).not.toContain('#');
      expect(urlKey, `${urlKey} ends in a slash`).not.toMatch(/\/$/);
      const query = urlKey.includes('?') ? urlKey.slice(urlKey.indexOf('?') + 1) : '';
      const segments = query.length > 0 ? query.split('&') : [];
      expect(segments, `${urlKey} has unsorted query params`).toEqual([...segments].sort());
    }
  });
});
