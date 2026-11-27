-- ZNLY-410 step 2 part A (migration 436): bill links + public bill. Local DB only. EVERYTHING ROLLS BACK.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/znly-410-links.sql
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE res (n text, what text, ok boolean, evidence text);
CREATE TEMP TABLE got (k text, v jsonb);
GRANT ALL ON got TO anon, authenticated;
CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = p_email), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.share(p_id uuid, p_extra uuid[] DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS
$$ DECLARE r record; BEGIN SELECT * INTO r FROM public.share_bill(p_id, p_extra); RETURN r.bill_number || '|' || r.token; EXCEPTION WHEN OTHERS THEN RETURN 'ERR ' || SQLERRM || ' | ' || SQLSTATE; END $$;

-- a 3-row visit (ON org samis-import-qc), one booking of another customer in the same org, and a Nuad booking
CREATE TEMP TABLE fx AS
  SELECT v.visit_id, (SELECT array_agg(b2.id ORDER BY b2.booking_number) FROM bookings b2 WHERE b2.visit_id = v.visit_id) AS ids
  FROM (SELECT b.visit_id FROM bookings b JOIN branches br ON br.id = b.branch_id
        WHERE br.org_id = 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a' AND b.visit_id IS NOT NULL GROUP BY 1 HAVING count(*) = 3 LIMIT 1) v;
CREATE TEMP TABLE fx2 AS SELECT b.id FROM bookings b JOIN branches br ON br.id = b.branch_id WHERE br.org_id = '00000000-0000-0000-0000-000000000001' LIMIT 1;
CREATE TEMP TABLE fx3 AS SELECT b.id FROM bookings b JOIN branches br ON br.id = b.branch_id
  WHERE br.org_id = 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a' AND b.visit_id IS NULL AND b.customer_id IS NOT NULL ORDER BY b.booking_number LIMIT 2;

SELECT pg_temp.as_user('admin@samis-import-qc.test');
CREATE TEMP TABLE sh (k text, v text); GRANT ALL ON sh TO anon, authenticated;
INSERT INTO sh SELECT 'v1', pg_temp.share(ids[3]) FROM fx;
INSERT INTO sh SELECT 'v2', pg_temp.share(ids[1]) FROM fx;
INSERT INTO sh SELECT 'bundle', pg_temp.share((SELECT id FROM fx3 ORDER BY id LIMIT 1), ARRAY(SELECT id FROM fx3 ORDER BY id DESC LIMIT 1));
INSERT INTO sh SELECT 'other', pg_temp.share(id) FROM fx2;
INSERT INTO res SELECT 'T-A1', 'share_bill returns the visit''s first booking number and a 64-char token',
  split_part(v, '|', 1) = (SELECT booking_number FROM bookings WHERE id = (SELECT ids[1] FROM fx)) AND length(split_part(v, '|', 2)) = 64, split_part(v, '|', 1) FROM sh WHERE k = 'v1';
INSERT INTO res SELECT 'T-A2', 'another row of the same visit gets the SAME token (one active link per visit)', (SELECT v FROM sh WHERE k='v1') = (SELECT v FROM sh WHERE k='v2'), '';
INSERT INTO res SELECT 'T-A3', 'a checkout bundle stores exactly its booking set', (SELECT cardinality(booking_ids) = 2 AND visit_id IS NULL FROM bill_links WHERE token = split_part((SELECT v FROM sh WHERE k='bundle'), '|', 2)), (SELECT v FROM sh WHERE k='bundle');
INSERT INTO res SELECT 'T-A4', 'another org''s booking cannot be shared', v LIKE 'ERR BILL_REFUSED%', v FROM sh WHERE k = 'other';

-- anon reads
INSERT INTO got SELECT 'good', public.get_public_bill(split_part((SELECT v FROM sh WHERE k='v1'), '|', 2));
SET LOCAL ROLE anon;
INSERT INTO got SELECT 'anon-good', public.get_public_bill(split_part((SELECT v FROM sh WHERE k='v1'), '|', 2));
INSERT INTO got SELECT 'anon-wrong', public.get_public_bill(repeat('a', 64));
INSERT INTO got SELECT 'anon-short', public.get_public_bill('abc');
DO $$ BEGIN PERFORM 1 FROM public.bill_links LIMIT 1; INSERT INTO got VALUES ('anon-table', 'true'); EXCEPTION WHEN insufficient_privilege THEN INSERT INTO got VALUES ('anon-table', 'false'); END $$;
DO $$ BEGIN PERFORM public.share_bill((SELECT ids[1] FROM fx)); INSERT INTO got VALUES ('anon-share', 'true'); EXCEPTION WHEN OTHERS THEN INSERT INTO got VALUES ('anon-share', 'false'); END $$;
RESET ROLE;
INSERT INTO res SELECT 'T-A5', 'anon gets the bill: 3 rows, active, number matches', (v->>'active')::boolean AND jsonb_array_length(v->'rows') = 3 AND v->>'billNumber' = split_part((SELECT v FROM sh WHERE k='v1'), '|', 1), v->>'billNumber' FROM got WHERE k = 'anon-good';
INSERT INTO res SELECT 'T-A6', 'customer phone is masked, name shown, no email key anywhere',
  (v->'customer'->>'phone') LIKE '%•%' AND v->'customer'->>'name' IS NOT NULL AND (v::text NOT LIKE '%customer_email%') AND (v->'customer') ?& ARRAY['name','phone'] AND (SELECT count(*) FROM jsonb_object_keys(v->'customer')) = 2, v->'customer'->>'phone' FROM got WHERE k = 'anon-good';
INSERT INTO res SELECT 'T-A7', 'only the bill''s own rows: every row id belongs to the visit', (SELECT bool_and((r->>'id')::uuid = ANY (SELECT unnest(ids) FROM fx)) FROM got, jsonb_array_elements(v->'rows') r WHERE k = 'anon-good'), '';
INSERT INTO res SELECT 'T-A8', 'wrong / too-short token: nothing, not even a business name', (SELECT v = '{"active": false}'::jsonb FROM got WHERE k='anon-wrong') AND (SELECT v = '{"active": false}'::jsonb FROM got WHERE k='anon-short'), '';
INSERT INTO res SELECT 'T-A9', 'anon cannot read bill_links or call share_bill', (SELECT v = 'false' FROM got WHERE k='anon-table') AND (SELECT v = 'false' FROM got WHERE k='anon-share'), '';

-- other org cannot turn it off; staff of the org can
SELECT pg_temp.as_user('admin@smoke.test');
INSERT INTO res SELECT 'T-A10', 'a user of another org cannot turn the link off (and cannot see it)', public.turn_off_bill_link(split_part((SELECT v FROM sh WHERE k='v1'), '|', 2)) = false, '';
SELECT pg_temp.as_user('admin@samis-import-qc.test');
INSERT INTO res SELECT 'T-A11', 'turn off works', public.turn_off_bill_link(split_part((SELECT v FROM sh WHERE k='v1'), '|', 2)) = true, '';
SET LOCAL ROLE anon;
INSERT INTO got SELECT 'anon-off', public.get_public_bill(split_part((SELECT v FROM sh WHERE k='v1'), '|', 2));
RESET ROLE;
INSERT INTO res SELECT 'T-A12', 'turned-off link: not active, business name only', (v->>'active')::boolean = false AND v->>'businessName' IS NOT NULL AND NOT (v ? 'rows'), v->>'businessName' FROM got WHERE k = 'anon-off';
INSERT INTO sh SELECT 'v3', pg_temp.share((SELECT ids[2] FROM fx));
INSERT INTO res SELECT 'T-A13', 'sending again after a turn-off makes a NEW token, same bill number', split_part((SELECT v FROM sh WHERE k='v3'), '|', 2) <> split_part((SELECT v FROM sh WHERE k='v1'), '|', 2) AND split_part((SELECT v FROM sh WHERE k='v3'), '|', 1) = split_part((SELECT v FROM sh WHERE k='v1'), '|', 1), '';

-- "Updated": a payment after the link was made
INSERT INTO got SELECT 'before', public.get_public_bill(split_part((SELECT v FROM sh WHERE k='v3'), '|', 2));
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) SELECT (SELECT ids[1] FROM fx), 1, 'Cash', (SELECT id FROM users WHERE email='admin@samis-import-qc.test');
INSERT INTO got SELECT 'after', public.get_public_bill(split_part((SELECT v FROM sh WHERE k='v3'), '|', 2));
INSERT INTO res SELECT 'T-A14', 'unchanged bill: no "updated"; after a payment: updatedAt is set',
  (SELECT v->>'updatedAt' IS NULL FROM got WHERE k='before') AND (SELECT v->>'updatedAt' IS NOT NULL FROM got WHERE k='after'), '';
-- tax-invoice org: an invoiced booking is its own bill; the public JSON carries the invoice without internal ids
UPDATE organizations SET settings = jsonb_build_object('billing_enabled', true, 'billing_legal_name','T Pvt','billing_pan','123456789','billing_address','x','billing_phone','1','billing_tax_mode','inclusive','billing_vat_rate',13,'billing_invoice_prefix','TST') WHERE id = 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a';
SELECT pg_temp.as_user('admin@samis-import-qc.test');
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) SELECT ids[2], (SELECT final_amount FROM bookings WHERE id = ids[2]) - COALESCE((SELECT sum(amount) FROM payments WHERE booking_id = ids[2]), 0), 'Cash', (SELECT id FROM users WHERE email='admin@samis-import-qc.test') FROM fx;
SELECT public.issue_invoice((SELECT ids[2] FROM fx));
INSERT INTO sh SELECT 'inv', pg_temp.share((SELECT ids[2] FROM fx));
INSERT INTO got SELECT 'inv', public.get_public_bill(split_part((SELECT v FROM sh WHERE k='inv'), '|', 2));
INSERT INTO res SELECT 'T-A16', 'an invoiced booking is its own bill: link stores that booking only, public bill = 1 row + its invoice, total = the invoice total, no *_id keys in the invoice',
  (SELECT visit_id IS NULL AND cardinality(booking_ids) = 1 FROM bill_links WHERE token = split_part((SELECT v FROM sh WHERE k='inv'), '|', 2))
  AND jsonb_array_length(v->'rows') = 1 AND (v->'invoice'->>'total_amount')::numeric = (v->'rows'->0->>'final')::numeric
  AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v->'invoice') k WHERE k ~ '(^id$|_id$|^issued_by$)') AND v->'invoice'->>'invoice_number' IS NOT NULL, v->'invoice'->>'invoice_number' FROM got WHERE k = 'inv';
INSERT INTO res SELECT 'T-A15', 'migration 436 recorded', EXISTS (SELECT 1 FROM schema_migrations WHERE version = '436'), '';

SELECT n || ' ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' — ' || what || ' [' || COALESCE(evidence, '') || ']' FROM res ORDER BY length(n), n;
SELECT 'FAILS: ' || count(*) FROM res WHERE NOT ok;
ROLLBACK;
