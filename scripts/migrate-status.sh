#!/usr/bin/env bash
# migrate-status.sh — show which migrations are applied vs pending on a DB.
#
# Usage:
#   scripts/migrate-status.sh local                  # your local Supabase DB (default URL)
#   STAGE_DB_URL='postgresql://...'  scripts/migrate-status.sh stage
#   PROD_DB_URL='postgresql://...'   scripts/migrate-status.sh prod
#
# Read-only. Reads the schema_migrations ledger. This is the answer to
# "what's actually applied on <env>?".
#
# Same version-extraction as migrate-apply.sh: ledger.version is the file's
# leading token (NNN or NNNa), not the full filename.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  local) DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" ;;
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (Supabase dashboard -> staging project -> Settings -> Database)."; exit 1; } ;;
  prod)  DB="${PROD_DB_URL:-}";  [ -z "$DB" ] && { echo "Set PROD_DB_URL (Supabase dashboard -> prod project -> Settings -> Database)."; exit 1; } ;;
  *)     echo "Usage: $0 <local|stage|prod>   (DB URL via LOCAL_DB_URL / STAGE_DB_URL / PROD_DB_URL env)"; exit 1 ;;
esac

DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"
FILES="$(mktemp)"; APPLIED="$(mktemp)"
trap 'rm -f "$FILES" "$APPLIED"' EXIT

# Real, numbered migration files (excludes _TEMPLATE.sql), reduced to their
# version token (leading NNN or NNNa), sorted.
ls "$DIR" | grep -E '^[0-9]{3}[a-z]?_.*\.sql$' | sed -E 's/^([0-9]{3}[a-z]?)_.*/\1/' | sort > "$FILES"

# Applied set from the ledger (empty if the ledger table doesn't exist yet).
psql "$DB" -tAc "SELECT version FROM public.schema_migrations ORDER BY version;" 2>/dev/null \
  | sed '/^$/d' | sort > "$APPLIED" || true

echo "== $ENV : $(wc -l < "$APPLIED" | tr -d ' ') applied / $(wc -l < "$FILES" | tr -d ' ') files in repo =="
echo
echo "-- PENDING (in repo, NOT in ledger — apply these to $ENV) --"
comm -23 "$FILES" "$APPLIED" || true
echo
echo "-- GHOST (in ledger, NOT in repo — investigate) --"
comm -13 "$FILES" "$APPLIED" || true
