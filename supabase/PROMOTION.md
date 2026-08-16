# Database Promotion Runbook

How to promote database changes (schema migrations + credential/seed SQL) from **staging** to
**production**. This is the source of truth — follow it for every DB change.

> [!NOTE]
> **Migrations are now applied automatically by CI, not by hand.** Every push to `stage` runs
> `scripts/migrate-apply.sh stage` against the staging DB before the app deploys. Every push to
> `main` that touches a `supabase/migration-NNN-*.sql` file runs `scripts/migrate-apply.sh prod`
> against the production DB, gated behind the `production-db` GitHub Environment's required
> reviewer — a human still approves before it runs, but no longer has to find + paste the SQL by
> hand or trust a manifest. `scripts/check-migrations.sh` enforces in CI that every new migration
> actually self-records (see "Writing a new migration" below — unchanged). The sections below
> describe *what* the automation does; you shouldn't need to run these steps by hand anymore
> except to investigate or recover from a failure.

## The two-database reality

Zenly runs **two completely separate Supabase databases that share no data**:

| Env | Project ref | Domain | How you reach it |
|-----|-------------|--------|------------------|
| Staging | `snzcckzfmpboeqkktmwy` | `dev-zenly.zunkireelabs.com` | Supabase **MCP** + dashboard |
| Production | `pmbvogiphelmpjdalmtv` | `zenly.zunkireelabs.com` | Dashboard SQL editor **only** (MCP does not reach prod) |

**App deploys and DB migrations are separate CI jobs against separate databases.** Merging
`stage → main` does **NOT** copy schema, rows, or migrations between the two databases — each push
runs its own `migrate-apply.sh` against that branch's database (see the automation note above).

The `public.schema_migrations` table (added by `migration-027`) records which migrations have run
in **that** database, so you can always tell what staging vs production is missing.

## Writing a new migration

1. Create `supabase/migration-NNN-short-name.sql` (next number after the highest existing file).
2. Make it **idempotent** — `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`, `… ON CONFLICT DO
   NOTHING`, guarded `ALTER`s — so re-running it is harmless.
3. **Record it at the end** of the file:
   ```sql
   INSERT INTO public.schema_migrations (version, name)
   VALUES ('NNN','short-name') ON CONFLICT (version) DO NOTHING;
   ```
4. That's it — `migrate-status.sh` (below) diffs `schema_migrations` against disk directly, so
   there's no manifest to keep updated.

## Promotion order (every migration)

1. **Staging** — commit the migration on a feature branch → PR to `stage`. Once merged,
   `scripts/migrate-apply.sh stage` runs automatically in CI before the app deploys. Test the app.
2. **Production** — after testing, PR `stage → main`. If the merge touches a
   `supabase/migration-NNN-*.sql` file, the `migrate` job in `.github/workflows/deploy.yml` runs
   `scripts/migrate-apply.sh prod` automatically, gated behind the `production-db` environment's
   required reviewer — approve that run in the Actions tab to let it proceed. The app deploy is
   blocked if this step fails.
3. **Confirm** — `PGHOST=... PGUSER=... PGDATABASE=... scripts/migrate-status.sh prod` shows
   nothing pending (leave `PGPASSWORD` unset locally — psql reads it from `~/.pgpass`).

**Manual fallback** (CI unavailable, or investigating a failed automated run): apply via Supabase
MCP `apply_migration` for staging, or the prod dashboard SQL editor (`pmbvogiphelmpjdalmtv`,
MCP cannot reach prod) — paste the same migration file. The self-recording `INSERT ...
ON CONFLICT (version) DO NOTHING` at the end of every migration makes this safe to combine with
the automated path; whichever runs first "wins" and the other is a no-op.

## Pending-check ("what is this database missing?")

```bash
PGHOST=db.snzcckzfmpboeqkktmwy.supabase.co PGUSER=postgres PGDATABASE=postgres \
  scripts/migrate-status.sh stage   # swap host/target for prod; PGPASSWORD comes from ~/.pgpass
```

Reads `public.schema_migrations` directly and diffs it against the `.sql` files on disk — no
hand-maintained manifest to go stale. (The old manifest-based pending-check query used to live
here; it's what silently hid the 038–041 migrations during the 2026-06-13 outage, since nobody
had appended their versions to it. `migrate-status.sh` structurally can't do that — it has no
manifest to fall out of sync.)

`013` and a standalone `001` file never existed — `001` represents the base schema
(`schema.sql` + `rls.sql`); `008` shipped as two files (`008a`, `008b`).

## Credentials / seed data (separate from migrations)

Credential and seed syncs are **data**, not schema — they are **not** recorded in
`schema_migrations` and are re-run as needed. Use the **portable, idempotent pattern** proven in
`supabase/seed-prod-nuad-credentials.sql`:

- Resolve **branches by name** and **users by email** (not by UUID) so the same script runs on
  both databases despite different IDs.
- Upsert with `ON CONFLICT … DO UPDATE`; ensure an `auth.identities` email row exists for password
  login; end with a verification `SELECT`.
- Touch **only** the listed users — never blanket-update.

**These files contain plaintext passwords/PINs — keep them UNTRACKED (never commit).** Run the
same script in the staging dashboard/MCP and the production dashboard.

## Bootstrapping a brand-new database

Run in order: `schema.sql` → `rls.sql` → then every `migration-NNN-*.sql` (`002` and `050` can be
skipped — see `supabase/LOCAL_DEV.md`) → `seed.sql` (or a tenant seed) last. `seed.sql` inserts
`branches.org_id`/`therapists.org_id`, columns added by the multi-tenancy migrations
(`009`/`010`/`038`), so it must run after migrations, not before. `schema.sql` already creates an
empty `schema_migrations` table; record migrations as you apply them.

For a working, scripted example of this exact order, see `scripts/local-db-bootstrap.sh` (used
for local OrbStack dev — see `supabase/LOCAL_DEV.md`).
