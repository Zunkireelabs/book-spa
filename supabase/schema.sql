-- ============================================================
-- BooX Phase 1: Database Schema
-- Target: Supabase (Postgres 15+)
-- Run this FIRST in Supabase SQL Editor
-- ============================================================

-- Required extension for GIST exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('staff', 'manager', 'admin');

CREATE TYPE booking_status AS ENUM (
  'Pending',
  'Confirmed',
  'In-Progress',
  'Completed',
  'Cancelled',
  'No Show'
);

CREATE TYPE payment_mode AS ENUM (
  'Cash',
  'Nabil',
  'GlobalIME',
  'NICAsia',
  'Fonepay'
);

CREATE TYPE payment_status_enum AS ENUM ('unpaid', 'paid');

-- Note: No 'rejected' value. Rejection resets to 'none' (clean state).
CREATE TYPE discount_status_enum AS ENUM ('none', 'pending', 'approved');

-- ============================================================
-- TABLES
-- ============================================================

-- Branches
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Rooms (belong to a branch)
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Services (global, not branch-specific)
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  duration_minutes integer NOT NULL,
  price_npr decimal(10,2) NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Therapists (belong to a branch)
CREATE TABLE therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('Male', 'Female')),
  specialties text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Users (linked to Supabase Auth)
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  role user_role NOT NULL DEFAULT 'staff',
  branch_id uuid REFERENCES branches(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Bookings (core operational table)
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text UNIQUE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  service_id uuid NOT NULL REFERENCES services(id),
  therapist_id uuid REFERENCES therapists(id),

  -- Customer info
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text,
  customer_gender text,

  -- Scheduling
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,

  -- Status
  status booking_status NOT NULL DEFAULT 'Pending',
  special_requests text,
  payment_status payment_status_enum NOT NULL DEFAULT 'unpaid',

  -- Financial (persisted at booking time, not derived dynamically)
  base_amount decimal(10,2) NOT NULL,
  discount_amount decimal(10,2) NOT NULL DEFAULT 0,
  final_amount decimal(10,2) NOT NULL,

  -- Discount workflow
  discount_status discount_status_enum NOT NULL DEFAULT 'none',
  discount_approved_by uuid REFERENCES users(id),
  discount_requested_by uuid REFERENCES users(id),
  discount_requested_to uuid REFERENCES users(id),
  discount_reason text,

  -- CRM link (nullable for walk-ins)
  customer_id uuid REFERENCES customers(id),

  -- Denormalized snapshots (populated by trigger at booking time)
  service_name_snapshot text,
  service_duration_snapshot integer,
  service_price_snapshot decimal(10,2),
  therapist_name_snapshot text,
  room_name_snapshot text,

  -- Lock (set by daily close)
  is_locked boolean NOT NULL DEFAULT false,

  -- Audit
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- CHECK: financial consistency
  CONSTRAINT chk_final_amount CHECK (final_amount = base_amount - discount_amount),
  CONSTRAINT chk_discount_positive CHECK (discount_amount >= 0),
  CONSTRAINT chk_base_positive CHECK (base_amount > 0),

  -- CHECK: approved discount requires approver
  CONSTRAINT chk_discount_approval CHECK (
    (discount_status != 'approved') OR (discount_approved_by IS NOT NULL)
  ),

  -- GIST EXCLUSION: Room overlap prevention
  -- Prevents any two active bookings from occupying the same room
  -- during overlapping time ranges (Cancelled and No Show free the resource)
  CONSTRAINT excl_room_overlap EXCLUDE USING GIST (
    room_id WITH =,
    tstzrange(start_datetime, end_datetime) WITH &&
  ) WHERE (status NOT IN ('Cancelled', 'No Show')),

  -- GIST EXCLUSION: Therapist overlap prevention
  -- Prevents therapist double-booking across overlapping time ranges
  CONSTRAINT excl_therapist_overlap EXCLUDE USING GIST (
    therapist_id WITH =,
    tstzrange(start_datetime, end_datetime) WITH &&
  ) WHERE (therapist_id IS NOT NULL AND status NOT IN ('Cancelled', 'No Show'))
);

-- Payments (immutable after insert)
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  amount decimal(10,2) NOT NULL,
  payment_mode payment_mode NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Daily Reports (Phase 5: daily closing & reconciliation)
CREATE TABLE daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  report_date date NOT NULL,
  total_bookings integer NOT NULL DEFAULT 0,
  completed_bookings integer NOT NULL DEFAULT 0,
  cancelled_bookings integer NOT NULL DEFAULT 0,
  gross_revenue decimal(12,2) NOT NULL DEFAULT 0,
  total_discounts decimal(12,2) NOT NULL DEFAULT 0,
  net_revenue decimal(12,2) NOT NULL DEFAULT 0,
  cash_total decimal(12,2) NOT NULL DEFAULT 0,
  card_total decimal(12,2) NOT NULL DEFAULT 0,
  fonepay_total decimal(12,2) NOT NULL DEFAULT 0,
  unpaid_count integer NOT NULL DEFAULT 0,
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  is_locked boolean NOT NULL DEFAULT true,

  CONSTRAINT uq_daily_report_branch_date UNIQUE (branch_id, report_date)
);

-- Attendance
CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  date date NOT NULL,
  check_in timestamptz NOT NULL DEFAULT now(),
  check_out timestamptz,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT uq_attendance_user_date UNIQUE (user_id, date)
);

-- ============================================================
-- INDEXES (for dashboard query performance <500ms)
-- ============================================================

CREATE INDEX idx_bookings_date ON bookings(date);
CREATE INDEX idx_bookings_branch_date ON bookings(branch_id, date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_payments_created_at ON payments(created_at);
CREATE INDEX idx_attendance_date ON attendance(date);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- 1. Auto-generate booking_number: BK-YYYYMMDD-XXXX
CREATE OR REPLACE FUNCTION generate_booking_number()
RETURNS TRIGGER AS $$
DECLARE
  date_part text;
  seq_num integer;
  new_number text;
BEGIN
  date_part := to_char(NEW.date, 'YYYYMMDD');

  SELECT COUNT(*) + 1 INTO seq_num
  FROM bookings
  WHERE date = NEW.date;

  new_number := 'BK-' || date_part || '-' || lpad(seq_num::text, 4, '0');

  -- Handle unlikely collision
  WHILE EXISTS (SELECT 1 FROM bookings WHERE booking_number = new_number) LOOP
    seq_num := seq_num + 1;
    new_number := 'BK-' || date_part || '-' || lpad(seq_num::text, 4, '0');
  END LOOP;

  NEW.booking_number := new_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_booking_number
  BEFORE INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.booking_number IS NULL)
  EXECUTE FUNCTION generate_booking_number();

-- 2. Auto-compute end_time and datetime fields
-- Fires on INSERT and UPDATE of date, start_time, or service_id
CREATE OR REPLACE FUNCTION compute_booking_datetimes()
RETURNS TRIGGER AS $$
DECLARE
  svc_duration integer;
BEGIN
  -- Fetch service duration
  SELECT duration_minutes INTO svc_duration
  FROM services
  WHERE id = NEW.service_id;

  IF svc_duration IS NULL THEN
    RAISE EXCEPTION 'Service not found: %', NEW.service_id;
  END IF;

  -- Compute end_time from start_time + duration
  NEW.end_time := NEW.start_time + (svc_duration * interval '1 minute');

  -- Compute timestamptz values (Nepal timezone: Asia/Kathmandu = UTC+5:45)
  NEW.start_datetime := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
  NEW.end_datetime := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_datetimes
  BEFORE INSERT OR UPDATE OF date, start_time, service_id ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION compute_booking_datetimes();

-- 3. Auto-compute final_amount
CREATE OR REPLACE FUNCTION compute_final_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.final_amount := NEW.base_amount - NEW.discount_amount;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_final_amount
  BEFORE INSERT OR UPDATE OF base_amount, discount_amount ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION compute_final_amount();

-- 4. Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 5. Auto-update booking.payment_status when payment is recorded (Phase 4)
CREATE OR REPLACE FUNCTION update_booking_payment_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.bookings
  SET payment_status = 'paid'
  WHERE id = NEW.booking_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

CREATE TRIGGER trg_payment_update_booking_status
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_payment_status();

-- 6. Enforce booking immutability for Completed/Locked bookings (Phase 6)
CREATE OR REPLACE FUNCTION enforce_booking_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Locked bookings: no changes at all
  IF OLD.is_locked = true THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Completed bookings: freeze structural fields, but allow discount edits until paid
  -- (Allow is_locked and updated_at to change for closeDay)
  IF OLD.status = 'Completed' THEN
    -- Structural fields are always immutable once completed
    IF (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
      OR NEW.therapist_id IS DISTINCT FROM OLD.therapist_id
    ) THEN
      RAISE EXCEPTION 'BOOKING_IMMUTABLE: Completed bookings cannot be modified.'
        USING ERRCODE = 'P0002';
    END IF;

    -- Discounts stay editable until payment is taken; once paid, frozen
    IF OLD.payment_status = 'paid' AND (
      NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.discount_status IS DISTINCT FROM OLD.discount_status
    ) THEN
      RAISE EXCEPTION 'BOOKING_IMMUTABLE: Cannot modify discount on a paid booking.'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE TRIGGER trg_enforce_booking_immutability
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_immutability();

-- ============================================================
-- CUSTOMERS TABLE (CRM)
-- ============================================================

CREATE TABLE customers (
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
-- THERAPIST ATTENDANCE
-- ============================================================

CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Leave', '1st-Half Day', '2nd-Half Day');

CREATE TABLE therapist_attendance (
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

-- ============================================================
-- AUDIT LOGS (Governance)
-- ============================================================

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  table_name text NOT NULL,
  record_id uuid,
  action_type text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_logs_branch ON audit_logs(branch_id);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);

-- ============================================================
-- MIGRATION TRACKING (see supabase/PROMOTION.md)
-- Records which migrations have been applied to THIS database, so
-- staging/production drift is visible. A fresh bootstrap starts empty and
-- records migrations as they run; existing databases were backfilled by
-- migration-027. RLS on with no policies: only the dashboard/MCP postgres
-- role touches it; app clients are denied.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  name       text,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SCHEMA COMPLETE
-- Next: Run rls.sql, then seed.sql
-- For existing databases: Run migration-002-missing-tables.sql
-- ============================================================
