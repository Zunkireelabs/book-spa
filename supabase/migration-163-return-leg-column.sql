-- Migration 163: is_return_leg column instead of note-text matching (additive, REVERSIBLE)
--
-- Both revert_staff_transfer_now() (migration-160/161/162) and apply_due_staff_reverts()
-- (migration-149) insert a synthesized "return leg" row (destination -> origin) to record a
-- transfer ending, distinguished from a real outbound transfer only by a hardcoded note string
-- ('Returned early (marked by manager)' / 'Auto-reverted after scheduled duration'). The
-- frontend (TransferReportPanel.jsx) exact-matches those two literals to tell return rows apart
-- from real transfers — fragile, since a future wording change to either string would silently
-- break that matching with no error, just wrong badges in the report.
--
-- This adds a proper boolean column set explicitly at INSERT time by both functions, and
-- backfills existing rows by the same note match (one-time, not an ongoing dependency).
--
-- Reversible: ALTER TABLE public.staff_transfers DROP COLUMN IF EXISTS is_return_leg;
--             (and re-run migration-162/149 verbatim to drop the column writes)

ALTER TABLE public.staff_transfers ADD COLUMN IF NOT EXISTS is_return_leg boolean NOT NULL DEFAULT false;

UPDATE public.staff_transfers
   SET is_return_leg = true
 WHERE note IN ('Returned early (marked by manager)', 'Auto-reverted after scheduled duration')
   AND is_return_leg = false;

-- Redefine revert_staff_transfer_now() (byte-for-byte migration-162's body — booking guard +
-- widened origin/destination-manager authorization — plus is_return_leg = true on the
-- synthesized return row's INSERT).
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

-- Redefine apply_due_staff_reverts() (byte-for-byte migration-149's body, plus
-- is_return_leg = true on the synthesized return row's INSERT).
CREATE OR REPLACE FUNCTION public.apply_due_staff_reverts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now            timestamptz := now();
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE revert_at IS NOT NULL AND applied = true AND reverted = false AND revert_at <= v_now
    ORDER BY revert_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      UPDATE public.staff_transfers SET reverted = true, reverted_at = v_now WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF v_current_branch = v_rec.to_branch_id THEN
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
        (v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id, v_rec.from_branch_id, NULL,
         'Auto-reverted after scheduled duration', (v_now AT TIME ZONE 'Asia/Kathmandu')::date, true,
         (v_now AT TIME ZONE 'Asia/Kathmandu')::time, true);
    ELSE
      RAISE NOTICE 'apply_due_staff_reverts: therapist % no longer at % (transfer %); skipping auto-revert, marking resolved',
        v_rec.therapist_id, v_rec.to_branch_id, v_rec.id;
    END IF;

    UPDATE public.staff_transfers SET reverted = true, reverted_at = v_now WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM authenticated;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('163', 'return-leg-column')
ON CONFLICT (version) DO NOTHING;
