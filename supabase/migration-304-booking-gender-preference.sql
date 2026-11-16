-- Migration 304: persist the customer's staff gender preference on the booking
--
-- The customer-facing booking flow has a "Staff Gender Preference" selector
-- (Female/Male/No Preference). It's always been used to filter which time slots show
-- as available (by live gender headcount), but the selected value was never saved
-- anywhere: not sent to createBooking, not written to any DB column, never shown to
-- staff despite BookingCard.jsx already having a "Gender Preference" row wired up to
-- a field (booking.genderPreference) that transformBooking() never populated.
--
-- Separately, the live customer flow (provider-profile-flow, mandatory for every
-- tenant since this session's earlier work) hardcoded the prop to the literal string
-- "no-preference" with a no-op onChange — a leftover from when this layout only
-- served a beauty-industry tenant with no staff-gender concept. That's fixed in the
-- same change as this migration, in the frontend only (no DB component to it).
--
-- Informational field only — unlike the two most recent migrations (online-capacity,
-- advance-booking-window), this isn't enforced by any trigger. It's a preference
-- staff see and can act on manually when assigning a therapist, same as
-- special_requests.
--
-- Reversible (manual):
--   ALTER TABLE bookings DROP COLUMN IF EXISTS gender_preference;
--
-- Applied: stage PENDING / prod HELD.

BEGIN;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gender_preference text
  CHECK (gender_preference IN ('male', 'female', 'no-preference'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('304', 'booking-gender-preference')
ON CONFLICT (version) DO NOTHING;

COMMIT;
