#!/usr/bin/env bash
# CI-time assertion: no public-schema RLS policy may call get_user_role(),
# get_user_org_id(), get_user_branch_id(), get_user_branch_ids() or auth.uid()
# *unwrapped*.
#
# Unwrapped, Postgres re-evaluates the call once per row. get_user_role() is
# `SELECT role FROM users WHERE id = auth.uid()`, so each call is a table lookup;
# across policies on every table this turned a 27-row users table into the hottest
# relation in the production database (94.9M sequential scans) and took the whole
# staff dashboard down on 2026-09-25. Wrapped as (SELECT fn()), the planner hoists
# it to an InitPlan and evaluates it once per query.
#
# Checked live against pg_policies rather than by grepping migration files:
# migration-225 was authored as a DO block emitting dynamic SQL, which a static
# lint cannot see at all.
#
# Connection is via standard libpq PG* env vars, matching scripts/migrate-apply.sh.
set -euo pipefail

: "${PGHOST:?PGHOST not set}"
: "${PGUSER:?PGUSER not set}"
: "${PGDATABASE:?PGDATABASE not set}"
export PGSSLMODE="${PGSSLMODE:-require}"

# Strategy: concatenate qual and with_check, delete every correctly-wrapped
# `( SELECT fn() ... )` occurrence, then look for any bare call left behind.
# Checking with_check matters — it carries the identical per-row penalty as qual,
# and the 2026-09-26 investigation scanned only qual.
read -r -d '' QUERY <<'SQL' || true
WITH pol AS (
  SELECT schemaname, tablename, policyname,
         coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
  FROM pg_policies
  WHERE schemaname = 'public'
),
stripped AS (
  SELECT schemaname, tablename, policyname,
         regexp_replace(
           expr,
           '\( *SELECT +(public\.)?(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids|auth\.uid)\(\)[^)]*\)',
           '',
           'gi'
         ) AS rest
  FROM pol
)
SELECT schemaname || '.' || tablename || ' :: ' || policyname
FROM stripped
WHERE rest ~* '(get_user_role|get_user_org_id|get_user_branch_id|get_user_branch_ids|auth\.uid)[[:space:]]*\('
ORDER BY 1;
SQL

echo "Checking RLS policies on $PGUSER@$PGHOST/$PGDATABASE for unwrapped helper calls..."

# Guard against a vacuous pass. The whole premise of this script is "cannot
# silently pass" — but it would still print OK and exit 0 if QUERY somehow came
# out empty (the `read -r -d '' ... || true` above swallows read failures) or if
# pg_policies legitimately returns zero rows for schemaname='public' (wrong
# database, wrong schema, or a stale search path). Zero policies inspected is
# not a pass; it's the check not having looked at anything.
POLICY_COUNT="$(psql -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")"

if [ "$POLICY_COUNT" -eq 0 ]; then
  echo ""
  echo "FAIL: found 0 policies in schema 'public' on $PGUSER@$PGHOST/$PGDATABASE."
  echo "This almost certainly means the check is connected to the wrong database"
  echo "or the wrong schema, not that RLS has no policies. Verify PGHOST/PGDATABASE."
  exit 1
fi

OFFENDERS="$(psql -v ON_ERROR_STOP=1 -tAc "$QUERY")"

if [ -n "$OFFENDERS" ]; then
  COUNT="$(printf '%s\n' "$OFFENDERS" | grep -c . || true)"
  echo ""
  echo "FAIL: $COUNT policy/policies call an RLS helper unwrapped:"
  # Read line-by-line: policy identifiers contain spaces (" :: "), so an
  # unquoted printf would word-split them into mangled output.
  while IFS= read -r line; do
    [ -n "$line" ] && echo "  $line"
  done <<< "$OFFENDERS"
  echo ""
  echo "Wrap each call so the planner hoists it to an InitPlan:"
  echo "  get_user_role()        ->  (SELECT get_user_role())"
  echo "  auth.uid()             ->  (SELECT auth.uid())"
  echo ""
  echo "Note: '= ANY ((SELECT fn()))' parses as ANY's subquery form. When fn()"
  echo "returns uuid[], cast it: '= ANY ((SELECT fn())::uuid[])'."
  echo ""
  echo "See supabase/migration-225-rls-initplan-sweep.sql for the established pattern."
  exit 1
fi

echo "OK: no unwrapped RLS helper calls found. Inspected $POLICY_COUNT policies in schema public."
