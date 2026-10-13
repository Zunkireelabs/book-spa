-- Migration 268: wrap unwrapped RLS helper calls in migration-267's staff
-- policy (additive, REVERSIBLE)
--
-- migration-267 added "Staff can read branch users" with get_user_role() and
-- get_user_branch_ids() called bare inside the policy expression. CI's
-- check-rls-initplan.sh guard (added after migration-225's incident -- see
-- that file's header: unwrapped calls on a hot policy turned a 27-row users
-- table into 94M+ seq scans and tipped dashboard queries past the
-- statement_timeout) caught this on migration-267's deploy and blocked the
-- pipeline. The policy itself already applied successfully to stage before
-- the guard step ran, so this migration fixes the live policy in place
-- rather than relying on migration-267 being re-run (it's already recorded
-- in schema_migrations; migrate-apply.sh skips applied versions).
--
-- Semantics UNCHANGED -- same role check, same branch scoping. Only the
-- number of times the planner evaluates each helper call changes.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Reversible: re-run migration-267's original (unwrapped) CREATE POLICY block.

BEGIN;

DROP POLICY IF EXISTS "Staff can read branch users" ON public.users;
CREATE POLICY "Staff can read branch users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'staff'
    AND branch_id = ANY((SELECT get_user_branch_ids())::uuid[])
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('268', 'fix-staff-users-rls-initplan')
ON CONFLICT (version) DO NOTHING;

COMMIT;
