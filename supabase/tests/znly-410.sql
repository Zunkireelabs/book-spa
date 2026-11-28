-- ZNLY-410 (migration 435): fix_bill_number. Local DB only. EVERYTHING ROLLS BACK.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/znly-410.sql
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE res (n text, what text, ok boolean, evidence text);
CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = p_email), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.fix(p_id uuid, p_single boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS
$$ BEGIN RETURN public.fix_bill_number(p_id, p_single); EXCEPTION WHEN OTHERS THEN RETURN 'ERR ' || SQLERRM || ' | ' || SQLSTATE; END $$;

-- a 3-row visit of the ON org (samis-import-qc) and a single booking of the OFF org (nuad-thai-spa)
CREATE TEMP TABLE fx AS
  SELECT v.visit_id, (SELECT b2.id FROM bookings b2 WHERE b2.visit_id = v.visit_id ORDER BY b2.booking_number DESC LIMIT 1) AS last_id,
         (SELECT min(b2.booking_number) FROM bookings b2 WHERE b2.visit_id = v.visit_id) AS first_no
  FROM (SELECT b.visit_id FROM bookings b JOIN branches br ON br.id = b.branch_id
        WHERE br.org_id = 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a' AND b.visit_id IS NOT NULL GROUP BY 1 HAVING count(*) = 3 LIMIT 1) v;
CREATE TEMP TABLE fx2 AS SELECT b.id, b.booking_number FROM bookings b JOIN branches br ON br.id = b.branch_id WHERE br.org_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;

SELECT pg_temp.as_user('admin@samis-import-qc.test');
INSERT INTO res SELECT 'T410-1', 'visit bill number = the visit''s first booking number, taken from ANY row of the visit', pg_temp.fix(last_id) = first_no, pg_temp.fix(last_id) FROM fx;
INSERT INTO res SELECT 'T410-2', 'fixed once: asking again (other row) returns the stored number, exactly one row', (SELECT count(*) FROM bill_numbers WHERE bill_number = fx.first_no) = 1, first_no FROM fx;
INSERT INTO res SELECT 'T410-3', 'p_single anchors on the booking itself (tax-invoice orgs)', pg_temp.fix(last_id, true) = (SELECT booking_number FROM bookings WHERE id = fx.last_id), pg_temp.fix(last_id, true) FROM fx;
INSERT INTO res SELECT 'T410-4', 'another org''s booking is refused', pg_temp.fix(fx2.id) LIKE 'ERR BILL_REFUSED%', pg_temp.fix(fx2.id) FROM fx2;
SELECT pg_temp.as_user('admin@smoke.test');
INSERT INTO res SELECT 'T410-5', 'OFF org: the booking itself', pg_temp.fix(fx2.id) = fx2.booking_number, pg_temp.fix(fx2.id) FROM fx2;
CREATE TEMP TABLE seen (n int);
GRANT ALL ON seen TO authenticated;
SET LOCAL ROLE authenticated;  -- RLS only applies below the superuser
INSERT INTO seen SELECT count(*) FROM bill_numbers WHERE org_id = 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a';
RESET ROLE;
INSERT INTO res SELECT 'T410-6', 'a user of the other org cannot see the ON org''s numbers (RLS)', n = 0, n::text FROM seen;
SELECT n || ' ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' — ' || what || ' [' || COALESCE(evidence, '') || ']' FROM res ORDER BY n;
SELECT 'FAILS: ' || count(*) FROM res WHERE NOT ok;
ROLLBACK;
