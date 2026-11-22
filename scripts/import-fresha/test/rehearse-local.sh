#!/usr/bin/env bash
# LOCAL rehearsal: copies the local dev DB into a scratch DB, stubs the 424/425 flags, onboards a beauty org, snapshots, imports,
# snapshots again and diffs. Never touches anything but 127.0.0.1. Usage: rehearse-local.sh <fresha-export-dir> [db-name]
set -euo pipefail
EXPORT="$1"; DB="${2:-zn_import_rehearsal}"
export PGPASSWORD="${PGPASSWORD:-postgres}" PGHOST=127.0.0.1 PGPORT="${PGPORT:-56422}" PGUSER=postgres
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/temp_ss/client-data}"; mkdir -p "$OUT"
PGBIN=/opt/homebrew/opt/libpq/bin
psql -d postgres -qc "drop database if exists $DB" -c "create database $DB"
psql -d "$DB" -q -c "create schema if not exists extensions; create extension btree_gist schema public; create extension pgcrypto schema extensions; create extension \"uuid-ossp\" schema extensions;"
"$PGBIN/pg_dump" -d postgres -n public -n auth --no-owner --no-privileges 2>/dev/null | psql -d "$DB" -q >/dev/null 2>&1 || true
if [ -n "${MIG_DIR:-}" ]; then # the REAL migrations 424/425 instead of the stub
  for m in "$MIG_DIR"/migration-424-*.sql "$MIG_DIR"/migration-425-*.sql; do psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$m" 2>&1 | grep -v NOTICE || true; done
else psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/local-stub-flags.sql" 2>&1 | grep -v NOTICE || true; fi
psql -d "$DB" -v ON_ERROR_STOP=1 -q -v org_name="Sami Import Test" -v org_code=SIT -v org_slug=samis -v owner_email=admin@samis-import.test -v industry_type=beauty -v branch_name=Lazimpat -v branch_address=Kathmandu -v branch_phone=+97710000000 -f "$ROOT/scripts/onboard-tenant.sql" >/dev/null 2>&1
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/local-fixture.sql"
psql -d "$DB" -X -A -t -F '|' -f "$ROOT/scripts/qc-snapshot.sql" > "$OUT/qc-before.txt"
URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:$PGPORT/$DB"
if [ -n "${WRITER:-}" ]; then node "$HERE/concurrent-writer.mjs" "$URL" start > "$OUT/writer.out" & WPID=$!; sleep 1; fi
node "$HERE/../import.mjs" --export "$EXPORT" --org samis --admin-email admin@samis-import.test --staff-gender Female --db "postgresql://postgres:$PGPASSWORD@127.0.0.1:$PGPORT/$DB" --out "$OUT" ${MODE_MAP:+--mode-map "$MODE_MAP"} ${IMPORT_ARGS:-}
if [ -n "${WRITER:-}" ]; then sleep 1; kill -TERM $WPID; wait $WPID || true; cat "$OUT/writer.out"; node "$HERE/concurrent-writer.mjs" "$URL" check; fi
psql -d "$DB" -X -A -t -F '|' -f "$ROOT/scripts/qc-snapshot.sql" > "$OUT/qc-after.txt"
diff "$OUT/qc-before.txt" "$OUT/qc-after.txt" > "$OUT/qc-diff.txt" || true
echo "qc diff lines: $(wc -l < "$OUT/qc-diff.txt") (see $OUT/qc-diff.txt)"
