# Handoff: Zennly platform audit + efficiency work

For: Anish (and his Claude). From: Sadin. Date: 2026-09-26.

Two parts: **A) a note for Anish**, **B) a prompt to paste into his Claude Code session**.

---

## A) Note for Anish

### What happened
On 2026-09-26 (~19:00-20:30 NPT) Nuad Thai staff could not log in. Prod was down for about 90 minutes.

- Prod Supabase project `pmbvogiphelmpjdalmtv` was on the **Free tier, `t4g.nano`** (ap-northeast-2).
- The dashboard showed **CPU/compute at ~98%**, "Conns Unavailable", and Advisor criticals: "Database not usable, CONNECT_TIMEOUT after 5002ms" and "Data API error rate persistently high".
- PostgREST, Auth and Storage flapped Unhealthy. From the app: `HEAD /rest/v1/` returned 503, and the profile/org queries hung. Login could not finish.
- Disk was **6%** (the "83%" number we first saw was not the issue).
- Rebooting (fast DB reboot) did **not** fix it. Transferring the project to a Pro org moved compute to **MICRO** and everything went green.
- Same project ref, so no code or secret changes were needed.

### Why we are NOT just buying a bigger instance
Zennly has **one tenant**. Roughly 1,000 bookings a month, 41 therapists, a few branches. That should sit comfortably on a micro. If it saturates a nano and might saturate a micro, something in the app or DB is doing far more work than it should. We want to find it and fix it. **Compute stays at MICRO for now.**

### What is verified vs. what is a guess
Verified:
- Nano instance, CPU ~98%, health flapping, 503s from PostgREST, recovery after the compute bump.
- The CPU graph was mostly 25-60% for the week of Sep 19-26, with a sharp jump only at the end of Sep 26.

Not verified (hypotheses to test, do not treat as findings):
1. **Correlation with deploy #341** (your transient-DB resilience PR). It deployed 12:40 UTC (18:25 NPT), the outage started shortly after. Migration 227 killed the authenticator pool, and the retry wrapper adds requests. On a starved box, retries could amplify load. postgrest-js also retries GET/HEAD on 503 up to 4x, on top of ours. **Please actively try to falsify or confirm this.** I said earlier it was "not the cause" and I had no evidence to be that confident.
2. The Sep 25-26 `25P02` incidents may have been early symptoms of the same CPU pressure, not a separate bug.
3. App-side load: the dashboard fans out ~10 parallel queries per load; the login page polls `HEAD /rest/v1/` every 30s; Realtime subscriptions; RLS policy nesting (calendar query plan had ~671 nodes / 325+ nested InitPlans); PostHog; large `api.js`.
4. Something changed on Sep 25 that added load: flags for Products, Campaigns, Outreach and Platform Admin were switched on in prod (#336/#333), plus RLS migrations 224/225.

### What we want back
1. A written audit (`docs/superpowers/specs/2026-09-27-perf-audit.md` or similar): ranked findings, each with evidence (query text, numbers, plan), estimated CPU impact, and proposed fix.
2. Fixes as small PRs to `stage`, highest impact first.
3. A repeatable way to prove it: a load test on staging that reproduces "one busy day at Nuad Thai" and a before/after CPU comparison.
4. Alerting that pages us **before** users notice (CPU, connection count, 5xx rate). The synthetic monitor is now in PR #344.
5. A short recommendation on sizing: what load profile would justify Small, and what would not.

### Access
- Read-only DB role. I will create it and put `AUDIT_DATABASE_URL` in your `.env.local`. Use the **Session pooler** (port 5432). Do not use the service role. Drop the role when done.
- Supabase dashboard: Reports (CPU, memory, connections, DB requests), Logs > Postgres, Advisors (Performance + Security). You will need access to the Pro org that now owns the project.
- Postgres ERROR logs were never set up before. Turn on and save a query for `severity = ERROR`. The original 25P02 error is still unknown because of that.

### Guardrails
- Do not touch prod data. Read-only on prod. Anything that writes goes to staging first.
- Staging is a **separate DB with much less data**, so it will not show per-row RLS cost. Seed it to prod scale before trusting any staging number (this is already flagged as out of scope in your resilience design doc, now it is in scope).
- Branch flow: `feature/*` or `fix/*` to PR into `stage`, then `stage` to `main`. Never straight to `main`.
- Schema changes only as `supabase/migration-NNN-*.sql` files that self-record into `public.schema_migrations`. Next number is **228**. No ad hoc dashboard edits.
- Migration 227 is the only migration that acts on live sessions. Do not copy that pattern casually.
- Do not add native `<select>`; use `CustomSelect`. Nepal timezone for datetimes. Only anon keys in env files.
- Do not split `api.js` unless it directly explains load. The monolith is intentional per CLAUDE.md.

### Already done today (do not redo)
- Compute moved to Pro/MICRO; services healthy.
- PR #344 to `stage`: graceful degradation on 503 (Reconnecting screen, better login errors) and `healthcheck-prod.yml` now fails on 000/5xx.
- Memory note saved locally by Sadin's Claude about this incident.

---

## B) Prompt to paste into Anish's Claude Code

```
You are helping me audit and optimise the Zennly production platform (repo: book-spa, React 18 + Vite SPA on Supabase). Read CLAUDE.md first and follow it. Then read tasks/HANDOFF-zennly-perf-audit.md (part A) for full context, and docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md.

## Situation
On 2026-09-26 prod login was down ~90 minutes. The Supabase DB instance (Free, t4g.nano) was CPU-saturated at ~98%, PostgREST returned 503, Auth/Storage flapped. It recovered only after the project moved to a Pro org (compute now MICRO). We have ONE tenant (Nuad Thai Spa): ~1,000 bookings/month, ~41 therapists, a few branches. That load should not stress a micro instance. We are deliberately NOT scaling compute up. Your job is to find out why this workload is expensive and make the app efficient.

## Goal
Reduce steady-state and peak DB CPU and connection use so a single tenant runs comfortably on MICRO with wide headroom, and so we could add several more tenants before resizing. Prove every improvement with numbers.

## Hypotheses to test (none are confirmed; try to falsify each)
1. Deploy #341 (retry wrapper in src/lib/supabaseRetry.js + migrations 226/227) amplified load on an already-starved instance. Note postgrest-js also retries GET/HEAD on 503 up to 4x, so retries may stack. Check request volume before/after 12:40 UTC 2026-09-26 in Supabase Reports/Logs.
2. The 25P02 incidents of Sep 25-26 were early symptoms of the same CPU pressure.
3. App-side amplification: dashboard fan-out (~10 parallel queries per load), the 30s HEAD /rest/v1/ poll on the login page (src/pages/login/index.jsx), Realtime subscriptions and re-subscribe loops, polling intervals, duplicate fetches on mount (React strict/re-render), N+1 patterns in src/services/api.js, unbounded selects, missing pagination.
4. RLS cost: nested policies, unwrapped helpers, per-row function calls, the calendar query plan (~671 nodes, 325+ nested InitPlans). Also check with_check clauses, which earlier scans skipped.
5. Load added on Sep 25: Products/Campaigns/Outreach/Platform Admin flags enabled in prod, RLS migrations 224/225, stock/branch-stock views (migration 219).
6. Missing or unused indexes, bloat, autovacuum, pg_cron jobs, large JSON columns, heavy views.

## Method
1. Baseline first. Using the READ-ONLY connection in .env.local (AUDIT_DATABASE_URL, session pooler), set statement_timeout = '5s' on your session and run ONLY read-only queries. Show me each query before you run it. Collect: pg_stat_statements (top by total_exec_time, mean_exec_time, calls), pg_stat_activity (connections by state/application), pg_stat_user_tables (seq scans, dead tuples), pg_stat_user_indexes (unused), pg_locks, pg_policies, cron.job_run_details, and Supabase Reports (CPU, memory, connections, DB requests, API request counts by endpoint).
2. Rank by impact: total time = calls x mean. Fix the biggest first; do not micro-optimise things that are cheap.
3. Trace each expensive query back to the code path (which page, which service function in src/services/api.js, how often it fires). Use the browser or a Playwright/devtools network capture on staging to count requests per page load for: login, dashboard, calendar, bookings list, customer flow.
4. Reproduce on staging. Staging is a separate DB with far less data. Seed it to prod scale (bookings, customers, therapists, memberships, packages, vouchers) BEFORE trusting any staging number. Write a load script that simulates one busy Nuad Thai day (concurrent staff sessions, dashboard refreshes, calendar use, bookings created, customer booking flow) and record CPU/latency before and after each change.
5. Fix in small PRs. One concern per PR.

## Deliverables
- docs/superpowers/specs/<date>-perf-audit.md: ranked findings, each with evidence (query text, calls, ms, EXPLAIN ANALYZE output), root cause, proposed fix, expected impact, and status. Clearly separate CONFIRMED from HYPOTHESIS.
- PRs into `stage` (never main), each with before/after numbers.
- A load-test script and instructions to rerun it.
- Alerting recommendations that would have paged us before users noticed: CPU, connection count, 5xx/503 rate, slow-query threshold. Reuse .github/workflows/healthcheck-prod.yml where sensible.
- A short sizing recommendation: what load would justify Small, and what would not.

## Hard rules
- Prod is read-only for you. No writes, no DDL, no restarts, no pg_terminate_backend on prod. Anything that writes goes to staging first.
- Never put a service_role key in any env file. Only anon keys there. Do not paste secrets in chat or commit them.
- Schema changes only as supabase/migration-NNN-*.sql (next is 228) that self-record into public.schema_migrations; CI applies them to prod behind the production-db reviewer. Ad hoc DB edits are not allowed. New RLS policies must wrap helper calls in (SELECT ...) InitPlan style.
- Branch flow: feature/* or fix/* -> PR to stage -> stage to main. Never merge feature branches to main.
- Do not split src/services/api.js unless it directly explains the load. Do not change the state machine, discount limits, payment immutability, or Nepal-timezone rules.
- npm run build and npm test must pass before every PR. Do not claim an improvement without a measured before/after.
- Git attribution per CLAUDE.md: no Claude branding; co-author sthasadin; PR footer "Created by @sthasadin".
- If you cannot verify something, say so plainly. Do not present a hypothesis as a finding.

Start by reading the docs above, then tell me your plan and the first three read-only queries you want to run. Do not run anything on prod until I approve them.
```
