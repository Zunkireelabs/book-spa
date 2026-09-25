-- Migration 224: wrap RLS helper calls on public.bookings in scalar subqueries
--
-- Incident (2026-09-25, production): the whole staff dashboard failed with
-- Postgres 25P02 "current transaction is aborted, commands ignored until end of
-- transaction block" on every widget at once.
--
-- Chain of events:
--   1. public.bookings carries 5 PERMISSIVE SELECT policies. Postgres OR's them
--      together and evaluates all of them for every candidate row.
--   2. Those policies call get_user_role() / get_user_org_id() /
--      get_user_branch_id() / get_user_branch_ids() / auth.uid() *unwrapped*.
--      An unwrapped STABLE function inside a policy expression is re-executed
--      per row instead of being hoisted into a once-per-query InitPlan.
--   3. Two of the read policies ("customer reads own bookings" and "customer
--      reads own referral-linked bookings") additionally run subqueries over
--      customer_accounts / customer_referrals. Staff can never match them, but
--      they are still evaluated for every row.
--   4. Result: ~5.9k-row table producing 35M seq_tup_read and query times up to
--      7.5s -- against the `authenticated` role's 8s statement_timeout.
--   5. A query that tripped that timeout aborted mid-transaction, and the
--      connection was returned to the Supavisor pool without a ROLLBACK. Every
--      later request handed that same backend got 25P02, indefinitely, because
--      idle_in_transaction_session_timeout was 0.
--
-- The 0 -> 60s idle_in_transaction_session_timeout was set separately as a
-- backstop (ALTER DATABASE postgres). This migration removes the cause rather
-- than the symptom.
--
-- Semantics are UNCHANGED. All four helpers are STABLE and SECURITY DEFINER, and
-- auth.uid() is STABLE, so `(SELECT f())` returns exactly the same value as
-- `f()` -- it is only evaluated once per query instead of once per row. No
-- policy's USING/WITH CHECK logic, role list, or command is altered here.

-- ---------------------------------------------------------------- SELECT ----

ALTER POLICY "Admin viewer can read org bookings" ON public.bookings
USING (
  (SELECT get_user_role()) = 'admin_viewer'::user_role
  AND EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = bookings.branch_id
      AND b.org_id = (SELECT get_user_org_id())
  )
);

ALTER POLICY "Staff can read branch bookings" ON public.bookings
USING (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
  OR (SELECT get_user_role()) = 'admin'::user_role
);

ALTER POLICY "Staff can read own org bookings" ON public.bookings
USING (
  EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = bookings.branch_id
      AND b.org_id = (SELECT get_user_org_id())
  )
  AND (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'::user_role
  )
);

ALTER POLICY "customer reads own bookings" ON public.bookings
USING (
  customer_account_id IN (
    SELECT customer_accounts.id
    FROM customer_accounts
    WHERE customer_accounts.auth_user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "customer reads own referral-linked bookings" ON public.bookings
USING (
  id IN (
    SELECT cr.booking_id
    FROM customer_referrals cr
    WHERE cr.referring_customer_id IN (
      SELECT customer_accounts.customer_id
      FROM customer_accounts
      WHERE customer_accounts.auth_user_id = (SELECT auth.uid())
        AND customer_accounts.customer_id IS NOT NULL
    )
    UNION
    SELECT cr.redeemed_booking_id
    FROM customer_referrals cr
    WHERE cr.redeemed_booking_id IS NOT NULL
      AND cr.referring_customer_id IN (
        SELECT customer_accounts.customer_id
        FROM customer_accounts
        WHERE customer_accounts.auth_user_id = (SELECT auth.uid())
          AND customer_accounts.customer_id IS NOT NULL
      )
  )
);

-- ---------------------------------------------------------------- UPDATE ----
-- Both halves are restated: ALTER POLICY leaves an omitted clause untouched, so
-- USING and WITH CHECK must each be given to wrap both.

ALTER POLICY "Staff can update branch bookings" ON public.bookings
USING (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
  OR (SELECT get_user_role()) = 'admin'::user_role
)
WITH CHECK (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
  OR (SELECT get_user_role()) = 'admin'::user_role
);

ALTER POLICY "Staff can update own org bookings" ON public.bookings
USING (
  EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = bookings.branch_id
      AND b.org_id = (SELECT get_user_org_id())
  )
  AND (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'::user_role
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = bookings.branch_id
      AND b.org_id = (SELECT get_user_org_id())
  )
  AND (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'::user_role
  )
);

-- ---------------------------------------------------------------- INSERT ----
-- anon_insert_bookings is `WITH CHECK (true)` and needs no change.

ALTER POLICY "Staff can create branch bookings" ON public.bookings
WITH CHECK (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
  OR (SELECT get_user_role()) = 'admin'::user_role
);

ALTER POLICY "Staff can create own org bookings" ON public.bookings
WITH CHECK (
  EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = bookings.branch_id
      AND b.org_id = (SELECT get_user_org_id())
  )
  AND (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'::user_role
  )
);

INSERT INTO public.schema_migrations (version, name)
VALUES ('224', 'bookings-rls-initplan-perf')
ON CONFLICT (version) DO NOTHING;
