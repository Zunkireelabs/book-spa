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
# See LEDGER_FLOOR comment in migrate-apply.sh — pre-028 files don't map
# 1:1 to their ledger version keys (baselined as a group by migration-027).
LEDGER_FLOOR=28

: "${PGHOST:?PGHOST not set}"
: "${PGUSER:?PGUSER not set}"
: "${PGDATABASE:?PGDATABASE not set}"
export PGSSLMODE="${PGSSLMODE:-require}"

if ! psql -v ON_ERROR_STOP=1 -tAc "SELECT 1;" >/dev/null 2>&1; then
  echo "FAIL: could not connect to $TARGET database ($PGUSER@$PGHOST/$PGDATABASE)."
  exit 1
fi

# Uses the same filename parsing as migrate-apply.sh's PENDING loop (same regex,
# same LEDGER_FLOOR test) so status and apply can never disagree about which file
# maps to which ledger version. apply.sh keeps the paths, this keeps the version
# strings — that is the only difference.
#
# This used to be `find ... -printf '%f\n'`. `-printf` is a GNU findutils
# extension that BSD find (macOS) does not have, so on a Mac the find failed,
# FILE_VERSIONS came back EMPTY, and the `comm` below then reported "Pending:
# (none)" plus every applied migration as a "ghost" — i.e. it told you the
# target was up to date while it was actually several migrations behind. CI runs
# on ubuntu so it never saw this; only local pre-promotion checks were affected,
# which is exactly when this script is trusted most. Same fail-open shape as the
# 2026-06-13 stale-manifest incident this script was written to prevent.
mapfile -t FILE_VERSIONS < <(
  while IFS= read -r f; do
    base="${f##*/}"
    [[ "$base" =~ ^migration-([0-9]{3})([a-z]?)-.*\.sql$ ]] || continue
    num10=$((10#${BASH_REMATCH[1]}))
    [ "$num10" -lt "$LEDGER_FLOOR" ] && continue
    printf '%s\n' "${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
  done < <(find "$REPO_ROOT/supabase" -maxdepth 1 -name 'migration-*.sql') | sort
)

# Fail closed. The repo always carries migration files at or above the floor, so
# an empty list means the scan itself broke (missing directory, find behaving
# unexpectedly) — never that nothing is pending. Reporting "up to date" off a
# broken scan is the failure mode that makes this whole script untrustworthy.
if [ "${#FILE_VERSIONS[@]}" -eq 0 ]; then
  echo "FAIL: found no supabase/migration-*.sql files at or above version $LEDGER_FLOOR"
  echo "in $REPO_ROOT/supabase. The scan is broken — refusing to report a status."
  exit 1
fi

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

# Apply LEDGER_FLOOR to the ledger side too, not just the file side. Versions
# 001–027 were baselined as a group by migration-027 and have no 1:1 file, so
# without this they were reported as "ghosts" on every single run — 27 lines of
# guaranteed false positives above any real one, and a permanently-noisy alarm is
# one nobody reads.
#
# Excluded, NOT hidden: the count is reported below the Ghost section. The
# baselined range is not contiguous (013 is absent from prod's ledger, for
# instance), so a filter that merely swallowed everything under 28 would silently
# eat a genuinely spurious low version. A count that moves unexpectedly is still
# something you can see.
#
# Versions that do not parse as NNN[a] are deliberately kept rather than counted —
# a malformed ledger key is exactly the kind of thing the Ghost section is for.
mapfile -t LEDGER_VERSIONS < <(
  while IFS= read -r v; do
    [[ "$v" =~ ^([0-9]{3})([a-z]?)$ ]] || { [ -n "$v" ] && printf '%s\n' "$v"; continue; }
    [ "$((10#${BASH_REMATCH[1]}))" -lt "$LEDGER_FLOOR" ] && continue
    printf '%s\n' "$v"
  done < <(printf '%s\n' "${LEDGER_OUTPUT[@]}" | sed '/^$/d') | sort
)

# Derived in the parent shell by subtraction, not counted inside the loop above:
# that loop runs in a process-substitution subshell, so a counter incremented
# there would not survive back out here.
LEDGER_TOTAL="$(printf '%s\n' "${LEDGER_OUTPUT[@]}" | sed '/^$/d' | grep -c '' || true)"
BASELINED_EXCLUDED=$(( LEDGER_TOTAL - ${#LEDGER_VERSIONS[@]} ))

echo "=== $TARGET ($PGUSER@$PGHOST/$PGDATABASE) ==="
echo ""
echo "Pending (in repo, not applied):"
comm -23 <(printf '%s\n' "${FILE_VERSIONS[@]}") <(printf '%s\n' "${LEDGER_VERSIONS[@]}") | sed '/^$/d' | sed 's/^/  /'
echo ""
echo "Ghost (in ledger, no matching file — investigate):"
comm -13 <(printf '%s\n' "${FILE_VERSIONS[@]}") <(printf '%s\n' "${LEDGER_VERSIONS[@]}") | sed '/^$/d' | sed 's/^/  /'
echo ""
echo "Excluded from the ghost check: $BASELINED_EXCLUDED pre-0$LEDGER_FLOOR ledger entries"
echo "baselined as a group by migration-027. Expected — but if this number moves,"
echo "something inserted a low version and the check above would not have shown it."
