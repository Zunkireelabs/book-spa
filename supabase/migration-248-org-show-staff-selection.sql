-- Migration 248: org booking-settings toggles — show_staff_selection + enable_staff_ratings
-- (additive, REVERSIBLE)
--
-- Two per-org admin toggles, both booleans stored in organizations.settings (jsonb, added in
-- migration-009):
--   - show_staff_selection: lets a customer pick their staff member during booking
--     (Fresha-style) instead of today's gender-preference-only flow. This migration only
--     plumbs the flag — the actual customer-facing staff-picker UI is deferred.
--   - enable_staff_ratings: admin decides per-org whether staff ratings/reviews show at all.
--     Pairs with migration-250's therapists.rating column (admin-set value, not a
--     customer-submitted review system).
--
-- organizations has no blanket UPDATE RLS (migration-052's payment-methods feature
-- deliberately avoided one), so this adds one narrowly-scoped SECURITY DEFINER RPC —
-- modeled directly on migration-052's update_org_payment_methods — restricted to an
-- allow-list of known setting keys so future boolean toggles don't each need their own
-- migration+RPC pair.
--
-- Reversible: DROP FUNCTION IF EXISTS public.update_org_booking_settings(text, boolean);

BEGIN;

CREATE OR REPLACE FUNCTION public.update_org_booking_settings(p_key text, p_value boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id   uuid := get_user_org_id();
  v_role     text := get_user_role();
  v_settings jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_org_booking_settings: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_org_booking_settings: no organization context';
  END IF;

  IF p_key NOT IN ('show_staff_selection', 'enable_staff_ratings') THEN
    RAISE EXCEPTION 'update_org_booking_settings: unknown setting key %', p_key;
  END IF;

  UPDATE public.organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[p_key], to_jsonb(p_value), true)
  WHERE id = v_org_id
  RETURNING settings INTO v_settings;

  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'update_org_booking_settings: organization % not found', v_org_id;
  END IF;

  RETURN v_settings;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_booking_settings(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_org_booking_settings(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_org_booking_settings(text, boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('248', 'org-show-staff-selection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
