-- Migration 292: set_service_addons — atomic replace RPC for service_addons
--
-- service_addons (migration-291) only has a direct-write RLS policy (admin FOR
-- ALL) — fine for a single-row edit, but replacing a service's whole add-on
-- list from the UI is a delete-then-insert; without one atomic statement a
-- failed insert after a successful delete would leave the service with zero
-- add-ons. Mirrors set_service_combo_components (migration-289) exactly:
-- validate role + org ownership of the service and every candidate add-on
-- service, then delete+insert inside one function call.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-applied unconditionally.
-- Reversible: DROP FUNCTION IF EXISTS public.set_service_addons(uuid, uuid[]).

BEGIN;

CREATE OR REPLACE FUNCTION public.set_service_addons(
  p_service_id uuid,
  p_addon_service_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_count  integer;
BEGIN
  IF v_role != 'admin' THEN
    RAISE EXCEPTION 'set_service_addons: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_service_addons: no organization context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = p_service_id AND s.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'set_service_addons: service % not found in your organization', p_service_id;
  END IF;

  IF p_addon_service_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_addon_service_ids) AS addon_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.services s WHERE s.id = addon_id AND s.org_id = v_org_id
    )
  ) THEN
    RAISE EXCEPTION 'set_service_addons: one or more add-on service ids do not belong to your organization';
  END IF;

  IF p_addon_service_ids IS NOT NULL AND p_service_id = ANY(p_addon_service_ids) THEN
    RAISE EXCEPTION 'set_service_addons: a service cannot be its own add-on';
  END IF;

  DELETE FROM public.service_addons WHERE service_id = p_service_id;

  INSERT INTO public.service_addons (service_id, addon_service_id, display_order)
  SELECT p_service_id, addon_id, ord - 1
  FROM unnest(COALESCE(p_addon_service_ids, '{}'::uuid[])) WITH ORDINALITY AS t(addon_id, ord);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_addons(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_service_addons(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_service_addons(uuid, uuid[]) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('292', 'set-service-addons')
ON CONFLICT (version) DO NOTHING;

COMMIT;
