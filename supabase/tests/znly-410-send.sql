-- ZNLY-410 (migration 438): bill_send_state. Local DB only. EVERYTHING ROLLS BACK.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/znly-410-send.sql
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE res (n text, what text, ok boolean, evidence text);
CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM public.users WHERE email = p_email), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.st(p text) RETURNS text LANGUAGE plpgsql AS
$$ BEGIN RETURN public.bill_send_state(p)::text; EXCEPTION WHEN OTHERS THEN RETURN 'ERR ' || SQLERRM; END $$;

INSERT INTO public.outreach_provider_config (org_id, channel, provider, from_address) VALUES ('ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a', 'email', 'resend', 'x@example.test');
INSERT INTO public.outreach_messages (org_id, customer_id, channel, to_address, subject, body, status, dedupe_key)
  SELECT 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a', c.id, 'email', 'a@example.test', 's', 'SECRET BODY', 'failed', 'bill:BK-TEST-1:' || gen_random_uuid()
  FROM public.customers c WHERE c.org_id = 'ef1cecbb-ccf3-4029-b2c6-f6e716eecc6a' LIMIT 1;

SELECT pg_temp.as_user('staff@samis-import-qc.test');
INSERT INTO res SELECT 'T410B-1', 'staff gets email_ready + the last send for that bill number', (pg_temp.st('BK-TEST-1')::jsonb ->> 'email_ready') = 'true' AND (pg_temp.st('BK-TEST-1')::jsonb -> 'last' ->> 'status') = 'failed', pg_temp.st('BK-TEST-1');
INSERT INTO res SELECT 'T410B-2', 'no message body is returned', pg_temp.st('BK-TEST-1') NOT LIKE '%SECRET%', '';
INSERT INTO res SELECT 'T410B-3', 'another bill number has no last send', (pg_temp.st('BK-TEST-2')::jsonb -> 'last') = 'null'::jsonb, pg_temp.st('BK-TEST-2');
SELECT pg_temp.as_user('admin@smoke.test');
INSERT INTO res SELECT 'T410B-4', 'another org sees nothing: not ready, no last', (pg_temp.st('BK-TEST-1')::jsonb ->> 'email_ready') = 'false' AND (pg_temp.st('BK-TEST-1')::jsonb -> 'last') = 'null'::jsonb, pg_temp.st('BK-TEST-1');
SELECT n || ' ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' — ' || what || ' [' || COALESCE(evidence, '') || ']' FROM res ORDER BY n;
SELECT 'FAILS: ' || count(*) FROM res WHERE NOT ok;
ROLLBACK;
