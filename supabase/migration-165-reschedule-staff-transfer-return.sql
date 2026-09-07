-- Migration 165: reschedule an active transfer's return to a new FUTURE date/time
-- (additive, REVERSIBLE)
--
-- The existing tools for ending a transfer only cover two cases: extend_staff_transfer() pushes
-- the scheduled revert_at LATER, and revert_staff_transfer_now() (migration-160/161/162/163/164)
-- records that the staffer ALREADY came back at some point in the past (its p_reverted_at must
-- be <= now()). Neither covers "this was a 2-day transfer, but we now only need them for 1 day —
-- have them come back tomorrow instead", i.e. moving the scheduled return EARLIER but still into
-- the future. A manager trying to do this via revert_staff_transfer_now()'s custom-time field
-- hits "return time cannot be in the future" for a date like tomorrow, because that field is for
-- recording history, not for scheduling ahead.
--
-- This adds reschedule_staff_transfer_return(): sets a transfer's revert_at to any new instant
-- strictly after now() (so it's still a real future auto-revert, handled by the existing
-- apply_due_staff_reverts() cron same as if that had been the original duration) and strictly
-- before the transfer's own transferred_at + a sane bound isn't needed — no upper limit, a
-- manager may also push it further out this way instead of using "Add Extra Time" if they prefer
-- picking an exact date. Same authorization as revert_staff_transfer_now(): admin, or the
-- manager of either the origin or destination branch.
--
-- Reversible: DROP FUNCTION public.reschedule_staff_transfer_return(uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.reschedule_staff_transfer_return(
  p_transfer_id   uuid,
  p_new_revert_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role           user_role;
  v_caller_org     uuid;
  v_caller_branch  uuid;
  v_rec            record;
  v_updated_count  int;
BEGIN
  IF p_new_revert_at IS NULL THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: a new return time is required';
  END IF;

  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_transfer_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: transfer not found';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: not your organization';
  END IF;

  IF v_rec.revert_at IS NULL THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: this transfer has no scheduled return time (permanent transfers can''t be rescheduled — start a new transfer instead)';
  END IF;

  IF NOT (v_rec.applied = true AND v_rec.reverted = false) THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: this transfer has already ended';
  END IF;

  -- Authorization mirrors revert_staff_transfer_now(): either branch's manager, or admin.
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.to_branch_id = v_caller_branch)
    OR (v_role = 'manager' AND v_rec.from_branch_id = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: only an admin, the destination branch''s manager, or the origin branch''s manager may reschedule this transfer''s return';
  END IF;

  IF p_new_revert_at <= now() THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: new return time must be in the future — for a return that already happened, use "Mark Returned Early" instead';
  END IF;

  UPDATE public.staff_transfers
     SET revert_at = p_new_revert_at
   WHERE id = p_transfer_id
     AND applied = true
     AND reverted = false;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'reschedule_staff_transfer_return: this transfer has already ended';
  END IF;

  RETURN p_new_revert_at;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_staff_transfer_return(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_staff_transfer_return(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_staff_transfer_return(uuid, timestamptz) TO authenticated;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('165', 'reschedule-staff-transfer-return')
ON CONFLICT (version) DO NOTHING;
