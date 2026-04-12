-- ============================================================
-- BooX Migration 002: Missing Tables & Schema Reconciliation
-- Run this in Supabase SQL Editor AFTER schema.sql + rls.sql
-- ============================================================

-- ============================================================
-- 1. CUSTOMERS TABLE
-- Separate customer records for CRM, linked to bookings
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  full_name text NOT NULL,
  phone text,
  email text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_customers_branch ON customers(branch_id);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================================
-- 2. ADD customer_id + SNAPSHOT COLUMNS TO BOOKINGS
-- customer_id links to customers table (nullable for walk-ins)
-- snapshot fields denormalize names at booking time for reports
-- ============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_name_snapshot text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_duration_snapshot integer;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_price_snapshot decimal(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS therapist_name_snapshot text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_name_snapshot text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_reason text;

CREATE INDEX idx_bookings_customer ON bookings(customer_id);

-- ============================================================
-- 3. THERAPIST_ATTENDANCE TABLE
-- Per-therapist daily attendance tracking
-- ============================================================

CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Leave', 'Half-Day');

CREATE TABLE IF NOT EXISTS therapist_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  date date NOT NULL,
  status attendance_status NOT NULL DEFAULT 'Present',
  check_in_time timestamptz,
  check_out_time timestamptz,
  notes text,
  marked_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),

  CONSTRAINT uq_therapist_attendance UNIQUE (therapist_id, date)
);

CREATE INDEX idx_therapist_attendance_branch_date ON therapist_attendance(branch_id, date);
CREATE INDEX idx_therapist_attendance_therapist ON therapist_attendance(therapist_id);

-- ============================================================
-- 4. AUDIT_LOGS TABLE
-- Immutable event log for governance panel
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  table_name text NOT NULL,
  record_id uuid,
  action_type text NOT NULL,     -- INSERT, UPDATE, DELETE, STATUS_CHANGE, etc.
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_logs_branch ON audit_logs(branch_id);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);
CREATE INDEX idx_audit_logs_record ON audit_logs(record_id);

-- ============================================================
-- 5. SNAPSHOT TRIGGER
-- Auto-populate snapshot fields on booking INSERT/UPDATE
-- ============================================================

CREATE OR REPLACE FUNCTION populate_booking_snapshots()
RETURNS TRIGGER AS $$
DECLARE
  svc_name text;
  svc_duration integer;
  svc_price decimal;
  ther_name text;
  rm_name text;
BEGIN
  -- Service snapshot
  SELECT name, duration_minutes, price_npr
    INTO svc_name, svc_duration, svc_price
    FROM services WHERE id = NEW.service_id;

  NEW.service_name_snapshot := svc_name;
  NEW.service_duration_snapshot := svc_duration;
  NEW.service_price_snapshot := svc_price;

  -- Therapist snapshot (nullable)
  IF NEW.therapist_id IS NOT NULL THEN
    SELECT name INTO ther_name
      FROM therapists WHERE id = NEW.therapist_id;
    NEW.therapist_name_snapshot := ther_name;
  END IF;

  -- Room snapshot
  IF NEW.room_id IS NOT NULL THEN
    SELECT name INTO rm_name
      FROM rooms WHERE id = NEW.room_id;
    NEW.room_name_snapshot := rm_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_booking_snapshots
  BEFORE INSERT OR UPDATE OF service_id, therapist_id, room_id ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION populate_booking_snapshots();

-- ============================================================
-- 6. AUDIT LOG TRIGGER for bookings
-- Logs status changes and financial modifications
-- ============================================================

CREATE OR REPLACE FUNCTION log_booking_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'STATUS_CHANGE',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      auth.uid()
    );
  END IF;

  -- Log discount changes
  IF OLD.discount_amount IS DISTINCT FROM NEW.discount_amount THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'DISCOUNT_CHANGE',
      jsonb_build_object('discount_amount', OLD.discount_amount, 'discount_status', OLD.discount_status),
      jsonb_build_object('discount_amount', NEW.discount_amount, 'discount_status', NEW.discount_status, 'discount_reason', NEW.discount_reason),
      auth.uid()
    );
  END IF;

  -- Log payment status changes
  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'PAYMENT_STATUS_CHANGE',
      jsonb_build_object('payment_status', OLD.payment_status),
      jsonb_build_object('payment_status', NEW.payment_status),
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

CREATE TRIGGER trg_audit_booking_changes
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION log_booking_changes();

-- ============================================================
-- 7. THERAPIST ATTENDANCE DAY-LOCK TRIGGER
-- Prevent attendance modifications on closed days
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_attendance_day_lock()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM daily_reports
    WHERE branch_id = NEW.branch_id
      AND report_date = NEW.date
      AND is_locked = true
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_DAY_LOCKED: This day has been closed. Attendance cannot be modified.'
      USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_attendance_day_lock
  BEFORE INSERT OR UPDATE ON therapist_attendance
  FOR EACH ROW
  EXECUTE FUNCTION enforce_attendance_day_lock();

-- ============================================================
-- 8. RLS POLICIES FOR NEW TABLES
-- ============================================================

-- CUSTOMERS
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

-- THERAPIST_ATTENDANCE
ALTER TABLE therapist_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read branch attendance"
  ON therapist_attendance FOR SELECT
  TO authenticated
  USING (
    branch_id = get_user_branch_id()
    OR get_user_role() = 'admin'
  );

CREATE POLICY "Manager can manage attendance"
  ON therapist_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

CREATE POLICY "Manager can update attendance"
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

-- AUDIT_LOGS (read-only for managers, system writes via SECURITY DEFINER triggers)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager can read branch audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (branch_id = get_user_branch_id() OR get_user_role() = 'admin')
  );

-- INSERT policy for SECURITY DEFINER triggers (they bypass RLS, but belt-and-suspenders)
CREATE POLICY "System can write audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
