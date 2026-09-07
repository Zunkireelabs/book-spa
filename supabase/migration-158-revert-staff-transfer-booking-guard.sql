-- Migration 158: block "Mark Returned Early" while a booking is still in the way
-- (additive, REVERSIBLE)
--
-- revert_staff_transfer_now() (migration-156/157) moves a therapist's branch_id back to
-- from_branch_id immediately, with no check that they aren't mid-booking (or about to start
-- one) at the destination branch. A manager ending a transfer early — or entering a custom
-- past return time — could yank a therapist off a booking's branch while that booking is still
-- Confirmed/In-Progress there, orphaning it (the branch's calendar would show a booking for a
-- therapist who, per therapists.branch_id, is no longer at that branch).
--
-- This adds a guard: if the therapist has any Confirmed/In-Progress booking at the destination
-- branch (v_rec.to_branch_id) whose end_datetime is after the return moment (v_now — "now" for
-- the instant path, or the manager-entered p_reverted_at for the custom-time path), the whole
-- function raises and nothing is written. The manager must wait until that booking's slot
-- finishes, then either use "Mark Returned Early" again (now unblocked) or enter that finish
-- time via the custom-return-time field.
--
-- Also widens who may call this: previously only the destination branch's manager (or admin)
-- could end a transfer early. The ORIGIN branch's manager now can too — e.g. Thamel transfers a
-- therapist to Sanepa for 2 days, then Thamel wants to cancel that transfer and pull them back.
-- The booking guard above still applies either way, so a same-day booking at Sanepa still blocks
-- the return and surfaces its end time to whoever attempted it.
--
-- Builds on migration-156/157.
--
-- Reversible: re-run migration-157 verbatim to drop this guard (same signature, no booking check).

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
  v_conflict          record;
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

  -- A manually-entered return time may only backdate to when this leg of the transfer
  -- actually started, and may never be in the future or past the originally scheduled
  -- automatic return (that's just letting it run its course, not "early").
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
  -- may want to cancel/recall that transfer.
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.to_branch_id = v_caller_branch)
    OR (v_role = 'manager' AND v_rec.from_branch_id = v_caller_branch)
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
  -- started/finished yet at the branch they're currently at.
  SELECT b.id, b.end_datetime INTO v_conflict
  FROM public.bookings b
  WHERE b.therapist_id = v_rec.therapist_id
    AND b.branch_id = v_rec.to_branch_id
    AND b.status IN ('Confirmed', 'In-Progress')
    AND b.end_datetime > v_now
  ORDER BY b.start_datetime
  LIMIT 1;

  IF v_conflict.id IS NOT NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: still booked at this branch until % — wait until that booking finishes, then mark them returned (you can enter that exact time)',
      to_char(v_conflict.end_datetime AT TIME ZONE 'Asia/Kathmandu', 'DD Mon HH24:MI');
  END IF;

  -- Prefer the captured original spot; fall back to append-at-end for legacy rows
  -- (pre-145) that never captured one, or if that slot is somehow already taken.
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
     effective_date, applied, start_time)
  VALUES
    (v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id, v_rec.from_branch_id, auth.uid(),
     'Returned early (marked by manager)', (v_now AT TIME ZONE 'Asia/Kathmandu')::date, true,
     (v_now AT TIME ZONE 'Asia/Kathmandu')::time);

  -- Atomic, race-safe: re-checks applied/reverted against the CURRENT row at UPDATE time, so
  -- a concurrent apply_due_staff_reverts() tick between our SELECT and here is caught cleanly.
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

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('158', 'revert-staff-transfer-booking-guard')
ON CONFLICT (version) DO NOTHING;
