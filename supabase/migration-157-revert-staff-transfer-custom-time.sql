-- Migration 157: allow a custom return time on "Mark Returned Early" (additive, REVERSIBLE)
--
-- revert_staff_transfer_now() (migration-156) always stamped reverted_at (and the synthesized
-- "returned early" transfer row's effective_date/start_time) with now() — there was no way for
-- a manager to say "they actually came back at 3:00 PM", only "they're back right this second".
-- This adds an optional p_reverted_at param: when supplied it's used instead of now() for the
-- three places migration-156 hardcoded v_now (the synthesized return-row's effective_date/
-- start_time, and staff_transfers.reverted_at); when omitted, behavior is identical to before
-- (defaults to now()). Existing 1-arg callers are unaffected.
--
-- Reversible: DROP FUNCTION IF EXISTS public.revert_staff_transfer_now(uuid, timestamptz);
--             then re-run migration-156 to restore the 1-arg-only version.

DROP FUNCTION IF EXISTS public.revert_staff_transfer_now(uuid);

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

  -- Authorization mirrors extend_staff_transfer(): the manager of the staffer's CURRENT
  -- (destination) branch may act, since that's who is reporting them back.
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.to_branch_id = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: only an admin or the destination branch''s manager may end this transfer';
  END IF;

  SELECT branch_id INTO v_current_branch
  FROM public.therapists WHERE id = v_rec.therapist_id;

  IF v_current_branch IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: therapist no longer exists';
  END IF;

  IF v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: therapist is no longer at the destination branch for this transfer';
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
VALUES ('157', 'revert-staff-transfer-custom-time')
ON CONFLICT (version) DO NOTHING;
