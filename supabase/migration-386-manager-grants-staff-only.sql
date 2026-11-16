-- Migration 386 (ZNLY-215, owner decision): who may create / change a login (users row), replacing the migration-321 rule.
--   * admin: anyone in the organisation, any role, any branch (but never their own row: no self-promotion, as before).
--   * manager: ONLY the Staff role, and ONLY for people whose home branch (users.branch_id) is one the manager manages
--     (get_user_branch_ids(): their own branch plus granted ones). A manager can no longer create or edit a Manager, an Admin or an
--     Admin viewer, cannot promote anyone, and cannot move a person to a branch they do not manage (WITH CHECK looks at the new row too).
--   * Access at other branches (user_branches) was already admin-only (migration-321) and stays so.
-- Rollback (manual): re-create the two policies from migration-321.
-- Applied: stage - / prod HELD.

BEGIN;

DROP POLICY IF EXISTS "Managers and admins can create org users" ON public.users;
CREATE POLICY "Managers and admins can create org users"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_user_org_id())
    AND (
      (SELECT public.get_user_role()) = 'admin'
      OR ((SELECT public.get_user_role()) = 'manager' AND role = 'staff' AND branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]))
    )
  );

DROP POLICY IF EXISTS "Managers and admins can update org users" ON public.users;
CREATE POLICY "Managers and admins can update org users"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (
    org_id = (SELECT public.get_user_org_id())
    AND id <> (SELECT auth.uid())
    AND (
      (SELECT public.get_user_role()) = 'admin'
      OR ((SELECT public.get_user_role()) = 'manager' AND role = 'staff' AND branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]))
    )
  )
  WITH CHECK (
    org_id = (SELECT public.get_user_org_id())
    AND id <> (SELECT auth.uid())
    AND (
      (SELECT public.get_user_role()) = 'admin'
      OR ((SELECT public.get_user_role()) = 'manager' AND role = 'staff' AND branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]))
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('386', 'manager-grants-staff-only')
ON CONFLICT (version) DO NOTHING;

COMMIT;
