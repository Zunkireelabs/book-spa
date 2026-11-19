-- migration-379-link-conflict-resolve.sql
-- ZNLY-198 step 4b / ZNLY-205 (UI half). Migration 377 saved every login link it could not copy in public.znly205_link_conflicts.
-- The "Link needs review" prompt (admins, top of the team member list) now lets an admin settle each one:
--   * link  - do what the row suggested (set_user_therapist, which still refuses a taken person / login), and mark the row;
--   * keep  - leave things as they are, and mark the row.
-- A row is "open" while resolved_at IS NULL. The link and the mark happen in one transaction (one function call), so a refused
-- link leaves the row open. Admin only; the table keeps its admin-only read policy and gets no write policy (the RPC is the write path).
-- Reversible: DROP FUNCTION public.resolve_link_conflict(bigint, text); ALTER TABLE ... DROP COLUMN resolved_at, resolved_by, resolution.

BEGIN;

ALTER TABLE public.znly205_link_conflicts
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolution  text;

CREATE OR REPLACE FUNCTION public.resolve_link_conflict(p_conflict_id bigint, p_action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.get_user_org_id();
  c record;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'resolve_link_conflict: admins only' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('link', 'keep') THEN
    RAISE EXCEPTION 'resolve_link_conflict: action must be link or keep' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.znly205_link_conflicts WHERE id = p_conflict_id AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolve_link_conflict: not found in your organization' USING ERRCODE = '42501';
  END IF;
  IF c.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_link_conflict: already resolved' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'link' THEN
    IF c.user_id IS NULL OR c.therapist_id IS NULL THEN
      RAISE EXCEPTION 'resolve_link_conflict: this row has nothing to link' USING ERRCODE = '22023';
    END IF;
    -- Same rules as every other link: refuses a person or login that already belongs to another (23505), a person outside the org, or a branch you cannot manage.
    PERFORM public.set_user_therapist(c.user_id, c.therapist_id);
  END IF;
  UPDATE public.znly205_link_conflicts
     SET resolved_at = now(), resolved_by = auth.uid(), resolution = p_action
   WHERE id = p_conflict_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_link_conflict(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_link_conflict(bigint, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('379', 'link-conflict-resolve')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
