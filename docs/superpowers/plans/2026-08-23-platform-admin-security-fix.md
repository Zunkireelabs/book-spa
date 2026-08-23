# Platform Admin — Security Fix (migration 118) Implementation Plan

> **For the executor:** This is a small, single-migration follow-up on branch
> `feature/platform-admin-revenue-share`. Do the work on that branch (check it out; it already holds
> migrations 113–117 + the frontend). Use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** Close a HIGH-severity cross-tenant revenue leak found in post-implementation review: four
`SECURITY DEFINER` helper functions are callable by any authenticated tenant user with an arbitrary
`p_org_id`, exposing other tenants' sales/commission. Revoke their execute grants so only the gated
rollup (as definer-owner) can call them.

**Spec / review source:** `docs/superpowers/specs/2026-08-23-platform-admin-revenue-share-design.md`
and the review that produced this plan.

## Background (why)

Supabase auto-grants `EXECUTE` to `PUBLIC`/`anon`/`authenticated` on every new function; there is no
global `ALTER DEFAULT PRIVILEGES` revoke in this repo (see `migration-039`'s comment:
*"REVOKE FROM PUBLIC alone does NOT remove those role-specific grants"*). These four helpers —
`platform_org_sales_base` (migration 116), `platform_org_category_breakdown`,
`platform_org_branch_breakdown`, `platform_commission_for_range` (migration 117) — are `SECURITY
DEFINER` (bypass RLS), take a caller-supplied `p_org_id`, and have **no `is_platform_admin()` gate**.
Three are explicitly granted to `authenticated`; the fourth is auto-granted despite a comment claiming
otherwise. Result: any logged-in staff of any tenant can call e.g.
`rpc('platform_org_category_breakdown', { p_org_id: '<other org>', ... })` and read another client's
revenue.

The six top-level RPCs the frontend uses (`platform_get_revenue_rollup`, `platform_get_org_bookings`,
`platform_list_rates`, `platform_list_collections`, `platform_set_commission_rate`,
`platform_record_collection`) are all self-gated and stay as-is. `platformApi.js` never calls the four
helpers directly — they are internal to the rollup — so revoking is safe.

## Global constraints

- **Do NOT edit migrations 116/117 in place.** They are already applied on staging and recorded in
  `schema_migrations`, so an in-place edit would never re-run there, and forward-only is the repo rule.
  Fix via a **new migration 118**.
- New migration self-records into `schema_migrations`; version string must equal the filename NNN.
  Confirm `118` is free first (`ls supabase/migration-*.sql | sed -E 's#.*migration-([0-9]+).*#\1#' |
  sort -n | tail`). If taken, use the next free number and update the version string to match.
- psql to staging via `~/.pgpass` (host `aws-1-ap-south-1.pooler.supabase.com`, port `5432` per the
  prior session's working config, DB user `postgres.snzcckzfmpboeqkktmwy`, db `postgres`). Do not paste
  passwords.
- Commit attribution: `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`, no Claude
  branding.

---

## Task 1: Add migration 118 (revoke internal helpers)

**Files:**
- Create: `supabase/migration-118-revoke-internal-commission-helpers.sql`

- [ ] **Step 1: Confirm the leak exists (red)** — call a helper without the platform-admin gate. From a
  raw psql (`postgres` role) it will NOT prove the leak (owner has rights), so instead confirm the
  functions currently carry an `authenticated` execute grant:

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 5432 -U postgres.snzcckzfmpboeqkktmwy -d postgres -c "
  SELECT p.proname, r.rolname AS grantee
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  JOIN pg_roles r ON r.oid = a.grantee
  WHERE n.nspname='public'
    AND p.proname IN ('platform_org_sales_base','platform_org_category_breakdown',
                      'platform_org_branch_breakdown','platform_commission_for_range')
    AND a.privilege_type='EXECUTE'
  ORDER BY 1,2;"
```
Expected (the bug): rows showing `authenticated` (and possibly `PUBLIC`/`anon`) as grantee on these
functions. (If `proacl` is null for a function, default PUBLIC execute applies — also a leak.)

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-118-revoke-internal-commission-helpers.sql
-- SECURITY FIX. The revenue helpers below are SECURITY DEFINER and take an
-- arbitrary p_org_id with no is_platform_admin() gate. They must be callable
-- ONLY by the gated platform_get_revenue_rollup (as its definer-owner), never
-- by tenant users directly — otherwise any authenticated staff can read any
-- org's revenue/commission. Supabase auto-grants EXECUTE to
-- PUBLIC/anon/authenticated on new functions (see migration-039), so revoke all
-- three explicitly per function. The rollup keeps working because a
-- SECURITY DEFINER function calls these as its owner, which retains EXECUTE.

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'public.platform_org_sales_base(uuid,date,date)',
    'public.platform_org_category_breakdown(uuid,date,date)',
    'public.platform_org_branch_breakdown(uuid,date,date)',
    'public.platform_commission_for_range(uuid,date,date)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
  END LOOP;
END $$;

-- Defense in depth: gate the one plpgsql helper directly too (cheap; the two
-- LANGUAGE sql breakdowns rely on the revoke above).
CREATE OR REPLACE FUNCTION public.platform_commission_for_range(
  p_org_id uuid, p_from date, p_to date
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  r RECORD;
  v_overlap_from date;
  v_overlap_to   date;
  v_base numeric;
  v_total numeric := 0;
  v_any boolean := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT rate_percent, commission_basis, vat_rate_percent, effective_from, effective_to
    FROM public.org_commission_rates
    WHERE org_id = p_org_id
  LOOP
    v_overlap_from := GREATEST(p_from, r.effective_from);
    v_overlap_to   := LEAST(p_to, COALESCE(r.effective_to, v_today));
    IF v_overlap_from <= v_overlap_to THEN
      v_any := true;
      v_base := public.platform_org_sales_base(p_org_id, v_overlap_from, v_overlap_to);
      IF r.commission_basis = 'vat_exclusive' THEN
        v_base := v_base / (1 + r.vat_rate_percent / 100.0);
      END IF;
      v_total := v_total + v_base * r.rate_percent / 100.0;
    END IF;
  END LOOP;
  IF NOT v_any THEN RETURN NULL; END IF;
  RETURN round(v_total, 2);
END $$;

-- CREATE OR REPLACE re-applies default PUBLIC execute — re-revoke this one.
REVOKE ALL ON FUNCTION public.platform_commission_for_range(uuid,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_commission_for_range(uuid,date,date) FROM anon;
REVOKE ALL ON FUNCTION public.platform_commission_for_range(uuid,date,date) FROM authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('118', 'revoke-internal-commission-helpers') ON CONFLICT (version) DO NOTHING;
```

> Note the ordering: the `CREATE OR REPLACE` of `platform_commission_for_range` re-adds default PUBLIC
> execute, so it is re-revoked *after* the replace. The other three are only revoked (not replaced), so
> the leading `DO $$` loop is sufficient for them.

- [ ] **Step 3: Apply to staging**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 5432 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/migration-118-revoke-internal-commission-helpers.sql
```

- [ ] **Step 4: Verify grants gone (green)** — re-run the Step 1 query.
Expected: **zero rows** for `authenticated`/`anon`/`PUBLIC` on all four functions (no explicit grantees;
`proacl` now excludes them). The rollup still owns/executes internally.

- [ ] **Step 5: Verify the leak is closed with a real tenant JWT** — using a **staging staff user's**
  session (NOT the service role), call each helper against a different org and confirm rejection. Easiest
  path: in the running staging app, open the browser console while logged in as an ordinary staff user and
  run:

```js
const { data, error } = await window.supabase /* or the app's client */
  .rpc('platform_org_category_breakdown', { p_org_id: '<some other org uuid>', p_from: '2026-08-01', p_to: '2026-08-23' });
console.log({ data, error });
```
Expected: `error` is a permission-denied (`42501` / "permission denied for function
platform_org_category_breakdown"), `data` is null. Repeat for `platform_org_sales_base`,
`platform_org_branch_breakdown`, `platform_commission_for_range`.

- [ ] **Step 6: Verify the rollup still works** — as the platform admin (`supabasePlatform` session on
  `/platform/dashboard`), confirm the dashboard still loads with populated `revenue_by_category`,
  `revenue_by_branch`, and commission columns. This proves the definer rollup still reaches the revoked
  helpers internally.

- [ ] **Step 7: Migration guard**

```bash
bash scripts/check-migrations.sh
```
Expected: passes for 118.

- [ ] **Step 8: Commit**

```bash
git add supabase/migration-118-revoke-internal-commission-helpers.sql
git commit -m "fix(db): revoke tenant execute on internal revenue helpers — close cross-org leak (migration 118)

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>"
```

---

## Task 2 (optional, non-blocking): minor cleanups

Only do these if quick; otherwise skip and note in the PR.

- [ ] **F2 — avoid double commission compute.** In `platform_get_revenue_rollup` (migration 116), the
  `commission_owed_to_date` value is computed and then computed **again** inside `net_owed`. Optional: add
  it once in a LATERAL (e.g. `owed AS (SELECT public.platform_commission_for_range(o.id, fr.first_from,
  v_today) AS val)`) and reference `owed.val` in both keys. Requires a new migration (do not edit 116).
  Correctness is already fine — this is only a perf tidy. Recommend deferring unless the dashboard is slow.
- [ ] **F4 — churned-org visibility.** rollup filters `WHERE o.is_active`, hiding inactive orgs that may
  still owe commission. Confirm with the user whether that's intended before changing.

(F3 label tweak and F5 voucher-void/membership-refund limitation are documentation-only; leave as noted in
the spec's edge-cases.)

---

## Task 3: Push + open PR to stage

- [ ] **Step 1: Push**

```bash
git push -u origin feature/platform-admin-revenue-share
```

- [ ] **Step 2: Open PR targeting `stage`** (never `main`)

```bash
gh pr create --base stage \
  --title "Platform admin: cross-tenant revenue share (Phase 1)" \
  --body "Implements docs/superpowers/specs/2026-08-23-platform-admin-revenue-share-design.md.

Flag-gated (VITE_ENABLE_PLATFORM_ADMIN): staging on, prod off.
Drill-in served via SECURITY DEFINER RPC (deviation from spec's RLS exception — closes a branch-name gap and loosens zero tenant RLS).
Migration 118 hardens four internal revenue helpers (revokes tenant EXECUTE) after a post-implementation review found they were callable cross-tenant.

Pre-prod-go-live checklist lives in supabase/PROMOTION.md (manual: prod auth user + seed, enable flag in deploy.yml, rotate password, 2-tab session-isolation spot-check).

Created by @sthasadin"
```

- [ ] **Step 3: Confirm the PR base is `stage`, not `main`.**

---

## Done when

- Migration 118 applied on staging; the four helpers reject a real tenant JWT; the platform dashboard
  still renders full breakdowns; `check-migrations.sh` passes; PR open against `stage` with the note above.
