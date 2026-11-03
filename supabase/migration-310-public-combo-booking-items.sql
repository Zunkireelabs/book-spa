-- Migration 310: anon-safe write path for booking_combo_items (ZNLY-182)
--
-- The online/anonymous customer booking flow (createBooking with orgSlug set) has
-- never had a way to write booking_combo_items -- the per-component combo-service
-- rows CalendarGrid.jsx already knows how to split into separate cards
-- (`isCombo = b.booking_combo_items?.length > 0`). createComboBookingItems()
-- (services/api.js) already builds these rows correctly for the staff Quick Create
-- flow, but it cannot be called as-is from the anon/online flow for two reasons:
--   1. It starts with getAuthenticatedUser(), which requires a `users` table row --
--      an anonymous customer has none.
--   2. booking_combo_items' only RLS policies (migration-288) are "Staff can manage
--      own org combo items" (authenticated, org-scoped) and two SELECT-only
--      policies -- there is no anon INSERT policy at all, unlike `bookings` itself
--      (migration-008 explicitly added one there for exactly this reason).
--
-- Rather than opening a broad anon INSERT policy on booking_combo_items (which would
-- also require restoring anon SELECT on bookings/rooms/booking_therapists for the
-- table's own BEFORE INSERT triggers -- check_booking_combo_item_room_capacity /
-- _therapist_conflict, both plain non-SECURITY-DEFINER functions that internally
-- query those tables -- a much wider RLS surface than this bug needs, and the kind
-- of broad anon SELECT migration-097 deliberately closed), this follows the same
-- narrow SECURITY DEFINER RPC pattern already used for every other anon-safe
-- write/read in this flow (public_get_booking_by_request_id migration-223,
-- public_record_customer_referral, public_cancel_booking_group). The JS side
-- (createComboBookingItems) still does all the offset/duration computation exactly
-- as before -- this RPC only performs the actual privileged insert of the
-- pre-computed rows, scoped to bookings created anonymously (created_by IS NULL),
-- so it can't be used to attach combo items onto a staff-created booking.
--
-- Reversible: DROP FUNCTION IF EXISTS public.public_create_combo_booking_items(uuid, jsonb);

BEGIN;

CREATE OR REPLACE FUNCTION public.public_create_combo_booking_items(
  p_booking_id uuid,
  p_items jsonb
)
RETURNS SETOF public.booking_combo_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_created_by uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % not found', p_booking_id;
  END IF;
  IF v_created_by IS NOT NULL THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % was not created anonymously', p_booking_id;
  END IF;

  RETURN QUERY
  INSERT INTO public.booking_combo_items (
    booking_id, component_id, service_id, therapist_id, room_id,
    display_order, date, start_time, commission_weight, base_share_amount
  )
  SELECT
    p_booking_id,
    NULLIF(item->>'component_id', '')::uuid,
    (item->>'service_id')::uuid,
    NULLIF(item->>'therapist_id', '')::uuid,
    NULLIF(item->>'room_id', '')::uuid,
    (item->>'display_order')::int,
    (item->>'date')::date,
    (item->>'start_time')::time,
    1,
    0
  FROM jsonb_array_elements(p_items) AS item
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.public_create_combo_booking_items(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_combo_booking_items(uuid, jsonb) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('310', 'public-combo-booking-items')
ON CONFLICT (version) DO NOTHING;

COMMIT;
