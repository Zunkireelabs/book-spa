# Local development (OrbStack)

Runs a full local Supabase stack (Postgres, Auth, PostgREST, Realtime, Storage, Studio) in Docker
containers under [OrbStack](https://orbstack.dev), completely isolated from the staging
(`snzcckzfmpboeqkktmwy`) and production (`pmbvogiphelmpjdalmtv`) cloud projects. Nothing in this
workflow ever makes a network call to either cloud project.

## One-time setup

```bash
brew install supabase/tap/supabase   # Supabase CLI
supabase init                        # already done — supabase/config.toml is checked in
```

OrbStack must be running and its `orbstack` Docker context active (`docker context use orbstack`
if it isn't already the default).

## Day-to-day workflow

```bash
supabase start                      # bring up local Postgres/Auth/Studio (OrbStack containers)
./scripts/local-db-bootstrap.sh     # apply schema.sql + rls.sql + migrations + seed.sql
cp .env.local .env                  # point the app at the local stack
npm start                           # http://localhost:4028
```

- **Studio** (table editor, SQL editor, auth users): http://127.0.0.1:54323
- **API**: http://127.0.0.1:54321
- **Mailpit** (catches local auth emails, magic links, etc.): http://127.0.0.1:54324
- `supabase status` reprints all local URLs/keys if you need them again.

### Reset and reseed

```bash
supabase db reset && ./scripts/local-db-bootstrap.sh
```

`supabase db reset` recreates an empty local database; the bootstrap script replays everything
back onto it.

### Stop

```bash
supabase stop
```

## Why a custom bootstrap script instead of `supabase db reset` alone

This repo's schema/RLS/migrations live in raw `supabase/schema.sql`, `supabase/rls.sql`, and
`supabase/migration-NNN-*.sql` files, applied by hand to staging/production per
`supabase/PROMOTION.md` — not in the Supabase CLI's `supabase/migrations/` convention. Rather than
restructure 60+ files and change that documented promotion workflow,
`scripts/local-db-bootstrap.sh` replays the existing raw files straight into the local OrbStack
Postgres via `psql`: `schema.sql` → `rls.sql` → migrations → `seed.sql`. This deviates from
`PROMOTION.md`'s documented "schema.sql → rls.sql → seed.sql → migrations" bootstrap order —
`seed.sql` inserts `branches.org_id`, a column added by the multi-tenancy migrations
(`009`/`010`), so it has to run after them; that dependency didn't exist when `PROMOTION.md` was
written. `[db.seed] enabled = false` in `supabase/config.toml` turns off the CLI's own auto-seed
step so it doesn't conflict with this.

## Known gaps vs. staging/production (documented, not hidden)

Discovered while getting a fresh bootstrap working end-to-end — these are pre-existing drift in
the raw SQL files, not something specific to local/OrbStack:

- **`migration-002-missing-tables.sql` is skipped locally.** `schema.sql` is a periodically
  re-exported snapshot that already absorbed migration-002's tables/columns/RLS policies (with
  differences — e.g. a later `attendance_status` enum) — replaying migration-002 verbatim on top
  collides (non-idempotent `CREATE TYPE`/`CREATE POLICY`). The one real gap this creates — 3
  trigger functions (`populate_booking_snapshots`, `log_booking_changes`,
  `enforce_attendance_day_lock`) that staging/production have live via migration-002 but
  `schema.sql`'s snapshot predates — is filled by `scripts/local-only-supplemental-triggers.sql`,
  which the bootstrap script runs automatically. Net effect: local behavior matches staging/prod;
  only the *replay path* differs.
- **`migration-050` is skipped**, per the exclusion already noted in `supabase/PROMOTION.md` (it
  was never committed/shipped to any environment).
- **The `pin-login` Edge Function isn't available locally** — it's dashboard-managed per cloud
  project (see the note in the root `CLAUDE.md`) and isn't in this repo. Email/password auth
  works locally; staff PIN login does not.

## `anon`/`authenticated` table grants (`auto_expose_new_tables`)

A fresh local CLI stack defaults to *not* auto-granting `SELECT`/etc. on new tables to the
`anon`/`authenticated` Data API roles (the newer, stricter Supabase platform default) — RLS
policies alone aren't enough; Postgres checks table-level grants first. Staging/production were
provisioned under the older platform default, which auto-grants. `supabase/config.toml` sets
`auto_expose_new_tables = true` to match that, so local behaves like staging/prod. If you ever see
`permission denied for table ...` locally despite the RLS policy looking right, this is why.

## Fixes made to get a fresh bootstrap working (apply to staging/prod too, not just local)

Two real bugs surfaced by replaying the SQL files top-to-bottom for the first time — both fixed
in the source files, not worked around locally only:

1. **`schema.sql`**: `bookings.customer_id` referenced `customers(id)` before the `customers`
   table existed later in the same file. Fixed by moving the column onto `bookings` via `ALTER
   TABLE` right after `customers` is created, instead of as a column in the original `CREATE
   TABLE bookings`.
2. **`migration-002-missing-tables.sql`**: its two `CREATE INDEX` statements for `customers`
   weren't guarded with `IF NOT EXISTS`, unlike the rest of that file's idempotent style. Fixed to
   match.
3. **`seed.sql`**: therapist rows didn't set `org_id`, which `migration-038` later made `NOT
   NULL`. Fixed to set it, matching the pattern already used for the `branches` insert.
