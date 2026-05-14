-- ============================================================
-- Migration 022: Service Staff Flag
-- Distinguishes service providers from support staff
-- ============================================================

ALTER TABLE therapists ADD COLUMN is_service_staff boolean DEFAULT true;

COMMENT ON COLUMN therapists.is_service_staff IS 'true = assigned to bookings (Therapist, Hairdresser, etc.), false = support staff (Housekeeping, Gardener, etc.)';

UPDATE therapists SET is_service_staff = false WHERE position IN (
  'Housekeeping', 'Gardener', 'Manager',
  'Maintenance Head and Driver', 'Guest Relation Officer',
  'Facilitate Supervisor/Receptionist', 'Intern/Receptionist'
);
