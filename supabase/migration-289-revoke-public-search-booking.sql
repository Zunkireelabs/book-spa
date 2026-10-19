-- Migration 289: stop anonymous callers from searching bookings
-- Idempotent: safe to re-run in either database.
-- Applied: hotfix/revoke-public-search-booking → prod + stage (2026-10-19)
--
-- WHY
--   public_search_booking(branch_id, query) is SECURITY DEFINER and was executable by the anon key. It returns full
--   booking rows (customer name, phone, email, amounts) for any branch by phone/booking-number substring, so anyone
--   with the public key could enumerate bookings. Its only caller, src/pages/booking-management-portal/index.jsx, is
--   no longer routed (/booking-management-portal renders CustomerOrgFinder). Staff "Check Booking" uses the
--   authenticated searchBookings path and is unaffected.
--   The wider cross-tenant RLS fix (migration-287) also contains this REVOKE; it ships separately.
--
-- ROLLBACK
--   GRANT EXECUTE ON FUNCTION public.public_search_booking(uuid, text) TO anon, authenticated;
--   DELETE FROM public.schema_migrations WHERE version = '289';

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.public_search_booking(uuid, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.public_search_booking(uuid, text) FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'migration-289: public_search_booking(uuid, text) not present, nothing to revoke';
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('289', 'revoke-public-search-booking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
