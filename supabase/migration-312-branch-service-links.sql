-- Migration 312: per-branch service scope (ZNLY-185) (additive, REVERSIBLE)
--
-- Today every service is "Overall" — visible at every branch, with no way to restrict
-- one to specific branches. This adds an explicit allow-list join table, mirroring
-- service_therapists' (migration-249) inclusion convention exactly:
--
--   - No rows for a service = Overall (visible at every branch — today's behavior,
--     unchanged default for every existing service in every org, zero migration cost).
--   - >=1 row for a service = branch-specific, visible ONLY at those branches.
--
-- No org_id column (mirrors service_therapists again) — RLS joins through
-- services.org_id for ownership, branches.org_id for the branch side.
--
-- Unlike service_therapists, this table has no direct manager/admin RLS write policy —
-- writes go through set_service_branches only. That RPC's atomic delete-then-insert
-- replace is the only way branch scope should ever change; a direct RLS write policy
-- would let a client UPDATE/DELETE individual rows non-atomically instead.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.set_service_branches(uuid, uuid[]);
--   DROP TABLE IF EXISTS public.branch_service_links;

BEGIN;

CREATE TABLE IF NOT EXISTS public.branch_service_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (branch_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_service_links_service ON public.branch_service_links(service_id);
CREATE INDEX IF NOT EXISTS idx_branch_service_links_branch ON public.branch_service_links(branch_id);

ALTER TABLE public.branch_service_links ENABLE ROW LEVEL SECURITY;

-- Open to authenticated and anon -- the public booking flow needs to filter services
-- by branch scope client-side (services/api.js, fetchServices /
-- fetchBookableServicesByOrgSlug), same reasoning as branches' own public SELECT policy.
DROP POLICY IF EXISTS "Public can read branch service links" ON public.branch_service_links;
CREATE POLICY "Public can read branch service links"
  ON public.branch_service_links FOR SELECT
  TO authenticated, anon
  USING (true);

-- No INSERT/UPDATE/DELETE policy -- writes only through set_service_branches below
-- (SECURITY DEFINER bypasses RLS for its own atomic replace).

CREATE OR REPLACE FUNCTION public.set_service_branches(
  p_service_id uuid,
  p_branch_ids uuid[]
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
  IF v_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'set_service_branches: manager or admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_service_branches: no organization context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = p_service_id AND s.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'set_service_branches: service % not found in your organization', p_service_id;
  END IF;

  -- Every id must belong to the caller's org -- validated BEFORE writing anything,
  -- same atomicity as set_service_therapists (migration-258). No manager-branch-
  -- ownership restriction here, unlike set_service_therapists -- this isn't a
  -- single-branch-scoped write, any manager/admin in the org can set any service's
  -- branch scope (same permission level fetchServicesForManagement/
  -- toggleServiceActive already use).
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_branch_ids, ARRAY[]::uuid[])) AS bid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = bid AND b.org_id = v_org_id
    )
  ) THEN
    RAISE EXCEPTION 'set_service_branches: one or more branch ids do not belong to your organization';
  END IF;

  DELETE FROM public.branch_service_links WHERE service_id = p_service_id;

  INSERT INTO public.branch_service_links (branch_id, service_id)
  SELECT bid, p_service_id
  FROM unnest(COALESCE(p_branch_ids, ARRAY[]::uuid[])) AS bid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_branches(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_service_branches(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_service_branches(uuid, uuid[]) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('312', 'branch-service-links')
ON CONFLICT (version) DO NOTHING;

COMMIT;
