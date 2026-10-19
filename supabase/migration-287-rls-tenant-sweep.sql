-- Migration 287: close cross-tenant RLS holes (legacy "branch OR admin" policies, role-only payroll, open junctions)
-- Idempotent: safe to re-run in either database.
-- Applied: local only (feat/ui-port-from-clinicmd)
--
-- SHIPS AS A HOTFIX straight to main (prod is at migration-268) and separately to stage, so it must run on both schemas:
-- every DROP/ALTER POLICY is guarded by that table+policy existing (a NOTICE says what was skipped), the function changes
-- are guarded by the exact signature existing, and service_categories (no tracked CREATE TABLE) also needs its org_id
-- column. On prod, therapist_working_hours(+_breaks) don't exist yet (migrations 275/278), so those statements are
-- skipped; migration-288 re-applies them after 275/278 land at promotion.
--
-- WHAT WAS WRONG
--   Every policy is PERMISSIVE, so the policies on a table are OR'd. migration-012 replaced the pre-multi-tenancy
--   "branch" policies with org-scoped ones, but migration-063 (multi-branch managers) re-created the legacy names as
--   `branch_id = ANY(get_user_branch_ids()) OR get_user_role() = 'admin'` with no org check (seed-prod-nissa-bhaisepati-
--   grant.sql does the same). The bare admin disjunct lets an admin of ANY org pass for EVERY org's rows: bookings,
--   customers, payments, tips, daily reports, attendance, working hours, audit log. Payroll (migration-044/054) is
--   role-only; booking_therapists (migration-020/254) and the untracked service_categories write policies are `true`.
--
-- THE FIX (same-org behaviour is unchanged except where noted)
--   (A) Legacy policies already covered by an org-wide policy for the same command: dropped (only if that org-wide
--       policy is present).
--   (B) Legacy policies with no org-scoped equivalent: rewritten in place (ALTER POLICY, names kept). Only the admin
--       disjunct changes, to "admin AND the row's branch is in my org"; the branch clauses (incl. the multi-branch
--       get_user_branch_ids()) are untouched, so multi-branch managers keep their extra branches.
--   Intended tightening: service_categories writes require manager/admin of the row's org (the policy names already
--   say so, and the app only lets managers/admins edit categories); audit rows without a branch are scoped through
--   changed_by's org (today every org's managers/viewers can read them).
--   Owner decision 2026-10-19: customers get an admin-only, own-org DELETE policy (there was none, so deleteCustomer()
--   silently deleted nothing). Customers with history stay undeletable through the FKs (bookings, packages, vouchers,
--   product_sales, customer_accounts: NO ACTION; memberships, referrals: RESTRICT → 23503). Deleting a customer
--   cascades to outreach_messages, customer photos/documents and duplicate dismissals.
--   RPCs: public_search_booking (anon-executable, returned bookings.* incl. customer PII by phone substring) is no
--   longer executable by anon/authenticated (its only caller, the old /booking-management-portal page, is not routed);
--   enqueue_notification only targets users in the caller's org.
--
-- ROLLBACK
--   Re-run the CREATE POLICY statements for these names from migration-063 (bookings, customers, payments, audit_logs,
--   daily_reports, therapist_attendance, users), 240 (booking_tips), 012/054 (own-org / viewer audit), 275/278 (working
--   hours), 044/054 (payroll), 020/254 (booking_therapists); restore the service_categories write policies to
--   USING/WITH CHECK (true); DROP POLICY "Admin can delete own org customers" ON public.customers;
--   GRANT EXECUTE ON FUNCTION public.public_search_booking(uuid, text) TO anon, authenticated;
--   restore enqueue_notification from migration-032; DELETE FROM public.schema_migrations WHERE version = '287'.

BEGIN;

-- Guard helpers (session-local, gone when the session ends).
CREATE OR REPLACE FUNCTION pg_temp.v287_apply(p_table text, p_policy text, p_sql text, p_need_column text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table AND policyname = p_policy) THEN
    RAISE NOTICE 'migration-287: skipped "%" on public.% (policy not present)', p_policy, p_table;
  ELSIF p_need_column IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                                                  WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_need_column) THEN
    RAISE NOTICE 'migration-287: skipped "%" on public.% (column % not present)', p_policy, p_table, p_need_column;
  ELSE
    EXECUTE p_sql;
  END IF;
END $$;

-- Drop a legacy policy only when the org-wide policy that makes it redundant is present.
CREATE OR REPLACE FUNCTION pg_temp.v287_drop_redundant(p_table text, p_legacy text, p_cover text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table AND policyname = p_legacy) THEN
    RAISE NOTICE 'migration-287: "%" on public.% already gone', p_legacy, p_table;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table AND policyname = p_cover) THEN
    RAISE WARNING 'migration-287: kept "%" on public.% because "%" is missing; review by hand', p_legacy, p_table, p_cover;
  ELSE
    EXECUTE format('DROP POLICY %I ON public.%I', p_legacy, p_table);
  END IF;
END $$;

-- ============================================================
-- (A) Redundant: an org-wide policy already grants the same command to the same users
-- ============================================================
-- customers: "Staff can read/create/update own org customers" (migration-037) = org_id = my org, any role.
SELECT pg_temp.v287_drop_redundant('customers', 'Staff can read branch customers',   'Staff can read own org customers');
SELECT pg_temp.v287_drop_redundant('customers', 'Staff can create customers',        'Staff can create own org customers');
SELECT pg_temp.v287_drop_redundant('customers', 'Staff can update branch customers', 'Staff can update own org customers');
-- users: "Manager can read own org users" (migration-012) = my org AND role manager/admin.
SELECT pg_temp.v287_drop_redundant('users', 'Managers can read branch users', 'Manager can read own org users');

-- customers DELETE (owner decision): admins only, own org.
DROP POLICY IF EXISTS "Admin can delete own org customers" ON public.customers;
CREATE POLICY "Admin can delete own org customers" ON public.customers FOR DELETE TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) = 'admin');

-- ============================================================
-- (B) Rewritten with an org check (names kept; only the admin disjunct changes)
-- ============================================================
-- bookings
SELECT pg_temp.v287_apply('bookings', 'Staff can read branch bookings', $p$
  ALTER POLICY "Staff can read branch bookings" ON public.bookings
    USING (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = bookings.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);
SELECT pg_temp.v287_apply('bookings', 'Staff can create branch bookings', $p$
  ALTER POLICY "Staff can create branch bookings" ON public.bookings
    WITH CHECK (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = bookings.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);
SELECT pg_temp.v287_apply('bookings', 'Staff can update branch bookings', $p$
  ALTER POLICY "Staff can update branch bookings" ON public.bookings
    USING (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = bookings.branch_id AND br.org_id = (SELECT get_user_org_id()))))
    WITH CHECK (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = bookings.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);

-- payments / booking_tips (the branch is reached through the booking)
SELECT pg_temp.v287_apply('payments', 'Staff can read branch payments', $p$
  ALTER POLICY "Staff can read branch payments" ON public.payments
    USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = payments.booking_id
                   AND (b.branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                        OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = b.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v287_apply('payments', 'Staff can record payments', $p$
  ALTER POLICY "Staff can record payments" ON public.payments
    WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = payments.booking_id
                        AND (b.branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                             OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = b.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v287_apply('booking_tips', 'Staff can read branch tips', $p$
  ALTER POLICY "Staff can read branch tips" ON public.booking_tips
    USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_tips.booking_id
                   AND (b.branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                        OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = b.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v287_apply('booking_tips', 'Staff can record tips', $p$
  ALTER POLICY "Staff can record tips" ON public.booking_tips
    WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_tips.booking_id
                        AND (b.branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                             OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = b.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);

-- daily_reports
SELECT pg_temp.v287_apply('daily_reports', 'Manager can read branch daily reports', $p$
  ALTER POLICY "Manager can read branch daily reports" ON public.daily_reports
    USING (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = daily_reports.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);
SELECT pg_temp.v287_apply('daily_reports', 'Manager can close day', $p$
  ALTER POLICY "Manager can close day" ON public.daily_reports
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = daily_reports.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);

-- therapist_attendance
SELECT pg_temp.v287_apply('therapist_attendance', 'Staff can read branch therapist attendance', $p$
  ALTER POLICY "Staff can read branch therapist attendance" ON public.therapist_attendance
    USING (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_attendance.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);
SELECT pg_temp.v287_apply('therapist_attendance', 'Manager can manage therapist attendance', $p$
  ALTER POLICY "Manager can manage therapist attendance" ON public.therapist_attendance
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_attendance.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v287_apply('therapist_attendance', 'Manager can update therapist attendance', $p$
  ALTER POLICY "Manager can update therapist attendance" ON public.therapist_attendance
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_attendance.branch_id AND br.org_id = (SELECT get_user_org_id())))))
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_attendance.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);

-- therapist_working_hours + _breaks (migrations 275/278; absent on prod until promotion, re-applied by migration-288).
-- These use the single primary branch (get_user_branch_id()), kept as is.
SELECT pg_temp.v287_apply('therapist_working_hours', 'Staff can read branch therapist working hours', $p$
  ALTER POLICY "Staff can read branch therapist working hours" ON public.therapist_working_hours
    USING (branch_id = (SELECT get_user_branch_id())
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id()))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours', 'Manager can insert therapist working hours', $p$
  ALTER POLICY "Manager can insert therapist working hours" ON public.therapist_working_hours
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = (SELECT get_user_branch_id())
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours', 'Manager can update therapist working hours', $p$
  ALTER POLICY "Manager can update therapist working hours" ON public.therapist_working_hours
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND (branch_id = (SELECT get_user_branch_id())
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND (branch_id = (SELECT get_user_branch_id())
                     OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours', 'Manager can delete therapist working hours', $p$
  ALTER POLICY "Manager can delete therapist working hours" ON public.therapist_working_hours
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND (branch_id = (SELECT get_user_branch_id())
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = therapist_working_hours.branch_id AND br.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours_breaks', 'Staff can read branch therapist working hours breaks', $p$
  ALTER POLICY "Staff can read branch therapist working hours breaks" ON public.therapist_working_hours_breaks
    USING (EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                   AND (wh.branch_id = (SELECT get_user_branch_id())
                        OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours_breaks', 'Manager can insert therapist working hours breaks', $p$
  ALTER POLICY "Manager can insert therapist working hours breaks" ON public.therapist_working_hours_breaks
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                            AND (wh.branch_id = (SELECT get_user_branch_id())
                                 OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours_breaks', 'Manager can update therapist working hours breaks', $p$
  ALTER POLICY "Manager can update therapist working hours breaks" ON public.therapist_working_hours_breaks
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                       AND (wh.branch_id = (SELECT get_user_branch_id())
                            OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
    WITH CHECK ((SELECT get_user_role()) IN ('manager', 'admin')
                AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                            AND (wh.branch_id = (SELECT get_user_branch_id())
                                 OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);
SELECT pg_temp.v287_apply('therapist_working_hours_breaks', 'Manager can delete therapist working hours breaks', $p$
  ALTER POLICY "Manager can delete therapist working hours breaks" ON public.therapist_working_hours_breaks
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.id = therapist_working_hours_breaks.working_hours_id
                       AND (wh.branch_id = (SELECT get_user_branch_id())
                            OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = wh.branch_id AND br.org_id = (SELECT get_user_org_id()))))))
$p$);

-- audit_logs: no org_id column; rows without a branch are scoped through the author's org.
SELECT pg_temp.v287_apply('audit_logs', 'Manager can read branch audit logs', $p$
  ALTER POLICY "Manager can read branch audit logs" ON public.audit_logs
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND (branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
                OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = audit_logs.branch_id AND br.org_id = (SELECT get_user_org_id())))
                OR ((SELECT get_user_role()) = 'admin' AND audit_logs.branch_id IS NULL
                    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = audit_logs.changed_by AND u.org_id = (SELECT get_user_org_id())))))
$p$);
SELECT pg_temp.v287_apply('audit_logs', 'Manager can read own org audit logs', $p$
  ALTER POLICY "Manager can read own org audit logs" ON public.audit_logs
    USING ((SELECT get_user_role()) IN ('manager', 'admin')
           AND ((branch_id IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = audit_logs.changed_by AND u.org_id = (SELECT get_user_org_id())))
                OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = audit_logs.branch_id AND b.org_id = (SELECT get_user_org_id())))
           AND (branch_id IS NULL OR branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin'))
$p$);
SELECT pg_temp.v287_apply('audit_logs', 'Admin viewer can read org audit logs', $p$
  ALTER POLICY "Admin viewer can read org audit logs" ON public.audit_logs
    USING ((SELECT get_user_role()) = 'admin_viewer'
           AND ((branch_id IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = audit_logs.changed_by AND u.org_id = (SELECT get_user_org_id())))
                OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = audit_logs.branch_id AND b.org_id = (SELECT get_user_org_id()))))
$p$);

-- payroll (role-only today): scope to the org of the run's branch / the therapist
SELECT pg_temp.v287_apply('payroll_runs', 'Admin manage payroll runs', $p$
  ALTER POLICY "Admin manage payroll runs" ON public.payroll_runs
    USING ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = payroll_runs.branch_id AND br.org_id = (SELECT get_user_org_id())))
    WITH CHECK ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = payroll_runs.branch_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('payroll_runs', 'Admin viewer can read payroll runs', $p$
  ALTER POLICY "Admin viewer can read payroll runs" ON public.payroll_runs
    USING ((SELECT get_user_role()) = 'admin_viewer' AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = payroll_runs.branch_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('payroll_items', 'Admin manage payroll items', $p$
  ALTER POLICY "Admin manage payroll items" ON public.payroll_items
    USING ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.payroll_runs r JOIN public.branches br ON br.id = r.branch_id
                                                         WHERE r.id = payroll_items.payroll_run_id AND br.org_id = (SELECT get_user_org_id())))
    WITH CHECK ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.payroll_runs r JOIN public.branches br ON br.id = r.branch_id
                                                              WHERE r.id = payroll_items.payroll_run_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('payroll_items', 'Admin viewer can read payroll items', $p$
  ALTER POLICY "Admin viewer can read payroll items" ON public.payroll_items
    USING ((SELECT get_user_role()) = 'admin_viewer' AND EXISTS (SELECT 1 FROM public.payroll_runs r JOIN public.branches br ON br.id = r.branch_id
                                                                WHERE r.id = payroll_items.payroll_run_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('staff_compensation', 'Admin manage staff compensation', $p$
  ALTER POLICY "Admin manage staff compensation" ON public.staff_compensation
    USING ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.therapists t WHERE t.id = staff_compensation.therapist_id AND t.org_id = (SELECT get_user_org_id())))
    WITH CHECK ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.therapists t WHERE t.id = staff_compensation.therapist_id AND t.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('staff_compensation', 'Admin viewer can read staff compensation', $p$
  ALTER POLICY "Admin viewer can read staff compensation" ON public.staff_compensation
    USING ((SELECT get_user_role()) = 'admin_viewer' AND EXISTS (SELECT 1 FROM public.therapists t WHERE t.id = staff_compensation.therapist_id AND t.org_id = (SELECT get_user_org_id())))
$p$);

-- booking_therapists (`true` today): any signed-in user of the booking's org, as before for same-org users.
-- The public booking flow writes this table through a SECURITY DEFINER RPC (migration-252), unaffected.
SELECT pg_temp.v287_apply('booking_therapists', 'booking_therapists_select', $p$
  ALTER POLICY booking_therapists_select ON public.booking_therapists
    USING (EXISTS (SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
                   WHERE b.id = booking_therapists.booking_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('booking_therapists', 'booking_therapists_insert', $p$
  ALTER POLICY booking_therapists_insert ON public.booking_therapists
    WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
                        WHERE b.id = booking_therapists.booking_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('booking_therapists', 'booking_therapists_update', $p$
  ALTER POLICY booking_therapists_update ON public.booking_therapists
    USING (EXISTS (SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
                   WHERE b.id = booking_therapists.booking_id AND br.org_id = (SELECT get_user_org_id())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
                        WHERE b.id = booking_therapists.booking_id AND br.org_id = (SELECT get_user_org_id())))
$p$);
SELECT pg_temp.v287_apply('booking_therapists', 'booking_therapists_delete', $p$
  ALTER POLICY booking_therapists_delete ON public.booking_therapists
    USING (EXISTS (SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
                   WHERE b.id = booking_therapists.booking_id AND br.org_id = (SELECT get_user_org_id())))
$p$);

-- service_categories writes (`true` today; untracked table, so org_id is checked too). Reads stay public: booking catalog.
SELECT pg_temp.v287_apply('service_categories', 'Manager and admin can create service_categories', $p$
  ALTER POLICY "Manager and admin can create service_categories" ON public.service_categories
    WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
$p$, 'org_id');
SELECT pg_temp.v287_apply('service_categories', 'Manager and admin can update service_categories', $p$
  ALTER POLICY "Manager and admin can update service_categories" ON public.service_categories
    USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
    WITH CHECK (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
$p$, 'org_id');
SELECT pg_temp.v287_apply('service_categories', 'Manager and admin can delete service_categories', $p$
  ALTER POLICY "Manager and admin can delete service_categories" ON public.service_categories
    USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) IN ('manager', 'admin'))
$p$, 'org_id');

-- ============================================================
-- RPCs (guarded by the exact signature)
-- ============================================================
DO $$
BEGIN
  -- Returned bookings.* (customer name/phone/email, amounts) for any branch to the anon key by phone substring. Its only
  -- caller (src/pages/booking-management-portal) is not routed on main or stage.
  IF to_regprocedure('public.public_search_booking(uuid, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.public_search_booking(uuid, text) FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'migration-287: skipped REVOKE on public_search_booking(uuid, text) (function not present)';
  END IF;

  IF to_regprocedure('public.enqueue_notification(uuid, text, text, text, uuid)') IS NOT NULL THEN
    -- Same body as migration-032 plus an org check. The old `role NOT IN ('manager', 'admin')` test also let a caller
    -- with NO users row through (NULL NOT IN (...) is NULL, not true); the org check below closes that too, because
    -- get_user_org_id() is NULL for such a caller and no user matches.
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.enqueue_notification(p_user_id uuid, p_type text, p_title text, p_body text, p_booking_id uuid)
      RETURNS uuid
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public'
      AS $fn$
      DECLARE v_id uuid;
      BEGIN
        IF p_user_id IS NULL THEN RETURN NULL; END IF;
        IF (SELECT role FROM public.users WHERE id = auth.uid()) NOT IN ('manager', 'admin') THEN
          RAISE EXCEPTION 'Not authorized to enqueue notifications' USING ERRCODE = 'P0001';
        END IF;
        -- Only notify people in the caller's own organization.
        IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND org_id = get_user_org_id()) THEN
          RAISE EXCEPTION 'Not authorized to notify this user' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.notifications (user_id, type, title, body, booking_id)
        VALUES (p_user_id, p_type, p_title, p_body, p_booking_id)
        RETURNING id INTO v_id;
        RETURN v_id;
      END;
      $fn$
    $ddl$;
  ELSE
    RAISE NOTICE 'migration-287: skipped enqueue_notification (function not present with that signature)';
  END IF;
END $$;

-- ============================================================
-- Drift detector: a policy that grants on an admin role without referencing the org, or a `true` policy for signed-in
-- users (any write; reads except the public catalogs), would reopen this hole. WARNING (not EXCEPTION) so CI keeps going.
-- ============================================================
DO $$
DECLARE r record; e text;
BEGIN
  FOR r IN SELECT tablename, policyname, cmd, roles::text AS roles, coalesce(qual, '') AS q, coalesce(with_check, '') AS w
           FROM pg_policies WHERE schemaname = 'public'
  LOOP
    e := r.q || ' ' || r.w;
    IF e ~ '''admin(_viewer)?''' AND e !~ '(org_id|get_user_org_id)' THEN
      RAISE WARNING 'migration-287: %.% (%) grants on an admin role without an org check', r.tablename, r.policyname, r.cmd;
    ELSIF r.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND r.roles LIKE '%authenticated%' AND btrim(e) IN ('true', 'true true') THEN
      RAISE WARNING 'migration-287: %.% (%) lets any signed-in user of any org write', r.tablename, r.policyname, r.cmd;
    ELSIF r.cmd = 'SELECT' AND r.roles LIKE '%authenticated%' AND btrim(e) = 'true'
          AND r.tablename NOT IN ('industries', 'service_categories') THEN  -- intentionally public catalogs
      RAISE WARNING 'migration-287: %.% (%) lets any signed-in user of any org read every row', r.tablename, r.policyname, r.cmd;
    END IF;
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('287', 'rls-tenant-sweep')
ON CONFLICT (version) DO NOTHING;

COMMIT;
