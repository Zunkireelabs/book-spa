#!/usr/bin/env bash
# ZNLY-353: pre-release schema-drift check. Compares the public schema of a TARGET database (normally production)
# with a REFERENCE database built from migrations only, and exits 1 if anything differs that is not on the allow-list.
# Works on macOS bash 3.2 (no mapfile, no associative arrays). Read-only: both sessions run with
# default_transaction_read_only=on and the snapshot is catalog SELECTs only (scripts/schema-drift.sql).
#
#   scripts/schema-drift.sh --target "$PROD_URL" --reference "$REFERENCE_URL"
#   TARGET_URL=... REFERENCE_URL=... scripts/schema-drift.sh
#   (with no --target / TARGET_URL the target is whatever the standard PG* env vars point at; same for REFERENCE_PG* is NOT
#    supported: the reference always needs --reference or REFERENCE_URL.)
# Options: --allow FILE (default scripts/schema-drift-allow.txt)   --keep DIR (keep the two snapshots there)
# Exit: 0 = no unexplained drift, 1 = unexplained drift, 2 = could not run.
# Allow-list line:  <kind>|<key>[|<detail prefix>]  # reason          (blank lines and lines starting with # are ignored)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ALLOW="$HERE/schema-drift-allow.txt"
TARGET="${TARGET_URL:-}"
REFERENCE="${REFERENCE_URL:-}"
KEEP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --reference) REFERENCE="$2"; shift 2 ;;
    --allow) ALLOW="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$REFERENCE" ] || { echo "need --reference <conninfo/URL> (a database built from migrations only)" >&2; exit 2; }

WORK="${KEEP:-$(mktemp -d)}"; mkdir -p "$WORK"
[ -n "$KEEP" ] || trap 'rm -rf "$WORK"' EXIT

snapshot() { # $1 = conninfo (empty = PG* env), $2 = output file
  if [ -n "$1" ]; then
    PGOPTIONS='-c default_transaction_read_only=on' psql "$1" -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/schema-drift.sql" > "$2.raw"
  else
    PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/schema-drift.sql" > "$2.raw"
  fi || return 1
  LC_ALL=C sort -u "$2.raw" > "$2"; rm -f "$2.raw"
}

snapshot "$TARGET" "$WORK/target.txt" || { echo "could not read the TARGET database" >&2; exit 2; }
snapshot "$REFERENCE" "$WORK/reference.txt" || { echo "could not read the REFERENCE database" >&2; exit 2; }
echo "Schema drift: TARGET ($(wc -l < "$WORK/target.txt" | tr -d ' ') facts) vs REFERENCE ($(wc -l < "$WORK/reference.txt" | tr -d ' ') facts)"

LC_ALL=C comm -23 "$WORK/reference.txt" "$WORK/target.txt" | sed 's/^/R\t/' > "$WORK/diff.txt"   # only in REFERENCE (migrations): missing from the target
LC_ALL=C comm -13 "$WORK/reference.txt" "$WORK/target.txt" | sed 's/^/T\t/' >> "$WORK/diff.txt"   # only in TARGET: extra on the target
[ -f "$ALLOW" ] || : > "$ALLOW.missing"
ALLOWFILE="$ALLOW"; [ -f "$ALLOW" ] || ALLOWFILE=/dev/null
rm -f "$ALLOW.missing"

awk -F'\t' -v allowfile="$ALLOWFILE" '
  BEGIN {
    n = 0
    while ((getline l < allowfile) > 0) {
      if (l ~ /^[ \t]*(#|$)/) continue
      reason = ""; i = index(l, " # ")
      if (i > 0) { reason = substr(l, i + 3); l = substr(l, 1, i - 1) }
      sub(/[ \t]+$/, "", l)
      n++; entry[n] = l; why[n] = reason; used[n] = 0
    }
    nentries = n
  }
  function allowed(line,   k) {
    for (k = 1; k <= nentries; k++)
      if (line == entry[k] || index(line, entry[k] "|") == 1) { used[k] = 1; return k }
    return 0
  }
  {
    side = $1; line = $2; split(line, p, "|"); kind = p[1]
    isnote = (kind ~ /-name$/)
    a = allowed(line)
    k = (isnote ? "note" : "fail")
    if (a) { k = "allowed" }
    cnt[kind "|" k]++
    kinds[kind] = 1
    rec[++r] = kind "\t" k "\t" side "\t" line "\t" (a ? why[a] : "")
  }
  END {
    nfail = 0; nnote = 0; nallow = 0
    nk = 0; for (x in kinds) order[++nk] = x
    # simple insertion sort of kinds for a stable report
    for (i = 2; i <= nk; i++) { v = order[i]; j = i - 1; while (j > 0 && order[j] > v) { order[j + 1] = order[j]; j-- } order[j + 1] = v }
    for (i = 1; i <= nk; i++) {
      kd = order[i]
      if (cnt[kd "|fail"] + cnt[kd "|allowed"] + cnt[kd "|note"] == 0) continue
      printf "\n== %s  (%d unexplained, %d allowed, %d note)\n", kd, cnt[kd "|fail"] + 0, cnt[kd "|allowed"] + 0, cnt[kd "|note"] + 0
      for (q = 1; q <= r; q++) {
        split(rec[q], f, "\t")
        if (f[1] != kd) continue
        mark = (f[2] == "fail" ? "  DRIFT " : (f[2] == "note" ? "  note  " : "  ok    "))
        who = (f[3] == "R" ? "migrations only: " : "target only:     ")
        printf "%s%s%s%s\n", mark, who, f[4], (f[5] != "" ? "   [allowed: " f[5] "]" : "")
        if (f[2] == "fail") nfail++; else if (f[2] == "note") nnote++; else nallow++
      }
    }
    for (k = 1; k <= nentries; k++) if (!used[k]) printf "\nWARNING: allow-list entry matches nothing (stale?): %s\n", entry[k]
    printf "\nSUMMARY: %d unexplained difference(s), %d allowed, %d name-only note(s)\n", nfail, nallow, nnote
    exit (nfail > 0 ? 1 : 0)
  }' "$WORK/diff.txt"
