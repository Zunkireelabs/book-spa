# Zennly production perf audit — findings, 2026-09-27

Companion: `tasks/HANDOFF-zennly-perf-audit.md` (context, blockers, PR merge order).
Incident: 2026-09-26 ~19:00–20:30 NPT, prod CPU ~98% on nano, 503s, fixed by
compute bump to MICRO. Frame: compute stays MICRO — find and remove the
excess work, don't buy headroom (~33 bookings/day should be trivial for a
micro instance).

Findings ranked by measured/estimated impact. Each is labelled CONFIRMED
(measured) or HYPOTHESIS (reasoned, not yet measured) — do not read a
HYPOTHESIS as settled.

---

## 1. `cron.job_run_details` unpruned + reaper cadence — HYPOTHESIS (mechanism CONFIRMED, fix not yet applied)

**Evidence:** `pg_stat_statements`, prod, 18h02m idle window since
2026-09-26 14:37:42 UTC restart. `insert into cron.job_run_details`: 1,514
calls / 81,923ms / 54ms mean. One `update cron.job_run_details` averaging
8,032ms. Combined ≈ 15% of all execution time in the window.
`pg_stat_user_tables`: `job_run_details` seq-scanned with 18,568 rows/scan,
table at 18,961 rows back to 2026-06-13 (3,640kB). Job 4
(`outreach_drain_outbox`, every 5min) contributes ~8,838 of those rows; job 6
(the aborted-backend reaper, every minute) added 1,134 in 18h and is
succeeding-but-finding-nothing on every run.

**Root cause:** no pruning job on `cron.job_run_details`, and the reaper
(migration 229) runs every 60s regardless of whether there's anything to
reap.

**Proposed fix:** add a pruning migration (e.g. delete rows older than N
days, or cap to last M runs) and consider lowering the reaper's frequency
once H7/H8 are addressed (229's own header should carry a "remove once
H7/H8 are fixed" note — currently missing, see handoff doc).

**Expected impact:** ~15% of idle exec time, zero user-facing risk — pure
bookkeeping table.

**Status:** not yet implemented. Cheapest, highest-confidence item on this
list — do first.

---

## 2. Realtime WAL polling — HYPOTHESIS (share CONFIRMED, cause not diagnosed)

**Evidence:** `SELECT wal->>...` — 43,773 calls / 276,828ms / 6.32ms mean,
~40 calls/min constant over the whole 18h window. **37.7% of all execution
time** — the single largest line item, larger than every app query
combined.

**What's ruled out:** the Realtime publication is already narrow — only
`public.bookings` and `public.notifications` are published, both
replication slots active with 56-byte lag (not falling behind). So this
isn't a runaway/unbounded subscription; it's fixed polling overhead that
exists regardless of load.

**Not yet answered:** whether this cadence is Supabase Realtime's own
internal polling baseline (fixed cost of running Realtime at all, not
something the app controls) or whether it scales with the number of active
client subscriptions (4 concurrent channels in the app:
`usePersistentNotifications.js:40`, `branch-staff-dashboard/index.jsx:235`,
`branch-manager-dashboard/index.jsx:217`, `RealtimeBookingFeed.jsx:48` — 3 of
which subscribe to `bookings` changes simultaneously). If it's the latter,
consolidating those 3 `bookings` subscriptions into one shared channel is a
plausible fix.

**Proposed fix:** measure whether `wal->>` call rate changes with 0 vs N
connected Realtime clients on staging before touching anything. If it's
subscription-count-sensitive, consolidate the 3 `bookings` subscribers into
one channel + local fan-out. If it's fixed Supabase-side overhead, this
finding closes as "not ours to fix."

**Expected impact:** unknown until measured — potentially the single
biggest lever, but could also be a fixed floor with zero addressable slack.

**Status:** needs a staging experiment before any code change.

---

## 3. `bookings`/`customers` full-table scans — HYPOTHESIS (occurrence CONFIRMED, query not yet identified)

**Evidence:** `pg_stat_user_tables`, same window. `bookings`: 187 seq
scans at 5,958 rows/scan (full table) despite 63,919 healthy index scans
elsewhere on the same table. `customers`: 95 seq scans at 2,005 rows/scan
(full table) despite 598 healthy index scans. Both tables otherwise show
normal index usage, so this isn't "no index exists" — some specific query
path is bypassing the index that everything else uses.

**Not yet identified:** which query. Needs `pg_stat_statements` cross-
referenced against `EXPLAIN` on the app's `bookings`/`customers` read paths
in `src/services/api.js`, filtering for `Seq Scan` in the plan. Common
culprits worth checking first: a filter on a computed/expression column
(e.g. a date-truncated column) that defeats an index, or an `OR` across
columns that isn't covered by a single composite index.

**Expected impact:** unknown until the query is found — 187/95 scans over
18h is not huge in absolute terms, but each one reads the whole table, so
it may fully explain the CPU cost even at low call count.

**Status:** needs query identification before a fix can be proposed.

---

## 4. Idle-tab polling fan-out (`useAutoRefresh` + raw intervals + Realtime channels) — HYPOTHESIS (mechanism CONFIRMED via code, demoted by measurement)

**Evidence (code, confirmed):** `src/hooks/useAutoRefresh.js` has 11 call
sites (dashboard panels, calendar, attendance, memberships, discounts,
transfer report, customer account), all skipping ticks only on
`document.hidden` — a visible-but-unattended tab still polls. Intervals
range 30s–120s. Plus raw `setInterval` polls (discount notifs, bookings
view panel, 2× 30s connection probes on login/org-finder). Plus 4
concurrent Realtime channels (3 on `bookings`). A single calendar refresh
tick (`refreshCalendar`) fans out 3 queries via `Promise.all`
(`getCalendarBookings`, `fetchAttendance`, `fetchBlocksForRange`), and
`getCalendarBookings` is the query with the ~671-node RLS plan. Rough
order of magnitude: 10–20 queries/min per idle open tab; ~10 staff tabs
open all day ≈ 100–200 queries/min of pure idle load.

**Evidence (measured, contradicts the severity estimate above):** prod
`pg_stat_statements`, idle overnight window — all app queries combined
(payments + bookings + attendance + rooms) are only **~10.6%** of total
execution time. The two actually-dominant costs (Realtime, cron) were not
in the original hypothesis at all.

**Caveat that keeps this open rather than closed:** the measurement window
is Nepal overnight, near-idle by definition — it cannot see what happens
when 10 staff tabs are actually open simultaneously during business hours,
which is exactly the scenario this hypothesis describes. Demoted from lead
hypothesis to "real but unproven at the scale that matters," not
falsified.

**Proposed fix (unchanged from original plan, in increasing order of
effort):** gate `useAutoRefresh` on tab focus, not just `!document.hidden`;
back off after N idle ticks with no data change; consolidate panels
polling the same tables into one shared fetch; replace polling with the
Realtime subscriptions that already exist for `bookings`; lengthen
intervals for panels nobody watches minute-to-minute (transfer report,
memberships, wallet usage); drop the duplicated 30s connection probe
(login + org-finder each run one — PR #344 already gives a better 503
story, making the probe redundant).

**Status:** needs a business-hours re-measurement (or a staging load test
at prod scale, per Phase 3 of the audit plan) before ranking this above or
below items 1–3. Do not skip straight to shipping the fix on the strength
of the code-level estimate alone — that estimate has already been wrong
once (it was the original lead call).

---

## 5. RLS helper call-count on `users`/`branches` — HYPOTHESIS (call count CONFIRMED, cost is cheap per-call)

**Evidence:** `users`: 101,768 seq scans / 0 idx scans, 13 rows/scan.
`branches`: 64,988 seq scans / 4 idx scans, 6 rows/scan. Both tables are
small enough that a seq scan is the objectively correct plan — this is not
a missing-index problem, and each individual scan is cheap.

**What's open:** the *call count* itself. `get_user_role()` /
`get_user_org_id()` still fire many times per request even after
migration 225 wrapped RLS helper calls in `(SELECT ...)` InitPlan style,
which should have made each one evaluate once per query rather than once
per row. A ~95-100k call count over 18h on 2 tiny tables suggests either
many concurrent requests (plausible — pg_cron + Realtime + idle polling
combined already account for most traffic) or InitPlan de-duplication not
working the way 225 intended.

**Proposed fix:** none yet — this needs `EXPLAIN` on a representative
query to check whether `get_user_role()`/`get_user_org_id()` appear as a
single InitPlan or are repeated across multiple policies on the same
query (225's header covers 53 tables / 163 policies — if a query touches
several of those tables, the same helper could legitimately appear once
per table's policy, which would be working as designed rather than a bug).

**Expected impact:** low priority — the per-call cost is already cheap
(small tables). Worth understanding but not worth fixing ahead of items
1–3.

**Status:** open, low priority.

---

## 6. H7 — migrations 224/225 traded execution cost for planning cost — HYPOTHESIS, currently UNTESTABLE at scale

**Evidence for:** one ad hoc `EXPLAIN ANALYZE` on `public.bookings`,
prod MICRO, idle: Planning 4.139ms, Execution 2.762ms, 48+ nested
InitPlans in the plan — planning exceeds execution on this single sample.
Migration 225's own header documents the problem it was fixing:
`public.users` at 94.9M seq scans / 858M tuples read *before* the InitPlan
wrapping — so 224/225 were the right fix for the execution-side cost that
existed before them.

**Why it can't be tested at scale right now:**
`pg_stat_statements.track_planning = off` on prod, so `total_plan_time`
reads 0.0 for every query in the measured window — planning cost is
invisible to the aggregate numbers above. The one EXPLAIN is a single
data point, not a distribution.

**Proposed fix:** turn on `track_planning` (session-level `SET`, or a
config change if it needs to be persistent — confirm which before
proposing a migration, since this is a prod config change and needs the
read-only/no-DDL constraint respected) and re-run the Q2 query from the
audit plan (`SUM(total_plan_time)` vs `SUM(total_exec_time)`, aggregate,
not per-query) to get a real percentage.

**Status:** blocked on prod config access. Not yet actionable.

---

## 7. H1 — client-side retry amplification — FALSIFIED (our code); one sub-question still open

**Evidence:** `src/lib/supabaseRetry.js` (read on `origin/main`) retries
only `25P02`, `40001`, `40P01`. Max 2 retries. 150ms base delay + 100ms
jitter. `503` is explicitly not retried; network errors and timeouts are
explicitly excluded. Worst case per user action from our own retry logic:
3 requests total, jittered. This cannot have amplified a 503 storm — the
retried codes don't overlap 503 at all.

**Still open:** whether `postgrest-js`/`supabase-js` has its own built-in
retry on 503 for GET/HEAD requests (the original incident handoff claimed
up to 4×). If the library retries and our wrapper doesn't need to, the
amplification — if it exists at all — is entirely library-side, not ours.
Needs checking against the pinned version in `node_modules` (or the
library's changelog/source) before this closes fully.

**Proposed fix, if the sub-question confirms library-side retry:**
disable the library's 503 retry — retrying a 503 asks an already-overloaded
server to do more work, which is exactly backwards.

**Status:** effectively closed on our side. One cheap verification left
before writing it off entirely.

---

## Open PRs (context, not new findings — see handoff doc for full merge/conflict detail)

`#343` (idle-timeout revert + reaper + 25P03 retry), `#342` (health-check
probe fix + RLS runbook), `#344` (graceful DB-unavailable degradation).
None should close — the compute fix removed urgency, not the underlying
defects. Merge order: `#343` → `#342` → `#344`.

## Not yet done (blocked, see handoff doc "What's still blocked")

Read-only audit role + `AUDIT_DATABASE_URL`, Pro-org dashboard access,
Postgres ERROR-severity logging, staging load test at prod-scale data,
business-hours re-measurement of every "idle window" number above. No
finding above should be treated as final until re-measured during business
hours — the current baseline is Nepal overnight, near-idle, and already
demoted one hypothesis (H8) that looked dominant from code alone.
