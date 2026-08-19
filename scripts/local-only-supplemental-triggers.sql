-- ============================================================
-- LOCAL-ONLY supplemental triggers (NOT run against staging/production)
-- ============================================================
--
-- supabase/schema.sql is a periodically re-exported snapshot of the live schema. It already
-- absorbed most of what supabase/migration-002-missing-tables.sql adds (customers,
-- therapist_attendance, audit_logs tables + their RLS policies) — running migration-002
-- verbatim against a fresh schema.sql-bootstrapped DB fails on duplicate objects (CREATE TYPE,
-- CREATE POLICY aren't idempotent there). scripts/local-db-bootstrap.sh therefore skips
-- migration-002 entirely for local bootstrap.
--
-- However schema.sql's snapshot predates 3 trigger functions that migration-002 defines and
-- that staging/production already have applied for real (they went live via the normal
-- promotion process — this is a schema.sql documentation gap, not a functional gap on the real
-- databases). This file exists purely so local dev has the same trigger behavior: booking
-- snapshot auto-population, booking change audit logging, and attendance day-lock enforcement.
--
-- Extracted verbatim from supabase/migration-002-missing-tables.sql sections 5-7.

CREATE OR REPLACE FUNCTION populate_booking_snapshots()
RETURNS TRIGGER AS $$
DECLARE
  svc_name text;
  svc_duration integer;
  svc_price decimal;
  ther_name text;
  rm_name text;
BEGIN
  SELECT name, duration_minutes, price_npr
    INTO svc_name, svc_duration, svc_price
    FROM services WHERE id = NEW.service_id;

  NEW.service_name_snapshot := svc_name;
  NEW.service_duration_snapshot := svc_duration;
  NEW.service_price_snapshot := svc_price;

  IF NEW.therapist_id IS NOT NULL THEN
    SELECT name INTO ther_name
      FROM therapists WHERE id = NEW.therapist_id;
    NEW.therapist_name_snapshot := ther_name;
  END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT name INTO rm_name
      FROM rooms WHERE id = NEW.room_id;
    NEW.room_name_snapshot := rm_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_snapshots ON bookings;
CREATE TRIGGER trg_booking_snapshots
  BEFORE INSERT OR UPDATE OF service_id, therapist_id, room_id ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION populate_booking_snapshots();

CREATE OR REPLACE FUNCTION log_booking_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'STATUS_CHANGE',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      auth.uid()
    );
  END IF;

  IF OLD.discount_amount IS DISTINCT FROM NEW.discount_amount THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'DISCOUNT_CHANGE',
      jsonb_build_object('discount_amount', OLD.discount_amount, 'discount_status', OLD.discount_status),
      jsonb_build_object('discount_amount', NEW.discount_amount, 'discount_status', NEW.discount_status, 'discount_reason', NEW.discount_reason),
      auth.uid()
    );
  END IF;

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

DROP TRIGGER IF EXISTS trg_audit_booking_changes ON bookings;
CREATE TRIGGER trg_audit_booking_changes
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION log_booking_changes();

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

DROP TRIGGER IF EXISTS trg_enforce_attendance_day_lock ON therapist_attendance;
CREATE TRIGGER trg_enforce_attendance_day_lock
  BEFORE INSERT OR UPDATE ON therapist_attendance
  FOR EACH ROW
  EXECUTE FUNCTION enforce_attendance_day_lock();
