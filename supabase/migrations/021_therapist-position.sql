-- ============================================================
-- Migration 021: Add Position to Therapists
-- Categorizes employees (Therapist, Hairdresser, Beautician, etc.)
-- ============================================================

ALTER TABLE therapists ADD COLUMN position text;

COMMENT ON COLUMN therapists.position IS 'Employee position/category (e.g., Therapist, Hairdresser, Beautician, Housekeeping)';
