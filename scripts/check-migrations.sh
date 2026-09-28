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

# Make sure the base ref is present locally, WITHOUT changing the clone's depth.
# This used to pass `--depth=1`, which re-shallowed an otherwise complete clone
# on every run: `git fetch --depth=1` writes `.git/shallow` even when the repo
# was full, and a shallow base ref has no merge base with HEAD. The symptom is
# `fatal: no merge base` from the `A...B` diff below — harmless-looking, and in
# CI it was masked by the ref already being present so the fetch was a no-op.
# Locally it broke every run. If the clone really is shallow (not how ci.yml
# checks out — it uses fetch-depth: 0 — but possible elsewhere), deepen it
# instead of shallowing further.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  git fetch origin "${BASE_REF#origin/}" --unshallow >/dev/null 2>&1 \
    || git fetch origin "${BASE_REF#origin/}" >/dev/null 2>&1 || true
else
  git fetch origin "${BASE_REF#origin/}" >/dev/null 2>&1 || true
fi

# Fail closed, part 1: no merge base means the `A...B` diff below cannot be
# computed at all. Previously that case printed "nothing to check" and exited
# 0 — a green check that inspected no migrations. For a guard whose entire job
# is to catch an unrecorded migration before it reaches production, silently
# passing is the worst available failure.
if ! git merge-base "$BASE_REF" HEAD >/dev/null 2>&1; then
  echo "FAIL: no merge base between $BASE_REF and HEAD."
  echo "      Cannot determine which migrations changed, so this guard cannot"
  echo "      verify anything. Refusing to report success."
  echo "      Likely cause: a shallow clone. Fetch full history"
  echo "      (actions/checkout with fetch-depth: 0), or run"
  echo "      'git fetch --unshallow' locally."
  exit 1
fi

# Fail closed, part 2: run the diff where its exit status is actually visible.
# `mapfile -t FILES < <(git diff ...)` reports mapfile's status, not git's, so
# a git failure inside the process substitution is invisible — `set -e` cannot
# see it and a trailing `|| true` changes nothing. Assigning through a command
# substitution in an `if` makes the status checkable, so any git failure other
# than the merge-base case above is also caught rather than being read as "no
# migrations changed".
if ! diff_out="$(git diff --name-only --diff-filter=AM "$BASE_REF"...HEAD -- 'supabase/migration-*.sql')"; then
  echo "FAIL: 'git diff $BASE_REF...HEAD' failed."
  echo "      Cannot determine which migrations changed. Refusing to report"
  echo "      success."
  exit 1
fi

mapfile -t FILES < <(printf '%s' "$diff_out" | grep -v '^[[:space:]]*$' || true)

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
