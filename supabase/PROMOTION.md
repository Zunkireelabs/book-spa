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
| Staging | `snzcckzfmpboeqkktmwy` | `dev-app.zennly.io` / `dev-zenly.zunkireelabs.com` | Supabase **MCP** + dashboard |
| Production | `pmbvogiphelmpjdalmtv` | `app.zennly.io` / `zenly.zunkireelabs.com` | Dashboard SQL editor **only** (MCP does not reach prod) |

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

## Platform Admin (cross-tenant revenue share)

Implements commission tracking and multi-tenant dashboard access for platform admins. Migrations
`113–117` auto-apply via CI when merging to `main` (behind the `production-db` reviewer). The
following manual steps cannot be automated:

### 1. Create prod auth user and seed credentials

- [ ] **Create the auth user in the prod Supabase dashboard** (`pmbvogiphelmpjdalmtv`):
  - Open **Auth** → **Users**, click **Add user**.
  - Email: the platform admin's email (e.g., `ops@zunkireelabs.com`)
  - Password: strong/random (see step 4 below)
  - Confirm the user is created; copy their UUID for verification.

- [ ] **Run the seed script against production**:
  - Create `supabase/seed-prod-platform-admin.sql` (template: same shape as `seed-stage-platform-admin.sql`):
    ```sql
    -- supabase/seed-prod-platform-admin.sql
    -- Grants platform-admin to an existing auth user, by email. Idempotent.
    INSERT INTO public.platform_admins (user_id)
    SELECT id FROM auth.users WHERE email = 'ops@zunkireelabs.com'
    ON CONFLICT (user_id) DO NOTHING;
    ```
  - Paste and run in the prod Supabase dashboard SQL editor.
  - Verify the user is now in `public.platform_admins` (query: `SELECT user_id FROM public.platform_admins WHERE user_id = (SELECT id FROM auth.users WHERE email = 'ops@zunkireelabs.com');`).

### 2. Enable the feature flag in production

- [ ] **Update `.github/workflows/deploy.yml`**:
  - Locate the `build-push` job's Docker build-args.
  - Add (or update):
    ```yaml
    build-args: |
      VITE_ENABLE_PLATFORM_ADMIN=true
    ```
  - **Only add this when ready to go live.** Until enabled, production deploys with routes dark
    and the platform admin UI is unreachable.

### 3. Configure commission rates per client

- [ ] **Log in to the platform admin UI**:
  - Navigate to `app.zennly.io/platform/login`.
  - Use the email/password from step 1.
  - You are redirected to `/platform/dashboard` (lists all clients/orgs in a table).
  - Click a client row to open `/platform/dashboard/:orgId`.
  - In the **Commission rate history** section, click **Add rate** and fill in:
    - **Rate %**: commission percentage (e.g., 10.0).
    - **Basis**: VAT-inclusive or exclusive (per client negotiation).
    - **VAT %**: if applicable (e.g., 13.0 in Nepal).
    - **Effective from**: date the rate takes effect.
  - In the **Collections** section, click **Record** to log a payment received.
  - Repeat for each client.

### 4. Rotate and secure the password

- [ ] **Change the temporary password** (created in step 1):
  - Log out and use "Forgot password" in the app, or reset via the Supabase dashboard.
  - Choose a strong, unique password (minimum 16 characters, mixed case + digits + symbols).

- [ ] **Store credentials securely**:
  - Add the email and **new** password to your team secret manager (e.g., 1Password, LastPass).
  - **Never** commit credentials to the repository.
  - Rotate at least quarterly and after any team member departure.

### Known Limitations

- **Collection amount cap**: `org_commission_collections.amount_collected` is `numeric(10,2)`,
  limiting collection amounts to approximately 99,999,999.99 NPR per collection. Extremely
  unlikely to be hit in practice, but worth noting if a very large client's collections exceed
  this threshold (would require manual escalation/splitting).
