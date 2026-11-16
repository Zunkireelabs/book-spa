#!/usr/bin/env bash
# QC for step 4c (ZNLY-206 ..). Builds a SCRATCH database (znly_qc_4c) on the local Supabase Postgres, never the dev
# database, replays ALL migrations, runs
# supabase/tests/znly-204-205.sql and prints ALL PASSED. Also runs the migration self-record check.
#   ./scripts/qc-4c.sh            # local stack must be running (supabase start)
# Works on macOS bash 3.2.
set -uo pipefail
cd "$(dirname "$0")/.."

SERVER="${QC_DB_SERVER:-postgresql://postgres:postgres@127.0.0.1:56422}"
case "$SERVER" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing: server is not local ($SERVER)" >&2; exit 1;; esac
SCRATCH=znly_qc_4c
DB="$SERVER/$SCRATCH"
fail() { echo "QC FAILED: $*" >&2; exit 1; }

echo "== scratch database $SCRATCH"
psql "$SERVER/postgres" -q -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" -c "CREATE DATABASE $SCRATCH TEMPLATE template0" || fail "create database"
psql "$DB" -q -c 'CREATE SCHEMA IF NOT EXISTS extensions' -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions' \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions' -c 'CREATE EXTENSION IF NOT EXISTS btree_gist' >/dev/null 2>&1 || fail "extensions"
# auth + storage skeleton (auth.users, auth.uid(), storage.buckets ...) copied from the running local stack, structure only.
pg_dump -s --no-owner --no-privileges -n auth -n storage "$SERVER/postgres" 2>/dev/null | psql "$DB" -q >/dev/null 2>&1

psql "$DB" -q -c 'CREATE PUBLICATION supabase_realtime' >/dev/null 2>&1
# pg_cron can only live in the cluster's `postgres` database: a stub cron schema stands in (the migrations only schedule jobs).
psql "$DB" -q -c "CREATE SCHEMA IF NOT EXISTS cron" \
  -c "CREATE TABLE IF NOT EXISTS cron.job (jobname text)" -c "CREATE TABLE IF NOT EXISTS cron.job_run_details (jobid bigint, start_time timestamptz, end_time timestamptz)" \
  -c "CREATE OR REPLACE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint'" \
  -c "CREATE OR REPLACE FUNCTION cron.schedule(text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint'" \
  -c "CREATE OR REPLACE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS 'SELECT true'" >/dev/null 2>&1

# Supabase's default grants on public (anon / authenticated / service_role), so RLS rather than missing GRANTs decides access.
psql "$DB" -q -c "GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role" >/dev/null 2>&1

run() { psql "$DB" -q -v ON_ERROR_STOP=1 "$@" >/tmp/qc-4c-last.log 2>&1 || { grep -m3 ERROR /tmp/qc-4c-last.log; return 1; }; }

echo "== schema.sql, rls.sql, local-only supplements"
run -1 -f supabase/schema.sql || fail "schema.sql"
psql "$DB" -q -f supabase/rls.sql >/dev/null 2>&1          # a few policies for tables that migration 275+ creates fail here by design (ZNLY-200)
run -1 -f scripts/local-only-supplemental-triggers.sql || fail "supplemental triggers"
run -1 -f scripts/local-only-supplemental-service-categories.sql || fail "supplemental service_categories"
run -c "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_request_id uuid" || fail "client_request_id stub (ZNLY-200)"

apply_range() {  # apply_range FROM TO
  local f n
  for f in $(ls supabase/migration-[0-9]*.sql | sort -V); do
    n=$(basename "$f" | sed 's/migration-\([0-9]*\).*/\1/'); n=$((10#$n))
    [ "$n" -lt "$1" ] && continue; [ "$n" -gt "$2" ] && continue
    case "$n" in 2|50) continue;; esac
    sed 's/^CREATE EXTENSION IF NOT EXISTS pg_cron;/-- pg_cron stubbed by qc-4c.sh/' "$f" > /tmp/qc-4c-mig.sql
    run -1 -f /tmp/qc-4c-mig.sql || fail "$(basename "$f")"
  done
}
echo "== migrations 3..375, pre-377 fixtures, 376..379, then the 4a SQL test (Parts A, B, B2)"
apply_range 3 375
run -f supabase/tests/znly-205-pre377-setup.sql || fail "pre-377 fixtures"
apply_range 376 379
C_LINE=$(grep -n "Part C: remove the ZZ205 fixtures" supabase/tests/znly-204-205.sql | cut -d: -f1)
B_LINE=$(grep -n "Part B: RPCs, rules" supabase/tests/znly-204-205.sql | cut -d: -f1)
head -$((C_LINE-1)) supabase/tests/znly-204-205.sql > /tmp/qc-4c-204-AB.sql                         # \set + Part A + Part B + Part B2
{ echo '\set ON_ERROR_STOP on'; sed -n "${B_LINE},$((C_LINE-1))p" supabase/tests/znly-204-205.sql; } > /tmp/qc-4c-204-B.sql   # Part B + B2 only (re-run later)
sed -n "${C_LINE},\$p" supabase/tests/znly-204-205.sql > /tmp/qc-4c-204-C.sql                       # Part C cleanup
{ echo '\set ON_ERROR_STOP on'; cat /tmp/qc-4c-204-C.sql; } > /tmp/qc-4c-204-C2.sql
psql "$DB" -v ON_ERROR_STOP=1 -f /tmp/qc-4c-204-AB.sql >/tmp/qc-4c-204a.log 2>&1 || { grep -E "ERROR|DETAIL" /tmp/qc-4c-204a.log | head -3; fail "znly-204-205 (at 379)"; }
echo "4a assertions at 379: ok"
echo "== migrations 380.."
apply_range 380 9999
echo "== the 204 RPC assertions again AFTER all migrations (a later CREATE OR REPLACE must not drop a guard)"
psql "$DB" -v ON_ERROR_STOP=1 -f /tmp/qc-4c-204-B.sql >/tmp/qc-4c-204b.log 2>&1 || { grep -E "ERROR|DETAIL" /tmp/qc-4c-204b.log | head -3; fail "znly-204-205 Part B after 385"; }
echo "4a assertions after 385: ok"
psql "$DB" -v ON_ERROR_STOP=1 -f /tmp/qc-4c-204-C2.sql >/tmp/qc-4c-204c.log 2>&1 || fail "znly-204-205 Part C cleanup"
for f in public_check_slot_availability public_check_branch_bookings_range public_check_therapist_bookings_range public_get_bookable_therapists public_get_service_eligible_gender_headcount; do
  g=$(psql "$DB" -qAt -c "select count(*) from pg_proc w join pg_proc i on i.proname='_'||w.proname||'_impl' and i.pronamespace=w.pronamespace where w.pronamespace='public'::regnamespace and w.proname='$f' and w.prosrc ~ '_${f}_impl' and w.prosrc ~ 'is_active'")
  [ "$g" = "1" ] || fail "$f no longer calls its _impl behind the inactive-location guard (a later CREATE OR REPLACE dropped it?)"
done
echo "inactive-location guard still in all five public readers"

# Parallel check helper: two psql sessions at once. $1 = sql file template run with -v k=<n>
echo "== ZNLY-206 SQL test (supabase/tests/znly-206.sql)"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-206.sql >/tmp/qc-4c-206.log 2>&1
grep -E "NOTICE|ERROR|ALL PASSED|DETAIL" /tmp/qc-4c-206.log | sed 's#psql:[^ ]* ##'
grep -q "206 PASSED" /tmp/qc-4c-206.log || fail "ZNLY-206 SQL test"

echo "== ZNLY-207 SQL test (supabase/tests/znly-207.sql)"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-207.sql >/tmp/qc-4c-207.log 2>&1
grep -E "NOTICE|ERROR|DETAIL" /tmp/qc-4c-207.log | sed 's#psql:[^ ]* ##'
grep -q "207 PASSED" /tmp/qc-4c-207.log || fail "ZNLY-207 SQL test"

echo "== ZNLY-208 SQL test (supabase/tests/znly-208.sql)"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-208.sql >/tmp/qc-4c-208.log 2>&1
grep -E "NOTICE|ERROR|DETAIL" /tmp/qc-4c-208.log | sed 's#psql:[^ ]* ##'
grep -q "208 PASSED" /tmp/qc-4c-208.log || fail "ZNLY-208 SQL test"

echo "== ZNLY-218 SQL test (supabase/tests/znly-218.sql)"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-218.sql >/tmp/qc-4c-218.log 2>&1
grep -E "NOTICE|ERROR|DETAIL" /tmp/qc-4c-218.log | sed 's#psql:[^ ]* ##'
grep -q "218 PASSED" /tmp/qc-4c-218.log || fail "ZNLY-218 SQL test"

echo "== ZNLY-210/216 SQL test (supabase/tests/znly-210.sql)"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-210.sql >/tmp/qc-4c-210.log 2>&1
grep -E "NOTICE|ERROR|DETAIL" /tmp/qc-4c-210.log | sed 's#psql:[^ ]* ##'
grep -q "210 PASSED" /tmp/qc-4c-210.log || fail "ZNLY-210 SQL test"

echo "== B7 Locations SQL test (supabase/tests/znly-b7.sql)"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-b7.sql >/tmp/qc-4c-b7.log 2>&1
grep -E "NOTICE|ERROR|DETAIL" /tmp/qc-4c-b7.log | sed 's#psql:[^ ]* ##'
grep -q "B7 PASSED" /tmp/qc-4c-b7.log || fail "B7 SQL test"

echo "== ZNLY-206 parallel pay (two sessions, same booking, different keys)"
PAYB=$(psql "$DB" -qAt -c "select id from bookings where customer_name='ZZ206 parallel'")
call() { psql "$DB" -qAt -c "set request.jwt.claims='{\"sub\":\"20600000-0000-0000-0000-000000000101\",\"role\":\"authenticated\"}'; set role authenticated; select (record_booking_payment('$PAYB', '[{\"amount\":1000,\"payment_mode\":\"Cash\"}]', '$1', null))->>'replayed'" 2>&1 | grep -E "^(false|true)|ERROR" | head -1; }
call 20600000-0000-0000-0000-0000000000a1 >/tmp/qc-4c-p1.log &
call 20600000-0000-0000-0000-0000000000a2 >/tmp/qc-4c-p2.log &
wait
okn=$(cat /tmp/qc-4c-p1.log /tmp/qc-4c-p2.log | grep -c '^false')
[ "$okn" = "1" ] || fail "parallel pay: expected exactly one success, got $okn ($(cat /tmp/qc-4c-p1.log /tmp/qc-4c-p2.log | tr '\n' ' '))"
rows=$(psql "$DB" -qAt -c "select count(*) from payments where booking_id='$PAYB'")
[ "$rows" = "1" ] || fail "parallel pay: expected 1 payment row, got $rows"
echo "parallel pay: one payment, the other refused"

echo "== migration self-record check (vs origin/stage)"
bash scripts/check-migrations.sh origin/stage | grep -q "^FAIL" && fail "check-migrations"
echo "QC 4c: ALL PASSED"
