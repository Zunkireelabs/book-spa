# Handoff: Zennly production perf audit

> Supersedes the original briefing note of the same name (Sadin -> Anish: what
> happened, access, guardrails, and a prompt to paste). That version is preserved
> in git history at `stage:80ee4fd -- tasks/HANDOFF-zennly-perf-audit.md`. Its
> durable parts are carried forward below under "Frame" and "Hard rules"; the
> rest was setup instructions that have since been executed.

Started: 2026-09-27. Owner: Claude (this session), for @sthasadin.

## Incident that triggered this

2026-09-26 ~19:00–20:30 NPT: Nuad Thai staff locked out ~90 min. Prod Supabase
(`pmbvogiphelmpjdalmtv`, nano/t4g, ap-northeast-2) CPU ~98%; PostgREST 503;
Auth/Storage flapping Unhealthy. DB reboot did not help. Moving to Pro org and
bumping compute to MICRO fixed it immediately. Disk was 6% — not a factor.

## Frame (per @sthasadin, do not relitigate)

Compute stays at **MICRO**. One tenant (Nuad Thai Spa), ~1,000 bookings/month
(~33/day), ~41 therapists. That load should be trivial for MICRO. If it
saturated a nano, the app/DB is doing far more work than data volume
justifies — find and remove that work, don't buy headroom.

## Status of each hypothesis (2026-09-27)

- **H1 (client retry amplification)** — FALSIFIED on our side.
  `src/lib/supabaseRetry.js` retries only `25P02`, `40001`, `40P01`; max 2
  retries, 150ms base + 100ms jitter. `503` and network errors/timeouts are
  explicitly excluded. Codes don't overlap a 503 storm. **Still unchecked:**
  whether `postgrest-js`/`supabase-js` itself retries 503 on GET/HEAD — verify
  against the pinned version in `node_modules` before fully closing this out.
- **H7 (migrations 224/225 moved cost from execution to planning)** —
  UNTESTABLE via `pg_stat_statements` right now (`track_planning = off`, so
  `total_plan_time` reads 0 for everything). One ad hoc `EXPLAIN ANALYZE` on
  `public.bookings` on idle MICRO prod supports it: planning 4.139ms >
  execution 2.762ms, 48+ nested InitPlans. Needs `track_planning = on` (or
  more targeted EXPLAINs) to become a real measurement instead of one sample.
- **H8 (idle-tab polling fan-out, `useAutoRefresh` × 11 call sites + raw
  `setInterval`s + 4 concurrent Realtime channels)** — DEMOTED as the lead.
  It's real (~10–20 queries/min/idle tab, 100–200/min across ~10 staff tabs)
  but the measured prod baseline shows app queries are only ~10.6% of exec
  time at idle. Still worth fixing (cheap, zero DB risk) and still unmeasured
  during business hours — the idle-window numbers understate it.
- **H6 (RLS helper call-count hotspot)** — PARTIALLY OPEN. `users` and
  `branches` are tiny tables where a seq scan is the right plan, but
  `get_user_role()`/`get_user_org_id()` still fire many times per request even
  after 225's InitPlan wrapping (94 seq-scans/min on `users`, `idx_scan = 0`).

## Measured baseline (prod, read-only, 2026-09-27, pg_stat_statements since
2026-09-26 14:37:42 UTC restart, 18h02m window — **near-idle, mostly Nepal
overnight, not a business-hours sample**)

Total exec time ≈ 1.1% average CPU from queries in this window. Breakdown:

| Rank | What | Share | Detail |
|---|---|---|---|
| 1 | Realtime WAL polling | 37.7% | 43,773 calls, 6.32ms mean, ~40 calls/min constant |
| 2 | pg_cron bookkeeping | ~15% | `insert into cron.job_run_details` 1,514 calls/54ms mean; one `update` averaging 8,032ms |
| 3 | Dashboard extension list | 8.6% | My own dashboard reads — ignore |
| 4 | `payments` select | 5.0% | 1,665 calls, 22.09ms mean |
| 5 | `pg_timezone_names` | 4.9% | 16 calls, 2,240ms mean — PostgREST schema-cache reload cost |
| 6 | `bookings` select | 3.2% | 1,800 calls, 13.17ms mean |
| — | reaper (`reap_aborted_authenticator_backends`) | 1.3% | 1,073 calls, finding nothing |
| — | all app queries combined | ~10.6% | payments + bookings + attendance + rooms |

Overhead (Realtime + cron) ≈ 53% of exec time doing zero user-facing work, at idle.

Scan pressure (`pg_stat_user_tables`, same window): `users` 101,768 seq scans /
0 idx scans (13 rows/scan — table is tiny, this is cheap but call-count is
high); `branches` 64,988 seq scans; `bookings` full-scanned 187× at 5,958
rows/scan despite 63,919 healthy idx scans elsewhere; `customers`
full-scanned 95× at 2,005 rows/scan. The `bookings`/`customers` full scans
don't fit the rest of the pattern — some query isn't using an index. Not yet
identified which one.

`cron.job_run_details` is unpruned: 18,961 rows back to 2026-06-13, 3,640kB.
Job 4 (`outreach_drain_outbox`, every 5min) contributes most of the volume;
job 6 (the reaper, every minute) adds relatively little. Pruning + slowing the
reaper's cadence is the cheapest fix available (~15% of exec time, zero risk).

## Revised fix ranking

1. Prune `cron.job_run_details` + reduce reaper cadence off "every minute".
2. Investigate Realtime's 37.7% — check whether `notifications` needs to stay
   in the publication (only `bookings` + `notifications` are published today;
   both replication slots healthy, 56-byte lag — so this is fixed polling
   overhead, not a runaway subscription).
3. Find the `bookings`/`customers` full-table-scan query.
4. Re-measure everything during business hours before acting on H8.
5. Turn on `track_planning` so H7 is finally testable.

## Ledger / migration state (resolved 2026-09-27, see spec doc for detail)

Prod `schema_migrations` has 225/226/227/229; missing 228. PR #343
(`fix/idle-timeout-revert`) carries 228 (idempotent `ALTER ROLE ... SET
idle_in_transaction_session_timeout='60s'`, matches prod's already-live
value) and 229 (idempotent cron-job upsert, already applied by hand on prod).
Merging #343 fixes the ledger gap as a harmless re-apply — not a risk. No
separate reconciliation migration needed. Next free migration number for new
work is **230**.

## Open PRs — keep all three, do not close, merge in this order

`#343` → `#342` → `#344`. None depend on instance size; the compute bump
removed urgency, not the underlying defects (a monitor that stayed green
through a live outage, and users being told their password is wrong when the
DB is actually just unreachable, both recur regardless of box size).

Known merge conflicts to resolve by hand:
- `#342` and `#344` both rewrite the healthcheck probe loop in
  `healthcheck-prod.yml` in different directions (#342: probe `bookings`
  instead of `branches`; #344: add HTTP-status handling to the `branches`
  probe). Resolve so the final loop probes `bookings`, checks status code
  (000/5xx), and keeps the `branches` liveness probe.
- `#343` and `#344` both edit the `RETRYABLE_PG_CODES` region of
  `supabaseRetry.js` — textual conflict only, semantically independent (#343
  adds `25P03`; #344 adds `TRANSIENT_HTTP_STATUSES`/`isTransientStatus`/
  `ServiceUnavailableError` below it). Keep both.
- Correct the "~4200ms cold plan vs ~150ms warm" figure asserted in #342's
  runbook and #343's migration comment — that was measured on a saturated
  *nano*. On MICRO, idle, today: planning 4.139ms / execution 2.762ms. Add a
  dated correction rather than deleting the original number (it's still the
  useful record of what saturation does under load).
- Add an explicit "remove once H7/H8 are fixed" note to migration 229's
  reaper — it runs forever and masks the real cause if left unlabeled.

## Ownership handover (2026-09-28)

@sthasadin handed this work over to @anish in full. The items previously listed
here as "blocked, needs @sthasadin" were resolved by direct measurement against
production rather than by asking him:

- **Prod `psql` access — WORKING.** Reads go through `~/.pgpass`
  (`aws-1-ap-northeast-2.pooler.supabase.com`, `postgres.pmbvogiphelmpjdalmtv`)
  with `default_transaction_read_only = on`. A dedicated read-only audit role
  and `AUDIT_DATABASE_URL` were never needed and are no longer requested.
- **The 228 ledger gap — CLOSED.** Prod's ledger reads
  `220,221,222,223,224,225,226,227,229`. Migration 228 sets only
  `authenticator`'s `idle_in_transaction_session_timeout` to `60s`, and prod
  measurably already holds `60s`. So 228 is confirmed a safe idempotent
  re-apply on promotion. This is now a direct measurement, not an inference
  from file contents.
- **Hand-applied `statement_timeout` — CODIFIED.** Measured 2026-09-28:
  `authenticator` 30s, `authenticated` 30s, `anon` 3s, `service_role` none on
  prod, against 8s/8s/3s/none on staging. Migration 231
  (`fix/codify-role-statement-timeouts`, PR #347) writes these values as a
  tracked migration — a no-op on prod, and raises staging to match. It no
  longer depends on Sadin confirming what he typed.
- **`track_planning` — confirmed `off` on prod.** A settable parameter, not a
  piece of missing knowledge. H7 stays untestable only until someone turns it
  on.

Still genuinely unavailable, and now nobody's blocker to clear:

- **Pro-org dashboard (Reports, Logs > Postgres, Advisors).** Needed only for
  the request-count graph around the 12:40 UTC 2026-09-26 deploy — the single
  test of the deploy-amplification idea. Not worth chasing unless the incident
  recurs.
- **Postgres `ERROR`-severity logging.** Not currently on, so the original
  25P02 trigger event stays unnamed. This is a dashboard setting somebody with
  Pro-org access can enable; it is not knowledge locked in Sadin's head.

## Hard rules (carried forward, do not violate)

Prod read-only, no writes/DDL/restarts/`pg_terminate_backend`. Compute stays
MICRO — don't propose scaling. New migrations self-record, next number 232 (231 taken by PR #347).
New RLS policies wrap helper calls in `(SELECT ...)` InitPlan style. Migration
227's live-session-termination pattern must not be repeated. `feature/*` or
`fix/*` → PR to `stage` → `stage` to `main`, never straight to `main`. Anon
keys only in env files, no `service_role` anywhere in env/chat/commits. Don't
touch state machine, discount limits, payment immutability, or Nepal-timezone
rules. No native `<select>` — use `CustomSelect`. Hypotheses stay labelled
HYPOTHESIS until measured.
