-- ZNLY-210 + ZNLY-216: has_pin() and the unreadable PIN column (migration 384). Scratch database only (scripts/qc-4c.sh).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('21000000-0000-0000-0000-00000000000a', 'ZZ210 Org A', 'ZZ210A', 'zz210-a', '{}'::jsonb),
                                                                  ('21000000-0000-0000-0000-00000000000b', 'ZZ210 Org B', 'ZZ210B', 'zz210-b', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('21000000-0000-0000-0000-0000000000a1', 'ZZ210 A', '21000000-0000-0000-0000-00000000000a'),
                                               ('21000000-0000-0000-0000-0000000000b1', 'ZZ210 B', '21000000-0000-0000-0000-00000000000b');
INSERT INTO auth.users (id, email) SELECT ('21000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz210-u' || n || '@example.test' FROM generate_series(1, 5) n;
-- 1 admin A (has PIN), 2 staff A (has PIN), 3 staff A (no PIN), 4 manager A (no PIN), 5 staff B (has PIN)
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access, pin)
SELECT ('21000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz210-u' || n || '@example.test', 'ZZ210 U' || n,
       (CASE n WHEN 1 THEN 'admin' WHEN 4 THEN 'manager' ELSE 'staff' END)::user_role,
       CASE n WHEN 5 THEN '21000000-0000-0000-0000-0000000000b1' ELSE '21000000-0000-0000-0000-0000000000a1' END::uuid,
       CASE n WHEN 5 THEN '21000000-0000-0000-0000-00000000000b' ELSE '21000000-0000-0000-0000-00000000000a' END::uuid,
       'email', CASE n WHEN 1 THEN '1111' WHEN 2 THEN '2222' WHEN 5 THEN '5555' END
FROM generate_series(1, 5) n;
COMMIT;

-- every column except pin stays readable by the app roles (a future column added to users without a GRANT fails here)
DO $$
DECLARE c text; missing text := '';
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' LOOP
    IF c = 'pin' THEN
      ASSERT NOT has_column_privilege('authenticated', 'public.users', c, 'SELECT') AND NOT has_column_privilege('anon', 'public.users', c, 'SELECT'), 'P1 pin must not be selectable';
      ASSERT has_column_privilege('authenticated', 'public.users', c, 'UPDATE') AND has_column_privilege('authenticated', 'public.users', c, 'INSERT'), 'P2 pin must stay writable';
    ELSIF NOT (has_column_privilege('authenticated', 'public.users', c, 'SELECT') AND has_column_privilege('anon', 'public.users', c, 'SELECT')) THEN
      missing := missing || c || ' ';
    END IF;
  END LOOP;
  ASSERT missing = '', 'P3 columns of users the app cannot read (GRANT SELECT (col) ON public.users TO anon, authenticated): ' || missing;
  ASSERT NOT has_function_privilege('anon', 'public.verify_pin(text,text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.verify_pin(text,text,text)', 'EXECUTE'), 'P4 verify_pin is closed';
  ASSERT has_function_privilege('service_role', 'public.verify_pin(text,text,text)', 'EXECUTE'), 'P5 service_role keeps verify_pin';
END $$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"21000000-0000-0000-0000-000000000102","role":"authenticated"}', true);   -- staff A with a PIN
SET LOCAL ROLE authenticated;
DO $$
DECLARE r text;
BEGIN
  ASSERT has_pin() = true AND has_pin('21000000-0000-0000-0000-000000000102') = true, 'H1 own PIN is set';
  BEGIN PERFORM pin FROM users WHERE id = '21000000-0000-0000-0000-000000000102'; ASSERT false, 'H2 selecting pin must be refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM users LIMIT 1; ASSERT false, 'H3 select * must be refused (the app must list columns)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM has_pin('21000000-0000-0000-0000-000000000101'); ASSERT false, 'H4 staff cannot ask about someone else';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  PERFORM id, email, full_name, role, org_id, login_access FROM users WHERE id = '21000000-0000-0000-0000-000000000102';   -- the normal reads still work
  RAISE NOTICE 'own checks passed';
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"21000000-0000-0000-0000-000000000101","role":"authenticated"}', true);   -- admin A
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT has_pin('21000000-0000-0000-0000-000000000102') = true AND has_pin('21000000-0000-0000-0000-000000000103') = false, 'A1 admin sees who has a PIN';
  BEGIN PERFORM has_pin('21000000-0000-0000-0000-000000000105'); ASSERT false, 'A2 not across organisations';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  UPDATE users SET pin = '9999' WHERE id = '21000000-0000-0000-0000-000000000103';                       -- saving a PIN still works
  ASSERT has_pin('21000000-0000-0000-0000-000000000103') = true, 'A3 a saved PIN shows as set';
  RAISE NOTICE 'admin checks passed';
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"21000000-0000-0000-0000-000000000104","role":"authenticated"}', true);   -- manager A, no PIN of their own
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT has_pin() = false, 'M1 a manager with no PIN: has_pin() is false (lock screen stays off for them)';
  ASSERT has_pin('21000000-0000-0000-0000-000000000102') = true, 'M2 manager sees a team member';
  RAISE NOTICE 'manager checks passed';
END $$;
ROLLBACK;
\echo 210 PASSED
