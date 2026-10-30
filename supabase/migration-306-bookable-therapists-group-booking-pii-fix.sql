-- Migration 306: close the PII leak migration-305's p_for_group_booking bypass opened.
--
-- migration-305 let p_for_group_booking=true skip the show_staff_selection check
-- entirely, so group booking's availability math could read the therapist roster on
-- toggle-off tenants. But p_for_group_booking is a bare client-supplied boolean with
-- no server-side proof a real group booking is happening -- public_get_bookable_therapists
-- is GRANTed to anon, so anyone calling the RPC directly over PostgREST with
-- p_for_group_booking=true gets back the FULL roster (name, photo, bio, position,
-- rating, experience) on any tenant with show_staff_selection off, reopening the
-- exact PII exposure migration-253 closed.
--
-- The legitimate need: computeGroupSlots' "any professional" reserve-count math needs
-- real distinct therapist ids on toggle-off tenants, but never needs names/photos/bios
-- for that math -- those are only shown when a per-therapist picker renders, which
-- (after the show_staff_selection fix) only happens when the toggle is on anyway.
--
-- Fix: same signature (CREATE OR REPLACE, no new param). When
-- p_for_group_booking = true AND show_staff_selection = false, return id-only rows
-- (every other column NULL) -- enough for client-side availability math and
-- claimed-therapist-id tracking, nothing identifying. Full rows in every other case
-- (toggle on, regardless of caller).
--
-- Reversible: CREATE OR REPLACE migration-305's body verbatim (unconditional full
-- columns whenever show_staff_selection OR p_for_group_booking).

BEGIN;

CREATE OR REPLACE FUNCTION public.public_get_bookable_therapists(
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
    CASE WHEN show_sel THEN t.name             ELSE NULL END AS name,
    CASE WHEN show_sel THEN t.position          ELSE NULL END AS "position",
    CASE WHEN show_sel THEN t.photo_url         ELSE NULL END AS photo_url,
    CASE WHEN show_sel THEN t.rating            ELSE NULL END AS rating,
    CASE WHEN show_sel THEN t.experience_years  ELSE NULL END AS experience_years,
    CASE WHEN show_sel THEN t.bio               ELSE NULL END AS bio,
    CASE WHEN show_sel THEN t.display_order     ELSE NULL END AS display_order
  FROM public.therapists t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.organizations o ON o.id = b.org_id
  CROSS JOIN LATERAL (
    SELECT COALESCE((o.settings->>'show_staff_selection')::boolean, false) AS show_sel
  ) flags
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND (flags.show_sel = true OR p_for_group_booking = true)
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
VALUES ('306', 'bookable-therapists-group-booking-pii-fix')
ON CONFLICT (version) DO NOTHING;

COMMIT;
