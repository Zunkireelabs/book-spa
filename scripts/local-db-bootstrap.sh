#!/usr/bin/env bash
# Bootstraps the LOCAL OrbStack-hosted Supabase Postgres (started via `supabase start`) with
# this repo's schema, RLS policies, seed data, and every migration — in the same order documented
# in supabase/PROMOTION.md's "Bootstrapping a brand-new database" section.
#
# This never touches staging or production — it only runs against the local DB URL printed by
# `supabase status` (127.0.0.1:54322 by default).
#
# Usage:
#   supabase start                    # once, to bring up the local stack
#   ./scripts/local-db-bootstrap.sh   # apply schema + rls + seed + migrations
#
# To wipe and start over:
#   supabase db reset && ./scripts/local-db-bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_DIR="$REPO_ROOT/supabase"

DB_URL="$(supabase status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
if [ -z "$DB_URL" ]; then
  echo "Could not read DB_URL from 'supabase status' — is the local stack running? Try 'supabase start' first." >&2
  exit 1
fi

case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *)
    echo "Refusing to run: DB_URL does not look local (${DB_URL})." >&2
    exit 1
    ;;
esac

run_sql() {
  local file="$1"
  echo "==> Applying $(basename "$file")"
  # -1 wraps the whole file in one transaction, matching how the Supabase dashboard/MCP
  # apply_migration runs these — some migrations (e.g. 035) rely on that for ON COMMIT DROP temp
  # tables spanning multiple statements.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f "$file"
}

run_sql "$SUPABASE_DIR/schema.sql"
run_sql "$SUPABASE_DIR/rls.sql"

# schema.sql is a re-exported snapshot that already absorbed migration-002's tables/columns/RLS
# (with non-idempotent CREATE TYPE/CREATE POLICY statements that collide if migration-002 is
# replayed verbatim). This local-only file fills the one real gap: 3 trigger functions that
# staging/prod already have live via migration-002, but schema.sql's snapshot predates.
run_sql "$REPO_ROOT/scripts/local-only-supplemental-triggers.sql"

for f in $(ls "$SUPABASE_DIR"/migration-[0-9]*.sql | sort -V); do
  case "$(basename "$f")" in
    migration-002-*) echo "==> Skipping $(basename "$f") (superseded by schema.sql snapshot, see local-only-supplemental-triggers.sql)"; continue ;;
    migration-050-*) echo "==> Skipping $(basename "$f") (never shipped, see PROMOTION.md)"; continue ;;
  esac
  run_sql "$f"
done

# seed.sql runs LAST, not right after rls.sql as PROMOTION.md's bootstrap order states — it
# inserts branches.org_id, a column added by the multi-tenancy migrations (009/010), so it must
# come after them. PROMOTION.md's documented order predates that dependency.
run_sql "$SUPABASE_DIR/seed.sql"

echo "Local DB bootstrap complete. Studio: http://127.0.0.1:54323"
