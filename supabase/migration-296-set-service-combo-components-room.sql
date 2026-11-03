-- Migration 296: set_service_combo_components — extend for default_same_room
--
-- CREATE OR REPLACE FUNCTION on the same (uuid, jsonb) signature as migration-289 —
-- no DROP needed. p_components elements now also accept "default_same_room"
-- (bool, defaults true), written alongside default_timing/default_same_staff.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-applied unconditionally.
-- Reversible: re-apply migration-289's body (drops default_same_room handling,
-- not the column itself — see migration-295 for that).

BEGIN;

-- p_components: jsonb array of {"service_id": uuid, "display_order": int,
-- "default_timing": "sequential"|"concurrent", "default_same_staff": bool,
-- "default_same_room": bool}
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

  INSERT INTO public.combo_package_components (combo_service_id, service_id, display_order, default_timing, default_same_staff, default_same_room)
  SELECT
    p_combo_service_id,
    (elem->>'service_id')::uuid,
    COALESCE((elem->>'display_order')::integer, 0),
    COALESCE(elem->>'default_timing', 'sequential'),
    COALESCE((elem->>'default_same_staff')::boolean, true),
    COALESCE((elem->>'default_same_room')::boolean, true)
  FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) AS elem;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_combo_components(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_service_combo_components(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_service_combo_components(uuid, jsonb) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('296', 'set-service-combo-components-room')
ON CONFLICT (version) DO NOTHING;

COMMIT;
