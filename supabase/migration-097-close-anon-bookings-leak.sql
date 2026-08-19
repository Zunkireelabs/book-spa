-- Migration 097: close anon cross-org bookings leak (HOTFIX, REVERSIBLE)
--
-- migration-008 gave `anon` UNCONDITIONAL SELECT on the entire `bookings` table
-- ("anon_select_bookings", USING (true)) — no org/branch scoping. Any unauthenticated
-- caller could dump every booking across every tenant: customer names, phones,
-- special_requests, financial fields. Same bug class as anon_select_customers,
-- which migration-073 already closed on `customers` (that migration explicitly
-- flagged this table as an unclosed follow-up).
--
-- Two legitimate anon call sites depended on the open policy:
--   1. DateTimeSelection.jsx (customer booking flow, step 3) — raw SELECT to build a
--      slot-availability map. Was also unscoped by branch/org (separate bug: could
--      mix in another org's slots for the same calendar date).
--   2. searchBookings() in services/api.js, called from booking-management-portal
--      (/:orgSlug/manage) — free-text ILIKE search across booking_number,
--      customer_name, AND customer_phone. Called by an anon session, this let anyone
--      dump full booking rows (incl. phone, financial fields) by guessing a common
--      first name. searchBookings() is also called by BookingLookupPanel on the
--      *authenticated* staff dashboard — that path is unaffected (staff already has
--      "Staff can read own org bookings" from migration-012) and keeps using the
--      normal table SELECT.
--
-- Fix: drop the open policy, replace both anon call sites with narrow SECURITY
-- DEFINER RPCs, scoped to the branch/org the caller is actually looking at, and drop
-- customer_name from the anon search predicate (phone/booking-number match only —
-- name-only search is exactly the scraping vector).
--
-- Idempotent: DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_check_slot_availability(uuid, date);
--   DROP FUNCTION IF EXISTS public.public_search_booking(uuid, text);
--   CREATE POLICY "anon_select_bookings" ON public.bookings FOR SELECT TO anon USING (true);

-- ============================================================
-- 1. Close the hole
-- ============================================================

DROP POLICY IF EXISTS "anon_select_bookings" ON public.bookings;

-- ============================================================
-- 2. public_check_slot_availability — anon, branch+date scoped, no PII.
--    Replacement for DateTimeSelection.jsx's raw bookings SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_check_slot_availability(
  p_branch_id uuid,
  p_date      date
)
RETURNS TABLE (start_time time, duration_minutes int, therapist_gender text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    b.start_time,
    COALESCE(s.duration_minutes, 60) AS duration_minutes,
    t.gender AS therapist_gender
  FROM public.bookings b
  JOIN public.therapists t ON t.id = b.therapist_id
  LEFT JOIN public.services s ON s.id = b.service_id
  WHERE b.branch_id = p_branch_id
    AND b.date = p_date
    AND b.status NOT IN ('Cancelled', 'No Show')
    AND b.therapist_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.public_check_slot_availability(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_slot_availability(uuid, date) TO anon, authenticated;

-- ============================================================
-- 3. public_search_booking — anon, branch scoped, phone/booking-number
--    match only (no customer_name). Replacement for the anon path of
--    searchBookings() used by booking-management-portal (/manage).
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_search_booking(
  p_branch_id uuid,
  p_query     text
)
RETURNS SETOF public.bookings
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT b.*
  FROM public.bookings b
  WHERE b.branch_id = p_branch_id
    AND (
      b.booking_number ILIKE '%' || regexp_replace(p_query, '[,.()"\\%_]', '', 'g') || '%'
      OR b.customer_phone ILIKE '%' || regexp_replace(p_query, '[,.()"\\%_]', '', 'g') || '%'
    )
  ORDER BY b.date DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.public_search_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_search_booking(uuid, text) TO anon;

-- ============================================================
-- 4. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('097', 'close-anon-bookings-leak') ON CONFLICT (version) DO NOTHING;
