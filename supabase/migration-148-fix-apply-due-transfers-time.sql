-- Migration 144: fix apply_due_staff_transfers to respect start_time, not just effective_date
-- (bugfix, REVERSIBLE)
--
-- Bug: apply_due_staff_transfers() (the cron job) only checked `effective_date <= today`,
-- ignoring the `start_time` column added in migration-145. A transfer scheduled for LATER
-- TODAY (e.g. effective_date = today, start_time = 15:40) was incorrectly applied by the next
-- 5-minute cron tick, however early that happened to be — moving the therapist's branch_id
-- hours (or minutes) before the intended start time. transfer_therapist()'s own "is this
-- immediate" check already correctly used date+time (v_start_ts <= v_now); this migration
-- brings the cron's "is this due" check into line with that same logic.
--
-- Surfaced 2026-09-02: a transfer for ANISHA THAKURI (Lazimpat -> Thamel, start 15:40, 3h) was
-- applied by cron before 15:40 actually arrived.
--
-- Builds on migration-145 (start_time/duration columns) and migration-048 (user-branch sync).
--
-- Reversible: re-run migration-048's CREATE OR REPLACE body for apply_due_staff_transfers()
-- (reverts the WHERE clause back to `effective_date <= v_today`).

CREATE OR REPLACE FUNCTION public.apply_due_staff_transfers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now            timestamp := now() AT TIME ZONE 'Asia/Kathmandu';
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE applied = false
      AND (effective_date::text || ' ' || COALESCE(start_time, '00:00:00'::time)::text)::timestamp <= v_now
    ORDER BY effective_date, start_time, transferred_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN
      SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
      FROM public.therapists WHERE branch_id = v_rec.to_branch_id;

      UPDATE public.therapists
         SET branch_id = v_rec.to_branch_id,
             display_order = v_new_order
       WHERE id = v_rec.therapist_id;

      PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id);
    END IF;

    UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- apply_due_staff_transfers is invoked by cron (the postgres role); no client grant.
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM authenticated;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('148', 'fix-apply-due-transfers-time')
ON CONFLICT (version) DO NOTHING;
