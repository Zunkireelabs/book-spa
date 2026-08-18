-- ============================================================
-- Migration 012: Organization-Level RLS Policies
-- Updates all RLS policies to include org_id checks
-- CRITICAL: Test thoroughly before deploying to production
-- ============================================================

-- ============================================================
-- ORGANIZATIONS: Users can only see their own org
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read organizations" ON organizations;

CREATE POLICY "Users can read own organization"
  ON organizations FOR SELECT
  TO authenticated
  USING (id = get_user_org_id());

-- ============================================================
-- BRANCHES: Add org_id check
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read branches" ON branches;
DROP POLICY IF EXISTS "Anonymous users can read branches" ON branches;

CREATE POLICY "Users can read own org branches"
  ON branches FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

CREATE POLICY "Anonymous can read active branches"
  ON branches FOR SELECT
  TO anon
  USING (is_active = true);

-- ============================================================
-- SERVICES: Add org_id check (previously global)
-- ============================================================

DROP POLICY IF EXISTS "Anyone can read services" ON services;
DROP POLICY IF EXISTS "Anonymous users can read services" ON services;
DROP POLICY IF EXISTS "Admin can create services" ON services;
DROP POLICY IF EXISTS "Admin can update services" ON services;
DROP POLICY IF EXISTS "Admin can delete services" ON services;

CREATE POLICY "Users can read own org services"
  ON services FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

CREATE POLICY "Anonymous can read active services"
  ON services FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Admin can create org services"
  ON services FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
    AND org_id = get_user_org_id()
  );

CREATE POLICY "Admin can update org services"
  ON services FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id())
  WITH CHECK (get_user_role() = 'admin' AND org_id = get_user_org_id());

CREATE POLICY "Admin can delete org services"
  ON services FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id());

-- ============================================================
-- USERS: Add org_id check
-- ============================================================

DROP POLICY IF EXISTS "Users can read own profile" ON users;
DROP POLICY IF EXISTS "Managers can read branch users" ON users;

CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Manager can read own org users"
  ON users FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND get_user_role() IN ('manager', 'admin')
  );

-- ============================================================
-- ROOMS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read rooms" ON rooms;
DROP POLICY IF EXISTS "Anonymous users can read rooms" ON rooms;
DROP POLICY IF EXISTS "Manager and admin can create rooms" ON rooms;
DROP POLICY IF EXISTS "Manager and admin can update rooms" ON rooms;
DROP POLICY IF EXISTS "Manager and admin can delete rooms" ON rooms;

CREATE POLICY "Users can read own org rooms"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = rooms.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Anonymous can read active rooms"
  ON rooms FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Manager can create org rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can update org rooms"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = rooms.branch_id
      AND b.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can delete org rooms"
  ON rooms FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = rooms.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- THERAPISTS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read therapists" ON therapists;
DROP POLICY IF EXISTS "Anonymous users can read therapists" ON therapists;
DROP POLICY IF EXISTS "Manager and admin can create therapists" ON therapists;
DROP POLICY IF EXISTS "Manager and admin can update therapists" ON therapists;
DROP POLICY IF EXISTS "Manager and admin can delete therapists" ON therapists;

CREATE POLICY "Users can read own org therapists"
  ON therapists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapists.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Anonymous can read active therapists"
  ON therapists FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Manager can create org therapists"
  ON therapists FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can update org therapists"
  ON therapists FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapists.branch_id
      AND b.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can delete org therapists"
  ON therapists FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapists.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- BOOKINGS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch bookings" ON bookings;
DROP POLICY IF EXISTS "Staff can create branch bookings" ON bookings;
DROP POLICY IF EXISTS "Staff can update branch bookings" ON bookings;

CREATE POLICY "Staff can read own org bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = bookings.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can create own org bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can update own org bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = bookings.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- Keep anonymous booking policies (for public booking flow)
-- These are intentionally permissive for customer bookings

-- ============================================================
-- CUSTOMERS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch customers" ON customers;
DROP POLICY IF EXISTS "Staff can create customers" ON customers;
DROP POLICY IF EXISTS "Staff can update branch customers" ON customers;

CREATE POLICY "Staff can read own org customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = customers.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can create own org customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can update own org customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = customers.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- ============================================================
-- PAYMENTS: Inherits org check via booking->branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch payments" ON payments;
DROP POLICY IF EXISTS "Staff can record payments" ON payments;

CREATE POLICY "Staff can read own org payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings bk
      JOIN branches b ON b.id = bk.branch_id
      WHERE bk.id = payments.booking_id
      AND b.org_id = get_user_org_id()
      AND (bk.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

CREATE POLICY "Staff can record own org payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings bk
      JOIN branches b ON b.id = bk.branch_id
      WHERE bk.id = booking_id
      AND b.org_id = get_user_org_id()
      AND (bk.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

-- ============================================================
-- DAILY_REPORTS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Manager can read branch daily reports" ON daily_reports;
DROP POLICY IF EXISTS "Manager can close day" ON daily_reports;

CREATE POLICY "Manager can read own org daily reports"
  ON daily_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = daily_reports.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Manager can close own org day"
  ON daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- ============================================================
-- ATTENDANCE: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Users can read own attendance" ON attendance;
DROP POLICY IF EXISTS "Managers can read branch attendance" ON attendance;
DROP POLICY IF EXISTS "Users can check in" ON attendance;
DROP POLICY IF EXISTS "Users can check out" ON attendance;

CREATE POLICY "Users can read own attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Manager can read own org attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Users can check in own org"
  ON attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Users can check out"
  ON attendance FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- THERAPIST_ATTENDANCE: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch therapist attendance" ON therapist_attendance;
DROP POLICY IF EXISTS "Manager can manage therapist attendance" ON therapist_attendance;
DROP POLICY IF EXISTS "Manager can update therapist attendance" ON therapist_attendance;

CREATE POLICY "Staff can read own org therapist attendance"
  ON therapist_attendance FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapist_attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Manager can create own org therapist attendance"
  ON therapist_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Manager can update own org therapist attendance"
  ON therapist_attendance FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapist_attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- ============================================================
-- AUDIT_LOGS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Manager can read branch audit logs" ON audit_logs;

CREATE POLICY "Manager can read own org audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM branches b
        WHERE b.id = audit_logs.branch_id
        AND b.org_id = get_user_org_id()
      )
    )
    AND (
      branch_id IS NULL
      OR branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- System insert policy remains unchanged (SECURITY DEFINER triggers)
