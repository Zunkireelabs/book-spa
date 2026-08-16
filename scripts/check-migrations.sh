#!/usr/bin/env bash
# CI-time lint: every added/modified supabase/migration-*.sql file (numbered
# >= 028, the first migration after the schema_migrations ledger was created
# in migration-027) must self-record via
#   INSERT INTO public.schema_migrations (version, ...) VALUES ('NNN', ...)
#   ON CONFLICT (version) DO NOTHING;
# with a version matching its own filename. No DB access — pure git diff + grep.
set -euo pipefail

BASE_REF="${1:?usage: check-migrations.sh <base-ref>}"
LEDGER_FLOOR=28

git fetch origin "${BASE_REF#origin/}" --depth=1 >/dev/null 2>&1 || true

mapfile -t FILES < <(git diff --name-only --diff-filter=AM "$BASE_REF"...HEAD -- 'supabase/migration-*.sql' || true)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "No migration files added or modified — nothing to check."
  exit 0
fi

fail=0
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  if [[ ! "$base" =~ ^migration-([0-9]{3})([a-z]?)-.+\.sql$ ]]; then
    echo "SKIP: $f (doesn't match migration-NNN[a-z]?-slug.sql, not ledger-tracked)"
    continue
  fi

  num="${BASH_REMATCH[1]}"
  suffix="${BASH_REMATCH[2]}"
  version="${num}${suffix}"
  num10=$((10#$num))

  if [ "$num10" -lt "$LEDGER_FLOOR" ]; then
    echo "SKIP: $f (pre-ledger, floor is $LEDGER_FLOOR)"
    continue
  fi

  if ! grep -q "INSERT INTO public.schema_migrations" "$f"; then
    echo "FAIL: $f does not self-record into public.schema_migrations"
    fail=1
    continue
  fi

  if ! grep -q "ON CONFLICT (version) DO NOTHING" "$f"; then
    echo "FAIL: $f self-records but is missing 'ON CONFLICT (version) DO NOTHING' (must be idempotent)"
    fail=1
    continue
  fi

  if ! grep -qE "VALUES[[:space:]]*\('${version}'" "$f"; then
    echo "FAIL: $f self-records but the version string doesn't match its own filename (expected '${version}')"
    fail=1
    continue
  fi

  echo "OK: $f (version ${version})"
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "See supabase/migration-_TEMPLATE.sql and supabase/PROMOTION.md for the required pattern."
  exit 1
fi
