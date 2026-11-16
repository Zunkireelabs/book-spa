-- SQL checks for migration-348 (LOCAL DB only; everything rolls back). Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:56422/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/check-audit-therapist-tables.sql
-- Needs the local users from supabase/seed.sql + temp_ss/seed/local-demo-seed.sql (admin/manager/staff/viewer @local.test).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_admin uuid := 'e0000000-0000-0000-0000-000000000001';
  v_th    uuid;
  v_wh    uuid;
  v_br    uuid;
  n0 int; n1 int;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT id INTO v_th FROM public.therapists WHERE branch_id = 'b0000000-0000-0000-0000-000000000001' AND is_active ORDER BY id LIMIT 1;

  -- helper: count audit rows about this therapist in a table
  CREATE TEMP TABLE IF NOT EXISTS _c(label text, got int, want int) ON COMMIT DROP;

  -- ---- therapists
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name='therapists' AND record_id=v_th;
  UPDATE therapists SET bio = 'audit check bio' WHERE id = v_th;
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name='therapists' AND record_id=v_th;
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'therapists: edit should write exactly 1 row, wrote %', n1 - n0; END IF;
  UPDATE therapists SET bio = bio WHERE id = v_th;
  UPDATE therapists SET display_order = display_order + 1 WHERE id = v_th;
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name='therapists' AND record_id=v_th;
  IF n0 <> n1 THEN RAISE EXCEPTION 'therapists: no-op / display_order update must write nothing (wrote %)', n0 - n1; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name='therapists' AND record_id=v_th AND new_data ? 'bio' AND new_data->>'therapist_id' = v_th::text AND NOT (new_data ? 'updated_at')) THEN
    RAISE EXCEPTION 'therapists: audit row should hold only the changed field + therapist_id'; END IF;

  -- ---- staff_compensation (insert, update, no-op, delete)
  DELETE FROM staff_compensation WHERE therapist_id = v_th;
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name='staff_compensation' AND record_id=v_th;
  INSERT INTO staff_compensation (therapist_id, monthly_salary, commission_rate, product_commission_rate) VALUES (v_th, 30000, 10, 5);
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name='staff_compensation' AND record_id=v_th;
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'staff_compensation: insert should write 1 row, wrote %', n1 - n0; END IF;
  UPDATE staff_compensation SET commission_rate = 12 WHERE therapist_id = v_th;
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name='staff_compensation' AND record_id=v_th;
  IF n0 - n1 <> 1 THEN RAISE EXCEPTION 'staff_compensation: edit should write 1 row, wrote %', n0 - n1; END IF;
  UPDATE staff_compensation SET commission_rate = 12, updated_by = v_admin WHERE therapist_id = v_th;
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name='staff_compensation' AND record_id=v_th;
  IF n1 <> n0 THEN RAISE EXCEPTION 'staff_compensation: no-op update (only updated_by) must write nothing'; END IF;

  -- ---- staff_roster_overrides (insert, update, no-op, delete)
  DELETE FROM staff_roster_overrides WHERE therapist_id = v_th AND override_date = date '2030-01-07';
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name='staff_roster_overrides' AND new_data->>'therapist_id' = v_th::text OR old_data->>'therapist_id' = v_th::text AND table_name='staff_roster_overrides';
  INSERT INTO staff_roster_overrides (therapist_id, branch_id, override_date, start_time, end_time, is_day_off)
    VALUES (v_th, 'b0000000-0000-0000-0000-000000000001', '2030-01-07', '10:00', '18:00', false);
  UPDATE staff_roster_overrides SET end_time = '19:00' WHERE therapist_id = v_th AND override_date = '2030-01-07';
  UPDATE staff_roster_overrides SET end_time = '19:00' WHERE therapist_id = v_th AND override_date = '2030-01-07';
  DELETE FROM staff_roster_overrides WHERE therapist_id = v_th AND override_date = '2030-01-07';
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name='staff_roster_overrides' AND (new_data->>'therapist_id' = v_th::text OR old_data->>'therapist_id' = v_th::text);
  IF n1 - n0 <> 3 THEN RAISE EXCEPTION 'roster overrides: insert+edit+(no-op)+delete should write 3 rows, wrote %', n1 - n0; END IF;

  -- ---- therapist_working_hours + breaks
  DELETE FROM therapist_working_hours WHERE therapist_id = v_th AND day_of_week = 2;
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name IN ('therapist_working_hours','therapist_working_hours_breaks') AND (new_data->>'therapist_id' = v_th::text OR old_data->>'therapist_id' = v_th::text);
  INSERT INTO therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off)
    VALUES (v_th, 'b0000000-0000-0000-0000-000000000001', 2, '09:00', '17:00', false) RETURNING id INTO v_wh;
  UPDATE therapist_working_hours SET start_time = '09:30' WHERE id = v_wh;
  UPDATE therapist_working_hours SET start_time = '09:30' WHERE id = v_wh;
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name='therapist_working_hours' AND (new_data->>'therapist_id' = v_th::text OR old_data->>'therapist_id' = v_th::text);
  IF n1 - (n0) <> 2 THEN RAISE EXCEPTION 'working hours: insert + edit (+ no-op) should write 2 rows, wrote %', n1 - n0; END IF;
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name='therapist_working_hours_breaks';
  INSERT INTO therapist_working_hours_breaks (working_hours_id, name, start_time, end_time, sort_order) VALUES (v_wh, 'Lunch', '13:00', '14:00', 0) RETURNING id INTO v_br;
  UPDATE therapist_working_hours_breaks SET end_time = '14:30' WHERE id = v_br;
  UPDATE therapist_working_hours_breaks SET end_time = '14:30' WHERE id = v_br;
  DELETE FROM therapist_working_hours_breaks WHERE id = v_br;
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name='therapist_working_hours_breaks';
  IF n1 - n0 <> 3 THEN RAISE EXCEPTION 'breaks: insert+edit+(no-op)+delete should write 3 rows, wrote %', n1 - n0; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name='therapist_working_hours_breaks' AND (new_data->>'day_of_week')::int = 2 AND new_data->>'therapist_id' = v_th::text) THEN
    RAISE EXCEPTION 'breaks: audit row must carry therapist_id and day_of_week'; END IF;
  -- cascade: deleting the day with a break under it audits the day (1 row) and not the cascaded break
  INSERT INTO therapist_working_hours_breaks (working_hours_id, name, start_time, end_time, sort_order) VALUES (v_wh, 'Tea', '11:00', '11:15', 0);
  SELECT count(*) INTO n0 FROM audit_logs WHERE table_name IN ('therapist_working_hours','therapist_working_hours_breaks');
  DELETE FROM therapist_working_hours WHERE id = v_wh;
  SELECT count(*) INTO n1 FROM audit_logs WHERE table_name IN ('therapist_working_hours','therapist_working_hours_breaks');
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'cascade: deleting a day should write 1 row (the day), wrote %', n1 - n0; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'therapist_working_hours' AND action_type = 'DELETE' AND record_id = v_wh
                   AND jsonb_array_length(old_data->'breaks') >= 1) THEN
    RAISE EXCEPTION 'cascade: the day''s DELETE audit row should carry its breaks in old_data.breaks';
  END IF;

  RAISE NOTICE 'CHECK OK: one audit row per edit on all 5 tables; no-ops write none';
END $$;

-- ---- read privacy (pay rows) -------------------------------------------------------------------------
DO $$
DECLARE
  v_th uuid; n int; ok boolean;
  v_ids constant jsonb := jsonb_build_object('admin','e0000000-0000-0000-0000-000000000001','manager','e0000000-0000-0000-0000-000000000002',
                                             'staff','e0000000-0000-0000-0000-000000000003','viewer','e0000000-0000-0000-0000-000000000004');
  r text;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ids->>'admin', 'role', 'authenticated')::text, true);
  SELECT id INTO v_th FROM public.therapists WHERE branch_id = 'b0000000-0000-0000-0000-000000000001' AND is_active ORDER BY id LIMIT 1;
  UPDATE staff_compensation SET commission_rate = 15 WHERE therapist_id = v_th;
  IF NOT FOUND THEN INSERT INTO staff_compensation (therapist_id, monthly_salary, commission_rate) VALUES (v_th, 1000, 5); END IF;
  UPDATE therapists SET bio = 'privacy check' WHERE id = v_th;

  FOREACH r IN ARRAY ARRAY['admin','manager','staff','viewer'] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ids->>r, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- Payroll's rule: pay is for admin (edit) + admin_viewer (read-only); managers and staff never see it
    SELECT count(*) INTO n FROM audit_logs WHERE table_name = 'staff_compensation';
    IF r IN ('admin','viewer') AND n = 0 THEN RAISE EXCEPTION '% must be able to read pay audit rows', r; END IF;
    IF r IN ('manager','staff') AND n <> 0 THEN RAISE EXCEPTION '% must NOT read pay audit rows (saw %)', r, n; END IF;
    -- other audit reads unaffected for every role that could read them before
    SELECT count(*) INTO n FROM audit_logs WHERE table_name = 'bookings';
    IF r IN ('admin','manager','viewer') AND n = 0 THEN RAISE EXCEPTION '% lost access to booking audit rows', r; END IF;
    IF r = 'staff' AND n <> 0 THEN RAISE EXCEPTION 'staff must still have no audit read access'; END IF;
    IF r IN ('admin','manager','viewer') THEN
      SELECT count(*) INTO n FROM audit_logs WHERE table_name = 'customers';
      -- customers audit rows may legitimately be 0 locally; only assert no error
      SELECT count(*) INTO n FROM audit_logs WHERE table_name = 'therapists';
      IF n = 0 THEN RAISE EXCEPTION '% should still read non-pay staff audit rows', r; END IF;
    END IF;
    -- the feed function
    IF r = 'staff' THEN
      BEGIN PERFORM * FROM get_therapist_activity(v_th, 'all', 10); RAISE EXCEPTION 'staff must not be able to call get_therapist_activity';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    ELSE
      SELECT count(*) INTO n FROM get_therapist_activity(v_th, 'pay', 50);
      IF r IN ('admin','viewer') AND n = 0 THEN RAISE EXCEPTION '% should see pay events in the feed', r; END IF;
      IF r = 'manager' AND n <> 0 THEN RAISE EXCEPTION 'manager must not see pay events in the feed'; END IF;
      SELECT count(*) INTO n FROM get_therapist_activity(v_th, 'all', 200) WHERE category = 'pay';
      IF r = 'manager' AND n <> 0 THEN RAISE EXCEPTION 'manager must not see pay events under filter=all'; END IF;
      SELECT count(*) INTO n FROM get_therapist_activity(v_th, 'all', 200) WHERE category = 'profile';
      IF n = 0 THEN RAISE EXCEPTION '% should see profile events in the feed', r; END IF;
    END IF;
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'CHECK OK: pay audit rows readable by admin + admin_viewer only, hidden from manager + staff (table RLS and feed function); other audit reads unaffected';
END $$;

ROLLBACK;
