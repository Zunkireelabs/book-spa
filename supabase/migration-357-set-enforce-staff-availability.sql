-- Migration 357: admin-only write path for organizations.enforce_staff_availability (ZNLY-100, V29c2)
--  * organizations has no UPDATE policy (by design), so the Settings switch goes through this SECURITY DEFINER function,
--    same shape as update_org_booking_settings. Admin of the caller's own organization only; returns the new value.
-- Reversible (manual): DROP FUNCTION public.set_enforce_staff_availability(boolean);
BEGIN;

CREATE OR REPLACE FUNCTION public.set_enforce_staff_availability(p_value boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_org_id uuid := (SELECT get_user_org_id());
  v_new    boolean;
BEGIN
  IF (SELECT get_user_role()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_enforce_staff_availability: admin only' USING ERRCODE = '42501';
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_enforce_staff_availability: no organization context';
  END IF;

  UPDATE public.organizations SET enforce_staff_availability = COALESCE(p_value, false)
   WHERE id = v_org_id
  RETURNING enforce_staff_availability INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'set_enforce_staff_availability: organization % not found', v_org_id;
  END IF;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.set_enforce_staff_availability(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_enforce_staff_availability(boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('357', 'set-enforce-staff-availability')
ON CONFLICT (version) DO NOTHING;

COMMIT;
