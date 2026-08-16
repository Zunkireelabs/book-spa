-- PROD promotion script: migration-063 (multi-branch manager access)
-- + grant nissa_magar@nuadthainepal.com additional access to Bhaisepati.
-- Run in the PRODUCTION Supabase SQL editor (project pmbvogiphelmpjdalmtv).
-- Idempotent, portable (resolves by email/branch name, no hardcoded UUIDs).
-- Verified applied clean on staging 2026-08-11.

-- ============================================================
-- migration-063-multi-branch-manager-access.sql
-- ============================================================

-- ============================================================
-- 1. user_branches junction table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_branches (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own branch grants" ON public.user_branches;
CREATE POLICY "Users can read own branch grants"
  ON public.user_branches FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read org branch grants" ON public.user_branches;
CREATE POLICY "Admins can read org branch grants"
  ON public.user_branches FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = user_branches.user_id
      AND u.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admins can grant org branch access" ON public.user_branches;
CREATE POLICY "Admins can grant org branch access"
  ON public.user_branches FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = user_branches.user_id
      AND u.org_id = get_user_org_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = user_branches.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admins can revoke org branch access" ON public.user_branches;
CREATE POLICY "Admins can revoke org branch access"
  ON public.user_branches FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = user_branches.user_id
      AND u.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- 2. get_user_branch_ids() -- primary branch + granted branches
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_branch_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT branch_id FROM public.users WHERE id = auth.uid() AND branch_id IS NOT NULL
    UNION
    SELECT branch_id FROM public.user_branches WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_branch_ids() TO authenticated;

-- ============================================================
-- 3. Swap branch_id = get_user_branch_id() -> branch_id = ANY(get_user_branch_ids())
--    across bookings, customers, payments, users, daily_reports,
--    therapist_attendance, audit_logs.
-- ============================================================

-- -- users --

DROP POLICY IF EXISTS "Managers can read branch users" ON public.users;
CREATE POLICY "Managers can read branch users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
  );

-- -- bookings --

DROP POLICY IF EXISTS "Staff can read branch bookings" ON public.bookings;
CREATE POLICY "Staff can read branch bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Staff can create branch bookings" ON public.bookings;
CREATE POLICY "Staff can create branch bookings"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Staff can update branch bookings" ON public.bookings;
CREATE POLICY "Staff can update branch bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

-- -- payments --

DROP POLICY IF EXISTS "Staff can read branch payments" ON public.payments;
CREATE POLICY "Staff can read branch payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id
      AND (b.branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS "Staff can record payments" ON public.payments;
CREATE POLICY "Staff can record payments"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id
      AND (b.branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
    )
  );

-- -- daily_reports --

DROP POLICY IF EXISTS "Manager can read branch daily reports" ON public.daily_reports;
CREATE POLICY "Manager can read branch daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Manager can close day" ON public.daily_reports;
CREATE POLICY "Manager can close day"
  ON public.daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
  );

-- -- customers --

DROP POLICY IF EXISTS "Staff can read branch customers" ON public.customers;
CREATE POLICY "Staff can read branch customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Staff can create customers" ON public.customers;
CREATE POLICY "Staff can create customers"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Staff can update branch customers" ON public.customers;
CREATE POLICY "Staff can update branch customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

-- -- therapist_attendance --

DROP POLICY IF EXISTS "Staff can read branch therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Staff can read branch therapist attendance"
  ON public.therapist_attendance FOR SELECT
  TO authenticated
  USING (
    branch_id = ANY(get_user_branch_ids())
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Manager can manage therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Manager can manage therapist attendance"
  ON public.therapist_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Manager can update therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Manager can update therapist attendance"
  ON public.therapist_attendance FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
  );

-- -- audit_logs --

DROP POLICY IF EXISTS "Manager can read branch audit logs" ON public.audit_logs;
CREATE POLICY "Manager can read branch audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin')
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('063', 'multi-branch-manager-access')
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- Grant: nissa_magar@nuadthainepal.com -> Bhaisepati (additive to her
-- existing primary branch, Lazimpat). Resolved by email/branch name.
-- ============================================================

INSERT INTO public.user_branches (user_id, branch_id)
SELECT u.id, b.id
FROM public.users u
JOIN public.branches b ON b.org_id = u.org_id AND b.name = 'Bhaisepati'
WHERE u.email = 'nissa_magar@nuadthainepal.com'
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- Verify:
-- SELECT u.email, u.role, pb.name AS primary_branch, array_agg(gb.name) AS granted_branches
-- FROM public.users u
-- JOIN public.branches pb ON pb.id = u.branch_id
-- LEFT JOIN public.user_branches ub ON ub.user_id = u.id
-- LEFT JOIN public.branches gb ON gb.id = ub.branch_id
-- WHERE u.email = 'nissa_magar@nuadthainepal.com'
-- GROUP BY u.email, u.role, pb.name;
