#!/usr/bin/env bash
# Shared helpers for the migration ledger scripts (migrate-apply.sh,
# migrate-status.sh). Sourced, never executed.
#
# These two scripts must agree exactly about which file maps to which ledger
# version and about what counts as a collision. They used to hold two copies of
# the filename regex with a comment asking the reader to keep them in sync;
# that is the same drift risk the collision guard below exists to catch, so the
# shared parts live here instead.

# Files numbered below this were baselined into the ledger as a group by
# migration-027 (some under non-matching version keys, e.g. the two -008-
# files were recorded as '008a'/'008b' — the filenames themselves don't
# carry that letter). Only 028+ are expected to self-record 1:1 with their
# own filename, so only scan those.
LEDGER_FLOOR=28

# A migration file may acknowledge that its version number is already taken in
# some ledger by a DIFFERENT migration. See ml_report_collisions below for why
# that is not just a comment.
LEDGER_COLLISION_ACK_MARKER='-- ledger-collision-ack:'

# The ledger read, as one query. Both scripts need version AND name — name is
# what makes "already applied" distinguishable from "that number means
# something else here". Pipe-separated because psql -F needs a single char and
# no name in either live ledger contains one (verified); ml_row_name below
# still handles a name that does.
ml_ledger_sql() {
  printf '%s' "SELECT version || '|' || coalesce(name, '') FROM public.schema_migrations ORDER BY version;"
}

ml_row_version() { printf '%s' "${1%%|*}"; }
ml_row_name()    { printf '%s' "${1#*|}"; }

# "migration-NNN[a]-some-slug.sql" -> version key "NNN[a]". Returns 1 for a
# filename that does not match, or one below the floor.
ml_file_version() {
  local base="$1"
  [[ "$base" =~ ^migration-([0-9]{3})([a-z]?)-(.*)\.sql$ ]] || return 1
  [ "$((10#${BASH_REMATCH[1]}))" -lt "$LEDGER_FLOOR" ] && return 1
  printf '%s' "${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
}

# Same filename -> the slug a correctly-recorded ledger row would carry.
ml_file_slug() {
  local base="$1"
  [[ "$base" =~ ^migration-([0-9]{3})([a-z]?)-(.*)\.sql$ ]] || return 1
  printf '%s' "${BASH_REMATCH[3]}"
}

ml_has_ack_marker() {
  grep -qF -- "$LEDGER_COLLISION_ACK_MARKER" "$1"
}

# Compare every repo migration file against the ledger rows it would be skipped
# by, and report the ones where the version matches but the NAME does not.
#
# This is the whole point of the guard. Both scripts decide "already applied"
# purely from the 3-digit version, so when two branches independently pick the
# same number, whichever one loses the race is skipped SILENTLY and CI stays
# green — the migration simply never ships and nobody is told. Comparing the
# ledger's recorded name against the filename's slug is what tells those two
# cases apart.
#
# Args: $1 = target label, $2 = migrations dir. Reads the LEDGER_NAME
# associative array (version -> recorded name), which the caller must have
# populated. Returns 0 when there is nothing unacknowledged, 1 otherwise.
#
# A file carrying LEDGER_COLLISION_ACK_MARKER in its header downgrades its own
# collision to a warning: someone looked at that specific number and wrote down
# why the skip is safe. Everything else fails closed — a migration that does not
# apply while the deploy reports success is the failure this prevents.
ml_report_collisions() {
  local target="$1" dir="$2"
  local -a unacked=() acked=()
  local f base version slug ledger_name

  while IFS= read -r f; do
    base="${f##*/}"
    version="$(ml_file_version "$base")" || continue
    [ -n "${LEDGER_NAME[$version]+x}" ] || continue
    ledger_name="${LEDGER_NAME[$version]}"
    # An empty recorded name carries no information to compare against, so it
    # cannot be evidence of a collision either way.
    [ -z "$ledger_name" ] && continue
    slug="$(ml_file_slug "$base")" || continue
    [ "$ledger_name" = "$slug" ] && continue

    if ml_has_ack_marker "$f"; then
      acked+=("$version|$ledger_name|$slug|$base")
    else
      unacked+=("$version|$ledger_name|$slug|$base")
    fi
  done < <(find "$dir" -maxdepth 1 -name 'migration-*.sql' | sort)

  local entry v n sl b
  for entry in "${acked[@]}"; do
    IFS='|' read -r v n sl b <<< "$entry"
    echo "WARNING: version $v is recorded in the $target ledger as \"$n\", but the repo's"
    echo "         version $v is $b (\"$sl\"), so that file will NOT be"
    echo "         applied to $target. It carries an explicit"
    echo "         '$LEDGER_COLLISION_ACK_MARKER' note — read it before trusting this."
  done

  [ "${#unacked[@]}" -eq 0 ] && return 0

  echo ""
  echo "FAIL: migration version collision against the $target ledger."
  for entry in "${unacked[@]}"; do
    IFS='|' read -r v n sl b <<< "$entry"
    echo ""
    echo "  version $v"
    echo "    ledger ($target) records: $n"
    echo "    repo file is:             $b (\"$sl\")"
    echo "    -> $b would be SKIPPED without ever being applied,"
    echo "       because version $v is already in the ledger under a different name."
  done
  echo ""
  echo "Two migrations picked the same number. Decide which this is:"
  echo "  - The file still needs to ship: give it a free version number above the"
  echo "    highest applied one, unless a later migration already supersedes it."
  echo "  - The skip is genuinely safe (superseded, or the same change recorded"
  echo "    under another version): add a line starting with"
  echo "    '$LEDGER_COLLISION_ACK_MARKER' to the file's header saying why."
  echo "Not acknowledging it is not an option — that is how one silently never ships."
  return 1
}
