-- Migration 404 (ZNLY-282): 'own_view' is an own-only login in the database too.
--
-- Migration 322 restricts booking rows (RESTRICTIVE policy, plus the 334 / 393 policies and *_safe views that call the same
-- function) only when users.calendar_visibility = 'own'. A staff login set to 'own_view' (own calendar, view only) could therefore
-- read every booking at its branch through PostgREST. The app already treats both values as own-only (staffAccessRules isOwnCalendar).
--
-- The ONLY object that tests the literal is public.is_own_bookings_only(): every policy and caller_hides_* reads through it, and no
-- migration after 322 redefined it (grep of 323-403). So this recreates that one function with IN ('own','own_view'); nothing else changes.
-- Managers and admins are still never restricted. This does NOT add view-only (write) enforcement: separate ticket.
--
-- Reversible: re-run the CREATE OR REPLACE from migration-322 (= 'own').

BEGIN;

CREATE OR REPLACE FUNCTION public.is_own_bookings_only()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT u.calendar_visibility IN ('own', 'own_view') AND u.role NOT IN ('manager', 'admin')
     FROM public.users u WHERE u.id = auth.uid()),
    false
  );
$$;

COMMENT ON FUNCTION public.is_own_bookings_only() IS
  'True when the signed-in account is restricted to its own bookings '
  '(users.calendar_visibility in (''own'', ''own_view''), not manager/admin). See migration-322 and migration-404.';

INSERT INTO public.schema_migrations (version, name)
VALUES ('404', 'own-view-rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
