-- Migration 317: collapse the three permissive SELECT policies on payments into one
-- SECURITY DEFINER predicate, to stop the RLS policy tree multiplying.
-- Additive only where possible. Idempotent: safe to re-run in either database
-- (CREATE OR REPLACE, DROP POLICY IF EXISTS + recreate).
-- Applied: stage 2026-11-12 / prod HELD.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- payments carried three permissive SELECT policies. Postgres ORs permissive
-- policies, so all three were evaluated on every read. Each one did an EXISTS
-- into bookings, and a policy subquery is itself subject to the referenced
-- table's RLS — so bookings expanded its five permissive policies, each of
-- which reached branches, which expanded four more, one of them a correlated
-- subquery over customer_accounts. Three times five times four is sixty policy
-- branches for a single read.
--
-- Measured on production (2026-11-12), EXPLAIN (ANALYZE) as `authenticated`
-- with a real manager JWT, 50 rows out of a 6,499-row table:
--
--     Plan nodes . . . . . . 442   (278 InitPlan / SubPlan entries)
--     Planning Time  . . . . 11.798 ms
--     Execution Time . . . . 187.659 ms
--
-- Planning cost about as much as execution. In pg_stat_statements this query
-- was the #1 application statement by total time by a factor of 3.3x:
-- 49,635 calls, mean 48.2 ms, max 14,250.9 ms, total 2,392.3 s.
-- Full writeup: docs/planning/perf-audit-2026-11-12.html, finding 01.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES, AND WHAT MUST NOT
--
-- Access is intended to be IDENTICAL. The subtle part is that the old policies
-- got their org scoping *transitively*: "Staff can read branch payments" reads
--
--     EXISTS (SELECT 1 FROM bookings b
--             WHERE b.id = payments.booking_id
--               AND (b.branch_id = ANY (get_user_branch_ids())
--                    OR get_user_role() = 'admin'))
--
-- which on its own would let an admin read payments in ANY org — the clause is
-- not org-scoped. It was safe only because the inner `bookings` subquery was
-- itself filtered by bookings' RLS, which *is* org-scoped.
--
-- A SECURITY DEFINER function bypasses RLS on the tables it touches. That is
-- exactly what makes it fast, and exactly what would turn the above into a
-- cross-tenant leak if the org check were not restated explicitly. So
-- accessible_booking_ids() below makes `br.org_id = get_user_org_id()` a
-- mandatory conjunct that every role must satisfy. Do not relax it.
--
-- Equivalence was verified empirically rather than by reading: the set of
-- visible payment ids was captured for all 22 staging users across all four
-- roles and five orgs before and after this migration, and compared per user.
-- See the session log for 2026-11-12.
--
-- NOTE: booking_combo_items (3 policies), booking_tips (2) and payment_refunds
-- (1) nest into bookings the same way and can reuse accessible_booking_ids().
-- They are left alone here because payments is the only one measured hot, and
-- a security change wants a small review surface. Follow-up, not oversight.
-- ---------------------------------------------------------------------------

BEGIN;

-- Returns the ids of every booking whose financial rows the current user may
-- read. SECURITY DEFINER so the bookings/branches lookups inside are not
-- re-filtered by their own RLS (the whole point -- that re-filtering is what
-- multiplied the plan). search_path is pinned so the body cannot be hijacked
-- by a caller-controlled search_path.
--
-- Deliberately set-returning rather than a per-row user_can_read_booking(uuid)
-- predicate. A SECURITY DEFINER function cannot be inlined by the planner, so
-- a per-row form runs once per candidate row -- plus the four nested helper
-- calls inside it -- and measured SLOWER than the policies it replaced:
-- planning collapsed but execution roughly doubled. Phrased as
-- `booking_id IN (SELECT ...)` with no correlation to the outer row, the
-- planner evaluates it once per statement as a hashed SubPlan instead.
--
-- Measured on staging, same user and query, EXPLAIN (ANALYZE) of
-- `select amount, payment_mode from payments limit 50`:
--
--     three OR'd policies     planning 41.785 ms + execution 24.648 ms = 66.4 ms
--     per-row SECURITY DEFINER  planning  0.150 ms + execution 50.373 ms = 50.5 ms
--     this form               planning  1.126 ms + execution  9.706 ms = 10.8 ms
--
-- Scaling note: this materialises every accessible booking id once per
-- statement. At current volumes (8,980 bookings in production) that is a small
-- hash table. If bookings grows by an order of magnitude, re-measure -- the
-- right answer then is probably a denormalised org_id/branch_id column on
-- payments so the policy needs no join at all.
CREATE OR REPLACE FUNCTION public.accessible_booking_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT bk.id
  FROM public.bookings bk
  JOIN public.branches br ON br.id = bk.branch_id
  -- Mandatory tenant boundary. Every branch below is ANDed with this.
  WHERE br.org_id = (SELECT public.get_user_org_id())
    AND (
      -- Staff/manager: any branch they are assigned to (users.branch_id
      -- unioned with user_branches, per get_user_branch_ids()).
      bk.branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
      -- Their single home branch, which the old "own org payments" policy
      -- matched via get_user_branch_id().
      OR bk.branch_id = (SELECT public.get_user_branch_id())
      -- admin and admin_viewer read org-wide. admin_viewer is read-only;
      -- that is enforced by it having no INSERT/UPDATE policy, not here.
      OR (SELECT public.get_user_role()) IN ('admin'::user_role, 'admin_viewer'::user_role)
    );
$$;

COMMENT ON FUNCTION public.accessible_booking_ids() IS
  'Booking ids whose financial rows the current user may read. SECURITY DEFINER '
  'to keep RLS policies that reference bookings from expanding the whole '
  'bookings/branches policy tree (migration-317). Set-returning so the planner '
  'evaluates it once per statement. The org_id check is the tenant boundary and '
  'must stay a mandatory conjunct.';

-- anon has no SELECT policy on payments, but grant execute anyway so the
-- predicate evaluates cleanly rather than erroring if a future policy
-- references it. With auth.uid() NULL every helper returns NULL, so the
-- org_id comparison is NULL and the function returns no rows.
REVOKE ALL ON FUNCTION public.accessible_booking_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accessible_booking_ids() TO authenticated, anon;

-- Replace the three OR'd SELECT policies with one. The two INSERT policies on
-- payments ("Staff can record payments", "Staff can record own org payments")
-- are deliberately untouched.
DROP POLICY IF EXISTS "Admin viewer can read org payments" ON public.payments;
DROP POLICY IF EXISTS "Staff can read branch payments" ON public.payments;
DROP POLICY IF EXISTS "Staff can read own org payments" ON public.payments;

DROP POLICY IF EXISTS "Staff can read permitted payments" ON public.payments;
CREATE POLICY "Staff can read permitted payments"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (booking_id IN (SELECT public.accessible_booking_ids()));

INSERT INTO public.schema_migrations (version, name)
VALUES ('317', 'flatten-payments-rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
