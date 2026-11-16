-- migration-321-staff-access-write-policies.sql
--
-- `public.users` has RLS enabled and, until now, only SELECT policies. Postgres
-- denies any command with no matching policy, so every write the Staff access
-- screen makes was blocked from the browser:
--
--   provisionStaffLogin  INSERT into users        → denied
--   grantStaffAccess     UPDATE role/access       → denied
--   updateStaffAccess    UPDATE anything          → denied
--
-- An UPDATE denied by RLS is not an error — it reports zero rows affected. So
-- the Save button would have appeared to work and silently changed nothing.
--
-- This was missed because both verification passes ran through psql as the
-- superuser, which bypasses RLS entirely. The lesson is recorded in
-- tasks/lessons.md: a write path tested only through psql has not been tested.
--
-- Scoping decisions:
--   * Managers and admins may write users in their OWN org only.
--   * The manager role ceiling is enforced here as well as in api.js
--     (assertCanGrantRole). The API check gives a clean error message; this one
--     means a hand-crafted request cannot bypass it. Defence in depth, since
--     privilege escalation is the specific risk — a manager promoting
--     themselves to admin.
--   * Nobody may change their own role. An admin who could would be able to
--     grant themselves anything; worse, a manager could self-promote. Admins
--     can still edit every OTHER account in the org.

BEGIN;

-- Helper: the caller's own role, read without recursing through users' own
-- RLS (SECURITY DEFINER). get_user_role() already exists and is used by the
-- SELECT policies above, so reuse it rather than adding a second source of
-- truth.

DROP POLICY IF EXISTS "Managers and admins can create org users" ON public.users;
CREATE POLICY "Managers and admins can create org users"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_user_org_id())
    AND (SELECT public.get_user_role()) IN ('manager', 'admin')
    -- A manager may not mint an admin or admin_viewer account.
    AND (
      (SELECT public.get_user_role()) = 'admin'
      OR role IN ('staff', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers and admins can update org users" ON public.users;
CREATE POLICY "Managers and admins can update org users"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (
    org_id = (SELECT public.get_user_org_id())
    AND (SELECT public.get_user_role()) IN ('manager', 'admin')
    -- Not your own row: no self-promotion, by anyone.
    AND id <> (SELECT auth.uid())
    -- A manager may not edit an admin or admin_viewer account at all;
    -- otherwise they could demote an admin and take over.
    AND (
      (SELECT public.get_user_role()) = 'admin'
      OR role IN ('staff', 'manager')
    )
  )
  WITH CHECK (
    org_id = (SELECT public.get_user_org_id())
    AND (SELECT public.get_user_role()) IN ('manager', 'admin')
    AND id <> (SELECT auth.uid())
    -- And may not promote the row they are editing INTO admin.
    AND (
      (SELECT public.get_user_role()) = 'admin'
      OR role IN ('staff', 'manager')
    )
  );

-- therapists.user_id is written by the same flow (linking a login to a staff
-- member). therapists already has manager/admin UPDATE policies from earlier
-- migrations, so no change is needed there — verified against the live policy
-- list before writing this migration.

-- user_branches holds the manually-ticked branch grants. It already carries
-- four policies; they are left alone for the same reason.

INSERT INTO public.schema_migrations (version, name)
VALUES ('321', 'staff-access-write-policies')
ON CONFLICT (version) DO NOTHING;

COMMIT;
