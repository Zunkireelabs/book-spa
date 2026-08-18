#!/usr/bin/env bash
# check-migrations.sh — CI guard against the #1 cause of migration ledger drift:
# a migration file that does NOT self-record into public.schema_migrations.
#
# Root problem this prevents: a migration applied by hand (dashboard/psql) but
# never recorded leaves the ledger behind the real schema. scripts/migrate-apply.sh
# then treats it as "pending" and re-runs it — if it's not idempotent, that fails
# and (fail-closed) blocks the next deploy. This is exactly how 13 migrations
# (045-047, 052-055, 058-063) went missing from this repo entirely before this
# guard existed — see each reconstructed file's header comment.
#
# What this checks, for every migration file ADDED/MODIFIED in the PR:
#   1) It contains  INSERT INTO public.schema_migrations (version, ...) VALUES ('<version>', ...)
#      where <version> is EXACTLY this file's own leading token (e.g. 052, 008a —
#      NOT the full filename; see supabase/migrations/_TEMPLATE.sql).
#   2) That INSERT uses ON CONFLICT DO NOTHING (idempotent — safe to re-run/replay).
#
# Usage:
#   BASE_REF=origin/stage scripts/check-migrations.sh          # compare vs a base
#   scripts/check-migrations.sh <base-ref>                     # base as an arg
#   scripts/check-migrations.sh --all                          # check EVERY numbered file (repo audit)
#
# In CI, BASE_REF is set to origin/<PR base branch>. Locally, defaults to origin/stage.
set -euo pipefail

# Grandfather floor: the self-record convention was formalized when this repo's
# migrations moved into supabase/migrations/ and the ledger/scripts were added
# (2026-08). 051 was the last migration to exist as a file before that point;
# 052 and up are enforced. Below 052 (including the 13 reconstructed historical
# files 045-047/052-055/058-063 that land IN this same change) predates or is
# part of introducing the convention itself.
FLOOR=52

DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"

# Resolve which files to check.
MODE="diff"
BASE="${BASE_REF:-}"
if [ "${1:-}" = "--all" ]; then
  MODE="all"
elif [ -n "${1:-}" ]; then
  BASE="$1"
fi
[ -z "$BASE" ] && BASE="origin/stage"

LIST="$(mktemp)"; trap 'rm -f "$LIST"' EXIT

if [ "$MODE" = "all" ]; then
  ls "$DIR" | grep -E '^[0-9]{3}[a-z]?_.*\.sql$' | sed "s#^#supabase/migrations/#" > "$LIST"
else
  # Added or modified (not deleted) migration files on this PR branch vs the base.
  git diff --name-only --diff-filter=AM "${BASE}...HEAD" -- supabase/migrations/ 2>/dev/null \
    | grep -E 'supabase/migrations/[0-9]{3}[a-z]?_.*\.sql$' > "$LIST" || true
fi

if [ ! -s "$LIST" ]; then
  echo "✓ migration guard: no added/modified migration files to check (base=$BASE)."
  exit 0
fi

FAIL=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  [ -f "$path" ] || continue                       # skip deletions/renames-away
  file="$(basename "$path")"
  [ "$file" = "_TEMPLATE.sql" ] && continue

  version="$(echo "$file" | sed -E 's/^([0-9]{3}[a-z]?)_.*/\1/')"
  # Grandfather: skip pre-floor migrations, comparing on the NUMERIC part only
  # (strips any trailing letter, e.g. 008a -> 008) since floor is a plain integer.
  num="$(echo "$version" | sed -E 's/^0*([0-9]+).*/\1/')"
  if [ "$num" -lt "$FLOOR" ] 2>/dev/null; then
    continue
  fi

  # 1) self-record present with THIS file's exact version token? Flatten to a
  # single line first — real files in this repo routinely split
  # "INSERT INTO ... (version, name)" and "VALUES (...)" across two lines
  # (e.g. 029_discount-request-workflow.sql), which a plain per-line grep -E
  # would miss entirely.
  FLAT="$(tr '\n' ' ' < "$path")"
  if ! echo "$FLAT" | grep -Eq "schema_migrations[[:space:]]*\(version(,[[:space:]]*name)?\)[[:space:]]*VALUES[[:space:]]*\([[:space:]]*'${version}'"; then
    echo "✗ $file — MISSING self-record line for version '${version}'."
    echo "    Add before its final COMMIT;:"
    echo "      INSERT INTO public.schema_migrations (version, name) VALUES ('${version}', '<short-name>')"
    echo "        ON CONFLICT (version) DO NOTHING;"
    FAIL=1
    continue
  fi

  # 2) idempotent insert (ON CONFLICT DO NOTHING somewhere in the file)?
  if ! grep -Eiq 'ON CONFLICT[[:space:]]*\(version\)[[:space:]]*DO NOTHING' "$path"; then
    echo "✗ $file — self-record must be idempotent: use ON CONFLICT (version) DO NOTHING."
    FAIL=1
    continue
  fi

  echo "✓ $file — self-records correctly."
done < "$LIST"

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "Migration guard FAILED. Every migration numbered >= $FLOOR must self-record in"
  echo "the ledger (public.schema_migrations) using its own exact version token — see"
  echo "supabase/migrations/_TEMPLATE.sql. This is what keeps scripts/migrate-apply.sh"
  echo "from re-running already-applied migrations. Fix the file(s) above."
  exit 1
fi

echo
echo "✓ migration guard passed."
