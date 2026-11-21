-- ZNLY-282: 'own_view' is own-only in RLS (migration 404). ROLLS BACK. Uses the local samis-qc logins (staff linked to a team member, admin,
-- manager). Each case: set the login's calendar_visibility, act as it (`authenticated` + jwt sub), count the bookings it can read (bookings_safe: this login hides customer details, so the base table is closed to it).
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE seen (who text, vis text, n int);
GRANT ALL ON seen TO authenticated;
CREATE TEMP TABLE ids AS SELECT email, id FROM users WHERE email IN ('staff@samis.test', 'admin@samis.test', 'manager@samis.test');
GRANT SELECT ON ids TO authenticated;

\set ROLE_STAFF  'SELECT set_config(''request.jwt.claims'', json_build_object(''sub'', (SELECT id FROM ids WHERE email = ''staff@samis.test''), ''role'', ''authenticated'')::text, true)'
\set ROLE_ADMIN  'SELECT set_config(''request.jwt.claims'', json_build_object(''sub'', (SELECT id FROM ids WHERE email = ''admin@samis.test''), ''role'', ''authenticated'')::text, true)'
\set ROLE_MGR    'SELECT set_config(''request.jwt.claims'', json_build_object(''sub'', (SELECT id FROM ids WHERE email = ''manager@samis.test''), ''role'', ''authenticated'')::text, true)'

-- staff: all, own, own_view, all_view
UPDATE users SET calendar_visibility = 'all' WHERE email = 'staff@samis.test';
:ROLE_STAFF \gset
SET LOCAL ROLE authenticated; INSERT INTO seen SELECT 'staff', 'all', count(*) FROM bookings_safe; RESET ROLE;
UPDATE users SET calendar_visibility = 'own' WHERE email = 'staff@samis.test';
SET LOCAL ROLE authenticated; INSERT INTO seen SELECT 'staff', 'own', count(*) FROM bookings_safe; RESET ROLE;
UPDATE users SET calendar_visibility = 'own_view' WHERE email = 'staff@samis.test';
SET LOCAL ROLE authenticated; INSERT INTO seen SELECT 'staff', 'own_view', count(*) FROM bookings_safe; RESET ROLE;
UPDATE users SET calendar_visibility = 'all_view' WHERE email = 'staff@samis.test';
SET LOCAL ROLE authenticated; INSERT INTO seen SELECT 'staff', 'all_view', count(*) FROM bookings_safe; RESET ROLE;
-- admin and manager with a stray own_view: never restricted
UPDATE users SET calendar_visibility = 'own_view' WHERE email IN ('admin@samis.test', 'manager@samis.test');
:ROLE_ADMIN \gset
SET LOCAL ROLE authenticated; INSERT INTO seen SELECT 'admin', 'own_view', count(*) FROM bookings_safe; RESET ROLE;
:ROLE_MGR \gset
SET LOCAL ROLE authenticated; INSERT INTO seen SELECT 'manager', 'own_view', count(*) FROM bookings_safe; RESET ROLE;

SELECT * FROM seen ORDER BY who, vis;
DO $$
DECLARE a int; o int; ov int; av int; adm int; mg int;
BEGIN
  SELECT n INTO a  FROM seen WHERE who = 'staff' AND vis = 'all';
  SELECT n INTO o  FROM seen WHERE who = 'staff' AND vis = 'own';
  SELECT n INTO ov FROM seen WHERE who = 'staff' AND vis = 'own_view';
  SELECT n INTO av FROM seen WHERE who = 'staff' AND vis = 'all_view';
  SELECT n INTO adm FROM seen WHERE who = 'admin'; SELECT n INTO mg FROM seen WHERE who = 'manager';
  ASSERT a > 0, 'staff with all must see the branch';
  ASSERT o < a, 'own must see fewer bookings than all';
  ASSERT ov = o, 'own_view must see exactly what own sees';
  ASSERT av = a, 'all_view must see the branch';
  ASSERT adm = a AND mg = a, 'admin and manager are never restricted';
  RAISE NOTICE 'ZNLY-282 ok: all=% own=% own_view=% all_view=% admin=% manager=%', a, o, ov, av, adm, mg;
END $$;
ROLLBACK;
