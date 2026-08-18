-- Migration 003: Add missing discount_reason column
-- Fixes: fetchPendingDiscounts API 400 error on manager/admin pages
-- Root cause: Column defined in schema.sql:129 but never applied to live DB
-- Date: 2026-03-10

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_reason text;

-- Verify
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'discount_reason'
  ) THEN
    RAISE NOTICE 'OK: bookings.discount_reason column exists';
  ELSE
    RAISE EXCEPTION 'FAIL: bookings.discount_reason column was not created';
  END IF;
END $$;
