-- ZNLY-236: staff self check-in (migration 394). One transaction that ROLLS BACK, so it is safe on any database.
-- Logins: 01 staff linked to therapist T1 (branch A1), 02 staff linked to T2, 03 manager (A1), 04 staff with NO linked team member, 05 admin.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('23600000-0000-0000-0000-00000000000a', 'ZZ236 Org', 'ZZ236A', 'zz236-org', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('23600000-0000-0000-0000-0000000000a1', 'ZZ236 A1', '23600000-0000-0000-0000-00000000000a'),
                                               ('23600000-0000-0000-0000-0000000000a2', 'ZZ236 A2', '23600000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) SELECT ('23600000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz236-u' || n || '@example.test' FROM generate_series(1, 5) n;
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
SELECT ('23600000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz236-u' || n || '@example.test', 'ZZ236 U' || n,
       (CASE n WHEN 3 THEN 'manager' WHEN 5 THEN 'admin' ELSE 'staff' END)::user_role, '23600000-0000-0000-0000-0000000000a1', '23600000-0000-0000-0000-00000000000a', 'email'
FROM generate_series(1, 5) n;
INSERT INTO therapists (id, branch_id, name, gender, org_id, user_id) VALUES
  ('23600000-0000-0000-0000-0000000a0001', '23600000-0000-0000-0000-0000000000a1', 'ZZ236 T1', 'Female', '23600000-0000-0000-0000-00000000000a', '23600000-0000-0000-0000-000000000101'),
  ('23600000-0000-0000-0000-0000000a0002', '23600000-0000-0000-0000-0000000000a1', 'ZZ236 T2', 'Female', '23600000-0000-0000-0000-00000000000a', '23600000-0000-0000-0000-000000000102'),
  ('23600000-0000-0000-0000-0000000a0003', '23600000-0000-0000-0000-0000000000a1', 'ZZ236 T3', 'Female', '23600000-0000-0000-0000-00000000000a', NULL);

CREATE OR REPLACE FUNCTION pg_temp.as_login(n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', ('23600000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0')), 'role', 'authenticated')::text, true); END $$;

-- staff 01: own team member, own branch, now
SELECT pg_temp.as_login(1);
SET LOCAL ROLE authenticated;
DO $$
DECLARE pid uuid; ok boolean;
  a1 uuid := '23600000-0000-0000-0000-0000000000a1'; a2 uuid := '23600000-0000-0000-0000-0000000000a2';
  t1 uuid := '23600000-0000-0000-0000-0000000a0001'; t2 uuid := '23600000-0000-0000-0000-0000000a0002';
BEGIN
  -- refused: someone else's team member, another branch, backdated, with a check-out, with a reason, not from the button
  BEGIN PERFORM punch_in(t2, a1, now(), 'button', NULL, NULL); ASSERT false, 'S1 staff must not punch in a colleague';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM punch_in(t1, a2, now(), 'button', NULL, NULL); ASSERT false, 'S2 staff must not punch in at a branch they do not belong to';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM punch_in(t1, a1, now() - interval '2 hours', 'button', NULL, NULL); ASSERT false, 'S3 no backdating';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM punch_in(t1, a1, now() - interval '1 minute', 'button', NULL, now()); ASSERT false, 'S4 no check-out time on a self punch';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM punch_in(t1, a1, now(), 'button', 'because', NULL); ASSERT false, 'S5 no reason on a self punch';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM punch_in(t1, a1, now(), 'panel', NULL, NULL); ASSERT false, 'S6 only the button source';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- allowed: own check-in, then own check-out
  pid := punch_in(t1, a1, clock_timestamp(), 'button', NULL, NULL);          ASSERT pid IS NOT NULL, 'S7 own check-in';
  BEGIN PERFORM punch_in(t1, a1, clock_timestamp(), 'button', NULL, NULL); ASSERT false, 'S8 a second open check-in is refused (P0008)';
  EXCEPTION WHEN SQLSTATE 'P0008' THEN NULL; END;
  PERFORM pg_sleep(0.05);
  PERFORM punch_out(pid, NULL, NULL, clock_timestamp(), NULL, 'button');
  RAISE NOTICE 'staff self check-in ok';
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT count(*) FROM attendance_punches WHERE therapist_id = '23600000-0000-0000-0000-0000000a0001' AND check_out IS NOT NULL) = 1, 'S7b own check-out saved'; END $$;

-- a manager checks the colleague in; staff 01 may not close that punch, nor save/edit punches
SELECT pg_temp.as_login(3);
SET LOCAL ROLE authenticated;
DO $$
DECLARE pid uuid; t2 uuid := '23600000-0000-0000-0000-0000000a0002'; t1 uuid := '23600000-0000-0000-0000-0000000a0001'; a1 uuid := '23600000-0000-0000-0000-0000000000a1';
BEGIN
  pid := punch_in(t2, a1, now() - interval '3 hours', 'panel', 'late entry', NULL);   ASSERT pid IS NOT NULL, 'M1 manager unchanged: can backdate with a reason for anyone at the branch';
  RAISE NOTICE 'manager ok';
END $$;
RESET ROLE;

SELECT set_config('zenly.pid', (SELECT id::text FROM attendance_punches WHERE therapist_id = '23600000-0000-0000-0000-0000000a0002' LIMIT 1), true);
SELECT pg_temp.as_login(1);
SET LOCAL ROLE authenticated;
DO $$
DECLARE pid uuid := current_setting('zenly.pid')::uuid;
BEGIN
  BEGIN PERFORM punch_out(pid, NULL, NULL, now(), NULL, 'button'); ASSERT false, 'S9 staff must not close a colleague punch';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM save_punch(pid, now() - interval '5 hours', NULL, 'x', 'panel'); ASSERT false, 'S10 staff must not edit a punch';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'staff cannot touch colleagues ok';
END $$;
RESET ROLE;


-- THE DAY CLOSE IS A MONEY LOCK: close today's day at A1, then staff 02 still checks out and in for today; past/edit paths stay refused.
INSERT INTO daily_reports (branch_id, report_date, closed_by, is_locked)
VALUES ('23600000-0000-0000-0000-0000000000a1', (now() AT TIME ZONE 'Asia/Kathmandu')::date, '23600000-0000-0000-0000-000000000103', true);
SELECT set_config('zenly.self_punch', '', true);   -- (one transaction here; in production every call is its own transaction)
SELECT pg_temp.as_login(2);
SET LOCAL ROLE authenticated;
DO $$
DECLARE pid uuid; t2 uuid := '23600000-0000-0000-0000-0000000a0002'; a1 uuid := '23600000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM punch_out(NULL, t2, a1, clock_timestamp(), NULL, 'button');            -- C1 check-out after the close is allowed (own open punch from the manager above)
  PERFORM pg_sleep(0.05);
  pid := punch_in(t2, a1, clock_timestamp(), 'button', NULL, NULL);               ASSERT pid IS NOT NULL, 'C2 check-in after the close is allowed';
  PERFORM set_config('zenly.self_punch', '', true);
  BEGIN PERFORM punch_in('23600000-0000-0000-0000-0000000a0002', a1, now() - interval '1 day', 'button', NULL, NULL); ASSERT false, 'C3 no backdating even with a closed day';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM attendance_punches) = (SELECT count(*) FROM attendance_punches WHERE therapist_id = t2), 'C6 staff read only their own punches';
  ASSERT (SELECT count(*) FROM attendance_punches WHERE check_out IS NULL) = 1, 'C7 and see their open check-in (so My day shows Check out)';
  RAISE NOTICE 'self punch after the day close ok';
END $$;
RESET ROLE;
SELECT set_config('zenly.self_punch', '', true);
SELECT pg_temp.as_login(3);   -- manager: unchanged, the closed day still blocks a backdated/edit path
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM punch_in('23600000-0000-0000-0000-0000000a0003', '23600000-0000-0000-0000-0000000000a1', now() - interval '2 hours', 'panel', 'late entry', NULL);
    ASSERT false, 'C4 manager punch on a closed day is still refused (unchanged)';
  EXCEPTION WHEN SQLSTATE 'P0004' THEN NULL; END;
  BEGIN PERFORM save_punch((SELECT p.id FROM attendance_punches p WHERE p.therapist_id = '23600000-0000-0000-0000-0000000a0002' ORDER BY p.created_at LIMIT 1), now() - interval '6 hours', NULL, 'fix', 'panel');
    ASSERT false, 'C5 editing a closed day punch is refused';
  EXCEPTION WHEN SQLSTATE 'P0004' THEN NULL; END;
  RAISE NOTICE 'manager closed-day behaviour unchanged';
END $$;
RESET ROLE;

-- staff 04: not linked to any team member: refused for everyone
SELECT pg_temp.as_login(4);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM punch_in('23600000-0000-0000-0000-0000000a0003', '23600000-0000-0000-0000-0000000000a1', now(), 'button', NULL, NULL); ASSERT false, 'U1 unlinked login refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM punch_in('23600000-0000-0000-0000-0000000a0001', '23600000-0000-0000-0000-0000000000a1', now(), 'button', NULL, NULL); ASSERT false, 'U2 unlinked login refused for a colleague too';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'unlinked ok';
END $$;
RESET ROLE;
ROLLBACK;
\echo 236 PASSED
