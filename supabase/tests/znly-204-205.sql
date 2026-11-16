-- ZNLY-204 + ZNLY-205 (step 4a) database checks. Local database only.
--
--   psql "$LOCAL_DB_URL" -f supabase/tests/znly-205-pre377-setup.sql   # on a DB with migrations <= 376, BEFORE 377
--   psql "$LOCAL_DB_URL" -f supabase/migration-376-*.sql  -f supabase/migration-377-*.sql
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/znly-204-205.sql
--
-- Part A asserts what 377 did with the ZZ205 fixture links. Part B (one transaction, rolled back) asserts the RPCs and the
-- login rules. Part C removes the ZZ205 fixtures. Any failed ASSERT stops the run; the last line printed is "ALL PASSED".
\set ON_ERROR_STOP on

-- ───────────── Part A: the link move (needs the fixtures from znly-205-pre377-setup.sql) ─────────────
DO $$
DECLARE n int;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='therapist_id'),
    'A1 users.therapist_id must be gone';
  ASSERT (SELECT user_id FROM public.therapists WHERE id='20500000-0000-0000-0000-000000000001') = '20500000-0000-0000-0000-000000000101',
    'A2 T1 must have been linked to U1 (copied)';
  ASSERT (SELECT user_id FROM public.therapists WHERE id='20500000-0000-0000-0000-000000000002') = '20500000-0000-0000-0000-000000000102',
    'A3 T2 keeps its link to U2';
  ASSERT (SELECT user_id FROM public.therapists WHERE id='20500000-0000-0000-0000-000000000003') = '20500000-0000-0000-0000-000000000107',
    'A4 T3 must NOT be overwritten (still U7)';
  ASSERT (SELECT user_id FROM public.therapists WHERE id='20500000-0000-0000-0000-000000000004') IS NULL,
    'A5 T4 must stay unlinked: U4 is already linked to T5';
  ASSERT (SELECT user_id FROM public.therapists WHERE id='20500000-0000-0000-0000-000000000006') IS NULL,
    'A6 T6 (other organisation) must stay unlinked';
  SELECT count(*) INTO n FROM public.znly205_link_conflicts WHERE reason <> 'login_access_backfilled_to_email'
     AND user_id IN ('20500000-0000-0000-0000-000000000103','20500000-0000-0000-0000-000000000104','20500000-0000-0000-0000-000000000105');
  ASSERT n = 3, 'A7 exactly three saved conflicts for U3/U4/U5, got ' || n;
  ASSERT (SELECT reason FROM public.znly205_link_conflicts WHERE user_id='20500000-0000-0000-0000-000000000103') = 'therapist_already_linked_to_another_login'
     AND (SELECT therapist_current_user_id FROM public.znly205_link_conflicts WHERE user_id='20500000-0000-0000-0000-000000000103') = '20500000-0000-0000-0000-000000000107',
    'A8 U3 conflict row keeps the therapist''s current login';
  ASSERT (SELECT reason FROM public.znly205_link_conflicts WHERE user_id='20500000-0000-0000-0000-000000000104') = 'login_already_linked_to_another_therapist', 'A9 U4 reason';
  ASSERT (SELECT reason FROM public.znly205_link_conflicts WHERE user_id='20500000-0000-0000-0000-000000000105') = 'org_mismatch', 'A10 U5 reason';
  ASSERT (SELECT login_access FROM public.users WHERE id='20500000-0000-0000-0000-000000000108') = 'email', 'A11 account-only login with default none is backfilled to email';
  ASSERT EXISTS (SELECT 1 FROM public.znly205_link_conflicts WHERE user_id='20500000-0000-0000-0000-000000000108' AND reason='login_access_backfilled_to_email'), 'A12 backfill is recorded';
  ASSERT (SELECT login_access FROM public.users WHERE id='20500000-0000-0000-0000-000000000109') = 'none', 'A13 a login switched off on a linked staff member stays off';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.znly205_link_conflicts'::regclass), 'A14 RLS on for the conflicts table';
  RAISE NOTICE 'Part A passed';
END $$;

-- ───────────── Part B: RPCs, rules, RLS vs My day, login (one transaction, rolled back) ─────────────
BEGIN;
DO $$
DECLARE
  a1 constant uuid := '20500000-0000-0000-0000-0000000000a1';
  orga constant uuid := '20500000-0000-0000-0000-00000000000a';
  r uuid := '20500000-0000-0000-0000-0000000e0001';
  s uuid := '20500000-0000-0000-0000-0000000f0001';
  d date := current_date + 3;
  today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  n int; names int;
  ids_rls uuid[]; ids_day uuid[];
BEGIN
  -- one overload each
  ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='public_get_bookable_therapists') = 1, 'B1 one overload of public_get_bookable_therapists';
  ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='public_check_branch_bookings_range') = 1, 'B2 one overload of public_check_branch_bookings_range';

  INSERT INTO rooms (id, branch_id, name, capacity) VALUES (r, a1, 'ZZ205 Room', 3);
  INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES (s, 'ZZ205 Service', 60, 1000, orga);

  -- 3-arg and 4-arg calls both work (staff selection is OFF for the ZZ205 org)
  PERFORM * FROM public.public_get_bookable_therapists('zz205-org-a', a1, NULL);
  PERFORM * FROM public.public_get_bookable_therapists('zz205-org-a', a1, NULL, false);
  PERFORM * FROM public.public_get_bookable_therapists('zz205-org-a', a1, ARRAY[s], true);
  PERFORM * FROM public.public_check_branch_bookings_range(a1, d, d);
  PERFORM * FROM public.public_check_branch_bookings_range(a1, d, d, s);
  PERFORM * FROM public.public_check_branch_bookings_range(a1, d, d, s, 60);

  -- group booking with staff selection off: ids only, no names; a plain call returns nobody
  SELECT count(*), count(name) INTO n, names FROM public.public_get_bookable_therapists('zz205-org-a', a1, NULL, true);
  ASSERT n >= 3 AND names = 0, 'B3 group booking with staff selection off returns ids but no names, got ' || n || ' rows / ' || names || ' names';
  ASSERT (SELECT count(*) FROM public.public_get_bookable_therapists('zz205-org-a', a1, NULL, false)) = 0, 'B4 plain call with staff selection off returns nobody';
  UPDATE organizations SET settings = '{"show_staff_selection": true}'::jsonb WHERE id = orga;
  SELECT count(*), count(name) INTO n, names FROM public.public_get_bookable_therapists('zz205-org-a', a1, NULL);
  ASSERT n >= 3 AND names = n, 'B5 with staff selection on, names come back';
  UPDATE organizations SET settings = '{"show_staff_selection": false}'::jsonb WHERE id = orga;

  -- a manual block fills the room's FULL capacity (3 seats), room-scoped and whole-location
  INSERT INTO manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, room_id, prevent_online_booking)
    VALUES (orga, a1, d, '10:00', 60, r, true);
  SELECT count(*) INTO n FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source = 'block' AND room_id = r AND start_time = '10:00';
  ASSERT n = 3, 'B6 a room block must fill all 3 seats, got ' || n;
  INSERT INTO manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, prevent_online_booking)
    VALUES (orga, a1, d, '14:00', 60, true);
  SELECT count(*) INTO n FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source = 'block' AND room_id = r AND start_time = '14:00';
  ASSERT n = 3, 'B7 a whole-location block must fill all 3 seats of the active room, got ' || n;

  -- online capacity: an unassigned booking made without staff counts; a staff-made one does not
  INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
    VALUES (a1, r, s, 'ZZ205 online', '9800000001', d, '11:00', '12:00', (d + time '11:00') AT TIME ZONE 'Asia/Kathmandu', (d + time '12:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, NULL, 'Pending');
  INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
    VALUES (a1, r, s, 'ZZ205 staff', '9800000002', d, '11:00', '12:00', (d + time '11:00') AT TIME ZONE 'Asia/Kathmandu', (d + time '12:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, '20500000-0000-0000-0000-000000000101', 'Pending');
  ASSERT (SELECT count(*) FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source='booking' AND start_time='11:00' AND counts_as_online_capacity) = 1, 'B8 only the online booking counts toward online capacity';
  ASSERT (SELECT count(*) FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source='booking' AND start_time='11:00' AND NOT counts_as_online_capacity) = 1, 'B9 the staff-made booking does not count';

  -- gender reserve: a preference on an unassigned booking holds its slot; an assigned therapist shows her gender
  INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status, gender_preference)
    VALUES (a1, r, s, 'ZZ205 pref', '9800000003', d, '15:00', '16:00', (d + time '15:00') AT TIME ZONE 'Asia/Kathmandu', (d + time '16:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, NULL, 'Pending', 'female');
  INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status, therapist_id)
    VALUES (a1, r, s, 'ZZ205 assigned', '9800000004', d, '16:00', '17:00', (d + time '16:00') AT TIME ZONE 'Asia/Kathmandu', (d + time '17:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, '20500000-0000-0000-0000-000000000101', 'Confirmed', '20500000-0000-0000-0000-000000000001');
  ASSERT (SELECT gender_preference FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source='booking' AND start_time='15:00') = 'female' AND (SELECT therapist_gender FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source='booking' AND start_time='15:00') IS NULL, 'B10 gender preference reserves the slot';
  ASSERT lower((SELECT therapist_gender FROM public.public_check_branch_bookings_range(a1, d, d) WHERE source='booking' AND start_time='16:00')) = 'female', 'B11 an assigned therapist shows her gender';

  -- a linked restricted staff member sees the same booking set through RLS and through the My day query
  UPDATE users SET calendar_visibility = 'own' WHERE id = '20500000-0000-0000-0000-000000000101';
  INSERT INTO bookings (branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status, therapist_id)
    VALUES (a1, r, s, 'ZZ205 mine', '9800000005', today, '10:00', '11:00', (today + time '10:00') AT TIME ZONE 'Asia/Kathmandu', (today + time '11:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, '20500000-0000-0000-0000-000000000101', 'Confirmed', '20500000-0000-0000-0000-000000000001'),
           (a1, r, s, 'ZZ205 not mine', '9800000006', today, '12:00', '13:00', (today + time '12:00') AT TIME ZONE 'Asia/Kathmandu', (today + time '13:00') AT TIME ZONE 'Asia/Kathmandu', 1000, 1000, '20500000-0000-0000-0000-000000000101', 'Confirmed', '20500000-0000-0000-0000-000000000003');
  PERFORM set_config('request.jwt.claims', '{"sub":"20500000-0000-0000-0000-000000000101","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO ids_rls FROM public.bookings WHERE branch_id = a1 AND date = today AND status <> 'Cancelled';
  SELECT COALESCE(array_agg((x ->> 'id')::uuid ORDER BY (x ->> 'id')::uuid), '{}') INTO ids_day
    FROM jsonb_array_elements((public.get_dashboard(ARRAY[a1], today)) -> 'my_day' -> 'bookings') x;
  RESET ROLE;
  ASSERT cardinality(ids_rls) = 1, 'B12 RLS shows exactly the staff member''s own booking, got ' || cardinality(ids_rls);
  ASSERT ids_rls = ids_day, 'B13 My day shows the same booking set as RLS: ' || ids_rls::text || ' vs ' || ids_day::text;
  ASSERT (SELECT therapist_ids FROM (SELECT ARRAY(SELECT jsonb_array_elements_text(public.get_dashboard(ARRAY[a1], today) -> 'my_day' -> 'therapist_ids')::uuid) therapist_ids) q) IS NOT NULL, 'B14 my_day lists the linked therapist';

  -- sign-in rule (server-side hook): login off refuses; an on / default / unknown user is allowed
  UPDATE users SET login_access = 'none' WHERE id = '20500000-0000-0000-0000-000000000106';
  BEGIN
    PERFORM public.auth_hook_block_login_off(jsonb_build_object('user_id', '20500000-0000-0000-0000-000000000106'));
    ASSERT false, 'B15 login off must be refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.auth_hook_block_login_off(jsonb_build_object('user_id', '20500000-0000-0000-0000-000000000101'));  -- email: allowed
  PERFORM public.auth_hook_block_login_off(jsonb_build_object('user_id', gen_random_uuid()));                       -- not in users: allowed
  -- a login created outside Staff access (no login_access given) must NOT start locked out
  INSERT INTO auth.users (id, email) VALUES ('20500000-0000-0000-0000-000000000199', 'zz205-nv@example.test');
  INSERT INTO users (id, email, full_name, role, branch_id, org_id) VALUES ('20500000-0000-0000-0000-000000000199', 'zz205-nv@example.test', 'ZZ205 no value', 'staff', a1, orga);
  ASSERT (SELECT login_access FROM users WHERE id = '20500000-0000-0000-0000-000000000199') = 'email', 'B16 default login_access is email, not none';
  PERFORM public.auth_hook_block_login_off(jsonb_build_object('user_id', '20500000-0000-0000-0000-000000000199'));

  -- set_user_therapist now writes therapists.user_id; refuses to steal a link; NULL unlinks
  INSERT INTO auth.users (id, email) VALUES ('20500000-0000-0000-0000-0000000001ad', 'zz205-admin@example.test');
  INSERT INTO users (id, email, full_name, role, branch_id, org_id) VALUES ('20500000-0000-0000-0000-0000000001ad', 'zz205-admin@example.test', 'ZZ205 admin', 'admin', a1, orga);
  PERFORM set_config('request.jwt.claims', '{"sub":"20500000-0000-0000-0000-0000000001ad","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_user_therapist('20500000-0000-0000-0000-000000000106', '20500000-0000-0000-0000-000000000004');
  RESET ROLE;
  ASSERT (SELECT user_id FROM therapists WHERE id = '20500000-0000-0000-0000-000000000004') = '20500000-0000-0000-0000-000000000106', 'B17 set_user_therapist writes therapists.user_id';
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_user_therapist('20500000-0000-0000-0000-000000000103', '20500000-0000-0000-0000-000000000003');
    RESET ROLE; ASSERT false, 'B18 must refuse to take a therapist that belongs to another login';
  EXCEPTION WHEN unique_violation THEN RESET ROLE;
  END;
  SET LOCAL ROLE authenticated;
  PERFORM public.set_user_therapist('20500000-0000-0000-0000-000000000106', NULL);
  RESET ROLE;
  ASSERT (SELECT user_id FROM therapists WHERE id = '20500000-0000-0000-0000-000000000004') IS NULL, 'B19 NULL unlinks the login';
  RAISE NOTICE 'Part B passed';
END $$;
ROLLBACK;

-- ───────────── Part C: remove the ZZ205 fixtures ─────────────
BEGIN;
DELETE FROM public.znly205_link_conflicts WHERE org_id IN ('20500000-0000-0000-0000-00000000000a','20500000-0000-0000-0000-00000000000b');
UPDATE public.therapists SET user_id = NULL WHERE org_id IN ('20500000-0000-0000-0000-00000000000a','20500000-0000-0000-0000-00000000000b');
DELETE FROM public.therapists WHERE org_id IN ('20500000-0000-0000-0000-00000000000a','20500000-0000-0000-0000-00000000000b');
DELETE FROM public.users WHERE org_id IN ('20500000-0000-0000-0000-00000000000a','20500000-0000-0000-0000-00000000000b');
DELETE FROM auth.users WHERE email LIKE 'zz205-%@example.test';
DELETE FROM public.audit_logs WHERE branch_id IN ('20500000-0000-0000-0000-0000000000a1','20500000-0000-0000-0000-0000000000b1') OR changed_by::text LIKE '20500000-%';
DELETE FROM public.branches WHERE org_id IN ('20500000-0000-0000-0000-00000000000a','20500000-0000-0000-0000-00000000000b');
DELETE FROM public.organizations WHERE id IN ('20500000-0000-0000-0000-00000000000a','20500000-0000-0000-0000-00000000000b');
COMMIT;
SELECT 'ALL PASSED' AS result;
