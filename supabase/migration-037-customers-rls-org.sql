-- Migration 037: customer RLS → org_id (Phase 1, step 5 — REVERSIBLE)
--
-- Replaces the branch-join customer policies from migration-012 (L302-363) with a direct
-- org check now that customers.org_id exists (migration-033) and is NOT NULL. Two effects:
--   1. simpler/faster: no EXISTS join through branches — just org_id = get_user_org_id();
--   2. INTENDED behavior change: drops the per-branch restriction
--      (branch_id = get_user_branch_id() OR admin), so ALL org staff now see ALL org
--      customers. Required for cross-branch booking history + the outstanding/credit ledger.
--
-- The anon public-booking INSERT policy ("anon_insert_customers") is deliberately UNTOUCHED.
--
-- Idempotent (DROP IF EXISTS + CREATE) and portable (no hardcoded UUIDs).
--
-- Reversible: re-run the migration-012 L305-363 block to restore the branch-scoped policies.

-- 1. Drop the branch-join authenticated policies ----------------------------
DROP POLICY IF EXISTS "Staff can read own org customers"   ON public.customers;
DROP POLICY IF EXISTS "Staff can create own org customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can update own org customers" ON public.customers;

-- 2. Recreate them as direct org-scoped policies ----------------------------
CREATE POLICY "Staff can read own org customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

CREATE POLICY "Staff can create own org customers"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id());

CREATE POLICY "Staff can update own org customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (org_id = get_user_org_id())
  WITH CHECK (org_id = get_user_org_id());

-- 3. Record migration -------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('037', 'customers-rls-org')
ON CONFLICT (version) DO NOTHING;
