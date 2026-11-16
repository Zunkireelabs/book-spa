-- Migration 326: price combo lines, same as a standalone booking (ZNLY)
--
-- public_create_combo_booking_items (migration-310) always wrote
-- base_share_amount = 0 — every combo line was free by construction, with the
-- parent combo service's own flat price covering the whole booking. The user:
-- "please make the combos also tiered as it is also service."
--
-- Decision (2026-11-15): each line prices as ITS OWN service, not the parent
-- combo's. service_price_for_therapist(service_id, therapist_id) already
-- resolves this correctly for every price_type in one COALESCE — a tiered
-- component gets its tier price or Unassigned-rate fallback, a fixed/
-- calendar_only component gets its own price_npr, free/no_default get their
-- own price_npr too (both forced to 0 at the DB level by the Service Detail
-- form, migration-323) — so there is no price_type branching here at all, on
-- purpose. The parent combo service's own price_type no longer drives the
-- booking's total; the booking's base_amount becomes the sum of its lines.
-- This is a deliberate model change the next reader will not expect from the
-- parent-drives-pricing intuition — said here so it isn't "discovered" again.
--
-- Not trusting a client-supplied price for this anonymous write: an anon
-- caller could otherwise pass an arbitrary base_share_amount. The price is
-- computed server-side from service_id/therapist_id alone.

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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id) THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % not found', p_booking_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id AND created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % was not created anonymously', p_booking_id;
  END IF;

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
    public.service_price_for_therapist(
      (item->>'service_id')::uuid,
      NULLIF(item->>'therapist_id', '')::uuid
    )
  FROM jsonb_array_elements(p_items) AS item;

  -- The booking's total is the sum of its lines, full stop — the parent
  -- combo service's own price_type doesn't gate this (see the comment above).
  UPDATE public.bookings
  SET base_amount = (
    SELECT COALESCE(SUM(base_share_amount), 0)
    FROM public.booking_combo_items
    WHERE booking_id = p_booking_id
  )
  WHERE id = p_booking_id;

  RETURN QUERY
  SELECT * FROM public.booking_combo_items WHERE booking_id = p_booking_id ORDER BY display_order;
END;
$$;

REVOKE ALL ON FUNCTION public.public_create_combo_booking_items(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_combo_booking_items(uuid, jsonb) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('326', 'combo-booking-items-tiered-pricing')
ON CONFLICT (version) DO NOTHING;

COMMIT;
