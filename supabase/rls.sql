-- ============================================================
-- BookSpa Phase 1: Row Level Security Policies
-- Run this AFTER schema.sql in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- HELPER FUNCTION: Get current user's role and branch
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_branch_id()
RETURNS uuid AS $$
  SELECT branch_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- BRANCHES: All authenticated can read
-- ============================================================

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read branches"
  ON branches FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- ROOMS: All authenticated can read
-- ============================================================

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rooms"
  ON rooms FOR SELECT
  TO authenticated
  USING (true);

-- Allow anonymous read for customer booking flow
CREATE POLICY "Anonymous users can read rooms"
  ON rooms FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- SERVICES: All authenticated + anonymous can read
-- ============================================================

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read services"
  ON services FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anonymous users can read services"
  ON services FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- THERAPISTS: All authenticated can read
-- ============================================================

ALTER TABLE therapists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read therapists"
  ON therapists FOR SELECT
  TO authenticated
  USING (true);

-- Allow anonymous read for customer booking flow
CREATE POLICY "Anonymous users can read therapists"
  ON therapists FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- USERS: Read own profile, managers read branch users
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Managers can read branch users"
  ON users FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

-- ============================================================
-- BRANCHES: Anonymous read for customer booking flow
-- ============================================================

CREATE POLICY "Anonymous users can read branches"
  ON branches FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- BOOKINGS: Branch-scoped access
-- ============================================================

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Staff/Manager can read bookings for their branch
CREATE POLICY "Staff can read branch bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

-- Staff/Manager can create bookings for their branch
CREATE POLICY "Staff can create branch bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

-- Anonymous users can create bookings (customer booking flow)
CREATE POLICY "Anonymous users can create bookings"
  ON bookings FOR INSERT
  TO anon
  WITH CHECK (true);

-- Staff can update bookings (status, therapist assignment)
CREATE POLICY "Staff can update branch bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

-- Discount approval: only manager/admin can set discount_status to 'approved'
-- This is enforced at application level + CHECK constraint
-- (RLS cannot conditionally check column values on UPDATE easily,
--  so we enforce via the CHECK constraint on discount_approved_by)

-- ============================================================
-- PAYMENTS: Insert only, NO update, NO delete (immutable)
-- ============================================================

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read payments for their branch bookings
CREATE POLICY "Staff can read branch payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = payments.booking_id
      AND (b.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

-- Authenticated users can insert payments
CREATE POLICY "Staff can record payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id
      AND (b.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

-- NO UPDATE policy for payments (immutable)
-- NO DELETE policy for payments (immutable)

-- ============================================================
-- ATTENDANCE: Own records + manager branch view
-- ============================================================

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Users can read own attendance
CREATE POLICY "Users can read own attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Managers can read branch attendance
CREATE POLICY "Managers can read branch attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

-- Users can check in (insert own record)
CREATE POLICY "Users can check in"
  ON attendance FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can check out (update own record)
CREATE POLICY "Users can check out"
  ON attendance FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- DAILY REPORTS: Manager/Admin insert, read own branch (Phase 5)
-- ============================================================

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager can read branch daily reports"
  ON daily_reports FOR SELECT
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

CREATE POLICY "Manager can close day"
  ON daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

-- NO UPDATE policy — daily reports are immutable
-- NO DELETE policy — daily reports cannot be removed

-- ============================================================
-- CUSTOMERS: Branch-scoped CRUD
-- ============================================================

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read branch customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

CREATE POLICY "Staff can create customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

CREATE POLICY "Staff can update branch customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

-- ============================================================
-- THERAPIST_ATTENDANCE: Manager/Admin manage, Staff read
-- ============================================================

ALTER TABLE therapist_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read branch therapist attendance"
  ON therapist_attendance FOR SELECT
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

CREATE POLICY "Manager can manage therapist attendance"
  ON therapist_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

CREATE POLICY "Manager can update therapist attendance"
  ON therapist_attendance FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

-- ============================================================
-- AUDIT_LOGS: Manager/Admin read only (writes via SECURITY DEFINER triggers)
-- ============================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager can read branch audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

CREATE POLICY "System can write audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- RLS COMPLETE
-- Next: Run seed.sql
-- ============================================================
