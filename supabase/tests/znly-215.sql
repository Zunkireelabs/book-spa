-- ZNLY-215: managers grant the Staff role only, for people whose home branch they manage (migration 386). Scratch database only.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('21500000-0000-0000-0000-00000000000a', 'ZZ215 Org', 'ZZ215A', 'zz215-org', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('21500000-0000-0000-0000-0000000000a1', 'ZZ215 A1', '21500000-0000-0000-0000-00000000000a'),
                                               ('21500000-0000-0000-0000-0000000000a2', 'ZZ215 A2 (granted)', '21500000-0000-0000-0000-00000000000a'),
                                               ('21500000-0000-0000-0000-0000000000a3', 'ZZ215 A3 (not managed)', '21500000-0000-0000-0000-00000000000a');
-- 01 admin, 02 manager (home A1, granted A2), 03 staff A1, 04 staff A2, 05 staff A3, 06 manager A1, 07 admin_viewer A1, 08 another admin A1
INSERT INTO auth.users (id, email) SELECT ('21500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz215-u' || n || '@example.test' FROM generate_series(1, 9) n;
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
SELECT ('21500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz215-u' || n || '@example.test', 'ZZ215 U' || n,
       (CASE n WHEN 1 THEN 'admin' WHEN 2 THEN 'manager' WHEN 6 THEN 'manager' WHEN 7 THEN 'admin_viewer' WHEN 8 THEN 'admin' ELSE 'staff' END)::user_role,
       (CASE n WHEN 4 THEN '21500000-0000-0000-0000-0000000000a2' WHEN 5 THEN '21500000-0000-0000-0000-0000000000a3' ELSE '21500000-0000-0000-0000-0000000000a1' END)::uuid,
       '21500000-0000-0000-0000-00000000000a', 'email'
FROM generate_series(1, 8) n;
INSERT INTO auth.users (id, email) VALUES ('21500000-0000-0000-0000-000000000191', 'zz215-new1@example.test'), ('21500000-0000-0000-0000-000000000192', 'zz215-new2@example.test'), ('21500000-0000-0000-0000-000000000193', 'zz215-new3@example.test');
INSERT INTO user_branches (user_id, branch_id) VALUES ('21500000-0000-0000-0000-000000000102', '21500000-0000-0000-0000-0000000000a2');
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"21500000-0000-0000-0000-000000000102","role":"authenticated"}', true);   -- the manager
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  -- allowed: Staff at a branch they manage (home A1, and A2 through their grant)
  UPDATE users SET login_access = 'none', calendar_visibility = 'all' WHERE id = '21500000-0000-0000-0000-000000000103'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'M1 staff at their own branch editable';
  UPDATE users SET pin = '4321' WHERE id = '21500000-0000-0000-0000-000000000104'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'M2 staff at a granted branch editable';
  -- not allowed: staff at a branch they do not manage; managers; admin viewers; admins (0 rows: the policy hides them)
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000105'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'M3 staff at an unmanaged branch not editable';
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000106'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'M4 another manager not editable';
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000107'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'M5 admin viewer not editable';
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000108'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'M6 admin not editable';
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000102'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'M7 not their own row';
  -- not allowed: promoting staff, or moving them to a branch the manager does not manage
  BEGIN UPDATE users SET role = 'manager' WHERE id = '21500000-0000-0000-0000-000000000103'; ASSERT false, 'M8 promote to manager refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE users SET role = 'admin' WHERE id = '21500000-0000-0000-0000-000000000103'; ASSERT false, 'M9 promote to admin refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE users SET branch_id = '21500000-0000-0000-0000-0000000000a3' WHERE id = '21500000-0000-0000-0000-000000000103'; ASSERT false, 'M10 move to an unmanaged branch refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- create: Staff at a managed branch only
  INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access) VALUES ('21500000-0000-0000-0000-000000000191', 'zz215-new1@example.test', 'New 1', 'staff', '21500000-0000-0000-0000-0000000000a1', '21500000-0000-0000-0000-00000000000a', 'email');
  BEGIN INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access) VALUES ('21500000-0000-0000-0000-000000000192', 'zz215-new2@example.test', 'New 2', 'manager', '21500000-0000-0000-0000-0000000000a1', '21500000-0000-0000-0000-00000000000a', 'email');
        ASSERT false, 'M11 creating a manager refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access) VALUES ('21500000-0000-0000-0000-000000000193', 'zz215-new3@example.test', 'New 3', 'staff', '21500000-0000-0000-0000-0000000000a3', '21500000-0000-0000-0000-00000000000a', 'email');
        ASSERT false, 'M12 creating staff at an unmanaged branch refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- access at other branches stays admin only
  BEGIN INSERT INTO user_branches (user_id, branch_id) VALUES ('21500000-0000-0000-0000-000000000103', '21500000-0000-0000-0000-0000000000a2'); ASSERT false, 'M13 a manager cannot grant other-branch access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'manager rules passed';
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"21500000-0000-0000-0000-000000000101","role":"authenticated"}', true);   -- the admin
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  UPDATE users SET role = 'manager' WHERE id = '21500000-0000-0000-0000-000000000103'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'A1 admin promotes staff to manager';
  UPDATE users SET role = 'admin_viewer', branch_id = '21500000-0000-0000-0000-0000000000a3' WHERE id = '21500000-0000-0000-0000-000000000104'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'A2 admin changes role and branch';
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000108'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'A3 admin edits another admin';
  UPDATE users SET login_access = 'none' WHERE id = '21500000-0000-0000-0000-000000000101'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'A4 still not their own row';
  INSERT INTO user_branches (user_id, branch_id) VALUES ('21500000-0000-0000-0000-000000000103', '21500000-0000-0000-0000-0000000000a2');
  RAISE NOTICE 'admin rules passed';
END $$;
ROLLBACK;
\echo 215 PASSED
