-- ============================================================
-- Migration 020: Booking Therapists Junction Table
-- Supports multiple therapists per booking
-- ============================================================

CREATE TABLE booking_therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  therapist_id uuid NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  UNIQUE(booking_id, therapist_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_booking_therapists_booking ON booking_therapists(booking_id);
CREATE INDEX idx_booking_therapists_therapist ON booking_therapists(therapist_id);

-- Enable RLS
ALTER TABLE booking_therapists ENABLE ROW LEVEL SECURITY;

-- RLS: Allow authenticated users to read/write
CREATE POLICY "booking_therapists_select" ON booking_therapists FOR SELECT TO authenticated USING (true);
CREATE POLICY "booking_therapists_insert" ON booking_therapists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "booking_therapists_delete" ON booking_therapists FOR DELETE TO authenticated USING (true);

-- Backfill: copy existing therapist_id assignments into the junction table
INSERT INTO booking_therapists (booking_id, therapist_id)
SELECT id, therapist_id FROM bookings
WHERE therapist_id IS NOT NULL
ON CONFLICT DO NOTHING;
