-- ZNLY-205 fixture: run BEFORE migration-377 on a local database that has migrations up to 376.
-- Creates one case of every kind of users.therapist_id link so znly-204-205.sql can assert what 377 did with each.
-- All rows are prefixed 'ZZ205' / uuid 205xxxxx and are removed again by the cleanup block at the end of znly-204-205.sql.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES
  ('20500000-0000-0000-0000-00000000000b', 'ZZ205 Org B', 'ZZ205B', 'zz205-org-b', '{}'::jsonb),
  ('20500000-0000-0000-0000-00000000000a', 'ZZ205 Org A', 'ZZ205A', 'zz205-org-a', '{"show_staff_selection": false}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES
  ('20500000-0000-0000-0000-0000000000b1', 'ZZ205 Branch B', '20500000-0000-0000-0000-00000000000b'),
  ('20500000-0000-0000-0000-0000000000a1', 'ZZ205 Branch A', '20500000-0000-0000-0000-00000000000a');
INSERT INTO therapists (id, branch_id, name, gender, org_id) VALUES
  ('20500000-0000-0000-0000-000000000001', '20500000-0000-0000-0000-0000000000a1', 'ZZ205 T1 copy',        'Female', '20500000-0000-0000-0000-00000000000a'),
  ('20500000-0000-0000-0000-000000000002', '20500000-0000-0000-0000-0000000000a1', 'ZZ205 T2 same link',   'Female', '20500000-0000-0000-0000-00000000000a'),
  ('20500000-0000-0000-0000-000000000003', '20500000-0000-0000-0000-0000000000a1', 'ZZ205 T3 taken',       'Female', '20500000-0000-0000-0000-00000000000a'),
  ('20500000-0000-0000-0000-000000000004', '20500000-0000-0000-0000-0000000000a1', 'ZZ205 T4 login busy',  'Male',   '20500000-0000-0000-0000-00000000000a'),
  ('20500000-0000-0000-0000-000000000005', '20500000-0000-0000-0000-0000000000a1', 'ZZ205 T5 other of U4', 'Male',   '20500000-0000-0000-0000-00000000000a'),
  ('20500000-0000-0000-0000-000000000006', '20500000-0000-0000-0000-0000000000b1', 'ZZ205 T6 org B',       'Male',   '20500000-0000-0000-0000-00000000000b'),
  ('20500000-0000-0000-0000-000000000009', '20500000-0000-0000-0000-0000000000a1', 'ZZ205 T9 login off',   'Female', '20500000-0000-0000-0000-00000000000a');
-- ten logins
INSERT INTO auth.users (id, email) SELECT ('20500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz205-u' || n || '@example.test' FROM generate_series(1, 10) n;
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access, therapist_id)
SELECT ('20500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz205-u' || n || '@example.test', 'ZZ205 U' || n, 'staff',
       '20500000-0000-0000-0000-0000000000a1', '20500000-0000-0000-0000-00000000000a',
       CASE n WHEN 8 THEN 'none' WHEN 9 THEN 'none' WHEN 10 THEN 'email' ELSE 'email' END,
       CASE n WHEN 1 THEN '20500000-0000-0000-0000-000000000001'::uuid
              WHEN 2 THEN '20500000-0000-0000-0000-000000000002'::uuid
              WHEN 3 THEN '20500000-0000-0000-0000-000000000003'::uuid
              WHEN 4 THEN '20500000-0000-0000-0000-000000000004'::uuid
              WHEN 5 THEN '20500000-0000-0000-0000-000000000006'::uuid END
  FROM generate_series(1, 10) n;
-- therapists.user_id (mig 318 link): T2 already points at U2 (same link); T3 at U7 (taken); T5 at U4 (U4 is busy); T9 at U9 (login off)
UPDATE therapists SET user_id = '20500000-0000-0000-0000-000000000102' WHERE id = '20500000-0000-0000-0000-000000000002';
UPDATE therapists SET user_id = '20500000-0000-0000-0000-000000000107' WHERE id = '20500000-0000-0000-0000-000000000003';
UPDATE therapists SET user_id = '20500000-0000-0000-0000-000000000104' WHERE id = '20500000-0000-0000-0000-000000000005';
UPDATE therapists SET user_id = '20500000-0000-0000-0000-000000000109' WHERE id = '20500000-0000-0000-0000-000000000009';
COMMIT;
