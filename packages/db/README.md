# `@repo/db`

Prisma schema, migration chain and the shared `prismaClient` singleton (`@repo/db/db`) used by
`apps/http-server`. Server-only — nothing in `apps/extension` may import this package
(JF-001 SEC 14.1 boundary rule R-3).

```
prisma/schema.prisma        the single source of truth for the model layer
prisma/migrations/**        forward-only chain, applied in lexical (timestamp) order
src/index.ts                exports prismaClient
tests/migrations.test.ts    executes the whole chain against real PostgreSQL (see below)
```

## Verifying the migration chain

Migrations used to be reviewed by eye, because running them needed a live Postgres. They are now
executed for real on every test run: `tests/migrations.test.ts` boots
[PGlite](https://pglite.dev) — PostgreSQL 18 compiled to WASM, running in-process — and applies
every `prisma/migrations/*/migration.sql` in Prisma's own order against a fresh, empty database.

No Postgres server, no Docker and no `DATABASE_URL` are involved. The suite never touches the
Neon database, and takes about three seconds.

```bash
pnpm --filter @repo/db test      # or: pnpm turbo run test --filter=@repo/db
```

It also runs as part of the repo-wide `pnpm turbo run test`.

### What the suite proves

| # | Guarantee | How |
|---|-----------|-----|
| 1 | The whole chain applies from empty, in order | every `migration.sql` is executed in lexical directory order; a failure names the migration and the SQLSTATE |
| 2 | The JF-001 tables have the shape SEC 7.4 specifies | `information_schema` / `pg_catalog` assertions on the columns, types and nullability of `ProfileBlob`, `JobApplication`, `SiteMapping`, `Device`, `UserGeminiKey`, their primary keys (including `SiteMapping`'s composite `userId + domain + sigHash`), the unique indexes, the secondary indexes and both enums with their exact label order |
| 3 | Deleting a user deletes their data (SEC 7.4) | every new FK is checked to be `ON DELETE CASCADE` in `pg_constraint`, **and** proved behaviourally: seed a user plus one row in each of the five tables, `DELETE FROM "Users"`, assert all five children are gone |
| 4 | The JF-001 migrations are additive-only (SEC 7.5) | snapshot every column of every table after the 13 pre-existing migrations, apply the two new ones, snapshot again, and assert the diff contains no dropped table, no dropped column, no retyped or re-nullabled column and no new column on a pre-existing table |
| 5 | Defaults and constraints behave | `JobApplication.status` defaults to `APPLIED`; `UserGeminiKey` defaults to `keyVersion = 1`, `strikes = 0`, `status = ACTIVE`; a duplicate `clientId` is rejected (`23505`); an out-of-range enum value is rejected (`22P02`); an orphan `userId` is rejected (`23503`) |

`prisma/migrations/**` and `schema.prisma` are inputs to this suite, never outputs — if a test
fails, fix the migration, do not relax the assertion.

> `updatedAt` columns are `NOT NULL` with **no** database default: Prisma's `@updatedAt` is applied
> client-side. Raw SQL inserts (including the ones in this suite) must supply it explicitly.

## Adding a migration

```bash
pnpm --filter @repo/db exec prisma migrate dev --name <change>
pnpm --filter @repo/db test
```

The suite picks new migration directories up automatically. It pins two facts that a new
migration must not silently change: the chain is lexically sorted, and
`20260807000001_jobfill_sync_models` is immediately followed by `20260807000002_web_byok_vault`
with 13 migrations before them.
