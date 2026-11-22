#!/usr/bin/env bash
# LOCAL: proves the delta. Old export -> phase B+C; then (1) history alone must REFUSE politely (missing clients), (2) phase delta with the full export.
# Usage: rehearse-delta.sh <full-export-dir> [db-name]   (needs a scratch DB with the flags: run rehearse-local.sh first, then this reuses its steps)
set -euo pipefail
FULL="$1"; DB="${2:-zn_import_delta}"
export PGPASSWORD="${PGPASSWORD:-postgres}" PGHOST=127.0.0.1 PGPORT="${PGPORT:-56422}" PGUSER=postgres
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/temp_ss/client-data}"; OLD="$OUT/old-export"; rm -rf "$OLD"
URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:$PGPORT/$DB"
node "$HERE/make-old-export.mjs" "$FULL" "$OLD"
run() { node "$HERE/../import.mjs" --org samis --admin-email admin@samis-import.test --staff-gender Female --db "$URL" --out "$OUT" "$@" 2>&1 | grep -E "FAILED|COMMITTED|DRY|C:|customers-delta|products-delta|RECON" | cut -c1-330 || true; }
echo "== old export (B + C)"; run --export "$OLD" --phase all
echo "== full export, history alone (expect a polite refusal)"; run --export "$FULL" --phase history
echo "== full export, delta"; run --export "$FULL" --phase delta
echo "== delta again (expect 0 new, 0 changes)"; run --export "$FULL" --phase delta
