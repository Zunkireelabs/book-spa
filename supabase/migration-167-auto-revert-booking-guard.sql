-- Migration 167: give apply_due_staff_reverts() the same booking guard as
-- revert_staff_transfer_now() (additive, REVERSIBLE)
--
-- revert_staff_transfer_now() (migration-160/161/162/163/164) refuses to end a transfer while
-- the therapist still has a non-terminal booking at the destination branch, so a manager using
-- "Mark Returned Early" / a custom return time can't orphan a live booking. But
-- apply_due_staff_reverts() — the pg_cron job (migration-145/149/163) that fires the AUTOMATIC
-- revert once a transfer's scheduled revert_at has passed — never got the same check: it moves
-- the therapist's branch_id back unconditionally whenever revert_at <= now(), even if they're
-- mid-booking (or about to start one) at the branch they're currently assigned to. That silently
-- orphans the booking exactly like the bug migration-162 fixed for the manual path, just via the
-- cron instead of a button.
--
-- This makes the cron loop skip (not force through) a transfer whose therapist has any
-- non-terminal booking (Pending/Confirmed/In-Progress — mirrors migration-164's widened check)
-- at the destination branch ending after now(): the transfer row is left untouched (still
-- applied = true, reverted = false) so the very next tick (5 min later, per migration-145's cron
-- schedule) re-evaluates it once that booking clears, instead of skipping it forever like the
-- pre-existing "therapist no longer at that branch" branch does (which marks reverted = true and
-- gives up).
--
-- Reversible: re-run migration-163 verbatim to drop this guard.

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
  v_conflict_count int;
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
      -- Booking guard: don't pull them off a booking that's still in progress or hasn't
      -- started/finished yet at the branch they're currently at. Mirrors
      -- revert_staff_transfer_now()'s guard (migration-164) — any non-terminal status counts.
      -- Leave the transfer row untouched so the next cron tick retries it once the booking clears,
      -- rather than forcing the revert through and orphaning the booking.
      SELECT count(*) INTO v_conflict_count
      FROM public.bookings b
      WHERE b.therapist_id = v_rec.therapist_id
        AND b.branch_id = v_rec.to_branch_id
        AND b.status NOT IN ('Completed', 'Cancelled', 'No Show')
        AND b.end_datetime > v_now;

      IF v_conflict_count > 0 THEN
        RAISE NOTICE 'apply_due_staff_reverts: therapist % still has % non-terminal booking% at % (transfer %); deferring auto-revert to next tick',
          v_rec.therapist_id, v_conflict_count, CASE WHEN v_conflict_count = 1 THEN '' ELSE 's' END, v_rec.to_branch_id, v_rec.id;
        CONTINUE;
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
VALUES ('167', 'auto-revert-booking-guard')
ON CONFLICT (version) DO NOTHING;
