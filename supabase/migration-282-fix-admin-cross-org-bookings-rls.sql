-- Migration 282: close a cross-tenant data leak in bookings RLS for role='admin'
--
-- Found while building an org-wide "Due Report" admin panel: an admin querying
-- bookings with no branch_id filter (the Report's own query, and the existing
-- "Outstanding Report -> Overall" admin view, whose OVERALL_BRANCH_ID sentinel
-- also skips branch filtering) got back bookings from OTHER organizations'
-- branches -- customer name, phone, and amount due all readable.
--
-- Root cause: public.bookings carries two permissive policies per command that
-- both match an admin -- e.g. for SELECT, "Staff can read branch bookings" and
-- "Staff can read own org bookings". Postgres OR's permissive policies
-- together, so a row only needs to satisfy ONE of them. "...own org bookings"
-- correctly scopes its admin clause with an org EXISTS check:
--
--   branch_id = (SELECT get_user_branch_id())
--   OR (SELECT get_user_role()) = 'admin'::user_role
--   -- wrapped in: EXISTS (SELECT 1 FROM branches b WHERE b.id = bookings.branch_id
--   --                       AND b.org_id = (SELECT get_user_org_id()))
--
-- but the sibling "...branch bookings" policy has the identical admin clause
-- with NO org check at all:
--
--   branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
--   OR (SELECT get_user_role()) = 'admin'::user_role
--
-- so any row an admin tries to read/update/insert satisfies this second policy
-- regardless of which org the branch belongs to. The "...own org..." sibling
-- already grants admins correct org-scoped access on its own, so the admin
-- branch of "...branch bookings" is both redundant and the entire leak --
-- removing it (branch-id matching for non-admin staff is untouched) is the fix.
--
-- Same pattern existed on UPDATE and INSERT, fixed the same way.

BEGIN;

-- ---------------------------------------------------------------- SELECT ----

ALTER POLICY "Staff can read branch bookings" ON public.bookings
USING (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
);

-- ---------------------------------------------------------------- UPDATE ----
-- Both halves are restated: ALTER POLICY leaves an omitted clause untouched, so
-- USING and WITH CHECK must each be given to wrap both.

ALTER POLICY "Staff can update branch bookings" ON public.bookings
USING (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
)
WITH CHECK (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
);

-- ---------------------------------------------------------------- INSERT ----

ALTER POLICY "Staff can create branch bookings" ON public.bookings
WITH CHECK (
  branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
);

INSERT INTO public.schema_migrations (version, name)
VALUES ('282', 'fix-admin-cross-org-bookings-rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
