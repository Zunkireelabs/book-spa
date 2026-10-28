-- Migration 305: let group booking read the therapist roster even when a tenant has
-- show_staff_selection off.
--
-- public_get_bookable_therapists (migration-253, branch-scoped by migration-257)
-- hard-requires show_staff_selection = true server-side. That flag's actual meaning
-- is "offer a SOLO customer a staff-picker on the profile page" -- group booking's
-- per-person professional step needs the same roster data for an unrelated reason
-- (computing per-person availability), regardless of whether solo customers are
-- offered that picker. On a tenant with the flag off (nuad-thai-spa, the only real
-- tenant, among others), the RPC returned zero rows for group booking's fetch,
-- which computeGroupSlots correctly-but-wrongly read as "zero therapists exist" and
-- marked every slot unavailable.
--
-- Fix: add p_for_group_booking boolean DEFAULT false. Existing callers (solo flow)
-- never pass it, so they get the exact same behavior as before -- the predicate is
-- `show_staff_selection OR p_for_group_booking`, and false changes nothing. Only the
-- new group-booking caller (fetchBookableTherapists(..., true) in api.js) sets it.
--
-- DROP + CREATE, not CREATE OR REPLACE: adding a parameter changes the function's
-- argument signature, which Postgres treats as a distinct overload rather than a
-- replacement of the 3-arg version -- leaving both would make PostgREST's RPC
-- resolution ambiguous for any caller passing only the original 3 named params
-- (same gotcha noted in migration-301's RPC work). Signature-breaking is fine here:
-- single DEFAULT-only addition, no removed/reordered params, every existing caller
-- (named-param RPC call) keeps working unchanged.
--
-- Reversible: DROP this 4-arg version, recreate migration-257's 3-arg body verbatim,
-- re-run its REVOKE/GRANT pair.

BEGIN;

DROP FUNCTION IF EXISTS public.public_get_bookable_therapists(text, uuid, uuid[]);

CREATE FUNCTION public.public_get_bookable_therapists(
  p_org_slug text,
  p_branch_id uuid,
  p_service_ids uuid[] DEFAULT NULL,
  p_for_group_booking boolean DEFAULT false
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
    AND (
      COALESCE((o.settings->>'show_staff_selection')::boolean, false) = true
      OR p_for_group_booking = true
    )
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

REVOKE ALL ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[], boolean) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('305', 'bookable-therapists-group-booking-bypass')
ON CONFLICT (version) DO NOTHING;

COMMIT;
