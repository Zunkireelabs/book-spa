-- Migration 267: staff can read branch users (additive, REVERSIBLE)
--
-- Problem: public.users SELECT RLS only lets a user read their own row, or a
-- manager/admin read org/branch users (migration-012, migration-063). Staff
-- has no policy to read other users' rows, so fetchBranchStaffUsers()
-- (src/services/api.js) -- used to populate the "Received by" tip picker in
-- the Record Payment modal -- returns zero rows for a staff-role caller
-- (RLS filters silently, no error), leaving the picker empty. Managers/admins
-- are unaffected since migration-063's policy already covers them.
--
-- Fix: add a read-only, branch-scoped SELECT policy for staff, same
-- branch-scoping as migration-063's manager policy.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Reversible: DROP POLICY IF EXISTS "Staff can read branch users" ON public.users;

BEGIN;

DROP POLICY IF EXISTS "Staff can read branch users" ON public.users;
CREATE POLICY "Staff can read branch users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'staff'
    AND branch_id = ANY(get_user_branch_ids())
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('267', 'staff-read-branch-users')
ON CONFLICT (version) DO NOTHING;

COMMIT;
