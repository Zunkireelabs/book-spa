-- SQL checks for migration-349 (LOCAL DB only; rolls back). Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:56422/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/check-admin-viewer-working-hours.sql
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_admin  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  v_viewer constant uuid := 'e0000000-0000-0000-0000-000000000004';
  v_th uuid; v_wh uuid; v_org2 uuid; v_br2 uuid; v_th2 uuid; v_wh2 uuid; v_ov2 uuid;
  n int; blocked boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT id INTO v_th FROM public.therapists WHERE branch_id = 'b0000000-0000-0000-0000-000000000001' AND is_active ORDER BY id LIMIT 1;
  DELETE FROM therapist_working_hours WHERE therapist_id = v_th AND day_of_week = 3;
  INSERT INTO therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off)
    VALUES (v_th, 'b0000000-0000-0000-0000-000000000001', 3, '09:00', '17:00', false) RETURNING id INTO v_wh;
  INSERT INTO therapist_working_hours_breaks (working_hours_id, name, start_time, end_time, sort_order) VALUES (v_wh, 'Lunch', '13:00', '14:00', 0);
  INSERT INTO staff_roster_overrides (therapist_id, branch_id, override_date, start_time, end_time, is_day_off)
    VALUES (v_th, 'b0000000-0000-0000-0000-000000000001', '2031-01-06', '10:00', '16:00', false);

  -- a second organisation with its own branch / staff / hours (fabricated; rolled back)
  INSERT INTO organizations (id, name, code, slug) VALUES (gen_random_uuid(), 'Other Org (check)', 'OTHERCHK', 'other-org-check') RETURNING id INTO v_org2;
  INSERT INTO branches (id, org_id, name) VALUES (gen_random_uuid(), v_org2, 'Other Branch') RETURNING id INTO v_br2;
  INSERT INTO therapists (id, branch_id, org_id, name, gender) VALUES (gen_random_uuid(), v_br2, v_org2, 'Other Person', 'Female') RETURNING id INTO v_th2;
  INSERT INTO therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off)
    VALUES (v_th2, v_br2, 1, '08:00', '16:00', false) RETURNING id INTO v_wh2;
  INSERT INTO therapist_working_hours_breaks (working_hours_id, name, start_time, end_time, sort_order) VALUES (v_wh2, 'Other lunch', '12:00', '12:30', 0);
  INSERT INTO staff_roster_overrides (therapist_id, branch_id, override_date, start_time, end_time, is_day_off)
    VALUES (v_th2, v_br2, '2031-01-06', '08:00', '12:00', false) RETURNING id INTO v_ov2;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- reads: own org yes, other org no
  SELECT count(*) INTO n FROM therapist_working_hours WHERE id = v_wh;
  IF n <> 1 THEN RAISE EXCEPTION 'viewer must read in-org working hours (saw %)', n; END IF;
  SELECT count(*) INTO n FROM therapist_working_hours_breaks WHERE working_hours_id = v_wh;
  IF n <> 1 THEN RAISE EXCEPTION 'viewer must read in-org breaks (saw %)', n; END IF;
  SELECT count(*) INTO n FROM staff_roster_overrides WHERE therapist_id = v_th AND override_date = '2031-01-06';
  IF n <> 1 THEN RAISE EXCEPTION 'viewer must read in-org roster overrides (saw %)', n; END IF;
  SELECT count(*) INTO n FROM therapist_working_hours WHERE id = v_wh2;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must NOT read other-org working hours (saw %)', n; END IF;
  SELECT count(*) INTO n FROM therapist_working_hours_breaks WHERE working_hours_id = v_wh2;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must NOT read other-org breaks (saw %)', n; END IF;
  SELECT count(*) INTO n FROM staff_roster_overrides WHERE id = v_ov2;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must NOT read other-org roster overrides (saw %)', n; END IF;

  -- writes: none allowed (INSERT is refused; UPDATE/DELETE touch 0 rows)
  blocked := false;
  BEGIN
    INSERT INTO therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off)
      VALUES (v_th, 'b0000000-0000-0000-0000-000000000001', 4, '09:00', '17:00', false);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'viewer must not INSERT working hours'; END IF;
  blocked := false;
  BEGIN
    INSERT INTO therapist_working_hours_breaks (working_hours_id, name, start_time, end_time, sort_order) VALUES (v_wh, 'x', '10:00', '10:15', 1);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'viewer must not INSERT breaks'; END IF;
  blocked := false;
  BEGIN
    INSERT INTO staff_roster_overrides (therapist_id, branch_id, override_date, start_time, end_time, is_day_off)
      VALUES (v_th, 'b0000000-0000-0000-0000-000000000001', '2031-02-03', '10:00', '16:00', false);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'viewer must not INSERT roster overrides'; END IF;

  UPDATE therapist_working_hours SET end_time = '18:00' WHERE id = v_wh; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must not UPDATE working hours (% rows)', n; END IF;
  UPDATE therapist_working_hours_breaks SET end_time = '14:30' WHERE working_hours_id = v_wh; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must not UPDATE breaks (% rows)', n; END IF;
  UPDATE staff_roster_overrides SET end_time = '17:00' WHERE therapist_id = v_th AND override_date = '2031-01-06'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must not UPDATE roster overrides (% rows)', n; END IF;
  DELETE FROM therapist_working_hours WHERE id = v_wh; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must not DELETE working hours (% rows)', n; END IF;
  DELETE FROM therapist_working_hours_breaks WHERE working_hours_id = v_wh; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must not DELETE breaks (% rows)', n; END IF;
  DELETE FROM staff_roster_overrides WHERE therapist_id = v_th AND override_date = '2031-01-06'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'viewer must not DELETE roster overrides (% rows)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'CHECK OK: admin_viewer reads in-org hours/breaks/overrides, not other-org rows, and cannot write';
END $$;

ROLLBACK;
