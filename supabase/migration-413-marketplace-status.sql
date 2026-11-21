-- Migration 413 (ZNLY-345): marketplace live / not-live status + guarded go-live.
--
-- One shared readiness rule for every tenant and industry (no per-tenant code):
--   marketplace_readiness_blockers(org_id) -> text[] of plain-English blockers (empty = ready)
-- A studio is LIVE on the marketplace only when the owner flag marketplace_booking_enabled is on AND
-- there are zero blockers. The marketplace reads marketplace_status() (live / not_live / not_found + phone,
-- never the reasons). Only we flip the flag, through marketplace_go_live(), which refuses to switch ON while
-- blockers exist (nothing changes) and always allows switching OFF. go_live is service_role/SQL only: the
-- marketplace edge function does not expose it.
--
-- All three: SECURITY DEFINER, fixed search_path, EXECUTE for service_role only.
-- Idempotent: CREATE OR REPLACE. Reversible (manual):
--   DROP FUNCTION IF EXISTS public.marketplace_go_live(text, boolean);
--   DROP FUNCTION IF EXISTS public.marketplace_status(text);
--   DROP FUNCTION IF EXISTS public.marketplace_readiness_blockers(uuid);

CREATE OR REPLACE FUNCTION public.marketplace_readiness_blockers(p_org_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers text[] := ARRAY[]::text[];
  v_active boolean;
  v_rooms boolean;
  v_hours int; v_staff int; v_room int; v_svc int; v_ready int;
BEGIN
  SELECT o.is_active, COALESCE(i.enable_rooms, true) INTO v_active, v_rooms
  FROM public.organizations o LEFT JOIN public.industries i ON i.id = o.industry_type
  WHERE o.id = p_org_id;

  IF v_active IS NULL THEN
    RETURN ARRAY['The business does not exist.'];
  END IF;
  IF NOT v_active THEN
    v_blockers := array_append(v_blockers, 'The business is not active.'::text);
  END IF;

  -- Ready = ONE active branch that has everything at once: opening hours, an active staff member, an active
  -- room (rooms tenants only) and an active online-bookable service OFFERED at that branch. "Offered" is the
  -- customer flow's own rule (api.js fetchServices): branch_service_links (no rows = every branch, rows = only
  -- those branches, migration 312/313) AND the branch's excluded_service_categories (migration 024).
  SELECT count(*) FILTER (WHERE x.hours), count(*) FILTER (WHERE x.staff), count(*) FILTER (WHERE x.room),
         count(*) FILTER (WHERE x.svc), count(*) FILTER (WHERE x.hours AND x.staff AND x.room AND x.svc)
  INTO v_hours, v_staff, v_room, v_svc, v_ready
  FROM (
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM public.branch_working_hours w WHERE w.branch_id = b.id)
           THEN EXISTS (SELECT 1 FROM public.branch_working_hours w WHERE w.branch_id = b.id AND NOT w.is_day_off)
           ELSE b.open_time IS NOT NULL AND b.close_time IS NOT NULL END AS hours,
      EXISTS (SELECT 1 FROM public.therapists t WHERE t.branch_id = b.id AND t.is_active) AS staff,
      (NOT v_rooms OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.branch_id = b.id AND r.is_active)) AS room,
      EXISTS (SELECT 1 FROM public.services s
              WHERE s.org_id = p_org_id AND s.is_active AND COALESCE(s.bookable_online, true)
                AND (NOT EXISTS (SELECT 1 FROM public.branch_service_links l WHERE l.service_id = s.id)
                     OR EXISTS (SELECT 1 FROM public.branch_service_links l WHERE l.service_id = s.id AND l.branch_id = b.id))
                AND (s.category IS NULL OR NOT (s.category = ANY (COALESCE(b.excluded_service_categories, '{}'))))) AS svc
    FROM public.branches b WHERE b.org_id = p_org_id AND b.is_active
  ) x;

  IF v_hours = 0 THEN v_blockers := array_append(v_blockers, 'No active branch has opening hours set.'::text); END IF;
  IF v_staff = 0 THEN v_blockers := array_append(v_blockers, 'No active staff member.'::text); END IF;
  IF v_svc = 0 THEN v_blockers := array_append(v_blockers, 'No service is bookable online.'::text); END IF;
  IF v_rooms AND v_room = 0 THEN v_blockers := array_append(v_blockers, 'No active room.'::text); END IF;
  IF v_ready = 0 AND v_hours > 0 AND v_staff > 0 AND v_svc > 0 AND (NOT v_rooms OR v_room > 0) THEN
    v_blockers := array_append(v_blockers, 'No single location has everything needed to take bookings (opening hours, staff, a bookable service and a room if you use rooms).'::text);
  END IF;

  RETURN v_blockers;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_status(p_org_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_enabled boolean;
  v_phone text;
BEGIN
  SELECT id, COALESCE(marketplace_booking_enabled, false) INTO v_org_id, v_enabled
  FROM public.organizations WHERE slug = p_org_slug;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'phone', NULL);
  END IF;

  SELECT NULLIF(btrim(b.phone), '') INTO v_phone
  FROM public.branches b
  WHERE b.org_id = v_org_id AND b.is_active AND NULLIF(btrim(b.phone), '') IS NOT NULL
  ORDER BY b.created_at, b.id LIMIT 1;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_enabled AND cardinality(public.marketplace_readiness_blockers(v_org_id)) = 0
                   THEN 'live' ELSE 'not_live' END,
    'phone', v_phone);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_go_live(p_org_slug text, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_blockers text[];
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = p_org_slug FOR UPDATE;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organization not found: %', p_org_slug USING ERRCODE = 'BSNF1';
  END IF;

  IF p_on THEN
    v_blockers := public.marketplace_readiness_blockers(v_org_id);
    IF cardinality(v_blockers) > 0 THEN
      RAISE EXCEPTION 'cannot go live, fix first: %', array_to_string(v_blockers, ' ')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.organizations SET marketplace_booking_enabled = COALESCE(p_on, false) WHERE id = v_org_id;
  RETURN public.marketplace_status(p_org_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_readiness_blockers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketplace_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketplace_go_live(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_readiness_blockers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketplace_status(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketplace_go_live(text, boolean) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('413', 'marketplace-status')
ON CONFLICT (version) DO NOTHING;
