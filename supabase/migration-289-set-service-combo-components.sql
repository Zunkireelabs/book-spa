-- Migration 289: set_service_combo_components — atomic replace RPC
--
-- ledger-collision-ack: version 289 is ALSO used by migration-289-revoke-public-search-booking.sql
-- (PR #415), and that is what the PRODUCTION ledger records under 289. Because migrate-apply
-- skips by version, THIS file will be skipped on any database where 289 is already recorded.
--
-- That is safe here: migration-296-set-service-combo-components-room.sql does CREATE OR REPLACE
-- on the identical (uuid, jsonb) signature and fully supersedes this file — it adds
-- default_same_room, which this version has no concept of. A fresh database reaches the correct
-- end state from 296 alone.
--
-- DO NOT renumber this file to a higher number to "fix" the collision. Migrations apply in
-- version order, so any number above 296 would re-apply this older definition AFTER 296 and
-- silently drop default_same_room support. There is no free slot below 296 either — 282-298
-- are contiguous.
--
-- combo_package_components (migration-288) only had a direct-write RLS policy
-- (manager/admin FOR ALL) — fine for a single-row edit, but replacing a combo's
-- whole component list from the UI is a delete-then-insert; without a single
-- atomic statement a failed insert after a successful delete would leave the combo
-- with zero components. Mirrors set_service_therapists (migration-253) and
-- set_package_type_services (migration-288, staff-roster-overrides feature,
-- reverted) exactly: validate role + org ownership of both the combo and every
-- component service, then delete+insert inside one function call.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-applied unconditionally.
-- Reversible: DROP FUNCTION IF EXISTS public.set_service_combo_components(uuid, jsonb).

BEGIN;

-- p_components: jsonb array of {"service_id": uuid, "display_order": int,
-- "default_timing": "sequential"|"concurrent", "default_same_staff": bool}
CREATE OR REPLACE FUNCTION public.set_service_combo_components(
  p_combo_service_id uuid,
  p_components jsonb
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
    RAISE EXCEPTION 'set_service_combo_components: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_service_combo_components: no organization context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = p_combo_service_id AND s.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'set_service_combo_components: combo service % not found in your organization', p_combo_service_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) AS elem
    WHERE NOT EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = (elem->>'service_id')::uuid AND s.org_id = v_org_id
    )
  ) THEN
    RAISE EXCEPTION 'set_service_combo_components: one or more component service ids do not belong to your organization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) AS elem
    WHERE (elem->>'service_id')::uuid = p_combo_service_id
  ) THEN
    RAISE EXCEPTION 'set_service_combo_components: a combo cannot include itself as a component';
  END IF;

  DELETE FROM public.combo_package_components WHERE combo_service_id = p_combo_service_id;

  INSERT INTO public.combo_package_components (combo_service_id, service_id, display_order, default_timing, default_same_staff)
  SELECT
    p_combo_service_id,
    (elem->>'service_id')::uuid,
    COALESCE((elem->>'display_order')::integer, 0),
    COALESCE(elem->>'default_timing', 'sequential'),
    COALESCE((elem->>'default_same_staff')::boolean, true)
  FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) AS elem;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_combo_components(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_service_combo_components(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_service_combo_components(uuid, jsonb) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('289', 'set-service-combo-components')
ON CONFLICT (version) DO NOTHING;

COMMIT;
