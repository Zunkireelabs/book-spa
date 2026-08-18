-- Migration 054: admin-viewer-rls-policies (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: grants the 'admin_viewer' role (added in migration-053)
-- read-only SELECT access across the org's operational + financial tables — the
-- policies actually present in the live schema, all named "Admin viewer can read
-- ...". org-scoped tables are gated through their branch's org_id; payroll/staff
-- compensation policies in the live schema have NO org_id filter at all (recreated
-- verbatim below, not tightened, since this file documents actual live behavior
-- rather than what it perhaps should have been).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY (Postgres has no
-- CREATE POLICY IF NOT EXISTS).

DROP POLICY IF EXISTS "Admin viewer can read org attendance" ON public.attendance;
CREATE POLICY "Admin viewer can read org attendance"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = attendance.branch_id AND b.org_id = get_user_org_id()
    )
  );

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
        WHERE b.id = audit_logs.branch_id AND b.org_id = get_user_org_id()
      )
    )
  );

DROP POLICY IF EXISTS "Admin viewer can read org bookings" ON public.bookings;
CREATE POLICY "Admin viewer can read org bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = bookings.branch_id AND b.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admin viewer can read org daily reports" ON public.daily_reports;
CREATE POLICY "Admin viewer can read org daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = daily_reports.branch_id AND b.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admin viewer can read org payments" ON public.payments;
CREATE POLICY "Admin viewer can read org payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.bookings bk
      JOIN public.branches b ON b.id = bk.branch_id
      WHERE bk.id = payments.booking_id AND b.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admin viewer can read org therapist attendance" ON public.therapist_attendance;
CREATE POLICY "Admin viewer can read org therapist attendance"
  ON public.therapist_attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = therapist_attendance.branch_id AND b.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admin viewer can read org users" ON public.users;
CREATE POLICY "Admin viewer can read org users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND get_user_role() = 'admin_viewer'
  );

DROP POLICY IF EXISTS "Admin viewer can read payroll items" ON public.payroll_items;
CREATE POLICY "Admin viewer can read payroll items"
  ON public.payroll_items FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin_viewer');

DROP POLICY IF EXISTS "Admin viewer can read payroll runs" ON public.payroll_runs;
CREATE POLICY "Admin viewer can read payroll runs"
  ON public.payroll_runs FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin_viewer');

DROP POLICY IF EXISTS "Admin viewer can read staff compensation" ON public.staff_compensation;
CREATE POLICY "Admin viewer can read staff compensation"
  ON public.staff_compensation FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin_viewer');

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('054', 'admin-viewer-rls-policies')
ON CONFLICT (version) DO NOTHING;
