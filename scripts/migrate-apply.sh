#!/usr/bin/env bash
# Apply all pending supabase/migration-*.sql files to a target database, in
# version order, inside a single psql session guarded by an advisory lock.
# Every migration file self-wraps in BEGIN/COMMIT and self-records into
# public.schema_migrations with ON CONFLICT (version) DO NOTHING (enforced by
# scripts/check-migrations.sh in CI), so a partial failure is safe to re-run —
# already-committed files simply no-op on retry.
#
# Connection is via standard libpq PG* env vars (PGHOST/PGPORT/PGUSER/
# PGDATABASE/PGPASSWORD/PGSSLMODE), not a connection-string secret — a URI
# requires percent-encoding any special character in the password, which is
# an easy way to silently mis-parse the host. Locally, if PGPASSWORD is
# unset, psql falls back to ~/.pgpass automatically.
set -euo pipefail

TARGET="${1:?usage: migrate-apply.sh <local|stage|prod> [--dry-run]}"
DRY_RUN="${2:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_KEY=7834521099
# Filename parsing, LEDGER_FLOOR and the version-collision guard are shared with
# migrate-status.sh so the two can never disagree about what maps to what.
# shellcheck source=scripts/lib/migration-ledger.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/migration-ledger.sh"

: "${PGHOST:?PGHOST not set}"
: "${PGUSER:?PGUSER not set}"
: "${PGDATABASE:?PGDATABASE not set}"
export PGSSLMODE="${PGSSLMODE:-require}"

echo "Checking connectivity to $TARGET ($PGUSER@$PGHOST/$PGDATABASE)..."
CONNECT_ERR="$(psql -v ON_ERROR_STOP=1 -tAc "SELECT 1;" 2>&1 >/dev/null)" || {
  echo "$CONNECT_ERR"
  echo "FAIL: could not connect to $TARGET database. Aborting — will not assume an empty ledger."
  exit 1
}

declare -A APPLIED
declare -A LEDGER_NAME
LEDGER_ERR=""
LEDGER_OUT="$(psql -v ON_ERROR_STOP=1 -tAc "$(ml_ledger_sql)" 2>&1)" || LEDGER_ERR="1"

if [ -n "$LEDGER_ERR" ]; then
  if [[ "$LEDGER_OUT" == *"does not exist"* ]]; then
    echo "No schema_migrations table yet — treating ledger as empty."
  else
    echo "$LEDGER_OUT"
    echo "FAIL: could not read ledger from $TARGET database."
    exit 1
  fi
else
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    v="$(ml_row_version "$row")"
    APPLIED["$v"]=1
    LEDGER_NAME["$v"]="$(ml_row_name "$row")"
  done <<< "$LEDGER_OUT"
fi

# Before deciding what is pending: a version that IS in the ledger under a
# different name means the matching repo file is about to be skipped silently.
# Fail here rather than reporting a successful deploy that shipped nothing.
ml_report_collisions "$TARGET" "$REPO_ROOT/supabase" || exit 1

PENDING=()
while IFS= read -r f; do
  version="$(ml_file_version "$(basename "$f")")" || continue
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

psql -v ON_ERROR_STOP=1 -f "$SESSION_FILE"
echo "Applied ${#PENDING[@]} migration(s) to $TARGET."
