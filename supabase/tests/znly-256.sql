-- ZNLY-256 (migration 399): org-level admins can use the waitlist; branch managers stay on their own branches; other orgs stay out.
-- One transaction, rolled back. Prints "256 PASSED". Run after migration 399:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-256.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  oa uuid := gen_random_uuid(); ob uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_view uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  n int;
  refused boolean;
BEGIN
  INSERT INTO organizations (id, name, code, slug, industry_type) VALUES (oa, 'ZZ256 a', 'Z256A', 'zz256-a', 'spa'), (ob, 'ZZ256 b', 'Z256B', 'zz256-b', 'spa');
  INSERT INTO branches (id, org_id, name) VALUES (a1, oa, 'ZZ256 a1'), (a2, oa, 'ZZ256 a2'), (b1, ob, 'ZZ256 b1');
  INSERT INTO auth.users (id, instance_id, aud, role, email) SELECT x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x || '@zz256.test'
    FROM unnest(ARRAY[u_admin, u_mgr, u_view, u_other]) x;
  INSERT INTO users (id, email, full_name, role, org_id, branch_id) VALUES
    (u_admin, u_admin || '@zz256.test', 'ZZ256 admin', 'admin', oa, NULL),          -- org-level admin: no branch, no user_branches
    (u_mgr,   u_mgr   || '@zz256.test', 'ZZ256 mgr',   'manager', oa, a1),
    (u_view,  u_view  || '@zz256.test', 'ZZ256 view',  'admin_viewer', oa, NULL),
    (u_other, u_other || '@zz256.test', 'ZZ256 other', 'admin', ob, NULL);
  ASSERT (SELECT count(*) FROM user_branches WHERE user_id = u_admin) = 0, 'fixture: admin has no user_branches';

  PERFORM set_config('role', 'authenticated', true);

  -- org-level admin: any branch of its own org
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone) VALUES (oa, a1, 'ZZ256 w1', '9800000256'), (oa, a2, 'ZZ256 w2', '9800000256');
  SELECT count(*) INTO n FROM waitlist_entries WHERE customer_name LIKE 'ZZ256 w%';
  ASSERT n = 2, 'admin reads both branches of its org';
  UPDATE waitlist_entries SET notes = 'x' WHERE customer_name = 'ZZ256 w2';
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'admin updates a branch it is not assigned to';
  refused := false;
  BEGIN INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone) VALUES (oa, b1, 'ZZ256 x', '9800000256');
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  ASSERT refused, 'admin cannot add to ANOTHER org''s branch';

  -- branch manager: own branch only
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone) VALUES (oa, a1, 'ZZ256 w3', '9800000256');
  refused := false;
  BEGIN INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone) VALUES (oa, a2, 'ZZ256 w4', '9800000256');
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  ASSERT refused, 'manager cannot add to a branch that is not theirs';
  SELECT count(*) INTO n FROM waitlist_entries WHERE customer_name LIKE 'ZZ256 w%';
  ASSERT n = 2, 'manager reads only own branch (w1, w3)';
  UPDATE waitlist_entries SET notes = 'y' WHERE customer_name = 'ZZ256 w2';
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'manager cannot update another branch''s entry';

  -- viewer: reads the org, writes nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_view, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM waitlist_entries WHERE customer_name LIKE 'ZZ256 w%'; ASSERT n = 3, 'viewer reads the whole org';
  refused := false;
  BEGIN INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone) VALUES (oa, a1, 'ZZ256 w5', '9800000256');
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  ASSERT refused, 'viewer cannot insert';

  -- a different org sees nothing and cannot write into this one
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM waitlist_entries WHERE customer_name LIKE 'ZZ256 w%'; ASSERT n = 0, 'other org sees nothing';
  refused := false;
  BEGIN INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone) VALUES (oa, a1, 'ZZ256 w6', '9800000256');
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  ASSERT refused, 'other org cannot insert into this org';
END $$;
SELECT '256 PASSED';
ROLLBACK;
