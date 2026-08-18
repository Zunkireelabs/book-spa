# Local Supabase dev setup

How to run this project's database locally, and how schema changes move from your
machine to staging to production. Replaces the old fully-manual flow described in
`PROMOTION.md` (kept for historical reference, marked deprecated).

## One-time setup

```bash
brew install supabase/tap/supabase   # if you don't have the CLI yet
cd bookX
supabase start
```

This boots a local Postgres + Studio + Auth + Storage stack (see `supabase/config.toml`
for ports — Studio is on `http://127.0.0.1:54323`). On first start it seeds the local DB
from, in order:

1. `supabase/baseline/schema.sql` — a full dump of the current **production** schema
2. `supabase/baseline/ledger.sql` — backfills `public.schema_migrations` so every
   historical version (through 063, as of the baseline date) is marked applied
3. `supabase/seed.sql` — demo data

`[db.migrations]` is deliberately `enabled = false` in `config.toml` — the historical
migration chain is **not** cleanly replayable from an empty database (some of the
early files predate the org/multi-tenant restructuring, and 13 migrations were
reconstructed from the final schema rather than being the literal original SQL — see
their header comments). Local dev starts from a real baseline snapshot instead.

## Day to day

```bash
supabase start   # boot the stack (idempotent, no-op if already running)
npm start        # Vite dev server on :4028, pointed at STAGING Supabase per .env.example
```

Local Postgres is for schema/migration work — day-to-day app development still talks
to the **staging** Supabase project by default (see `.env.example`), same as before
this change. Point at local Postgres only when you're specifically testing a new
migration.

## Writing a new migration

1. `ls supabase/migrations | sort` → next free number (currently past 063; check
   before you start, someone may have landed one since).
2. Copy `supabase/migrations/_TEMPLATE.sql` to `supabase/migrations/NNN_short-name.sql`.
3. Write idempotent DDL (see the template for the exact guard patterns).
4. End with the self-record insert — CI (`scripts/check-migrations.sh`) rejects a PR
   that adds a migration numbered ≥ 052 without one.
5. Test it locally: `scripts/migrate-apply.sh local --dry-run`, then without `--dry-run`.
6. Commit, push, open a PR to `stage`.

## How a migration actually reaches each environment

Unlike the old `PROMOTION.md` flow (paste into the staging dashboard, then separately
paste into the prod dashboard SQL editor), migrations are now applied by CI:

- **Staging**: `deploy-staging.yml`'s `migrate` job runs `scripts/migrate-apply.sh stage`
  automatically on every push to `stage`, before the new container starts.
- **Production**: `deploy.yml` detects whether a push to `main` touched
  `supabase/migrations/`. If so, the `migrate` job runs under the `production-db`
  GitHub Environment, which requires a reviewer to approve before it executes. Code-only
  deploys (no migration files touched) skip this job entirely — no approval pause.

Check what's actually applied anywhere with:

```bash
STAGE_DB_URL='...' scripts/migrate-status.sh stage
PROD_DB_URL='...' scripts/migrate-status.sh prod
```

Connection strings come from Supabase dashboard → your project → Settings → Database.
Never commit one to a file — export it in your shell for the one command that needs it.

## The 13 reconstructed migrations

`045`–`047`, `052`–`055`, `058`–`063` were originally applied by hand in the Supabase
dashboard SQL editor and never committed. They were reconstructed from the live
production schema on 2026-08-13 — each file's header says so explicitly. Treat them as
documentation of net effect, not as verified original history.
