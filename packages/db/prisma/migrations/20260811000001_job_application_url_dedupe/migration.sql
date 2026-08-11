-- JF-001 · one Applied row per posting per user.
--
-- Sync deduplicates on "clientId", which is the extension's *local* Dexie row id. A reinstall, a
-- cleared local database, or the same posting applied to under two local profiles each mint a fresh
-- clientId, so the same application lands on the web Applied page twice. "urlKey" gives the server
-- an identity that outlives the local database: the posting url reduced to a stable key.

-- AlterTable
ALTER TABLE "public"."JobApplication" ADD COLUMN "urlKey" TEXT;

-- Backfill the rows that are already here, using the same reduction the repository applies on
-- write (see normalizeUrlKey in apps/http-server/src/repository/jobApplicationRepo.ts) — which in
-- turn mirrors normalizeApplicationUrl in apps/extension/src/tracker/service.ts, the identity the
-- extension keeps its own rows apart by. Drop the fragment, drop the *tracking* query parameters,
-- keep every other parameter (sorted), then drop the scheme, a leading "www." and trailing slashes.
--
-- Keeping the non-tracking parameters is the whole point: Indeed puts the job id in "?jk=", Taleo
-- in "?job=", SuccessFactors in "?career_job_req_id=", LinkedIn in "?currentJobId=". A key that
-- dropped the query string would make two unrelated postings on one host the *same* row, and the
-- url fallback in upsertByClientId would then overwrite one application with the other.
--
-- Only the host is lowercased — Greenhouse/Lever job tokens live in the path and are case
-- sensitive, so folding the whole url would merge two genuinely different postings.
WITH trimmed AS (
    SELECT
        ja."id",
        -- normalizeUrlKey opens with `url.trim()`, which removes *every* whitespace character, not
        -- the ASCII spaces btrim() removes: the tracker stores whatever the address bar held, and a
        -- url that arrived with a leading tab would otherwise backfill to a key the server can never
        -- emit again — the row stops being the one a push matches and the Applied page duplicates
        -- the card. "\s" here is PostgreSQL's [[:space:]] (space, tab, newline, CR, FF, VT), so the
        -- exotic Unicode spaces JavaScript also trims (NBSP, U+FEFF) still survive — that residual
        -- keys such a row more finely than the server would, which under-deduplicates (a second
        -- card) rather than merging two postings into one row.
        regexp_replace(ja."url", '^\s+|\s+$', '', 'g') AS url
    FROM "public"."JobApplication" ja
    WHERE ja."url" IS NOT NULL
),
split AS (
    SELECT
        t."id",
        -- Split at the *first* "?" only: a second one is part of the query, not a new query.
        CASE
            WHEN strpos(split_part(t.url, '#', 1), '?') = 0
                THEN split_part(t.url, '#', 1)
            ELSE left(
                split_part(t.url, '#', 1),
                strpos(split_part(t.url, '#', 1), '?') - 1
            )
        END AS before_query,
        CASE
            WHEN strpos(split_part(t.url, '#', 1), '?') = 0 THEN ''
            ELSE substr(
                split_part(t.url, '#', 1),
                strpos(split_part(t.url, '#', 1), '?') + 1
            )
        END AS raw_query
    FROM trimmed t
),
stripped AS (
    SELECT
        s."id",
        regexp_replace(
            regexp_replace(
                regexp_replace(s.before_query, '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''),
                '^www\.', '', 'i'
            ),
            '/+$', ''
        ) AS rest,
        s.raw_query
    FROM split s
),
normalized AS (
    SELECT
        st."id",
        -- A url that reduces to nothing ("https://", " ") is no identity at all, so it stays NULL —
        -- and NULL propagates through the concatenation below, query string or not.
        NULLIF(
            lower(split_part(st.rest, '/', 1)) || substr(st.rest, length(split_part(st.rest, '/', 1)) + 1),
            ''
        ) AS base,
        -- Segments are kept byte for byte, which is a deliberate divergence from the extension:
        -- normalizeApplicationUrl round-trips the query through URLSearchParams, so "?q=a%20b" and
        -- "?q=a+b" are one identity to it, as are "?flag" and "?flag=", while both stay two keys
        -- here. Reproducing that would mean percent-decoding and re-encoding inside this migration
        -- *and* inside normalizeUrlKey, and the decoded form no longer sorts the way COLLATE "C"
        -- sorts — the ordering below is only reproducible in SQL because it compares raw bytes.
        -- The divergence errs in the safe direction: a *finer* server key at worst leaves the user
        -- with a second Applied card (visible, editable, mergeable by hand), whereas a coarser one
        -- would let a push land on a different posting's row. Half-normalising is worse than
        -- neither, so this stays raw until the whole identity moves somewhere both sides can share.
        COALESCE(
            (
                SELECT string_agg(seg, '&' ORDER BY seg COLLATE "C")
                FROM unnest(string_to_array(st.raw_query, '&')) AS seg
                WHERE seg <> ''
                  -- The TRACKING_PARAM denylist, character for character, from
                  -- apps/extension/src/tracker/service.ts. Matched against the segment's key (what
                  -- precedes the first "="), exactly as the repository matches it.
                  AND split_part(seg, '=', 1) !~*
                      '^(utm_|gh_|mc_|_ga$|ref$|source$|src$|fbclid$|gclid$|msclkid$|trk$|trackingId$|lever-source|iis$|iisn$)'
            ),
            ''
        ) AS query
    FROM stripped st
)
UPDATE "public"."JobApplication" ja
-- Raw "key=value" segments, sorted by bytes: COLLATE "C" is collation *independent*, which is what
-- makes this ordering identical to the code-unit `.sort()` the repository uses. A locale-aware
-- ordering here would key old rows differently from the ones the server writes from now on.
SET "urlKey" = CASE WHEN n.query = '' THEN n.base ELSE n.base || '?' || n.query END
FROM normalized n
WHERE ja."id" = n."id";

-- A database that already collected duplicates cannot take the unique index. Deleting a user's rows
-- from a migration is not a trade this project makes, so instead only the freshest row of each
-- duplicate group keeps its key: the older copies stay on the Applied page, fully editable, they
-- simply stop being the row a future push will match. New duplicates cannot form after this point.
WITH ranked AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "userId", "urlKey"
            ORDER BY "updatedAt" DESC, "id" DESC
        ) AS rn
    FROM "public"."JobApplication"
    WHERE "urlKey" IS NOT NULL
)
UPDATE "public"."JobApplication" ja
SET "urlKey" = NULL
FROM ranked r
WHERE ja."id" = r."id" AND r.rn > 1;

-- CreateIndex
-- Partial on purpose: rows with no url (a manually added application, an ATS the tracker could not
-- read a permalink from) must never collide with each other. The name is the one Prisma generates
-- for `@@unique([userId, urlKey])`, so schema.prisma and this index stay the same object.
--
-- ⚠ KNOWN DIVERGENCE — do not "fix" it by dropping the WHERE clause.
-- Prisma's schema language cannot express a partial index, so schema.prisma declares a *total*
-- `@@unique([userId, urlKey])` — the closest legal declaration — while this migration creates the
-- partial one the database actually runs. Production and CI are unaffected (both run
-- `prisma migrate deploy`, which applies files and never diffs), but `prisma migrate dev` and
-- `prisma migrate diff` will report drift and offer to recreate this index without the predicate.
-- Take the drift, not the offer: url-less rows must stay out of the index entirely, which is the
-- same rule normalizeUrlKey encodes by returning NULL for a url it cannot reduce — no url, no
-- identity, no deduplication. (A total index would *permit* them too, since Postgres defaults to
-- NULLS DISTINCT, but it would index every url-less row for nothing and erase the intent.) If the
-- migration ever has to be regenerated, re-add this WHERE clause by hand. packages/db/tests/
-- migrations.test.ts asserts the index is partial, so dropping the predicate turns that suite red.
CREATE UNIQUE INDEX "JobApplication_userId_urlKey_key"
    ON "public"."JobApplication"("userId", "urlKey")
    WHERE "urlKey" IS NOT NULL;
