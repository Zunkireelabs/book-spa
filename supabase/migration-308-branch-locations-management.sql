-- Migration 308: Locations (branches) management — create/edit branch details + per-day hours
--
-- No "Locations"/"Branches" management page exists anywhere in book-spa today. Branches are
-- only ever created via SQL seed scripts, and name/address/phone/maps_url have zero edit path.
-- This adds:
--   1. branch_working_hours — per-day recurring opening hours for a branch, mirroring
--      therapist_working_hours' (migration-275) exact shape: one row per day per entity,
--      day_of_week 0=Monday..6=Sunday, is_day_off + start/end CHECK, UNIQUE(branch_id, day_of_week).
--      Unlike branches, this is a normal RLS-gated child table, not an RPC — it's a new table,
--      not a scalar column on an existing row with no write policy. SELECT is open to
--      authenticated/anon (matches branches' own public read policy — customers need to see
--      open hours); INSERT/UPDATE/DELETE are admin-only, scoped to the branch's org.
--   2. create_branch / update_branch_details — admin-only SECURITY DEFINER RPCs for the
--      branches columns that still have zero write path (name/address/phone/maps_url). Follows
--      the exact convention of update_branch_online_capacity/update_branch_photo
--      (migrations 301/302): branches has RLS enabled with SELECT-only policies, so a plain
--      .update()/.insert() from the client would silently affect zero rows.
--      update_branch_details intentionally does NOT touch online_booking_capacity/
--      advance_booking_days/photo_url — those keep their own existing single-purpose RPCs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.create_branch(text, text, text, text);
--   DROP FUNCTION IF EXISTS public.update_branch_details(uuid, text, text, text, text);
--   DROP TABLE IF EXISTS public.branch_working_hours;
--
-- Applied: stage PENDING / prod HELD (per CLAUDE.md, prod is applied by CI on merge to main).

BEGIN;

-- 1. Per-day branch opening hours.
CREATE TABLE IF NOT EXISTS public.branch_working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time,
  end_time time,
  is_day_off boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_branch_working_hours UNIQUE (branch_id, day_of_week),
  CONSTRAINT chk_branch_working_hours_times CHECK (
    is_day_off = true
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_branch_working_hours_branch ON public.branch_working_hours(branch_id);

ALTER TABLE public.branch_working_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read branch working hours" ON public.branch_working_hours;
CREATE POLICY "Public can read branch working hours"
  ON public.branch_working_hours FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Admin can insert branch working hours" ON public.branch_working_hours;
CREATE POLICY "Admin can insert branch working hours"
  ON public.branch_working_hours FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = branch_working_hours.branch_id
        AND b.org_id = (SELECT get_user_org_id())
    )
  );

DROP POLICY IF EXISTS "Admin can update branch working hours" ON public.branch_working_hours;
CREATE POLICY "Admin can update branch working hours"
  ON public.branch_working_hours FOR UPDATE
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = branch_working_hours.branch_id
        AND b.org_id = (SELECT get_user_org_id())
    )
  )
  WITH CHECK (
    (SELECT get_user_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = branch_working_hours.branch_id
        AND b.org_id = (SELECT get_user_org_id())
    )
  );

DROP POLICY IF EXISTS "Admin can delete branch working hours" ON public.branch_working_hours;
CREATE POLICY "Admin can delete branch working hours"
  ON public.branch_working_hours FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = branch_working_hours.branch_id
        AND b.org_id = (SELECT get_user_org_id())
    )
  );

-- 2. Admin-only write path for creating a branch. Same shape as update_branch_photo
-- (migration-302): branches has RLS enabled with SELECT-only policies, so a plain
-- .insert() from the client would be rejected outright.
CREATE OR REPLACE FUNCTION public.create_branch(
  p_name text,
  p_address text,
  p_phone text,
  p_maps_url text
)
RETURNS public.branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_branch public.branches;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'create_branch: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'create_branch: no organization context';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'create_branch: name is required';
  END IF;

  INSERT INTO public.branches (org_id, name, address, phone, maps_url)
  VALUES (v_org_id, btrim(p_name), p_address, p_phone, p_maps_url)
  RETURNING * INTO v_branch;

  RETURN v_branch;
END;
$$;

-- 3. Admin-only write path for name/address/phone/maps_url. Does NOT touch
-- online_booking_capacity/advance_booking_days/photo_url — those keep their own
-- existing single-purpose RPCs (migrations 301/302/303).
CREATE OR REPLACE FUNCTION public.update_branch_details(
  p_branch_id uuid,
  p_name text,
  p_address text,
  p_phone text,
  p_maps_url text
)
RETURNS public.branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_branch public.branches;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_branch_details: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_branch_details: no organization context';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'update_branch_details: name is required';
  END IF;

  UPDATE public.branches
  SET name = btrim(p_name),
      address = p_address,
      phone = p_phone,
      maps_url = p_maps_url
  WHERE id = p_branch_id
    AND org_id = v_org_id
  RETURNING * INTO v_branch;

  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'update_branch_details: branch % not found in this organization', p_branch_id;
  END IF;

  RETURN v_branch;
END;
$$;

-- Staff-only: revoke from anon explicitly as well as PUBLIC (belt-and-braces, same as
-- migrations 302/303).
REVOKE ALL ON FUNCTION public.create_branch(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_branch(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_branch(text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_branch_details(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_branch_details(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_branch_details(uuid, text, text, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('308', 'branch-locations-management')
ON CONFLICT (version) DO NOTHING;

COMMIT;
