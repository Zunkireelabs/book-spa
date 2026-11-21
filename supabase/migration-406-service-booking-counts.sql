-- Migration 406 (ZNLY-320): service_booking_counts — feeds the "MOST BOOKED" group of the shared service picker.
--
-- One branch, last 90 days (Nepal time, by the booking's own date), excluding Cancelled / No Show.
-- One row per booking: a group counts once per guest; a combo counts once against the combo service (its components are rows of
-- booking_combo_items, not bookings). Returns only (service_id, booking_count, last_booked_at) — no customer, money or staff data.
-- SECURITY DEFINER with a pinned search_path; the caller must belong to the branch's org (get_user_org_id()). EXECUTE: authenticated only.
-- Also service_min_tier_prices(): (service_id, min_tier_price) of the caller's org, so "from NPR x" reads the same for every login that may see prices
-- (service_tier_prices RLS is manager/admin only). Returns nothing when caller_hides_prices().
-- Idempotent (CREATE OR REPLACE). Reversible: DROP FUNCTION IF EXISTS public.service_booking_counts(uuid), public.service_min_tier_prices();

BEGIN;

CREATE OR REPLACE FUNCTION public.service_booking_counts(p_branch_id uuid)
RETURNS TABLE (service_id uuid, booking_count bigint, last_booked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b.service_id,
         count(*)::bigint AS booking_count,
         max(b.created_at) AS last_booked_at
  FROM public.bookings b
  WHERE b.branch_id = p_branch_id
    AND b.date >= ((now() AT TIME ZONE 'Asia/Kathmandu')::date - 90)
    AND b.date <= (now() AT TIME ZONE 'Asia/Kathmandu')::date
    AND b.service_id IS NOT NULL
    AND b.status NOT IN ('Cancelled'::booking_status, 'No Show'::booking_status)
    AND EXISTS (
      SELECT 1 FROM public.branches br
      WHERE br.id = p_branch_id AND br.org_id = public.get_user_org_id()
    )
  GROUP BY b.service_id;
$$;

REVOKE ALL ON FUNCTION public.service_booking_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_booking_counts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.service_min_tier_prices()
RETURNS TABLE (service_id uuid, min_tier_price numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT stp.service_id, min(stp.price_npr)
  FROM public.service_tier_prices stp
  JOIN public.services sv ON sv.id = stp.service_id
  WHERE sv.org_id = public.get_user_org_id()
    AND NOT public.caller_hides_prices()
  GROUP BY stp.service_id;
$$;

REVOKE ALL ON FUNCTION public.service_min_tier_prices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_min_tier_prices() TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('406', 'service-booking-counts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
