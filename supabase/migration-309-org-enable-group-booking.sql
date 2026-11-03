-- Migration 309: org booking-settings toggle — enable_group_booking
-- (additive, REVERSIBLE)
--
-- Group booking (customer books appointments for themselves and others together in one
-- online booking) is currently gated only by the build-time VITE_ENABLE_GROUP_BOOKING env
-- flag — no per-org admin control exists on top of it. This adds one more boolean key,
-- enable_group_booking, to the same organizations.settings jsonb allow-list migration-248
-- already set up for show_staff_selection/enable_staff_ratings — re-using
-- update_org_booking_settings(p_key, p_value) rather than adding a new table/column/RPC.
--
-- Default: TRUE (opt-out), unlike the other two toggles which default FALSE (opt-in). Group
-- booking is already live today for every tenant with the env flag on; defaulting this new
-- setting to off would silently take it away from all of them the moment this ships. The
-- frontend read (TenantContext.jsx) must check `!== false`, not `=== true`, to match.
--
-- Reversible: this CREATE OR REPLACE can be reverted by re-running migration-248's body
-- (same function, same signature, drops 'enable_group_booking' back out of the allow-list).

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

  IF p_key NOT IN ('show_staff_selection', 'enable_staff_ratings', 'enable_group_booking') THEN
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
VALUES ('309', 'org-enable-group-booking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
