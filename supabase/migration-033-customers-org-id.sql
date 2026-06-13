-- Migration 033: add org_id to customers (Phase 1, step 1 — additive, REVERSIBLE)
--
-- First step of centralizing customer identity from per-branch to per-organization
-- (see docs/feature/centralize-customer-staff-data.md §5.1). Adds customers.org_id
-- (the org-level identity), backfills it from branches.org_id via branch_id, verifies
-- there are zero NULLs, then locks the column with SET NOT NULL. customers.branch_id
-- is intentionally KEPT NOT NULL as the customer's ORIGIN branch.
--
-- Idempotent + portable: resolves org through the branches FK (no hardcoded UUIDs),
-- so the same file runs unchanged on staging and production.
--
-- Reversible (no data loss beyond the new column):
--   DROP INDEX IF EXISTS idx_customers_org_active;
--   DROP INDEX IF EXISTS idx_customers_org;
--   ALTER TABLE public.customers DROP COLUMN IF EXISTS org_id;

-- 1. Add column (nullable first so we can backfill) --------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

-- 2. Backfill from each customer's branch -----------------------------------
UPDATE public.customers c
   SET org_id = b.org_id
  FROM public.branches b
 WHERE b.id = c.branch_id
   AND c.org_id IS DISTINCT FROM b.org_id;

-- 3. Verify zero NULLs BEFORE locking the column ----------------------------
DO $$
DECLARE n_null int;
BEGIN
  SELECT count(*) INTO n_null FROM public.customers WHERE org_id IS NULL;
  IF n_null > 0 THEN
    RAISE EXCEPTION 'migration-033: % customers still have NULL org_id; aborting before SET NOT NULL', n_null;
  END IF;
END $$;

-- 4. Lock it in -------------------------------------------------------------
ALTER TABLE public.customers ALTER COLUMN org_id SET NOT NULL;

-- 5. Indexes for org-scoped reads / autocomplete ----------------------------
CREATE INDEX IF NOT EXISTS idx_customers_org ON public.customers(org_id);
CREATE INDEX IF NOT EXISTS idx_customers_org_active
  ON public.customers(org_id, is_active) WHERE is_active;

-- 6. Record migration -------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('033', 'customers-org-id')
ON CONFLICT (version) DO NOTHING;
