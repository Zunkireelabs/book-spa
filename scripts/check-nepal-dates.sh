#!/usr/bin/env bash
# CI guard (ZNLY-385): the spa's day is the NEPAL day. Fails on
#   1. a UTC-style "today":   new Date().toISOString().slice(...) / .split(...) / .substring(...)   (UTC is still yesterday until 05:45 Nepal)
#   2. the literal 'Asia/Kathmandu' anywhere but src/utils/nepalTime.js   (import NEPAL_TZ, or call nepalToday()/nepalNow()/nepalDateOf()/addDays())
# in non-test source under src/. Justified exceptions go in scripts/nepal-dates.allow, one per line:  <file> <rule> <reason>
# (rule is "utc-today" or "tz-literal"; a line with no reason fails the check). Pure grep: no node, no DB.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW=scripts/nepal-dates.allow
HELPER=src/utils/nepalTime.js
fail=0

files() { grep -rlE "$1" src --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' 2>/dev/null | grep -vE '\.test\.|\.spec\.' | grep -v "^$HELPER$" || true; }

allowed() { # $1 file, $2 rule
  [ -f "$ALLOW" ] && grep -vE '^\s*(#|$)' "$ALLOW" | awk -v f="$1" -v r="$2" '$1==f && $2==r {found=1} END{exit !found}'
}

if [ -f "$ALLOW" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    reason=$(echo "$line" | cut -d' ' -f3- | tr -d '[:space:]')
    if [ -z "$reason" ]; then echo "FAIL: allow-list entry without a reason: $line"; fail=1; fi
  done < "$ALLOW"
fi

check() { # $1 rule, $2 regex, $3 advice
  for f in $(files "$2"); do
    allowed "$f" "$1" && continue
    echo "FAIL [$1] $f"
    grep -nE "$2" "$f" | grep -vE '^[0-9]+:\s*(//|\*|/\*)' | sed 's/^/    /' | cut -c1-160
    echo "    -> $3"
    fail=1
  done
}

check utc-today "new Date\(\)\.toISOString\(\)\.(slice|split|substring)" "use nepalToday() from src/utils/nepalTime (the UTC date is yesterday until 05:45 Nepal)"
check tz-literal "['\"]Asia/Kathmandu['\"]" "import NEPAL_TZ (or use nepalToday/nepalNow/nepalDateOf/addDays) from src/utils/nepalTime"

if [ "$fail" -eq 0 ]; then echo "OK: no UTC-style 'today' and no inline Asia/Kathmandu outside $HELPER"; fi
exit "$fail"
