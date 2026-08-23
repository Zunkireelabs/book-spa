# Platform Admin & Cross-Tenant Revenue Share — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single super-admin credential that logs in at `/platform/login`, sees per-tenant total sales (drawer basis: non-wallet bookings + voucher/membership top-ups, counted once) split by category and branch for any date range, applies a per-org commission rate (rate history + VAT-inclusive/exclusive basis), and tracks commission owed vs collected.

**Architecture:** Cross-org reads are choke-pointed through `SECURITY DEFINER` Postgres RPCs gated on `public.is_platform_admin()` — **no RLS policy on any existing tenant table is modified**. New commission tables have RLS enabled with no policies (deny-all to `authenticated`; only the definer RPCs, which run as table owner and bypass RLS, touch them). The frontend runs an isolated third Supabase client (`supabasePlatform`, own `storageKey`) with its own `PlatformAuthContext` and route guard, mounted per-route so it never collides with the staff `AuthContext.onAuthStateChange` listener.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS + Auth), Tailwind (design tokens), date-fns, `CustomSelect` shared component, plpgsql RPCs returning `jsonb`.

**Spec:** `docs/superpowers/specs/2026-08-23-platform-admin-revenue-share-design.md`

> **⚠ Deviation from spec, flagged for approval:** The spec (option C) adds `OR public.is_platform_admin()` to SELECT RLS on `bookings`/`payments`/`services` for the drill-in. This plan instead serves the drill-in via one `SECURITY DEFINER` RPC (`platform_get_org_bookings`, Task 11) and modifies **no** existing RLS. Reason: the drill-in also needs `branches.name`, which isn't in the spec's 3-table exception set, so the RLS approach was already incomplete; the RPC closes that gap and loosens zero tenant tables. If you prefer the literal spec approach, replace Task 11 with three `ALTER POLICY` statements (exact text is in the spec's "Drill-in" section) plus a 4th on `branches`.

## Global Constraints

- **Migration numbering:** New migrations are `supabase/migration-NNN-slug.sql`, three-digit zero-padded. This plan uses **113–117**, assuming the base branch is `stage` (which carries outreach migrations 101–112). **Task 0 verifies this** — if the base branch lacks 101–112, renumber down; if other work has taken 113+, renumber up. Numbers must be contiguous-free, not necessarily sequential with prod.
- **Every migration self-records** into `public.schema_migrations` with the exact idempotent tail (enforced by `scripts/check-migrations.sh`):
  ```sql
  INSERT INTO public.schema_migrations (version, name)
  VALUES ('NNN', 'slug') ON CONFLICT (version) DO NOTHING;
  ```
  `version` must exactly equal the filename's NNN.
- **`SECURITY DEFINER` function style** (copy from `migration-011`): `SECURITY DEFINER` + `STABLE`/`VOLATILE` + `SET search_path = public` + explicit `GRANT EXECUTE ... TO authenticated`. Every platform RPC's **first statement** is `IF NOT public.is_platform_admin() THEN RAISE EXCEPTION '...' USING ERRCODE = '42501'; END IF;`.
- **No JS test runner exists** (per CLAUDE.md). The TDD "test" cycle is: DB tasks → red/green via `psql` verification queries against **staging** (`~/.pgpass` is configured; DB `snzcckzfmpboeqkktmwy`, host `aws-1-ap-south-1.pooler...`). Frontend tasks → `npm run build` must pass + the stated manual check. Never claim a task done without running its verification and seeing the expected output.
- **Branch off `stage`**, PRs target `stage` (never `main`). Commit attribution: `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`, no Claude branding.
- **Dropdowns use `CustomSelect`**, never native `<select>`. Z-index uses semantic tokens. Money renders via `formatNPR`.
- **Money is counted once (drawer basis)** — wallet payment modes to EXCLUDE from booking income: `'Membership'`, `'ReferralWallet'`, `'VoucherWallet'`, `'ReferralVoucher'`.

---

## Task 0: Confirm base branch & migration numbers

**Files:** none (verification only)

- [ ] **Step 1: Branch off stage**

```bash
git fetch origin stage
git checkout -b feature/platform-admin-revenue-share origin/stage
```

- [ ] **Step 2: List existing migrations, confirm 113–117 are free**

```bash
ls supabase/migration-*.sql | sed -E 's#.*migration-([0-9]+).*#\1#' | sort -n | tail -20
```
Expected: highest is `112` (outreach). If `113`–`117` already exist, shift this plan's numbers up to the next free contiguous block and adjust every migration filename + its `schema_migrations` version string accordingly. If the base branch tops out at `099` (outreach not present), you may use `100`–`104` instead — but prefer branching off `stage` so numbers align with what CI will apply.

- [ ] **Step 3: Confirm staging DB reachable**

```bash
psql "$(grep snzcckzfmpboeqkktmwy ~/.pgpass >/dev/null && echo 'service=zenly-stage' )" -c 'select 1' 2>/dev/null \
  || psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres -c 'select 1'
```
Expected: prints `1`. (Uses `~/.pgpass` for auth — do not paste a password.) If this fails, stop and resolve connectivity before continuing; every DB task verifies against this DB.

---

## Task 1: `platform_admins` table + `is_platform_admin()` (migration 113)

**Files:**
- Create: `supabase/migration-113-platform-admins.sql`

**Interfaces:**
- Produces: table `public.platform_admins(user_id uuid PK, created_at timestamptz)`; function `public.is_platform_admin() returns boolean` (used by every later RPC).

- [ ] **Step 1: Write the verification query (red)** — run BEFORE the migration exists

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.is_platform_admin();"
```
Expected: FAILS with `function public.is_platform_admin() does not exist` (confirms clean slate).

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-113-platform-admins.sql
-- Platform-wide super-admin identity. A user is "platform admin" iff they have
-- a row here. No org_id anywhere = not tenant-scoped. Deny-all RLS; only
-- SECURITY DEFINER RPCs (which bypass RLS as table owner) touch this table.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies => authenticated/anon cannot read or write directly.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('113', 'platform-admins') ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 3: Apply to staging**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/migration-113-platform-admins.sql
```

- [ ] **Step 4: Verify (green)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.is_platform_admin();"        # expect: f  (no session uid)
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select count(*) from public.platform_admins;"  # expect: 0
```
Expected: `is_platform_admin` returns `f` (called without an end-user JWT, `auth.uid()` is null), table exists and is empty.

- [ ] **Step 5: Confirm migration guard passes**

```bash
bash scripts/check-migrations.sh
```
Expected: passes (no complaint about migration 113).

- [ ] **Step 6: Commit**

```bash
git add supabase/migration-113-platform-admins.sql
git commit -m "feat(db): add platform_admins table + is_platform_admin() (migration 113)"
```

---

## Task 2: Commission tables — rates + collections (migration 114)

**Files:**
- Create: `supabase/migration-114-commission-tables.sql`

**Interfaces:**
- Produces: enum `public.commission_basis`; tables `public.org_commission_rates`, `public.org_commission_collections` (both RLS-enabled, no policies).

- [ ] **Step 1: Verification query (red)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select 1 from public.org_commission_rates limit 1;"
```
Expected: FAILS with `relation "public.org_commission_rates" does not exist`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-114-commission-tables.sql
-- Per-org commission config. Immutable history (no UPDATE/DELETE) — a rate
-- change closes the open row and inserts a new one; a collection correction is
-- a new (possibly negative) row. RLS on, no policies: reachable only via the
-- platform SECURITY DEFINER RPCs.

DO $$ BEGIN
  CREATE TYPE public.commission_basis AS ENUM ('vat_inclusive', 'vat_exclusive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.org_commission_rates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id),
  rate_percent     numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  commission_basis public.commission_basis NOT NULL,
  vat_rate_percent numeric(5,2) NOT NULL DEFAULT 13.00 CHECK (vat_rate_percent >= 0),
  effective_from   date NOT NULL,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES auth.users(id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_commission_rates_org ON public.org_commission_rates (org_id, effective_from);

CREATE TABLE IF NOT EXISTS public.org_commission_collections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  amount_collected numeric(10,2) NOT NULL,
  collected_at     date NOT NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES auth.users(id),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_commission_collections_org ON public.org_commission_collections (org_id);

ALTER TABLE public.org_commission_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_commission_collections ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all to authenticated/anon; definer RPCs bypass as owner.

INSERT INTO public.schema_migrations (version, name)
VALUES ('114', 'commission-tables') ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 3: Apply + verify (green)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/migration-114-commission-tables.sql
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select count(*) from public.org_commission_rates; select count(*) from public.org_commission_collections;"
```
Expected: both `0`, no error. Enum exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-114-commission-tables.sql
git commit -m "feat(db): add org commission rate + collection tables (migration 114)"
```

---

## Task 3: Commission read/write RPCs (migration 115)

**Files:**
- Create: `supabase/migration-115-commission-rpcs.sql`

**Interfaces:**
- Produces (all gated on `is_platform_admin()`, granted to `authenticated`):
  - `platform_set_commission_rate(p_org_id uuid, p_rate numeric, p_basis text, p_vat_rate numeric, p_effective_from date) returns uuid` — closes the open row (sets its `effective_to = p_effective_from - 1`), inserts the new row, returns new id. Rejects if `p_effective_from <=` the currently-open row's `effective_from`.
  - `platform_record_collection(p_org_id uuid, p_period_start date, p_period_end date, p_amount numeric, p_collected_at date, p_notes text) returns uuid`
  - `platform_list_rates(p_org_id uuid) returns jsonb` — array newest-first.
  - `platform_list_collections(p_org_id uuid) returns jsonb` — array newest-first.

- [ ] **Step 1: Verification (red)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.platform_list_rates('00000000-0000-0000-0000-000000000000');"
```
Expected: FAILS with `function public.platform_list_rates(...) does not exist`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-115-commission-rpcs.sql
-- Platform-admin-only read/write RPCs for commission config. Each self-gates on
-- is_platform_admin(). Granted to authenticated because RLS on the tables is
-- deny-all; the gate + SECURITY DEFINER are the access control.

CREATE OR REPLACE FUNCTION public.platform_set_commission_rate(
  p_org_id uuid, p_rate numeric, p_basis text, p_vat_rate numeric, p_effective_from date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open   public.org_commission_rates%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_open FROM public.org_commission_rates
   WHERE org_id = p_org_id AND effective_to IS NULL
   ORDER BY effective_from DESC LIMIT 1;

  IF FOUND THEN
    IF p_effective_from <= v_open.effective_from THEN
      RAISE EXCEPTION 'new effective_from (%) must be after the current rate''s effective_from (%)',
        p_effective_from, v_open.effective_from USING ERRCODE = '22007';
    END IF;
    UPDATE public.org_commission_rates
       SET effective_to = p_effective_from - 1
     WHERE id = v_open.id;
  END IF;

  INSERT INTO public.org_commission_rates
    (org_id, rate_percent, commission_basis, vat_rate_percent, effective_from, created_by)
  VALUES
    (p_org_id, p_rate, p_basis::public.commission_basis, COALESCE(p_vat_rate, 13.00), p_effective_from, auth.uid())
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

CREATE OR REPLACE FUNCTION public.platform_record_collection(
  p_org_id uuid, p_period_start date, p_period_end date,
  p_amount numeric, p_collected_at date, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.org_commission_collections
    (org_id, period_start, period_end, amount_collected, collected_at, notes, created_by)
  VALUES (p_org_id, p_period_start, p_period_end, p_amount, p_collected_at, p_notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.platform_list_rates(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.effective_from DESC), '[]'::jsonb)
    INTO v FROM public.org_commission_rates r WHERE r.org_id = p_org_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.platform_list_collections(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.collected_at DESC), '[]'::jsonb)
    INTO v FROM public.org_commission_collections c WHERE c.org_id = p_org_id;
  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_set_commission_rate(uuid,numeric,text,numeric,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_collection(uuid,date,date,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_rates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_collections(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('115', 'commission-rpcs') ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 3: Apply**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/migration-115-commission-rpcs.sql
```

- [ ] **Step 4: Verify gate + overlap logic (green)** — run as service role (bypasses the gate is NOT what we want; instead assert the gate fires). Because psql connects as `postgres`/service, `is_platform_admin()` returns false (no `auth.uid()`), so the RPC should RAISE `not authorized`:

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.platform_list_rates('00000000-0000-0000-0000-000000000000');"
```
Expected: `ERROR: not authorized`. This proves the self-gate works even for a raw DB connection. (Positive-path testing of the overlap rule happens in Task 13 via the real platform-admin JWT.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migration-115-commission-rpcs.sql
git commit -m "feat(db): add platform commission read/write RPCs (migration 115)"
```

---

## Task 4: Sales-base helper + revenue rollup RPC (migration 116)

**Files:**
- Create: `supabase/migration-116-revenue-rollup.sql`

**Interfaces:**
- Produces:
  - `platform_org_sales_base(p_org_id uuid, p_from date, p_to date) returns numeric` — the drawer-basis total (component 1 + 2 + 3) for one org over `[p_from, p_to]`. **Not** self-gated (internal helper), NOT granted to `authenticated`.
  - `platform_get_revenue_rollup(p_from date, p_to date) returns jsonb` — self-gated; array of per-org objects (shape in the spec's "Revenue rollup" section). Granted to `authenticated`.

- [ ] **Step 1: Verification (red)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.platform_get_revenue_rollup(current_date, current_date);"
```
Expected: FAILS — function does not exist.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-116-revenue-rollup.sql
-- Drawer-basis "total sales, counted once" + commission math. Reads across all
-- orgs internally (SECURITY DEFINER) so no tenant RLS change is needed.

-- Helper: drawer-basis sales for one org over [p_from, p_to]. Callable for any
-- sub-range so the rollup can slice per rate-period. Internal only.
CREATE OR REPLACE FUNCTION public.platform_org_sales_base(
  p_org_id uuid, p_from date, p_to date
) RETURNS numeric
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH booking_income AS (
    -- Component 1: real (non-wallet) payments against paid, non-refunded bookings,
    -- at the payments grain (handles split tenders). Bucketed by booking.date.
    SELECT COALESCE(SUM(pmt.amount), 0) AS amt
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
  ),
  voucher_income AS (
    -- Component 2: money paid to buy vouchers, bucketed by issued_date.
    SELECT COALESCE(SUM(v.actual_price), 0) AS amt
    FROM public.vouchers v
    WHERE v.org_id = p_org_id
      AND v.issued_date BETWEEN p_from AND p_to
  ),
  membership_income AS (
    -- Component 3: membership wallet top-ups (deposits only), by created_at date.
    SELECT COALESCE(SUM(mt.amount), 0) AS amt
    FROM public.membership_transactions mt
    WHERE mt.org_id = p_org_id
      AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
  )
  SELECT (SELECT amt FROM booking_income)
       + (SELECT amt FROM voucher_income)
       + (SELECT amt FROM membership_income);
$$;

CREATE OR REPLACE FUNCTION public.platform_get_revenue_rollup(
  p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(org_obj ORDER BY org_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      o.id AS org_id,
      o.name AS org_name,
      jsonb_build_object(
        'org_id', o.id,
        'org_name', o.name,
        'gross_total', public.platform_org_sales_base(o.id, p_from, p_to),
        'revenue_by_category', public.platform_org_category_breakdown(o.id, p_from, p_to),
        'revenue_by_branch',   public.platform_org_branch_breakdown(o.id, p_from, p_to),
        'active_rate_percent',     ar.rate_percent,
        'active_commission_basis', ar.commission_basis,
        'commission_for_range',    public.platform_commission_for_range(o.id, p_from, p_to),
        'commission_owed_to_date', CASE WHEN first_from IS NULL THEN NULL
                                        ELSE public.platform_commission_for_range(o.id, first_from, v_today) END,
        'collected_to_date',       COALESCE(coll.total, 0),
        'net_owed',                CASE WHEN first_from IS NULL THEN NULL
                                        ELSE public.platform_commission_for_range(o.id, first_from, v_today)
                                             - COALESCE(coll.total, 0) END
      ) AS org_obj,
      o.name AS org_name
    FROM public.organizations o
    LEFT JOIN LATERAL (
      SELECT rate_percent, commission_basis
      FROM public.org_commission_rates
      WHERE org_id = o.id AND effective_to IS NULL
      ORDER BY effective_from DESC LIMIT 1
    ) ar ON true
    LEFT JOIN LATERAL (
      SELECT MIN(effective_from) AS first_from
      FROM public.org_commission_rates WHERE org_id = o.id
    ) fr ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount_collected) AS total
      FROM public.org_commission_collections WHERE org_id = o.id
    ) coll ON true,
    LATERAL (SELECT fr.first_from AS first_from) fx
    WHERE o.is_active
  ) sub;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_get_revenue_rollup(date,date) TO authenticated;
-- platform_org_sales_base intentionally NOT granted to authenticated (internal).

INSERT INTO public.schema_migrations (version, name)
VALUES ('116', 'revenue-rollup') ON CONFLICT (version) DO NOTHING;
```

> NOTE: the rollup references three more helpers — `platform_org_category_breakdown`,
> `platform_org_branch_breakdown`, `platform_commission_for_range` — defined in Task 5. Apply Task 5's
> migration (117) **before** calling the rollup; until then the rollup will error on the missing helpers.
> (They live in 117 because they are logically the "breakdown + commission math" layer; 116 is the base
> sum. If you prefer a single file, inline Task 5's functions above the rollup and skip migration 117's
> function block — but keep the drill-in RPC as its own concern.)

- [ ] **Step 3: Apply** (rollup will not be callable until Task 5 is applied — that's expected)

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/migration-116-revenue-rollup.sql
```

- [ ] **Step 4: Verify helper directly (green)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.platform_org_sales_base(
         (select id from public.organizations where slug='nuad-thai-spa'),
         date '2026-08-01', date '2026-08-23');"
```
Expected: a non-negative numeric (Nuad Thai's drawer-basis sales for that range). Cross-check the ballpark against the app's own reports for the same org/range.

- [ ] **Step 5: Commit**

```bash
git add supabase/migration-116-revenue-rollup.sql
git commit -m "feat(db): add sales-base helper + revenue rollup RPC (migration 116)"
```

---

## Task 5: Breakdown + commission-math helpers + drill-in RPC (migration 117)

**Files:**
- Create: `supabase/migration-117-breakdowns-drilldown.sql`

**Interfaces:**
- Produces:
  - `platform_org_category_breakdown(p_org_id, p_from, p_to) returns jsonb` — `[{category, gross}]` incl. synthetic `"Voucher sales"`, `"Membership deposits"`.
  - `platform_org_branch_breakdown(p_org_id, p_from, p_to) returns jsonb` — `[{branch_id, branch_name, gross}]` incl. `{branch_id:null, branch_name:"— (org-level)", gross:<membership deposits>}`.
  - `platform_commission_for_range(p_org_id, p_from, p_to) returns numeric` — sums, per overlapping rate row, `sales_base(overlap)` (VAT-backed-out when `vat_exclusive`) × `rate_percent`. Returns NULL if no rate row overlaps the range at all.
  - `platform_get_org_bookings(p_org_id, p_from, p_to) returns jsonb` — self-gated; drill-in rows with service name/category + branch name. Granted to `authenticated`.

- [ ] **Step 1: Verification (red)**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select public.platform_commission_for_range('00000000-0000-0000-0000-000000000000', current_date, current_date);"
```
Expected: FAILS — function does not exist.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-117-breakdowns-drilldown.sql

CREATE OR REPLACE FUNCTION public.platform_org_category_breakdown(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH cats AS (
    SELECT s.category AS category, SUM(pmt.amount) AS gross
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    JOIN public.services s  ON s.id = bk.service_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
    GROUP BY s.category
    UNION ALL
    SELECT 'Voucher sales', SUM(v.actual_price)
    FROM public.vouchers v
    WHERE v.org_id = p_org_id AND v.issued_date BETWEEN p_from AND p_to
    HAVING SUM(v.actual_price) > 0
    UNION ALL
    SELECT 'Membership deposits', SUM(mt.amount)
    FROM public.membership_transactions mt
    WHERE mt.org_id = p_org_id AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
    HAVING SUM(mt.amount) > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'gross', gross) ORDER BY gross DESC), '[]'::jsonb)
  FROM cats WHERE gross IS NOT NULL AND gross <> 0;
$$;

CREATE OR REPLACE FUNCTION public.platform_org_branch_breakdown(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH by_branch AS (
    SELECT br.id AS branch_id, br.name AS branch_name, SUM(pmt.amount) AS gross
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
    GROUP BY br.id, br.name
    UNION ALL
    SELECT v.branch_id, br.name, SUM(v.actual_price)
    FROM public.vouchers v JOIN public.branches br ON br.id = v.branch_id
    WHERE v.org_id = p_org_id AND v.issued_date BETWEEN p_from AND p_to
    GROUP BY v.branch_id, br.name
    UNION ALL
    -- membership_transactions has no branch_id -> org-level bucket
    SELECT NULL::uuid, '— (org-level)', SUM(mt.amount)
    FROM public.membership_transactions mt
    WHERE mt.org_id = p_org_id AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
    HAVING SUM(mt.amount) > 0
  ),
  rolled AS (
    SELECT branch_id, MAX(branch_name) AS branch_name, SUM(gross) AS gross
    FROM by_branch WHERE gross IS NOT NULL AND gross <> 0
    GROUP BY branch_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', branch_id, 'branch_name', branch_name, 'gross', gross) ORDER BY gross DESC), '[]'::jsonb)
  FROM rolled;
$$;

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

CREATE OR REPLACE FUNCTION public.platform_get_org_bookings(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'date') DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'booking_id', bk.id,
      'booking_number', bk.booking_number,
      'date', bk.date,
      'branch_name', br.name,
      'service_name', s.name,
      'category', s.category,
      'final_amount', bk.final_amount,
      'payment_status', bk.payment_status,
      'status', bk.status,
      'payments', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('amount', p2.amount, 'payment_mode', p2.payment_mode)), '[]'::jsonb)
        FROM public.payments p2 WHERE p2.booking_id = bk.id
      )
    ) AS row_obj
    FROM public.bookings bk
    JOIN public.branches br ON br.id = bk.branch_id
    JOIN public.services s  ON s.id = bk.service_id
    WHERE br.org_id = p_org_id
      AND bk.date BETWEEN p_from AND p_to
  ) sub;
  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_org_category_breakdown(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_org_branch_breakdown(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_commission_for_range(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_org_bookings(uuid,date,date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('117', 'breakdowns-drilldown') ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 3: Apply**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/migration-117-breakdowns-drilldown.sql
```

- [ ] **Step 4: Verify commission math + rollup end-to-end (green)** via service role. The gate blocks the rollup from a raw connection, so wrap in a temporary `SET LOCAL role` is not available; instead verify the non-gated helpers and confirm the gated ones RAISE:

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres <<'SQL'
-- non-gated helper: commission for a hand-set rate (insert a temp rate, compute, rollback)
BEGIN;
INSERT INTO public.org_commission_rates (org_id, rate_percent, commission_basis, vat_rate_percent, effective_from, created_by)
SELECT id, 2.00, 'vat_inclusive', 13.00, date '2026-01-01', id  -- created_by any uuid; FK is auth.users, so use a real one:
FROM public.organizations WHERE slug='nuad-thai-spa';
-- NOTE: created_by must reference auth.users; if the above FK fails, pick an existing auth.users id.
SELECT public.platform_commission_for_range((select id from public.organizations where slug='nuad-thai-spa'),
                                             date '2026-08-01', date '2026-08-23') AS incl_commission;
ROLLBACK;
-- gated rollup must reject from a raw connection:
SELECT public.platform_get_revenue_rollup(date '2026-08-01', date '2026-08-23');
SQL
```
Expected: `incl_commission` ≈ 2% of the sales-base from Task 4 Step 4; final rollup call errors `not authorized`. (If the `created_by` FK insert fails, substitute a real `auth.users.id` — the math is what's under test.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migration-117-breakdowns-drilldown.sql
git commit -m "feat(db): add breakdown + commission math helpers + org drill-in RPC (migration 117)"
```

---

## Task 6: Seed the platform-admin credential (staging)

**Files:**
- Create: `supabase/seed-stage-platform-admin.sql`

This is credential data, not a tracked migration (per `supabase/PROMOTION.md`) — a manual dashboard/psql step, staging first.

- [ ] **Step 1: Create the auth user** (Supabase dashboard → Authentication → Users → Add user), email e.g. `platform@zunkireelabs.com`, set a strong password, confirm the email. (Auth-schema rows can't be cleanly inserted via SQL; use the dashboard or the Admin API.)

- [ ] **Step 2: Write the seed** (resolves user_id by email — portable, no hardcoded UUID)

```sql
-- supabase/seed-stage-platform-admin.sql
-- Grants platform-admin to an existing auth user, by email. Idempotent.
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'platform@zunkireelabs.com'
ON CONFLICT (user_id) DO NOTHING;
```

- [ ] **Step 3: Apply to staging + verify**

```bash
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -f supabase/seed-stage-platform-admin.sql
psql -h aws-1-ap-south-1.pooler.supabase.com -p 6543 -U postgres.snzcckzfmpboeqkktmwy -d postgres \
  -c "select u.email from public.platform_admins pa join auth.users u on u.id=pa.user_id;"
```
Expected: prints `platform@zunkireelabs.com`.

- [ ] **Step 4: Commit** (the seed file only — never commit the password)

```bash
git add supabase/seed-stage-platform-admin.sql
git commit -m "chore(db): add staging platform-admin seed (credential handoff)"
```

---

## Task 7: Add `supabasePlatform` client + feature flag

**Files:**
- Modify: `src/lib/supabase.js`
- Modify: `src/lib/featureFlags.js`

**Interfaces:**
- Produces: `import { supabasePlatform } from 'lib/supabase'`; `import { PLATFORM_ADMIN_ENABLED } from 'lib/featureFlags'`.

- [ ] **Step 1: Add the third client** (append to `src/lib/supabase.js`, after `supabaseCustomer`)

```javascript
// Isolated client for the platform super-admin area (own storage key) so a
// platform login never triggers the staff AuthContext listener (which would
// look up a non-existent org profile and bounce to /login). Mirrors
// supabaseCustomer's isolation.
export const supabasePlatform = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-platform-auth' },
});
```

- [ ] **Step 2: Add the flag** (append to `src/lib/featureFlags.js`)

```javascript
export const PLATFORM_ADMIN_ENABLED = import.meta.env.VITE_ENABLE_PLATFORM_ADMIN === 'true';
```

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase.js src/lib/featureFlags.js
git commit -m "feat(platform): add isolated supabasePlatform client + PLATFORM_ADMIN_ENABLED flag"
```

---

## Task 8: `PlatformAuthContext` + `ProtectedPlatformRoute`

**Files:**
- Create: `src/contexts/PlatformAuthContext.jsx`
- Create: `src/components/ProtectedPlatformRoute.jsx`

**Interfaces:**
- Produces: `PlatformAuthProvider`, `usePlatformAuth()` → `{ user, isPlatformAdmin, loading, signIn, signOut }`; `ProtectedPlatformRoute` wrapper.
- Consumes: `supabasePlatform` (Task 7).

- [ ] **Step 1: Write `PlatformAuthContext`** (mirrors `CustomerAuthContext`; verifies platform-admin via the `is_platform_admin` RPC after sign-in)

```jsx
// src/contexts/PlatformAuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabasePlatform } from 'lib/supabase';

const PlatformAuthContext = createContext(null);

export const usePlatformAuth = () => {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used within a PlatformAuthProvider');
  return ctx;
};

export const PlatformAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const signInActiveRef = useRef(false);

  const checkAdmin = async () => {
    const { data, error } = await supabasePlatform.rpc('is_platform_admin');
    if (error) return false;
    return data === true;
  };

  const signIn = async (email, password) => {
    signInActiveRef.current = true;
    try {
      const { data, error } = await supabasePlatform.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const ok = await checkAdmin();
      if (!ok) {
        await supabasePlatform.auth.signOut();
        throw new Error('This account is not a platform administrator.');
      }
      setUser(data.user);
      setIsPlatformAdmin(true);
      setLoading(false);
      return { user: data.user };
    } finally {
      signInActiveRef.current = false;
    }
  };

  const signOut = async () => {
    setUser(null);
    setIsPlatformAdmin(false);
    await supabasePlatform.auth.signOut();
  };

  useEffect(() => {
    const { data: { subscription } } = supabasePlatform.auth.onAuthStateChange(
      async (event, session) => {
        if (signInActiveRef.current) return;
        if (session?.user) {
          setUser(session.user);
          setIsPlatformAdmin(await checkAdmin());
        } else {
          setUser(null);
          setIsPlatformAdmin(false);
        }
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <PlatformAuthContext.Provider value={{ user, isPlatformAdmin, loading, signIn, signOut }}>
      {children}
    </PlatformAuthContext.Provider>
  );
};
```

- [ ] **Step 2: Write `ProtectedPlatformRoute`**

```jsx
// src/components/ProtectedPlatformRoute.jsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatformAuth } from 'contexts/PlatformAuthContext';

const ProtectedPlatformRoute = ({ children }) => {
  const { user, isPlatformAdmin, loading } = usePlatformAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-body text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }
  if (!user || !isPlatformAdmin) {
    return <Navigate to="/platform/login" replace />;
  }
  return children;
};

export default ProtectedPlatformRoute;
```

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: passes (unused imports are fine; both are wired in Task 12).

- [ ] **Step 4: Commit**

```bash
git add src/contexts/PlatformAuthContext.jsx src/components/ProtectedPlatformRoute.jsx
git commit -m "feat(platform): add PlatformAuthContext + ProtectedPlatformRoute"
```

---

## Task 9: `platformApi.js` service layer

**Files:**
- Create: `src/services/platformApi.js`

Kept separate from `services/api.js` because it uses a **different Supabase client** (`supabasePlatform`) — the monolith assumes the org-scoped `supabase` client.

**Interfaces:**
- Produces: `getRevenueRollup(from,to)`, `listRates(orgId)`, `listCollections(orgId)`, `setCommissionRate({orgId, ratePercent, basis, vatRatePercent, effectiveFrom})`, `recordCollection({orgId, periodStart, periodEnd, amount, collectedAt, notes})`, `getOrgBookings(orgId, from, to)`.

- [ ] **Step 1: Write the service**

```javascript
// src/services/platformApi.js
import { supabasePlatform } from 'lib/supabase';

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

export const getRevenueRollup = (from, to) =>
  supabasePlatform.rpc('platform_get_revenue_rollup', { p_from: from, p_to: to }).then(unwrap);

export const listRates = (orgId) =>
  supabasePlatform.rpc('platform_list_rates', { p_org_id: orgId }).then(unwrap);

export const listCollections = (orgId) =>
  supabasePlatform.rpc('platform_list_collections', { p_org_id: orgId }).then(unwrap);

export const setCommissionRate = ({ orgId, ratePercent, basis, vatRatePercent, effectiveFrom }) =>
  supabasePlatform.rpc('platform_set_commission_rate', {
    p_org_id: orgId, p_rate: ratePercent, p_basis: basis,
    p_vat_rate: vatRatePercent, p_effective_from: effectiveFrom,
  }).then(unwrap);

export const recordCollection = ({ orgId, periodStart, periodEnd, amount, collectedAt, notes }) =>
  supabasePlatform.rpc('platform_record_collection', {
    p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    p_amount: amount, p_collected_at: collectedAt, p_notes: notes || null,
  }).then(unwrap);

export const getOrgBookings = (orgId, from, to) =>
  supabasePlatform.rpc('platform_get_org_bookings', { p_org_id: orgId, p_from: from, p_to: to }).then(unwrap);

export const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
```

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/services/platformApi.js
git commit -m "feat(platform): add platformApi service (RPC wrappers)"
```

---

## Task 10: `PlatformLogin` page + minimal nav

**Files:**
- Create: `src/pages/platform/PlatformLogin.jsx`
- Create: `src/pages/platform/components/PlatformNav.jsx`

**Interfaces:**
- Consumes: `usePlatformAuth` (Task 8).
- Produces: `PlatformNav` (used by dashboard + detail pages).

- [ ] **Step 1: Write the minimal nav**

```jsx
// src/pages/platform/components/PlatformNav.jsx
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlatformAuth } from 'contexts/PlatformAuthContext';

const PlatformNav = () => {
  const { user, signOut } = usePlatformAuth();
  const navigate = useNavigate();
  const handleLogout = async () => { await signOut(); navigate('/platform/login', { replace: true }); };

  return (
    <header className="z-header bg-surface border-b border-border px-6 py-3 flex items-center justify-between">
      <Link to="/platform/dashboard" className="font-heading font-heading-semibold text-primary">
        Zenly · Platform
      </Link>
      <div className="flex items-center gap-4">
        <span className="font-body text-sm text-text-secondary">{user?.email}</span>
        <button onClick={handleLogout}
          className="font-body text-sm text-error hover:underline">Log out</button>
      </div>
    </header>
  );
};

export default PlatformNav;
```

- [ ] **Step 2: Write the login page**

```jsx
// src/pages/platform/PlatformLogin.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatformAuth } from 'contexts/PlatformAuthContext';

const PlatformLogin = () => {
  const { signIn } = usePlatformAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await signIn(email.trim(), password);
      navigate('/platform/dashboard', { replace: true });
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Invalid email or password.' : (err.message || 'Login failed.'));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface rounded-spa-lg shadow-spa-elevated p-6 space-y-4">
        <h1 className="font-heading font-heading-semibold text-lg text-text-primary">Platform Admin</h1>
        {error && <p className="font-body text-sm text-error">{error}</p>}
        <div className="space-y-1">
          <label className="font-body text-sm text-text-secondary">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            data-ph-mask
            className="w-full border border-border rounded-spa px-3 py-2 font-body text-sm" />
        </div>
        <div className="space-y-1">
          <label className="font-body text-sm text-text-secondary">Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            data-ph-mask
            className="w-full border border-border rounded-spa px-3 py-2 font-body text-sm" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-primary text-white rounded-spa px-3 py-2 font-body text-sm disabled:opacity-60">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

export default PlatformLogin;
```

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/pages/platform/PlatformLogin.jsx src/pages/platform/components/PlatformNav.jsx
git commit -m "feat(platform): add login page + minimal platform nav"
```

---

## Task 11: `PlatformDashboard` (rollup table)

**Files:**
- Create: `src/pages/platform/PlatformDashboard.jsx`

**Interfaces:**
- Consumes: `getRevenueRollup`, `formatNPR` (Task 9); `getPeriodRange`, `PERIOD_PRESETS`, `getTodayISO` (`utils/periodPresets`); `CustomSelect`; `PlatformNav`.

- [ ] **Step 1: Write the page**

```jsx
// src/pages/platform/PlatformDashboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomSelect from 'components/ui/CustomSelect';
import PlatformNav from './components/PlatformNav';
import { getRevenueRollup, formatNPR } from 'services/platformApi';
import { PERIOD_PRESETS, getPeriodRange } from 'utils/periodPresets';

const PlatformDashboard = () => {
  const navigate = useNavigate();
  const [preset, setPreset] = useState('monthly');
  const range = useMemo(() => getPeriodRange(preset), [preset]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    getRevenueRollup(range.startDate, range.endDate)
      .then((data) => { if (alive) setRows(data || []); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range.startDate, range.endDate]);

  const money = (v) => (v == null ? '—' : formatNPR(v));
  const pct = (v) => (v == null ? 'Not configured' : `${Number(v)}%`);

  return (
    <div className="min-h-screen bg-background">
      <PlatformNav />
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Revenue & Commission</h2>
          <div className="w-48">
            <CustomSelect value={preset} onChange={setPreset}
              options={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
          </div>
        </div>
        <p className="font-body text-sm text-text-secondary">{range.startDate} → {range.endDate}</p>

        {error && <p className="font-body text-sm text-error">{error}</p>}
        {loading ? (
          <p className="font-body text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="overflow-x-auto bg-surface rounded-spa-lg shadow-spa-resting">
            <table className="w-full text-sm font-data">
              <thead className="text-text-secondary border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-body">Client</th>
                  <th className="text-right px-4 py-2 font-body">Sales (range)</th>
                  <th className="text-right px-4 py-2 font-body">Rate</th>
                  <th className="text-right px-4 py-2 font-body">Commission (range)</th>
                  <th className="text-right px-4 py-2 font-body">Owed to date</th>
                  <th className="text-right px-4 py-2 font-body">Collected</th>
                  <th className="text-right px-4 py-2 font-body">Net owed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.org_id}
                    onClick={() => navigate(`/platform/dashboard/${r.org_id}`)}
                    className="border-b border-border hover:bg-background cursor-pointer">
                    <td className="px-4 py-2 font-body text-text-primary">{r.org_name}</td>
                    <td className="px-4 py-2 text-right">{money(r.gross_total)}</td>
                    <td className="px-4 py-2 text-right">{pct(r.active_rate_percent)}</td>
                    <td className="px-4 py-2 text-right">{money(r.commission_for_range)}</td>
                    <td className="px-4 py-2 text-right">{money(r.commission_owed_to_date)}</td>
                    <td className="px-4 py-2 text-right">{money(r.collected_to_date)}</td>
                    <td className="px-4 py-2 text-right">{money(r.net_owed)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center font-body text-text-secondary">No orgs.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default PlatformDashboard;
```

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/pages/platform/PlatformDashboard.jsx
git commit -m "feat(platform): add revenue rollup dashboard"
```

---

## Task 12: `PlatformOrgDetail` (rates, collections, drill-in)

**Files:**
- Create: `src/pages/platform/PlatformOrgDetail.jsx`

**Interfaces:**
- Consumes: `listRates`, `listCollections`, `setCommissionRate`, `recordCollection`, `getOrgBookings`, `formatNPR` (Task 9); `CustomSelect`; `getPeriodRange`, `PERIOD_PRESETS`, `getTodayISO`; `PlatformNav`.

- [ ] **Step 1: Write the page**

```jsx
// src/pages/platform/PlatformOrgDetail.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import CustomSelect from 'components/ui/CustomSelect';
import PlatformNav from './components/PlatformNav';
import {
  listRates, listCollections, setCommissionRate, recordCollection, getOrgBookings, formatNPR,
} from 'services/platformApi';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from 'utils/periodPresets';

const BASIS_OPTIONS = [
  { value: 'vat_inclusive', label: 'VAT inclusive (rate on full amount)' },
  { value: 'vat_exclusive', label: 'VAT exclusive (back VAT out first)' },
];

const PlatformOrgDetail = () => {
  const { orgId } = useParams();
  const [preset, setPreset] = useState('monthly');
  const range = useMemo(() => getPeriodRange(preset), [preset]);

  const [rates, setRates] = useState([]);
  const [collections, setCollections] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');

  // new-rate form
  const [rate, setRate] = useState('');
  const [basis, setBasis] = useState('vat_inclusive');
  const [vatRate, setVatRate] = useState('13');
  const [effFrom, setEffFrom] = useState(getTodayISO());

  // new-collection form
  const [colAmount, setColAmount] = useState('');
  const [colFrom, setColFrom] = useState(range.startDate);
  const [colTo, setColTo] = useState(range.endDate);
  const [colAt, setColAt] = useState(getTodayISO());
  const [colNotes, setColNotes] = useState('');

  const reload = useCallback(() => {
    setError('');
    Promise.all([listRates(orgId), listCollections(orgId), getOrgBookings(orgId, range.startDate, range.endDate)])
      .then(([r, c, b]) => { setRates(r || []); setCollections(c || []); setBookings(b || []); })
      .catch((e) => setError(e.message || 'Load failed'));
  }, [orgId, range.startDate, range.endDate]);

  useEffect(() => { reload(); }, [reload]);

  const submitRate = async (e) => {
    e.preventDefault();
    try {
      await setCommissionRate({
        orgId, ratePercent: Number(rate), basis,
        vatRatePercent: Number(vatRate), effectiveFrom: effFrom,
      });
      setRate('');
      reload();
    } catch (err) { setError(err.message); }
  };

  const submitCollection = async (e) => {
    e.preventDefault();
    try {
      await recordCollection({
        orgId, periodStart: colFrom, periodEnd: colTo,
        amount: Number(colAmount), collectedAt: colAt, notes: colNotes,
      });
      setColAmount(''); setColNotes('');
      reload();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="min-h-screen bg-background">
      <PlatformNav />
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <Link to="/platform/dashboard" className="font-body text-sm text-primary hover:underline">← All clients</Link>
        {error && <p className="font-body text-sm text-error">{error}</p>}

        {/* Rate history + add */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Commission rate history</h3>
          <ul className="space-y-1 font-data text-sm">
            {rates.map((r) => (
              <li key={r.id} className="text-text-primary">
                {r.rate_percent}% · {r.commission_basis === 'vat_exclusive' ? `VAT-excl @ ${r.vat_rate_percent}%` : 'VAT-incl'} ·
                {' '}{r.effective_from} → {r.effective_to || 'active'}
              </li>
            ))}
            {rates.length === 0 && <li className="text-text-secondary font-body">No rate configured.</li>}
          </ul>
          <form onSubmit={submitRate} className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
            <label className="font-body text-sm text-text-secondary">Rate %
              <input required type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-24" />
            </label>
            <div className="w-64">
              <span className="font-body text-sm text-text-secondary">Basis</span>
              <CustomSelect value={basis} onChange={setBasis} options={BASIS_OPTIONS} />
            </div>
            <label className="font-body text-sm text-text-secondary">VAT %
              <input type="number" step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-20" />
            </label>
            <label className="font-body text-sm text-text-secondary">Effective from
              <input required type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <button type="submit" className="bg-primary text-white rounded-spa px-3 py-1.5 font-body text-sm">Add rate</button>
          </form>
        </section>

        {/* Collections */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <h3 className="font-heading font-heading-semibold text-text-primary">Collections</h3>
          <ul className="space-y-1 font-data text-sm">
            {collections.map((c) => (
              <li key={c.id} className="text-text-primary">
                {formatNPR(c.amount_collected)} · {c.period_start} → {c.period_end} · collected {c.collected_at}
                {c.notes ? ` · ${c.notes}` : ''}
              </li>
            ))}
            {collections.length === 0 && <li className="text-text-secondary font-body">Nothing collected yet.</li>}
          </ul>
          <form onSubmit={submitCollection} className="flex flex-wrap items-end gap-3 pt-2 border-t border-border">
            <label className="font-body text-sm text-text-secondary">Amount
              <input required type="number" step="0.01" value={colAmount} onChange={(e) => setColAmount(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1 w-28" />
            </label>
            <label className="font-body text-sm text-text-secondary">Period start
              <input required type="date" value={colFrom} onChange={(e) => setColFrom(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Period end
              <input required type="date" value={colTo} onChange={(e) => setColTo(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Collected on
              <input required type="date" value={colAt} onChange={(e) => setColAt(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <label className="font-body text-sm text-text-secondary">Notes
              <input value={colNotes} onChange={(e) => setColNotes(e.target.value)}
                className="block border border-border rounded-spa px-2 py-1" />
            </label>
            <button type="submit" className="bg-primary text-white rounded-spa px-3 py-1.5 font-body text-sm">Record</button>
          </form>
        </section>

        {/* Booking drill-in */}
        <section className="bg-surface rounded-spa-lg shadow-spa-resting p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-heading font-heading-semibold text-text-primary">Bookings</h3>
            <div className="w-48">
              <CustomSelect value={preset} onChange={setPreset}
                options={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-data">
              <thead className="text-text-secondary border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-body">Date</th>
                  <th className="text-left px-3 py-2 font-body">Branch</th>
                  <th className="text-left px-3 py-2 font-body">Service</th>
                  <th className="text-right px-3 py-2 font-body">Amount</th>
                  <th className="text-left px-3 py-2 font-body">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.booking_id} className="border-b border-border">
                    <td className="px-3 py-1.5">{b.date}</td>
                    <td className="px-3 py-1.5">{b.branch_name}</td>
                    <td className="px-3 py-1.5">{b.service_name}</td>
                    <td className="px-3 py-1.5 text-right">{formatNPR(b.final_amount)}</td>
                    <td className="px-3 py-1.5">{b.payment_status}</td>
                  </tr>
                ))}
                {bookings.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center font-body text-text-secondary">No bookings in range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};

export default PlatformOrgDetail;
```

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/pages/platform/PlatformOrgDetail.jsx
git commit -m "feat(platform): add org detail — rate history, collections, booking drill-in"
```

---

## Task 13: Register routes + gate on flag

**Files:**
- Modify: `src/Routes.jsx`

- [ ] **Step 1: Add imports** (top of `src/Routes.jsx`, with the other imports)

```jsx
import { PlatformAuthProvider } from 'contexts/PlatformAuthContext';
import ProtectedPlatformRoute from 'components/ProtectedPlatformRoute';
import PlatformLogin from 'pages/platform/PlatformLogin';
import PlatformDashboard from 'pages/platform/PlatformDashboard';
import PlatformOrgDetail from 'pages/platform/PlatformOrgDetail';
import { PLATFORM_ADMIN_ENABLED } from 'lib/featureFlags';
```

- [ ] **Step 2: Register the routes BEFORE the `/login` (OrgFinder) route and any catch-all** — gate the whole block on the flag so prod stays dark until explicitly enabled:

```jsx
{/* ==================== PLATFORM ADMIN ROUTES (flag-gated) ==================== */}
{PLATFORM_ADMIN_ENABLED && (
  <>
    <Route path="/platform/login" element={
      <PlatformAuthProvider><PlatformLogin /></PlatformAuthProvider>
    } />
    <Route path="/platform/dashboard" element={
      <PlatformAuthProvider>
        <ProtectedPlatformRoute><PlatformDashboard /></ProtectedPlatformRoute>
      </PlatformAuthProvider>
    } />
    <Route path="/platform/dashboard/:orgId" element={
      <PlatformAuthProvider>
        <ProtectedPlatformRoute><PlatformOrgDetail /></ProtectedPlatformRoute>
      </PlatformAuthProvider>
    } />
  </>
)}
```

> Each route wraps its own `PlatformAuthProvider` so the isolated listener only mounts on `/platform/*`,
> never app-wide. `/platform/login` is a literal path — it cannot be captured by `/:orgSlug` because
> React Router prefers static segments over params, but registering it before `/login`/OrgFinder keeps
> intent obvious.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: passes.

- [ ] **Step 4: Manual smoke (local, flag on)**

```bash
VITE_ENABLE_PLATFORM_ADMIN=true npm start
```
Then in the browser:
- Visit `http://localhost:4028/platform/login` → login form renders.
- Sign in with the seeded `platform@zunkireelabs.com` (staging DB) → lands on `/platform/dashboard`, table shows orgs with Nuad Thai's real sales for the current month.
- Click Nuad Thai row → org detail loads (rate history empty, add a 2% `vat_inclusive` rate effective today, confirm it appears; try adding a second rate with an earlier `effective_from` → expect the "must be after" error surfaced in red).
- Open a second browser tab, go to `/:orgSlug/login` (staff) → confirm staff login still works and the platform session in tab 1 is unaffected (no logout, no loop).

Expected: all of the above behave as described.

- [ ] **Step 5: Commit**

```bash
git add src/Routes.jsx
git commit -m "feat(platform): register flag-gated /platform routes"
```

---

## Task 14: Build-time flag wiring (Dockerfile + staging deploy)

**Files:**
- Modify: `Dockerfile`
- Modify: `.github/workflows/deploy-staging.yml`

- [ ] **Step 1: Add the Docker build arg** — add alongside the other `VITE_ENABLE_*` ARGs in `Dockerfile`:

```dockerfile
ARG VITE_ENABLE_PLATFORM_ADMIN
```
(Ensure it is also exported to the build env where the sibling `VITE_ENABLE_*` args are — mirror exactly how `VITE_ENABLE_VOUCHERS` is passed to `npm run build`.)

- [ ] **Step 2: Set it true for staging** — in `.github/workflows/deploy-staging.yml` `build-args:` block, add:

```yaml
  VITE_ENABLE_PLATFORM_ADMIN=true
```
Leave `.github/workflows/deploy.yml` (production) untouched so prod stays dark.

- [ ] **Step 3: Build locally to confirm Dockerfile still parses** (optional if Docker available)

```bash
docker build --build-arg VITE_SUPABASE_URL=x --build-arg VITE_SUPABASE_ANON_KEY=x \
  --build-arg VITE_ENABLE_PLATFORM_ADMIN=true -t bookspa-platformcheck . 2>&1 | tail -5
```
Expected: build proceeds past the ARG lines (may fail later on real env, that's fine — we're checking the ARG wiring parses).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .github/workflows/deploy-staging.yml
git commit -m "chore(ci): wire VITE_ENABLE_PLATFORM_ADMIN build arg (staging on, prod off)"
```

---

## Task 15: Staging verification pass (spec's test plan)

**Files:** none (verification), then a session log.

Run the spec's manual walkthrough against staging after the branch deploys (or locally against the staging DB). Record results.

- [ ] **Step 1: Auth gate** — confirm `platform@zunkireelabs.com` reaches `/platform/dashboard`; confirm an ordinary staging staff/admin cannot (their login at `/platform/login` errors "not a platform administrator").

- [ ] **Step 2: Rate overlap** — via the org detail form, add a rate, then attempt a second rate with `effective_from` ≤ the open row's → expect rejection; add one with a later `effective_from` → expect the old row auto-closes (`effective_to` = new_from − 1) and both show in history.

- [ ] **Step 3: Negative net** — record a collection larger than owed-to-date; confirm `net_owed` renders negative on the dashboard without error.

- [ ] **Step 4: RLS isolation** — as an org-scoped admin (normal staff session), attempt to read the new tables and another org's data:

```bash
# via the app's normal supabase client, these must return no rows / error:
#   select * from org_commission_rates;         -> 0 rows (RLS deny)
#   rpc('platform_get_revenue_rollup', ...)      -> "not authorized"
```
Confirm an org admin still cannot see another org's bookings.

- [ ] **Step 5: Session isolation** — platform login in one tab + staff login in another; log out of one, confirm the other survives; no login-loop.

- [ ] **Step 6: Drawer-basis correctness** — build the fixture from the spec's Testing #6 (Cash booking; split-tender VoucherWallet+Cash; fully-wallet booking; voucher issued for cash + later redeemed; membership deposit + birthday_perk + adjustment). Hand-total expected `gross_total`; confirm the dashboard matches, `revenue_by_category` includes `"Voucher sales"`/`"Membership deposits"`, and `revenue_by_branch` sums to `gross_total` with membership under `"— (org-level)"`.

- [ ] **Step 7: Refund** — refund a paid booking; confirm it drops out of `gross_total`.

- [ ] **Step 8: Write the session log** — `docs/session-logs/2026-08-23.md` per `.claude/skills/session-log/SKILL.md`, recording what shipped, the spec deviation (RPC drill-in vs RLS exception), and the prod-promotion checklist (Task 16).

---

## Task 16: Production promotion notes (handoff, not executed here)

**Files:**
- Modify: `supabase/PROMOTION.md` (append a "Platform Admin" section)

Per CLAUDE.md, schema migrations 113–117 auto-apply via CI on merge to `main` (behind the `production-db` reviewer). What is **manual** and must be handed off explicitly:

- [ ] **Step 1: Document the manual prod steps** in `supabase/PROMOTION.md`:
  1. Create the prod auth user (dashboard) + run `seed-prod-platform-admin.sql` (same shape as the staging seed, resolve by email) against the **production** DB.
  2. Set `VITE_ENABLE_PLATFORM_ADMIN=true` in `.github/workflows/deploy.yml` build-args **only when ready to go live** (until then prod ships with the routes dark).
  3. Configure prod commission rates per client via the platform UI once live.
  4. Rotate/secure the platform admin password; store it in the team secret manager.

- [ ] **Step 2: Commit**

```bash
git add supabase/PROMOTION.md
git commit -m "docs(promotion): add platform admin prod-promotion checklist"
```

- [ ] **Step 3: Open PR targeting `stage`**

```bash
git push -u origin feature/platform-admin-revenue-share
gh pr create --base stage --title "Platform admin: cross-tenant revenue share (Phase 1)" \
  --body "Implements docs/superpowers/specs/2026-08-23-platform-admin-revenue-share-design.md. Flag-gated (VITE_ENABLE_PLATFORM_ADMIN), staging on / prod off. Drill-in served via RPC (deviation from spec's RLS exception — see plan header). Created by @sthasadin"
```

---

## Self-Review

**Spec coverage:**
- Identity `platform_admins` + `is_platform_admin()` → Task 1. ✓
- Isolated login (3rd client, own context, guard, per-route mount) → Tasks 7, 8, 10, 13. ✓
- Commission schema (enum, rates immutable history, collections append-only, RLS deny-all) → Task 2. ✓
- Close-old/open-new rate RPC with overlap rejection → Task 3 (`platform_set_commission_rate`). ✓
- Drawer-basis 3-component sales, net, current-truth/refunds-out, Nepal-date bucketing, VAT back-out over whole base → Tasks 4, 5. ✓
- Rollup output shape (category/branch incl. synthetic buckets, owed-to-date, collected, net) → Tasks 4, 5, 11. ✓
- Drill-in → Task 5 RPC + Task 12 UI. **Deviation flagged** (RPC vs RLS exception). ✓
- UI pages + minimal nav → Tasks 10, 11, 12. ✓
- Flag + Docker/CI wiring, prod dark → Tasks 7, 13, 14, 16. ✓
- Edge cases (not-configured NULLs, overlap reject, negative net, split-tender, membership no-branch, refunds) → covered in Tasks 4/5 logic + Task 15 verification. ✓
- Testing walkthrough → Task 15 mirrors spec Testing §. ✓

**Placeholder scan:** No TBD/TODO; every RPC/function/prop referenced is defined in an earlier task (`is_platform_admin` T1; commission tables T2; `platform_org_sales_base` T4 used by T5; breakdown/commission helpers T5 referenced by T4's rollup — apply-order note included; `platformApi` exports T9 consumed by T10-12; `PLATFORM_ADMIN_ENABLED` T7 used T13; `PlatformNav` T10 used T11-12).

**Type consistency:** RPC param names match between the SQL `CREATE FUNCTION` signatures and the `platformApi.js` `rpc(...)` call objects (`p_org_id`, `p_from`, `p_to`, `p_rate`, `p_basis`, `p_vat_rate`, `p_effective_from`, `p_period_start`, `p_period_end`, `p_amount`, `p_collected_at`, `p_notes`). Rollup JSON keys (`gross_total`, `active_rate_percent`, `commission_for_range`, `commission_owed_to_date`, `collected_to_date`, `net_owed`, `revenue_by_category`, `revenue_by_branch`) match the dashboard's `r.<key>` reads.

**Known cross-task ordering caveat (called out in Task 4):** migration 116's rollup references helpers defined in 117 — apply 117 before invoking the rollup. Both are applied before any frontend task needs them.
