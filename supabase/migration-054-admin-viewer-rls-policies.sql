-- Migration 054: additive read-only RLS policies for 'admin_viewer'
--
-- MUST run AFTER migration-053 has committed (adds the enum value this migration
-- references). Do not paste 053 and 054 together in one script execution.
--
-- Design: Postgres OR's together multiple permissive policies of the same command
-- type on the same table. So instead of editing any existing SELECT policy (risking
-- a mistake in a live write-granting policy), this migration only ADDS brand-new
-- SELECT-only policies scoped to get_user_role() = 'admin_viewer'. No existing policy
-- is touched. Since no INSERT/UPDATE/DELETE policy anywhere checks for
-- 'admin_viewer', this role can never write — enforced at the DB layer regardless of
-- what the frontend does or doesn't hide.
--
-- Coverage mirrors what 'admin' can currently read org/branch-wide (traced across
-- rls.sql + migration-012-org-rls-policies.sql + migration-044-payroll.sql):
--   users, bookings, payments, daily_reports, attendance, therapist_attendance,
--   audit_logs, staff_compensation, payroll_runs, payroll_items.
-- Tables NOT listed (organizations, branches, services, rooms, therapists,
-- booking_therapists, customers, notifications, staff_transfers, industries) already
-- grant org-wide SELECT to every authenticated org member with no role gate, so
-- admin_viewer already reads them with zero SQL change.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible:
--   DROP POLICY IF EXISTS "Admin viewer can read org users" ON public.users;
--   DROP POLICY IF EXISTS "Admin viewer can read org bookings" ON public.bookings;
--   DROP POLICY IF EXISTS "Admin viewer can read org payments" ON public.payments;
--   DROP POLICY IF EXISTS "Admin viewer can read org daily reports" ON public.daily_reports;
--   DROP POLICY IF EXISTS "Admin viewer can read org attendance" ON public.attendance;
--   DROP POLICY IF EXISTS "Admin viewer can read org therapist attendance" ON public.therapist_attendance;
--   DROP POLICY IF EXISTS "Admin viewer can read org audit logs" ON public.audit_logs;
--   DROP POLICY IF EXISTS "Admin viewer can read staff compensation" ON public.staff_compensation;
--   DROP POLICY IF EXISTS "Admin viewer can read payroll runs" ON public.payroll_runs;
--   DROP POLICY IF EXISTS "Admin viewer can read payroll items" ON public.payroll_items;

-- ============================================================
-- USERS
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org users" ON public.users;
CREATE POLICY "Admin viewer can read org users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND get_user_role() = 'admin_viewer'
  );

-- ============================================================
-- BOOKINGS
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org bookings" ON public.bookings;
CREATE POLICY "Admin viewer can read org bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = bookings.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- PAYMENTS
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org payments" ON public.payments;
CREATE POLICY "Admin viewer can read org payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.bookings bk
      JOIN public.branches b ON b.id = bk.branch_id
      WHERE bk.id = payments.booking_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- DAILY_REPORTS
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org daily reports" ON public.daily_reports;
CREATE POLICY "Admin viewer can read org daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = daily_reports.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- ATTENDANCE
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org attendance" ON public.attendance;
CREATE POLICY "Admin viewer can read org attendance"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- THERAPIST_ATTENDANCE
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Admin viewer can read org therapist attendance"
  ON public.therapist_attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = therapist_attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- AUDIT_LOGS
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read org audit logs" ON public.audit_logs;
CREATE POLICY "Admin viewer can read org audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.id = audit_logs.branch_id
        AND b.org_id = get_user_org_id()
      )
    )
  );

-- ============================================================
-- PAYROLL (staff_compensation, payroll_runs, payroll_items)
-- Mirrors the existing admin policy shape exactly (no org_id column on these
-- tables today, so admin's own policy is also unscoped by org — matching that,
-- not introducing new scoping here).
-- ============================================================

DROP POLICY IF EXISTS "Admin viewer can read staff compensation" ON public.staff_compensation;
CREATE POLICY "Admin viewer can read staff compensation"
  ON public.staff_compensation FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin_viewer');

DROP POLICY IF EXISTS "Admin viewer can read payroll runs" ON public.payroll_runs;
CREATE POLICY "Admin viewer can read payroll runs"
  ON public.payroll_runs FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin_viewer');

DROP POLICY IF EXISTS "Admin viewer can read payroll items" ON public.payroll_items;
CREATE POLICY "Admin viewer can read payroll items"
  ON public.payroll_items FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin_viewer');

-- ============================================================
-- RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('054', 'admin-viewer-rls-policies')
ON CONFLICT (version) DO NOTHING;
