-- Migration 063: multi-branch-manager-access (RECONSTRUCTED — not the original
-- applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: until this point a manager/staff user had exactly one
-- branch (users.branch_id) and every RLS policy checked branch_id = get_user_branch_id().
-- This migration lets a user (in practice: a manager who oversees more than one
-- branch) be GRANTED access to additional branches via a new public.user_branches
-- grant table + public.get_user_branch_ids() helper, and widens the write/read
-- policies on the tables staff actually touch day to day (bookings, customers,
-- payments, daily_reports, therapist_attendance, audit_logs, users) to also accept
-- `branch_id = ANY (get_user_branch_ids())`.
--
-- JUDGMENT CALL: the live schema.sql still contains BOTH generations of these
-- policies side by side (e.g. "Staff can read own org bookings" using
-- get_user_branch_id() singular, AND "Staff can read branch bookings" using
-- get_user_branch_ids() plural) — evidence that this migration was additive and
-- did NOT drop the earlier single-branch policies (matching the house convention's
-- preference for additive, reversible migrations). This file recreates only the
-- get_user_branch_ids()-based generation; the coexisting single-branch policies
-- predate these 13 migrations and are out of scope here.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE,
-- CREATE OR REPLACE FUNCTION).

-- 1. user_branches: additional branch grants beyond a user's home branch_id.
CREATE TABLE IF NOT EXISTS public.user_branches (
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

-- 2. get_user_branch_ids(): every branch the caller may act on -- their granted
--    set from user_branches. (Their home users.branch_id is a separate, older
--    concept surfaced by get_user_branch_id(); callers that need "all accessible
--    branches" now use this instead.)
CREATE OR REPLACE FUNCTION public.get_user_branch_ids() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(array_agg(branch_id), ARRAY[]::uuid[])
  FROM public.user_branches
  WHERE user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_user_branch_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_branch_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_branch_ids() TO authenticated;

-- 3. user_branches RLS: admins manage grants within their own org; a user can see
--    their own grants.
DROP POLICY IF EXISTS "Admins can grant org branch access" ON public.user_branches;
CREATE POLICY "Admins can grant org branch access"
  ON public.user_branches FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_branches.user_id AND u.org_id = get_user_org_id())
    AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = user_branches.branch_id AND b.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "Admins can read org branch grants" ON public.user_branches;
CREATE POLICY "Admins can read org branch grants"
  ON public.user_branches FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_branches.user_id AND u.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "Admins can revoke org branch access" ON public.user_branches;
CREATE POLICY "Admins can revoke org branch access"
  ON public.user_branches FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'admin'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_branches.user_id AND u.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "Users can read own branch grants" ON public.user_branches;
CREATE POLICY "Users can read own branch grants"
  ON public.user_branches FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 4. Widen the operational tables' policies to accept any granted branch, not just
--    the user's single home branch. Admins remain unrestricted (org-wide) as before.

DROP POLICY IF EXISTS "Staff can create branch bookings" ON public.bookings;
CREATE POLICY "Staff can create branch bookings"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can read branch bookings" ON public.bookings;
CREATE POLICY "Staff can read branch bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can update branch bookings" ON public.bookings;
CREATE POLICY "Staff can update branch bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  WITH CHECK (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can create customers" ON public.customers;
CREATE POLICY "Staff can create customers"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can read branch customers" ON public.customers;
CREATE POLICY "Staff can read branch customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can update branch customers" ON public.customers;
CREATE POLICY "Staff can update branch customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  WITH CHECK (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can read branch payments" ON public.payments;
CREATE POLICY "Staff can read branch payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id
        AND (b.branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS "Staff can record payments" ON public.payments;
CREATE POLICY "Staff can record payments"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id
        AND (b.branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS "Staff can read branch therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Staff can read branch therapist attendance"
  ON public.therapist_attendance FOR SELECT
  TO authenticated
  USING (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Manager can manage therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Manager can manage therapist attendance"
  ON public.therapist_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager','admin')
    AND (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Manager can update therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Manager can update therapist attendance"
  ON public.therapist_attendance FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager','admin')
    AND (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  )
  WITH CHECK (
    get_user_role() IN ('manager','admin')
    AND (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Manager can close day" ON public.daily_reports;
CREATE POLICY "Manager can close day"
  ON public.daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager','admin')
    AND (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Manager can read branch daily reports" ON public.daily_reports;
CREATE POLICY "Manager can read branch daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Manager can read branch audit logs" ON public.audit_logs;
CREATE POLICY "Manager can read branch audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager','admin')
    AND (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Managers can read branch users" ON public.users;
CREATE POLICY "Managers can read branch users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager','admin')
    AND (branch_id = ANY (get_user_branch_ids()) OR get_user_role() = 'admin')
  );

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('063', 'multi-branch-manager-access')
ON CONFLICT (version) DO NOTHING;
