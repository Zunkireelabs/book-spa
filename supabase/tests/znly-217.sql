-- ZNLY-217: who can read pay rates (staff_compensation). Scratch database only (scripts/qc-4c.sh).
-- Admin and admin_viewer read, manager and staff do not; so "no rows" for an admin means "no pay set up", never "not allowed".
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('21700000-0000-0000-0000-00000000000a', 'ZZ217 Org', 'ZZ217A', 'zz217-org', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('21700000-0000-0000-0000-0000000000a1', 'ZZ217 Branch', '21700000-0000-0000-0000-00000000000a');
INSERT INTO therapists (id, branch_id, name, gender, org_id) VALUES ('21700000-0000-0000-0000-000000000001', '21700000-0000-0000-0000-0000000000a1', 'ZZ217 T1', 'Female', '21700000-0000-0000-0000-00000000000a');
INSERT INTO staff_compensation (therapist_id) VALUES ('21700000-0000-0000-0000-000000000001');
INSERT INTO auth.users (id, email) SELECT ('21700000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz217-u' || n || '@example.test' FROM generate_series(1, 4) n;
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
SELECT ('21700000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz217-u' || n || '@example.test', 'ZZ217 U' || n,
       (CASE n WHEN 1 THEN 'admin' WHEN 2 THEN 'admin_viewer' WHEN 3 THEN 'manager' ELSE 'staff' END)::user_role,
       '21700000-0000-0000-0000-0000000000a1', '21700000-0000-0000-0000-00000000000a', 'email'
FROM generate_series(1, 4) n;
COMMIT;

DO $$
DECLARE who text; expected boolean; n int; uid uuid;
BEGIN
  FOR uid, who, expected IN SELECT ('21700000-0000-0000-0000-0000000001' || lpad(k::text, 2, '0'))::uuid, r, e FROM (VALUES (1, 'admin', true), (2, 'admin_viewer', true), (3, 'manager', false), (4, 'staff', false)) v(k, r, e) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO n FROM staff_compensation WHERE therapist_id = '21700000-0000-0000-0000-000000000001';
    EXECUTE 'RESET ROLE';
    ASSERT (n = 1) = expected, 'R1 ' || who || ' reads rates = ' || (n = 1) || ', expected ' || expected;
  END LOOP;
  RAISE NOTICE 'rate visibility by role passed';
END $$;
\echo 217 PASSED
