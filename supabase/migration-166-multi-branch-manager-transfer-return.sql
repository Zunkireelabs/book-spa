-- Migration 166: multi-branch-manager grants for the transfer-return functions
-- (additive, REVERSIBLE)
--
-- migration-157 fixed an incident where managers with a multi-branch grant
-- (public.user_branches) were rejected by transfer_therapist / cancel_scheduled_transfer /
-- extend_staff_transfer, because those functions only checked the caller's single primary
-- branch (get_user_branch_id()), never the grants table the branch-switcher already reads.
-- revert_staff_transfer_now() (migration-160-164) and reschedule_staff_transfer_return()
-- (migration-165) were added after that fix and never got the same widening — a manager whose
-- only access to a branch is via a user_branches grant (not their primary branch) would hit the
-- exact same false rejection trying to cancel/end/reschedule a transfer there.
--
-- Widens both functions' authorization checks the same way migration-157 did for the other four:
-- primary branch match OR a matching row in user_branches, for either side of the transfer.
--
-- Reversible: re-run migration-164/165 verbatim to drop the user_branches widening.

CREATE OR REPLACE FUNCTION public.revert_staff_transfer_now(
  p_transfer_id  uuid,
  p_reverted_at  timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role              user_role;
  v_caller_org        uuid;
  v_caller_branch     uuid;
  v_rec               record;
  v_current_branch    uuid;
  v_new_order         int;
  v_now               timestamptz := COALESCE(p_reverted_at, now());
  v_reverted_count    int;
  v_conflict_count    int;
  v_last_end          timestamptz;
BEGIN
  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_transfer_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: transfer not found';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: not your organization';
  END IF;

  IF v_rec.revert_at IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: this transfer has no scheduled return time';
  END IF;

  IF NOT (v_rec.applied = true AND v_rec.reverted = false) THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: this transfer has already ended';
  END IF;

  IF p_reverted_at IS NOT NULL THEN
    IF p_reverted_at > now() THEN
      RAISE EXCEPTION 'revert_staff_transfer_now: return time cannot be in the future';
    END IF;
    IF p_reverted_at < v_rec.transferred_at THEN
      RAISE EXCEPTION 'revert_staff_transfer_now: return time cannot be before the transfer started';
    END IF;
    IF p_reverted_at >= v_rec.revert_at THEN
      RAISE EXCEPTION 'revert_staff_transfer_now: return time must be before the scheduled return';
    END IF;
  END IF;

  -- Authorization: the manager of the staffer's CURRENT (destination) branch may act (mirrors
  -- extend_staff_transfer()), since that's who is reporting them back — and so may the manager
  -- of the ORIGIN branch (from_branch_id), since they're the one who sent the staffer away and
  -- may want to cancel/recall that transfer. Either side also counts via a user_branches grant,
  -- not just the manager's single primary branch (migration-157's fix, extended here).
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_rec.to_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.to_branch_id)
    ))
    OR (v_role = 'manager' AND (
      v_rec.from_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.from_branch_id)
    ))
  ) THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: only an admin, the destination branch''s manager, or the origin branch''s manager may end this transfer';
  END IF;

  SELECT branch_id INTO v_current_branch
  FROM public.therapists WHERE id = v_rec.therapist_id;

  IF v_current_branch IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: therapist no longer exists';
  END IF;

  IF v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: therapist is no longer at the destination branch for this transfer';
  END IF;

  -- Booking guard: don't pull them off a booking that's still in progress or hasn't
  -- started/finished yet at the branch they're currently at. Any non-terminal status (Pending
  -- included — the therapist is already assigned to it) counts; only Completed/Cancelled/No Show
  -- are excluded. Report the LAST scheduled booking's end time (not just the first one that
  -- happens to conflict) so the manager sees the real all-clear time instead of retrying into a
  -- second block.
  SELECT count(*), max(b.end_datetime) INTO v_conflict_count, v_last_end
  FROM public.bookings b
  WHERE b.therapist_id = v_rec.therapist_id
    AND b.branch_id = v_rec.to_branch_id
    AND b.status NOT IN ('Completed', 'Cancelled', 'No Show')
    AND b.end_datetime > v_now;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: still booked at this branch until % (% booking%) — wait until their last scheduled booking finishes, then mark them returned (you can enter that exact time)',
      to_char(v_last_end AT TIME ZONE 'Asia/Kathmandu', 'DD Mon HH24:MI'),
      v_conflict_count,
      CASE WHEN v_conflict_count = 1 THEN '' ELSE 's' END;
  END IF;

  IF v_rec.from_display_order IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.therapists
    WHERE branch_id = v_rec.from_branch_id AND display_order = v_rec.from_display_order
      AND id <> v_rec.therapist_id
  ) THEN
    v_new_order := v_rec.from_display_order;
  ELSE
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists WHERE branch_id = v_rec.from_branch_id;
  END IF;

  UPDATE public.therapists
     SET branch_id = v_rec.from_branch_id, display_order = v_new_order
   WHERE id = v_rec.therapist_id;

  PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.from_branch_id);

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note,
     effective_date, applied, start_time, is_return_leg)
  VALUES
    (v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id, v_rec.from_branch_id, auth.uid(),
     'Returned early (marked by manager)', (v_now AT TIME ZONE 'Asia/Kathmandu')::date, true,
     (v_now AT TIME ZONE 'Asia/Kathmandu')::time, true);

  UPDATE public.staff_transfers
     SET reverted = true, reverted_at = v_now
   WHERE id = p_transfer_id
     AND applied = true
     AND reverted = false;

  GET DIAGNOSTICS v_reverted_count = ROW_COUNT;

  IF v_reverted_count = 0 THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: this transfer has already ended';
  END IF;

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_staff_transfer_now(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revert_staff_transfer_now(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.revert_staff_transfer_now(uuid, timestamptz) TO authenticated;

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

  -- Authorization mirrors revert_staff_transfer_now(): either branch's manager (primary branch
  -- or a user_branches grant), or admin.
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_rec.to_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.to_branch_id)
    ))
    OR (v_role = 'manager' AND (
      v_rec.from_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.from_branch_id)
    ))
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
VALUES ('166', 'multi-branch-manager-transfer-return')
ON CONFLICT (version) DO NOTHING;
