-- Migration 378 (ZNLY-198 step 4a, found by the 204/205 test): stop "infinite recursion detected in policy for relation bookings".
--
-- Stage's migration 322 ("Own bookings only when restricted") lets a restricted staff member (calendar_visibility = 'own') read a
-- booking when a booking_therapists row names them: that policy reads booking_therapists. Zennly's migration 340 (tenant sweep)
-- changed the booking_therapists policies from `true` to "the booking belongs to my organisation", written as an EXISTS over
-- public.bookings. Read together, a restricted staff member selecting from bookings loops: bookings policy -> booking_therapists
-- policy -> bookings policy -> ... and PostgreSQL raises the recursion error, so the whole calendar / bookings list fails for
-- that account. Neither migration is wrong alone; the pair is.
--
-- Fix: the organisation check moves into a SECURITY DEFINER helper that reads bookings without RLS. Same rule (booking -> branch ->
-- organisation = the caller's organisation), no loop. The four booking_therapists policies call the helper.
--
-- Reversible (manual): ALTER POLICY ... back to the EXISTS form of migration-340 (do not, it brings the recursion back).
-- Applied: local only.

BEGIN;

CREATE OR REPLACE FUNCTION public.booking_in_my_org(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
     WHERE b.id = p_booking_id AND br.org_id = (SELECT public.get_user_org_id()));
$$;
REVOKE ALL ON FUNCTION public.booking_in_my_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_in_my_org(uuid) TO authenticated;

ALTER POLICY booking_therapists_select ON public.booking_therapists
  USING ((SELECT public.booking_in_my_org(booking_therapists.booking_id)));
ALTER POLICY booking_therapists_insert ON public.booking_therapists
  WITH CHECK ((SELECT public.booking_in_my_org(booking_therapists.booking_id)));
ALTER POLICY booking_therapists_update ON public.booking_therapists
  USING ((SELECT public.booking_in_my_org(booking_therapists.booking_id)))
  WITH CHECK ((SELECT public.booking_in_my_org(booking_therapists.booking_id)));
ALTER POLICY booking_therapists_delete ON public.booking_therapists
  USING ((SELECT public.booking_in_my_org(booking_therapists.booking_id)));

INSERT INTO public.schema_migrations (version, name)
VALUES ('378', 'booking-therapists-policy-no-recursion')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
