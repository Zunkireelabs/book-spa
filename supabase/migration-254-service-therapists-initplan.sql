-- Migration 254: two unrelated deploy-blocking RLS fixes
--
-- 1. Wrap unwrapped RLS helper calls on service_therapists
--
-- migration-249 added public.service_therapists with two policies calling
-- get_user_org_id() (3x) and get_user_role() (2x) bare inside USING/WITH CHECK.
-- scripts/check-rls-initplan.sh failed the staging deploy on both.
--
-- Same pattern/fix as migration-225: wrap each bare STABLE helper call in a
-- scalar subquery so the planner hoists it into a once-per-query InitPlan
-- instead of re-evaluating it per row. See migration-225 for the full
-- incident writeup (94.9M seq scans on public.users, staff dashboard outage
-- 2026-09-25). Semantics unchanged -- only evaluation count differs.
--
-- 249 is already applied and recorded on staging/prod, so it will never
-- re-run; this ships as its own migration instead of editing 249 in place.
--
-- 2. Add the missing booking_therapists UPDATE policy
--
-- api.js's createBooking upsert uses ignoreDuplicates: false, which emits
-- ON CONFLICT ... DO UPDATE. migration-020-booking-therapists.sql only ever
-- granted SELECT/INSERT/DELETE, so Postgres throws on the DO UPDATE path --
-- every staff booking that assigns a therapist to an existing row errors and
-- the room override never lands. No helper calls in this policy, so it
-- passes the InitPlan guard by construction.

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can read org service_therapists" ON public.service_therapists;
CREATE POLICY "Authenticated users can read org service_therapists"
  ON public.service_therapists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_therapists.service_id
        AND s.org_id = (SELECT get_user_org_id())
    )
  );

DROP POLICY IF EXISTS "Manager and admin can manage org service_therapists" ON public.service_therapists;
CREATE POLICY "Manager and admin can manage org service_therapists"
  ON public.service_therapists FOR ALL
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_therapists.service_id
        AND s.org_id = (SELECT get_user_org_id())
    )
  )
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_therapists.service_id
        AND s.org_id = (SELECT get_user_org_id())
    )
  );

DROP POLICY IF EXISTS "booking_therapists_update" ON public.booking_therapists;
CREATE POLICY "booking_therapists_update" ON public.booking_therapists
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.schema_migrations (version, name)
VALUES ('254', 'service-therapists-initplan')
ON CONFLICT (version) DO NOTHING;

COMMIT;
