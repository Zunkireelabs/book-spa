-- Migration 399: org-level admins can use the waitlist (ZNLY-256, found in the CP3 rehearsal 18 Nov 2026)
--
-- waitlist_entries (migration 327) let a row in only when branch_id = ANY(get_user_branch_ids()). An admin who is org-level (users.branch_id NULL
-- and no user_branches row; 5 of 7 Nuad admins) has an empty branch list, so "Add to waitlist" failed with
-- "new row violates row-level security policy for table waitlist_entries", while the same admin can read and write bookings.
-- Fix = the EXACT pattern of "Staff can create/update branch bookings": the caller's own branches, OR role admin on a branch of the caller's org.
--   - branch managers / staff stay limited to their own branches (get_user_branch_ids);
--   - org isolation unchanged (the branch must belong to get_user_org_id(); inserts must also carry org_id = the caller's org);
--   - admin_viewer may READ every branch of its org (bookings has the same separate read-only policy); no write;
--   - still no DELETE policy, deliberately (migration 327): removing an entry sets status='removed'.
-- Same on stage and prod before this migration (migration 327 only). Test: supabase/tests/znly-256.sql. Idempotent.
-- Applied: stage - / prod -.

BEGIN;

DROP POLICY IF EXISTS "Staff can read branch waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can read branch waitlist"
  ON public.waitlist_entries FOR SELECT TO authenticated
  USING (
    branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
    OR (
      (SELECT public.get_user_role()) = 'admin'::user_role
      AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = waitlist_entries.branch_id AND br.org_id = (SELECT public.get_user_org_id()))
    )
  );

DROP POLICY IF EXISTS "Admin viewers can read org waitlist" ON public.waitlist_entries;
CREATE POLICY "Admin viewers can read org waitlist"
  ON public.waitlist_entries FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'admin_viewer'::user_role
    AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = waitlist_entries.branch_id AND br.org_id = (SELECT public.get_user_org_id()))
  );

DROP POLICY IF EXISTS "Staff can add to branch waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can add to branch waitlist"
  ON public.waitlist_entries FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_user_org_id())
    AND (
      branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
      OR (
        (SELECT public.get_user_role()) = 'admin'::user_role
        AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = waitlist_entries.branch_id AND br.org_id = (SELECT public.get_user_org_id()))
      )
    )
  );

DROP POLICY IF EXISTS "Staff can update branch waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can update branch waitlist"
  ON public.waitlist_entries FOR UPDATE TO authenticated
  USING (
    branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
    OR (
      (SELECT public.get_user_role()) = 'admin'::user_role
      AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = waitlist_entries.branch_id AND br.org_id = (SELECT public.get_user_org_id()))
    )
  )
  WITH CHECK (
    branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
    OR (
      (SELECT public.get_user_role()) = 'admin'::user_role
      AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = waitlist_entries.branch_id AND br.org_id = (SELECT public.get_user_org_id()))
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('399', 'waitlist-org-admin-rls')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
