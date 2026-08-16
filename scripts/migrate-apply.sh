#!/usr/bin/env bash
# Apply all pending supabase/migration-*.sql files to a target database, in
# version order, inside a single psql session guarded by an advisory lock.
# Every migration file self-wraps in BEGIN/COMMIT and self-records into
# public.schema_migrations with ON CONFLICT (version) DO NOTHING (enforced by
# scripts/check-migrations.sh in CI), so a partial failure is safe to re-run —
# already-committed files simply no-op on retry.
set -euo pipefail

TARGET="${1:?usage: migrate-apply.sh <local|stage|prod> [--dry-run]}"
DRY_RUN="${2:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_KEY=7834521099

case "$TARGET" in
  local) DB_URL="${LOCAL_DB_URL:?LOCAL_DB_URL not set}" ;;
  stage) DB_URL="${STAGE_DB_URL:?STAGE_DB_URL not set}" ;;
  prod)  DB_URL="${PROD_DB_URL:?PROD_DB_URL not set}" ;;
  *) echo "unknown target '$TARGET' (expected local|stage|prod)"; exit 1 ;;
esac

echo "Checking connectivity to $TARGET..."
if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT 1;" >/dev/null 2>&1; then
  echo "FAIL: could not connect to $TARGET database. Aborting — will not assume an empty ledger."
  exit 1
fi

declare -A APPLIED
LEDGER_ERR=""
LEDGER_OUT="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT version FROM public.schema_migrations ORDER BY version;" 2>&1)" || LEDGER_ERR="1"

if [ -n "$LEDGER_ERR" ]; then
  if [[ "$LEDGER_OUT" == *"does not exist"* ]]; then
    echo "No schema_migrations table yet — treating ledger as empty."
  else
    echo "$LEDGER_OUT"
    echo "FAIL: could not read ledger from $TARGET database."
    exit 1
  fi
else
  while IFS= read -r v; do
    [ -n "$v" ] && APPLIED["$v"]=1
  done <<< "$LEDGER_OUT"
fi

PENDING=()
while IFS= read -r f; do
  base="$(basename "$f")"
  [[ "$base" =~ ^migration-([0-9]{3}[a-z]?)-.*\.sql$ ]] || continue
  version="${BASH_REMATCH[1]}"
  if [ -z "${APPLIED[$version]+x}" ]; then
    PENDING+=("$f")
  fi
done < <(find "$REPO_ROOT/supabase" -maxdepth 1 -name 'migration-*.sql' | sort)

if [ "${#PENDING[@]}" -eq 0 ]; then
  echo "$TARGET is up to date — nothing pending."
  exit 0
fi

echo "Pending for $TARGET:"
printf '  %s\n' "${PENDING[@]}"

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "Dry run — not applying."
  exit 0
fi

SESSION_FILE="$(mktemp)"
trap 'rm -f "$SESSION_FILE"' EXIT

{
  echo "SELECT pg_advisory_lock($LOCK_KEY);"
  for f in "${PENDING[@]}"; do
    echo "\\echo Applying $(basename "$f")"
    echo "\\i $f"
  done
  echo "SELECT pg_advisory_unlock($LOCK_KEY);"
} > "$SESSION_FILE"

psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SESSION_FILE"
echo "Applied ${#PENDING[@]} migration(s) to $TARGET."
