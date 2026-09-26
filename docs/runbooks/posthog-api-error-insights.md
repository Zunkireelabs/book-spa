# PostHog Insights — `api_error` Event

**Status:** Not yet configured in PostHog. This is a ready-to-apply spec, not a TODO.
See `docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md` for background.

## 1. Why this matters

The retry in `src/lib/supabaseRetry.js` is deliberately invisible to users: a transient
`25P02`/`40001`/`40P01` gets retried and, on success, the caller sees a normal response.
That is the point of the feature — but it also means this incident class is now *harder*
to notice casually than it was before this branch, when users were screenshotting red
error banners. `recovered: true` is the only surviving early-warning signal: it means the
problem **is happening right now**, silently. It currently alarms nothing in PostHog. This
is the one non-optional follow-up on PR #340 — the retry logic is not a complete mitigation
without an alert wired to its own telemetry.

## 2. Event contract

Event name: `api_error`

| Property | Type | Notes |
|---|---|---|
| `code` | string \| `null` | PostgREST/Postgres SQLSTATE, e.g. `25P02`. `null` on a 5xx with a non-JSON body (e.g. an HTML 502 from the proxy), and on a network-level throw **only when no earlier attempt saw a code** — a `25P02` followed by a throw reports `code: '25P02'` with `status: 0`. |
| `status` | number | HTTP status, or `0` for a network-level throw (no HTTP response received). |
| `table` | string | Table/resource name only (`URL.pathname`'s last segment) — never the query string, which can carry customer PII (e.g. `?customer_phone=eq.977...`). |
| `method` | string | HTTP method (`GET`, `POST`, ...). |
| `attempts` | number | Total fetch attempts made in this wrapper's own retry sequence (1–3). |
| `recovered` | boolean | `true` if a retryable code was seen on an earlier attempt and a later attempt succeeded; `false` otherwise. |

Emitted only in production (`VITE_POSTHOG_KEY` is unset on staging by design, so
`lib/analytics.js`'s wrapper no-ops there).

## 3. Insight A — "Transient DB errors recovered silently"

- **Filter:** `recovered = true`
- **Chart:** trend over time
- **Breakdown:** `code`
- **Alert threshold:** any sustained non-zero rate (e.g. >0 events in a 10-minute window,
  more than once) means a pool connection is being poisoned right now, even though every
  request that hit it eventually succeeded. Treat as an active-incident signal, not a
  cosmetic metric.

## 4. Insight B — "User-visible API errors"

- **Filter:** `recovered = false`
- **Chart:** trend over time
- **Breakdown:** `code` and `status`

This is what users actually experienced. Compare its trend against Insight A — a spike in B
without a corresponding rise in A means retries are exhausting (3 attempts) rather than
recovering, which points at a longer-lived outage than a single poisoned connection.

## 5. Insight C — "Unnamed originating errors"

- **Filter:** `status >= 500`
- **Breakdown:** `code`

This is the insight most likely to finally name the root cause of the 2026-09-26 incident.
Both poisoned backends observed during that investigation showed
`pg_stat_activity.query = 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY'` — a successful
`BEGIN` cannot itself abort a transaction, so the real failure happened during Parse/Bind of
the *following* statement, a phase that doesn't update `pg_stat_activity.query`. That
originating error should surface here as a real SQLSTATE (5xx, not the downstream `25P02`)
in the seconds immediately before the next `25P02` cluster in Insight A/B. Watch for a
`code` value here that isn't `25P02`/`40001`/`40P01` clustering right before a spike in
Insight A.

## 6. The 503 caveat (raw counts overstate ~4x) — and the workaround

postgrest-js has its own retry layer (`shouldRetry`) that runs **outside** this wrapper,
invisible to it: it retries GET/HEAD/OPTIONS requests on HTTP 503 and 520, up to 4 attempts,
with 1s/2s/4s backoff. One logical query that 503s can therefore produce **up to four
separate `api_error` events**, each with `attempts: 1` from this wrapper's point of view
(each retry re-enters `retryingFetch` as a fresh top-level call). A count-based insight over
the 503 class overstates incident volume roughly 4x.

**Workaround:** every event carries `status`. In any count-based insight (A, B, or C), either:
- filter `status != 503` to exclude the inflated class entirely, or
- divide any 503-class subtotal by ~4 before treating it as an incident count.

**The `25P02` path is unaffected.** PostgREST maps `25P02` to HTTP 500, which is not in
postgrest-js's retryable status list (only 503/520 are), so this wrapper is the *only* retry
layer in play for it — no double-counting there.

## 7. Known blind spots

- **Production-only.** Telemetry is silent on staging by design — `VITE_POSTHOG_KEY` is only
  set as a GitHub Environment secret on `production`, not `staging`. Do not expect these
  insights to show anything from staging traffic, ever.
- **No query string.** Events carry a bare table name (`URL.pathname`'s last segment) only,
  never the PostgREST query string. This is intentional: PostgREST encodes filters into the
  URL (e.g. `?customer_phone=eq.977...`), and forwarding that to a third-party analytics
  system would leak customer PII. Do not attempt to enrich these events with more of the
  URL later without re-checking this constraint.
