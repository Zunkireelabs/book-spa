-- migration-322-own-bookings-rls.sql
--
-- Enforce "this staff member sees only their own bookings" in the DATABASE,
-- not just in api.js.
--
-- Before this, calendar_visibility='own' was applied by getCalendarBookings
-- filtering on the booking_therapists junction. That stops the product from
-- showing other people's bookings, but it is not a restriction: measured
-- against staging, a restricted staff account could still read all 174
-- bookings at its branch — and their prices — through a hand-crafted
-- PostgREST request. Only 18 of those were actually theirs.
--
-- Row visibility is exactly what RLS is for, so this closes properly. The
-- column half (customer_name, customer_phone, amounts) does NOT close the
-- same way: column privileges apply to the whole `authenticated` role and
-- cannot vary per user, so masking per-person needs a view or RPC and a move
-- of every read. That remains open and is documented at the bottom.

BEGIN;

-- Which therapist row this login belongs to, if any. SECURITY DEFINER so the
-- policy can read `therapists` without recursing through that table's own RLS,
-- matching how get_user_branch_ids() and friends already work.
CREATE OR REPLACE FUNCTION public.current_therapist_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id FROM public.therapists t WHERE t.user_id = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_therapist_id() IS
  'The therapists row linked to the signed-in account (migration-318), or '
  'NULL if unlinked. Used by the own-bookings policy.';

-- Is this caller restricted to their own bookings? Managers and admins never
-- are — a manager who cannot see the branch calendar cannot run the branch.
CREATE OR REPLACE FUNCTION public.is_own_bookings_only()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT u.calendar_visibility = 'own' AND u.role NOT IN ('manager', 'admin')
     FROM public.users u WHERE u.id = auth.uid()),
    false
  );
$$;

COMMENT ON FUNCTION public.is_own_bookings_only() IS
  'True when the signed-in account is restricted to its own bookings '
  '(users.calendar_visibility = ''own'', staff role only). See migration-322.';

-- A RESTRICTIVE policy, not a modification of the existing permissive one.
--
-- This is the detail that matters: `bookings` carries FIVE permissive SELECT
-- policies, and permissive policies are OR'd. Narrowing "Staff can read branch
-- bookings" achieved nothing, because "Staff can read own org bookings" still
-- granted org-wide access on its own — verified: a restricted account could
-- still read all 174 rows after that attempt.
--
-- A restrictive policy is AND'd with every permissive one, so it can only ever
-- take access away. That makes it the right shape for a privacy rule layered
-- over existing grants, and it means we don't have to find and edit every
-- policy that might widen access now or later.
--
-- A booking counts as "theirs" if they are on the booking_therapists junction
-- (the multi-therapist source of truth, kept in sync by migration-252's
-- trigger) OR on the legacy bookings.therapist_id column. Both, because older
-- rows predate the junction and dropping them would hide a staff member's own
-- history from them.
--
-- Everyone else is unaffected: is_own_bookings_only() returns false for
-- managers, admins, unrestricted staff, and for customer-facing sessions that
-- have no public.users row at all — so the four customer/admin policies keep
-- working untouched.
--
-- Fails CLOSED: a restricted account with no linked therapist row sees
-- nothing. An unlinked restricted account is a misconfiguration, and showing
-- everything would be the wrong way to surface it.
DROP POLICY IF EXISTS "Own bookings only when restricted" ON public.bookings;
CREATE POLICY "Own bookings only when restricted"
  ON public.bookings
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    NOT (SELECT public.is_own_bookings_only())
    OR (
      (SELECT public.current_therapist_id()) IS NOT NULL
      AND (
        therapist_id = (SELECT public.current_therapist_id())
        OR EXISTS (
          SELECT 1 FROM public.booking_therapists bt
          WHERE bt.booking_id = bookings.id
            AND bt.therapist_id = (SELECT public.current_therapist_id())
        )
      )
    )
  );

-- ── Still open after this migration ──────────────────────────────────────────
-- Column-level masking. customer_name, customer_phone and the amount columns
-- are still readable by any authenticated user whose RLS lets them see the
-- row. api.js masks names/numbers after fetch and omits amounts from its
-- selects, so the product behaves correctly — but a staff member with
-- developer tools can still read the real values for rows they ARE allowed.
--
-- This migration shrinks that exposure a great deal (18 rows instead of 174
-- for a restricted account) without closing it. Closing it needs either:
--   a) a masking view over bookings plus moving all 43 customer_name reads, or
--   b) SECURITY DEFINER RPCs for the affected reads,
-- both of which are a larger change to the most central table in the app and
-- should be their own piece of work.

INSERT INTO public.schema_migrations (version, name)
VALUES ('322', 'own-bookings-rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
