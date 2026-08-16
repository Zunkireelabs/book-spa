#!/usr/bin/env bash
# Read-only: what's pending (in repo, not in ledger) vs ghost (in ledger, not
# in repo) for a given target database. Replaces the hand-maintained VALUES
# manifest in supabase/PROMOTION.md — this reads the live ledger instead, so
# it cannot go stale the way the manifest did (see the 2026-06-13 incident).
#
# Connection is via standard libpq PG* env vars (PGHOST/PGPORT/PGUSER/
# PGDATABASE/PGPASSWORD/PGSSLMODE) — see migrate-apply.sh for why (URI
# percent-encoding of special password characters is an easy footgun).
# Locally, if PGPASSWORD is unset, psql falls back to ~/.pgpass.
set -euo pipefail

TARGET="${1:?usage: migrate-status.sh <local|stage|prod>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${PGHOST:?PGHOST not set}"
: "${PGUSER:?PGUSER not set}"
: "${PGDATABASE:?PGDATABASE not set}"
export PGSSLMODE="${PGSSLMODE:-require}"

if ! psql -v ON_ERROR_STOP=1 -tAc "SELECT 1;" >/dev/null 2>&1; then
  echo "FAIL: could not connect to $TARGET database ($PGUSER@$PGHOST/$PGDATABASE)."
  exit 1
fi

mapfile -t FILE_VERSIONS < <(
  find "$REPO_ROOT/supabase" -maxdepth 1 -name 'migration-*.sql' -printf '%f\n' \
    | sed -E 's/^migration-([0-9]{3}[a-z]?)-.*\.sql$/\1/' \
    | sort
)

mapfile -t LEDGER_OUTPUT < <(
  psql -v ON_ERROR_STOP=1 -tAc \
    "SELECT version FROM public.schema_migrations ORDER BY version;" 2>&1
) || {
  if [[ "${LEDGER_OUTPUT[*]}" == *"does not exist"* ]]; then
    LEDGER_OUTPUT=()
  else
    printf '%s\n' "${LEDGER_OUTPUT[@]}"
    echo "FAIL: could not read ledger from $TARGET database."
    exit 1
  fi
}

mapfile -t LEDGER_VERSIONS < <(printf '%s\n' "${LEDGER_OUTPUT[@]}" | sed '/^$/d' | sort)

echo "=== $TARGET ($PGUSER@$PGHOST/$PGDATABASE) ==="
echo ""
echo "Pending (in repo, not applied):"
comm -23 <(printf '%s\n' "${FILE_VERSIONS[@]}") <(printf '%s\n' "${LEDGER_VERSIONS[@]}") | sed '/^$/d' | sed 's/^/  /'
echo ""
echo "Ghost (in ledger, no matching file — investigate):"
comm -13 <(printf '%s\n' "${FILE_VERSIONS[@]}") <(printf '%s\n' "${LEDGER_VERSIONS[@]}") | sed '/^$/d' | sed 's/^/  /'
