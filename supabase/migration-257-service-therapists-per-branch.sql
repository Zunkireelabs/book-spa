-- Migration 257: scope service_therapists allow-lists per branch
--
-- An eligible-staff allow-list (service_therapists) is org-wide while therapists are
-- branch-scoped. Restricting a service's staff at Branch A today makes that service
-- unbookable at every other branch too -- the allow-list has no rows for Branch B's
-- therapists, so both enforcement points below read "has an allow-list, nobody on it
-- eligible" instead of "Branch B has no allow-list for this service, stay
-- unrestricted". Harmless on a single-branch org (today), a silent landmine on the
-- first second branch.
--
-- Rule: an allow-list constrains only the branches whose staff actually appear on it.
-- A branch with no allow-listed staff for a given service stays unrestricted for that
-- branch -- same "no rows = unrestricted" convention the allow-list already uses,
-- just evaluated per branch instead of globally.
--
-- Two enforcement points need the identical predicate change so they can never
-- disagree:
--   1. public_get_bookable_therapists (migration-253) -- "has an allow-list" for a
--      selected service now means "has an allow-list row whose therapist is in
--      p_branch_id", not "has any allow-list row at all".
--   2. check_therapist_booking_guards (migration-252) -- same change, keyed off the
--      assigning therapist's own branch_id (looked up once, alongside the existing
--      therapist-name lookup).
--
-- Both signatures are unchanged from migration-253/252, so CREATE OR REPLACE is
-- sufficient -- no DROP needed. REVOKE/GRANT pairs are re-applied anyway since
-- CREATE OR REPLACE does not reliably preserve a function's prior grants across
-- Supabase's default-privileges behavior (same gotcha migration-252's own comment
-- calls out).
--
-- Reversible: CREATE OR REPLACE both functions back to their migration-253/252
-- bodies (org-wide "has an allow-list" predicate), then re-run this migration's
-- REVOKE/GRANT statements.

BEGIN;

-- 1. public_get_bookable_therapists -- branch-scope the "has an allow-list" check.
CREATE OR REPLACE FUNCTION public.public_get_bookable_therapists(
  p_org_slug text,
  p_branch_id uuid,
  p_service_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  name              text,
  "position"        text,
  photo_url         text,
  rating            numeric,
  experience_years  integer,
  bio               text,
  display_order     integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    t.id,
    t.name,
    t.position,
    t.photo_url,
    t.rating,
    t.experience_years,
    t.bio,
    t.display_order
  FROM public.therapists t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.organizations o ON o.id = b.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND COALESCE((o.settings->>'show_staff_selection')::boolean, false) = true
    AND t.branch_id = p_branch_id
    AND t.is_active = true
    AND t.is_service_staff = true
    -- Eligible for every selected service: there must be no selected service that has
    -- a branch-scoped allow-list which this therapist is missing from. A service with
    -- no allow-list rows AT THIS BRANCH stays unrestricted at this branch, even if it
    -- has allow-list rows for a different branch's therapists.
    AND (
      p_service_ids IS NULL
      OR cardinality(p_service_ids) = 0
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(p_service_ids) AS sid
        WHERE EXISTS (
          SELECT 1
          FROM public.service_therapists st
          JOIN public.therapists st_t ON st_t.id = st.therapist_id
          WHERE st.service_id = sid AND st_t.branch_id = p_branch_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_therapists st
          WHERE st.service_id = sid AND st.therapist_id = t.id
        )
      )
    )
  ORDER BY COALESCE(t.display_order, 2147483647), t.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[]) TO anon, authenticated;

-- 2. check_therapist_booking_guards -- same branch-scoped "has an allow-list" check,
-- keyed off the assigning therapist's own branch_id.
CREATE OR REPLACE FUNCTION public.check_therapist_booking_guards(
  p_therapist_id uuid,
  p_service_id uuid,
  p_date date,
  p_start_datetime timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_therapist_name text;
  v_service_name   text;
  v_branch_id       uuid;
  v_has_allowlist  boolean;
  v_on_allowlist    boolean;
  v_attendance      record;
BEGIN
  SELECT name, branch_id INTO v_therapist_name, v_branch_id FROM public.therapists WHERE id = p_therapist_id;
  SELECT name INTO v_service_name FROM public.services WHERE id = p_service_id;

  SELECT EXISTS(
    SELECT 1
    FROM public.service_therapists st
    JOIN public.therapists st_t ON st_t.id = st.therapist_id
    WHERE st.service_id = p_service_id AND st_t.branch_id = v_branch_id
  ) INTO v_has_allowlist;
  IF v_has_allowlist THEN
    SELECT EXISTS(
      SELECT 1 FROM public.service_therapists
      WHERE service_id = p_service_id AND therapist_id = p_therapist_id
    ) INTO v_on_allowlist;

    IF NOT v_on_allowlist THEN
      RAISE EXCEPTION 'THERAPIST_NOT_ELIGIBLE: % is not on the eligible staff list for %. Update the service''s eligible staff in Service Management to allow this.',
        COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service')
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  SELECT status, check_out_time INTO v_attendance
  FROM public.therapist_attendance
  WHERE therapist_id = p_therapist_id AND date = p_date;

  IF v_attendance.status IS NOT NULL AND v_attendance.status::text IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off') THEN
    RAISE EXCEPTION 'THERAPIST_ABSENT: % is marked as % on this date.',
      COALESCE(v_therapist_name, 'This therapist'), v_attendance.status
      USING ERRCODE = 'P0006';
  END IF;

  IF v_attendance.check_out_time IS NOT NULL AND p_start_datetime >= v_attendance.check_out_time THEN
    RAISE EXCEPTION 'THERAPIST_CHECKED_OUT: % already checked out for this date.',
      COALESCE(v_therapist_name, 'This therapist')
      USING ERRCODE = 'P0006';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_therapist_booking_guards(uuid, uuid, date, timestamptz) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('257', 'service-therapists-per-branch')
ON CONFLICT (version) DO NOTHING;

COMMIT;
