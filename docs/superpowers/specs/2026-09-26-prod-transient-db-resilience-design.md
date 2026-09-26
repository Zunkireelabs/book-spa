# Production Transient-DB Resilience — Design

**Date:** 2026-09-26
**Status:** Approved (design); implementation plan pending
**Author:** Anish Balami

---

## Problem

On 2026-09-25 and again on 2026-09-26, the Zenly production staff dashboard rendered
multiple red error banners reading:

```
current transaction is aborted, commands ignored until end of transaction block
```

(Postgres SQLSTATE `25P02`.) On 2026-09-26 it also broke the Calendar view outright
("Failed to Load Calendar").

### Mechanism (confirmed)

PostgREST holds a pool of ~10 long-lived `authenticator` connections. When one of those
connections is left inside an **aborted** transaction and returned to the pool without a
`ROLLBACK`, every subsequent request routed to that connection returns `25P02` until the
connection is terminated. With a pool of 10, roughly 10–20% of requests fail — which is
exactly why a dashboard that fans out ~10 parallel queries shows several failing widgets
while others render fine.

### Why it recurred

The 2026-09-25 remediation set `idle_in_transaction_session_timeout = 60s` at the database
level. That is a **blast-radius control, not a fix**: it bounds how long a poisoned
connection keeps failing (previously: forever, because the timeout was `0`) but does
nothing to prevent poisoning. Recurrence was therefore expected.

### What was ruled out on 2026-09-26

Measured against production during the investigation:

| Hypothesis | Evidence | Verdict |
|---|---|---|
| `public.users` RLS hotspot (the 2026-09-25 root cause) | 9 seq scans/sec; the 96.8M figure is a stale cumulative counter | Fixed, not the cause |
| Slow queries hitting the 8s `authenticated` timeout | Live 60s delta sample: slowest query 150ms | Not the cause |
| Unwrapped RLS helpers reintroduced | `pg_policies` scan returned 0 | Clean |
| `= ANY((SELECT fn()))` cast trap | `pg_policies` scan returned 0 | Clean |
| pg_cron jobs | All succeeded, 20–80ms | Not the cause |
| Client-side request cancellation | No `AbortController` anywhere in `src/` | Not the cause |

### What could not be determined

**The originating error is unknown.** Both poisoned backends showed
`pg_stat_activity.query = 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY'`. A successful
`BEGIN` cannot abort a transaction, so the failure occurred during **Parse/Bind of the
following statement** — a phase that does not update the `query` field. This also rules out
a statement timeout, which *does* update it.

Naming the error requires Postgres ERROR logs (Supabase → Logs → Postgres) around
**09:18 UTC 2026-09-26**. No log access was available during the investigation.

---

## Goal

Make transient database errors **invisible to users, self-announcing to operators, and
blocked from re-entering via RLS regressions** — without depending on knowing any single
root cause.

### Explicit non-goal

This design does **not** identify the root cause of the 2026-09-26 incident. Nothing can,
without the logs. Workstreams 2 and 3 exist so that the *next* occurrence is named
automatically instead of investigated archaeologically.

### Success criteria

1. A poisoned pool connection produces **zero** user-visible errors.
2. Every API error is captured with its SQLSTATE, and distinguishes "recovered after retry"
   from "failed after retries".
3. An ongoing incident triggers an alert without a human looking at anything.
4. A migration that reintroduces unwrapped RLS helpers **fails the deploy**.
5. Each recurrence self-heals in ≤5s rather than ≤60s.

---

## Design

### Workstream 1 — Transient retry at the client boundary

**New file:** `src/lib/supabaseRetry.js`
**Modified:** `src/lib/supabase.js`

`src/lib/supabase.js` is 42 lines and constructs all three Supabase clients (`supabase`,
`supabaseCustomer`, `supabasePlatform`). Injecting a wrapped `fetch` there via
`global: { fetch }` covers every request from all three clients — including all 173
`if (error)` sites in the 13,472-line `src/services/api.js` — with **zero call-site edits**.

This is the single most important structural decision in the design: the alternative
(wrapping calls in `api.js`) would touch 173 sites, miss any site added later, and miss the
customer and platform clients entirely.

#### Retry policy

Retry **only** when the PostgREST error body's `code` field is one of:

| SQLSTATE | Meaning |
|---|---|
| `25P02` | in_failed_sql_transaction |
| `40001` | serialization_failure |
| `40P01` | deadlock_detected |

All three share the property that **the transaction rolled back and nothing was committed**.
That makes retrying a write provably safe, not merely probably safe — which is why the retry
applies to mutations as well as reads.

Deliberately **not** retried: network errors, timeouts, `57014` (cancelled), and bare 5xx
without a recognised code. Those are genuinely ambiguous — the write may have landed before
the response was lost — and retrying them could double-apply a mutation.

#### Parameters

- Max 2 retries (3 total attempts).
- Jittered backoff: ~150ms, then ~400ms.
- Worst-case added latency ~550ms, incurred only on requests that would otherwise have
  failed outright.

#### Implementation constraints

- **Clone before reading.** A `Response` body may be consumed only once. The wrapper must
  `res.clone()` before parsing JSON to inspect `code`, or the caller receives a consumed body.
- **Non-replayable bodies.** Skip retry when `init.body` is not a string or `undefined`.
  supabase-js sends string bodies, so this is a safety guard rather than a functional limit.
- **Fail open — mandatory.** This wrapper sits on the hot path of every request in the
  application. A defect in it is a total outage, strictly worse than the problem being
  solved. Any exception thrown inside the wrapper must fall through to an unwrapped `fetch`
  call. This property must be covered by an explicit test.

#### Testing

TDD, `src/lib/supabaseRetry.test.js`, following the existing `src/services/*.test.js`
vitest convention. Required cases:

1. Retries on `25P02`, then succeeds → caller sees success.
2. Exhausts retries → caller sees the final error response, body still readable.
3. Does **not** retry a non-retryable code (e.g. `PGRST116`, `23505`).
4. Does **not** retry a 4xx.
5. Does **not** retry when `init.body` is non-replayable.
6. Honours the max-attempt ceiling exactly (asserted call count).
7. **Fails open**: an internal throw still results in a normal fetch, not a rejected promise.
8. Response body remains readable by the caller after inspection (clone correctness).

---

### Workstream 2 — Error telemetry

**Modified:** `src/lib/analytics.js`, `src/lib/supabaseRetry.js`

Telemetry is emitted from the same choke point as the retry, so no separate instrumentation
pass over the codebase is needed.

Add `captureApiError({ code, status, table, method, attempts, recovered })` to the existing
PostHog wrapper. The wrapper already no-ops when `VITE_POSTHOG_KEY` is unset, so staging
remains intentionally silent.

Because attempts are counted, two distinct signals are produced:

- `recovered: true` — the user saw nothing, but the problem **is happening**. This is the
  early-warning signal that did not exist during either incident.
- `recovered: false` — the user saw an error.

#### PII constraint (mandatory)

PostgREST encodes filters into the URL query string, e.g.
`/rest/v1/bookings?customer_phone=eq.977XXXXXXXXX`. Transmitting raw URLs to PostHog would
leak customer PII into a third-party analytics system.

**The wrapper sends `URL.pathname` only** — which yields the table name — and never the
query string. This is consistent with the existing posture in `lib/analytics.js`
(`maskAllInputs: true`, `[data-ph-mask]` on PII inputs).

---

### Workstream 3 — Synthetic monitor

**New file:** `.github/workflows/healthcheck-prod.yml`

Schedule: every 10 minutes, plus `workflow_dispatch`. The job fails on error; GitHub emails
the repository owner on scheduled-workflow failure by default, so no new vendor, webhook, or
secret is required.

Two constraints shaped this design:

1. **It must not use the `production-db` GitHub Environment.** That environment carries a
   required reviewer (used to gate the migrate job). A scheduled job targeting it would block
   on approval indefinitely. The check therefore runs over HTTPS using the anon key — already
   present as a secret — rather than psql.

2. **A single probe is insufficient.** With one poisoned connection in a pool of ten, a
   single request has roughly a 90% chance of *missing* it and reporting false health. The
   job issues **20 sequential requests** against an anon-readable endpoint and fails if
   **any** response carries `25P02`.

   The endpoint must be one the public customer booking flow already reads as `anon` (the
   `/:orgSlug/book` route reads branches and services). The implementation must **verify
   anon-readability against production before relying on it** — an endpoint that returns
   empty under RLS would make the monitor permanently green and useless.

Point 2 is the difference between a monitor that would have caught both incidents and one
that would have reported green through them.

The existing deploy health check is not a substitute: it verifies only that the container
responds, and passed throughout both incidents.

---

### Workstream 4 — RLS live assertion

**New file:** `scripts/check-rls-initplan.sh`
**Modified:** `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy.yml`

A psql assertion that exits non-zero if any `public` schema policy references
`get_user_role()`, `get_user_org_id()`, `get_user_branch_id()`, `get_user_branch_ids()`, or
`auth.uid()` **unwrapped** (i.e. not inside a `(SELECT ...)` that lets Postgres hoist it to
an InitPlan). Wired in immediately after the migrate step in both deploy workflows, reusing
the credentials those jobs already hold.

#### Why live, not static

Migration 225 was authored as a `DO` block emitting dynamic SQL, because prod and stage had
diverged on 20 policies and a static script would have overwritten one side. A grep over
migration files therefore **cannot see the policies it creates** — a static lint would have
missed the very migration that fixed the original outage. A live `pg_policies` query is
authoring-style agnostic and additionally catches drift from ad-hoc dashboard edits.

#### Must check `with_check`, not only `qual`

The 2026-09-26 investigation scanned only `qual`. A policy's `with_check` clause carries the
identical per-row re-evaluation penalty, and was not examined. The script checks **both**
columns. This is a known gap in the earlier verification, corrected here.

---

### Workstream 5 — Database configuration

**New file:** `supabase/migration-226-authenticator-idle-timeout.sql`

```sql
ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '5s';
```

Shipped as a tracked migration — not an ad-hoc dashboard edit — so CI applies it to both
environments and it self-records into `public.schema_migrations` per
`scripts/check-migrations.sh`.

Effect: each recurrence self-heals in ≤5s instead of ≤60s. Risk is low — PostgREST
transactions are per-request and sub-second, and nothing legitimately idles 5s inside a
transaction.

**Fallback:** if the `postgres` role lacks permission to `ALTER ROLE authenticator` on
Supabase, the implementation must report this explicitly and hand off idempotent SQL per
`supabase/PROMOTION.md`, rather than silently skipping it or assuming success.

---

### Workstream 6 — Log access (manual, non-code)

Configure and verify access to Postgres ERROR logs: Supabase → Logs → Postgres, saved query
filtering `severity = ERROR`.

This is a checklist item, not an implementation task, and it cannot be automated from this
repository. It is nonetheless the defect that turned the 2026-09-25 incident into a
2026-09-26 repeat: without it, the originating error is unrecoverable after the log-retention
window closes.

Optional, best-effort: enable `pg_stat_statements.track_planning`. During this investigation
all `plan_time` columns read `0`, making it impossible to distinguish planning cost from
execution cost on the observed multi-second spikes. Supabase may not permit this GUC; treat
as best-effort and report if unavailable.

---

## Risks

| Risk | Mitigation |
|---|---|
| A defect in the fetch wrapper breaks every request in the app | Fail-open requirement + dedicated test; TDD throughout |
| Retry masks a real, worsening problem | `recovered: true` telemetry surfaces silent retries explicitly |
| Retrying a mutation double-applies it | Restricted to three SQLSTATEs that guarantee rollback; ambiguous classes excluded by design |
| PII leaks into PostHog via PostgREST URLs | Pathname-only transmission, enforced in the wrapper |
| Synthetic monitor reports false green | 20 sequential probes rather than one |
| Monitor blocks on environment approval | Uses anon-key HTTPS, never the `production-db` environment |
| `ALTER ROLE` lacks permission | Explicit fallback to documented manual handoff |

---

## Out of scope

- Identifying the 2026-09-26 root cause (blocked on logs; see Workstream 6).
- Splitting `src/services/api.js` — the monolith is intentional per `CLAUDE.md`.
- Seeding staging to production data volume. Worth doing (a per-row RLS penalty is free at
  50 rows and fatal at 6,000, which is why staging missed the original outage) but it is a
  separate piece of work with its own spec.
- Reducing RLS policy nesting depth. The calendar query plan contains 671 nodes and 325+
  nested InitPlans/SubPlans from policy expansion. Execution currently measures 26ms, so this
  is not urgent — but it is a latent planning-time risk worth its own investigation.
