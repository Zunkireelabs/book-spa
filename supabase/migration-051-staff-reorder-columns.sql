-- Migration 051: let staff reorder therapist/room columns in their own branch (additive, REVERSIBLE)
--
-- The Operations → Calendar view supports drag-to-reorder therapist and room columns. Until now
-- only manager + admin could do it — controlled at three layers (sidebar visibility, frontend
-- api.js role check, and RLS on therapists/rooms UPDATE). The same PR that adds this migration
-- relaxes the first two layers; this migration is the DB half of the change.
--
-- We add **narrow, branch-scoped** policies that let role = 'staff' UPDATE rows in their own
-- branch. We DO NOT touch the existing manager/admin policies — those continue to apply.
--
-- Trade-off: Postgres RLS doesn't gate by column, so a staff user could theoretically update any
-- column on a therapist or room row in their own branch (not just display_order). The app's
-- frontend api.js layer is the column gate — `updateTherapistOrder` and `updateRoomOrder` only
-- SET display_order. This matches the existing pattern for manager (migration-005 + 012) where
-- managers also have row-level UPDATE, with column scope enforced in `api.js`.
--
-- Idempotent (DROP IF EXISTS + CREATE) and portable (no hardcoded UUIDs).
--
-- Reversible:
--   DROP POLICY IF EXISTS "Staff can reorder branch therapists" ON public.therapists;
--   DROP POLICY IF EXISTS "Staff can reorder branch rooms"      ON public.rooms;

-- 1. Therapists: staff can update rows in their own branch.
DROP POLICY IF EXISTS "Staff can reorder branch therapists" ON public.therapists;
CREATE POLICY "Staff can reorder branch therapists"
  ON public.therapists FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'staff'
    AND branch_id = get_user_branch_id()
  )
  WITH CHECK (
    get_user_role() = 'staff'
    AND branch_id = get_user_branch_id()
  );

-- 2. Rooms: same shape.
DROP POLICY IF EXISTS "Staff can reorder branch rooms" ON public.rooms;
CREATE POLICY "Staff can reorder branch rooms"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'staff'
    AND branch_id = get_user_branch_id()
  )
  WITH CHECK (
    get_user_role() = 'staff'
    AND branch_id = get_user_branch_id()
  );

-- 3. Record migration
INSERT INTO public.schema_migrations (version, name)
VALUES ('051', 'staff-reorder-columns')
ON CONFLICT (version) DO NOTHING;
