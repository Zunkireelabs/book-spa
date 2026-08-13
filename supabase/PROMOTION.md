# Database Promotion Runbook

How to promote database changes (schema migrations + credential/seed SQL) from **staging** to
**production**. This is the source of truth — follow it for every DB change.

## The two-database reality

Zenly runs **two completely separate Supabase databases that share no data**:

| Env | Project ref | Domain | How you reach it |
|-----|-------------|--------|------------------|
| Staging | `snzcckzfmpboeqkktmwy` | `dev-zenly.zunkireelabs.com` | Supabase **MCP** + dashboard |
| Production | `pmbvogiphelmpjdalmtv` | `zenly.zunkireelabs.com` | Dashboard SQL editor **only** (MCP does not reach prod) |

**Deploys ship frontend code only.** No CI job runs SQL. Merging `stage → main` deploys the React
app — it does **NOT** copy schema, rows, or migrations between the two databases. Every DB change
must be applied to **each** database by hand.

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
4. Add the new version to the **manifest** in the pending-check query below.

## Promotion order (every migration)

1. **Staging** — apply via Supabase MCP `apply_migration` (or the staging dashboard). Test the app.
2. **Git** — commit the migration on a feature branch → PR to `stage` → after testing, merge
   `stage → main`. (This records the file in the repo; it does **not** run any SQL.)
3. **Production** — open the prod dashboard SQL editor (`pmbvogiphelmpjdalmtv`) and **paste + run
   the same migration**. MCP cannot reach prod, so this step is manual by design.
4. **Confirm** — run the pending-check below against **production**. Empty result = up to date.

## Pending-check query ("what is this database missing?")

Paste into either database's SQL editor. Keep the `VALUES` manifest updated — add each new version
as you create it.

```sql
SELECT v AS pending
FROM (VALUES
  -- manifest: every migration version that should exist, in order.
  -- !!! WHEN YOU ADD A MIGRATION, APPEND ITS VERSION HERE !!!
  -- (an out-of-date manifest silently hides pending migrations — this is how the
  --  2026-06-13 prod "staff_transfers missing" outage happened; 038–041 were live
  --  on staging for days but the manifest still ended at 027.)
  ('001'),('002'),('003'),('004'),('005'),('006'),('007'),('008a'),('008b'),
  ('009'),('010'),('011'),('012'),('014'),('015'),('016'),('017'),('018'),
  ('019'),('020'),('021'),('022'),('023'),('024'),('025'),('026'),('027'),
  ('028'),('029'),('030'),('031'),('032'),('033'),('034'),('035'),('036'),
  ('037'),('038'),('039'),('040'),('041'),('042'),('043'),('044'),('045'),
  ('046'),('047'),('048'),('049'),('051'),('052'),('053'),('054'),('055'),
  ('056'),('057')
  -- 050 ('backfill-service-categories') intentionally excluded — file was never
  -- committed to the repo (held back from prod, per project notes); don't add it
  -- back here unless it actually ships.
  -- 053/054 = this change's admin_viewer role.
  -- <-- add new versions here
) t(v)
WHERE v NOT IN (SELECT version FROM public.schema_migrations)
ORDER BY v;
```

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
