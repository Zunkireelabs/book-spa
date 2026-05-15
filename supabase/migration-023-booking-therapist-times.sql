-- ============================================================
-- Migration 023: Per-therapist time slots in booking_therapists
-- Allows each assigned therapist to work a different sub-range
-- within the overall booking window
-- ============================================================

ALTER TABLE booking_therapists
  ADD COLUMN start_time time,
  ADD COLUMN end_time time;

COMMENT ON COLUMN booking_therapists.start_time IS 'Therapist-specific start time within the booking window';
COMMENT ON COLUMN booking_therapists.end_time IS 'Therapist-specific end time within the booking window';

-- Backfill existing entries with parent booking times
UPDATE booking_therapists bt
SET start_time = b.start_time, end_time = b.end_time
FROM bookings b
WHERE bt.booking_id = b.id;
