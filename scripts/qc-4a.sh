#!/usr/bin/env bash
# QC for step 4a (ZNLY-204 / ZNLY-205). Builds a SCRATCH database (znly_qc_4a) on the local Supabase Postgres, never the dev
# database, replays the migrations up to 376, loads the pre-377 link fixtures, applies 376..378, runs
# supabase/tests/znly-204-205.sql and prints ALL PASSED. Also runs the migration self-record check.
#   ./scripts/qc-4a.sh            # local stack must be running (supabase start)
# Works on macOS bash 3.2.
set -uo pipefail
cd "$(dirname "$0")/.."

SERVER="${QC_DB_SERVER:-postgresql://postgres:postgres@127.0.0.1:56422}"
case "$SERVER" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing: server is not local ($SERVER)" >&2; exit 1;; esac
SCRATCH=znly_qc_4a
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

run() { psql "$DB" -q -v ON_ERROR_STOP=1 "$@" >/tmp/qc-4a-last.log 2>&1 || { grep -m3 ERROR /tmp/qc-4a-last.log; return 1; }; }

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
    sed 's/^CREATE EXTENSION IF NOT EXISTS pg_cron;/-- pg_cron stubbed by qc-4a.sh/' "$f" > /tmp/qc-4a-mig.sql
    run -1 -f /tmp/qc-4a-mig.sql || fail "$(basename "$f")"
  done
}
echo "== migrations 3..375"
apply_range 3 375
echo "== pre-377 fixtures, then 376..378"
run -f supabase/tests/znly-205-pre377-setup.sql || fail "fixtures"
apply_range 376 378

echo "== SQL test"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/znly-204-205.sql >/tmp/qc-4a-test.log 2>&1
grep -E "NOTICE|ERROR|ALL PASSED|DETAIL" /tmp/qc-4a-test.log | sed 's#psql:[^ ]* ##'
grep -q "ALL PASSED" /tmp/qc-4a-test.log || fail "SQL test"
psql "$DB" -qAt -c "select 'ledger: '||count(*)||' versions, max '||max(version::int) from schema_migrations where version ~ '^[0-9]+$'"

echo "== migration self-record check (vs origin/stage)"
bash scripts/check-migrations.sh origin/stage | grep -E "FAIL|^OK: .*migration-37[678]" || true
bash scripts/check-migrations.sh origin/stage | grep -q "^FAIL" && fail "check-migrations"
echo "QC 4a: ALL PASSED"
