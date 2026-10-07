-- Migration 256: restrict anon's column access on public.therapists
--
-- The anon SELECT policy on therapists (migration-012, narrowed to `TO anon` by
-- migration-093) is `USING (is_active = true)` with no org predicate -- anon carries
-- no org context at all, so it cannot be scoped by organization. PR #372 widened what
-- that row-level hole leaks by adding bio, photo_url, experience_years, rating to the
-- table: any anon client can already read every tenant's active-therapist rows, and
-- now that includes their profile copy, photos and ratings too.
--
-- The RLS policy can't be fixed by adding an org predicate -- anon has none to check.
-- The surgical fix is column-level privileges: anon keeps row access (still needed by
-- the three anon-reachable read paths below) but loses SELECT on every column those
-- paths don't actually use.
--
-- Of 49 therapist read sites (29 direct, 20 embedded) in the frontend, exactly three
-- are anon-reachable (no logged-in session) and not already routed through a
-- SECURITY DEFINER RPC:
--   createBooking (api.js)                        needs: id, name, is_active, branch_id
--   searchBookingPublic (api.js)                   needs: id, name, gender
--   DateTimeSelection.jsx therapist-count effect   needs: gender, branch_id, is_active
--
-- Union of those: id, name, gender, is_active, branch_id. No select('*') touches
-- therapists anywhere in the frontend, and there is no realtime subscription on it,
-- so nothing else can break from dropping the rest.
--
-- bio/photo_url/experience_years/rating (and every other profile column) stay
-- reachable for the booking flow through public_get_bookable_therapists, which is
-- SECURITY DEFINER and org-scoped -- that's the front door this closes the back
-- door behind.
--
-- NOT fixed by this migration: anon can still read id/name/gender/is_active/branch_id
-- for every tenant's active staff, cross-tenant -- the row-level hole itself is
-- untouched, only the column exposure from #372 is closed. Closing the row-level hole
-- fully means replacing the blanket `USING (is_active = true)` anon policy with RPCs
-- for all three paths above -- separate work, not attempted here.
--
-- Reversible: GRANT SELECT ON public.therapists TO anon; (restores all-column access;
-- does not by itself re-widen the policy, which this migration never touched).

BEGIN;

REVOKE SELECT ON public.therapists FROM anon;
GRANT SELECT (id, name, gender, is_active, branch_id) ON public.therapists TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('256', 'therapists-anon-columns')
ON CONFLICT (version) DO NOTHING;

COMMIT;
