-- Migration 228: revert the authenticator idle-in-transaction timeout from
-- 5s back to 60s. 5s was wrong for THIS database and made an incident worse.
-- Idempotent: ALTER ROLE ... SET is last-write-wins, safe to re-run.
-- Applied: stage <pending> / prod 2026-09-26 (applied manually during the
-- incident, ahead of this migration landing — this migration exists to make
-- the repo match what production is already running, and to self-record it
-- into public.schema_migrations).
--
-- What 226 tried to do: shrink the idle_in_transaction_session_timeout for
-- the `authenticator` role from 60s to 5s, to bound how long a poisoned
-- PostgREST pool connection (stuck in an aborted transaction) keeps serving
-- 25P02 to every request routed to it. 227 then terminated idle authenticator
-- backends so the new 5s value would actually reach the live pool, since
-- ALTER ROLE ... SET only takes effect at session start.
--
-- Why 5s was wrong for THIS database specifically: 226's safety argument
-- ("PostgREST maps one HTTP request to one transaction with no client
-- round-trip inside it, so nothing legitimately idles 5s") assumed a warm
-- planner. This database's RLS policy tree is enormous — plans of ~671 nodes
-- with 325+ nested InitPlans — and a cold plan measured ~4200ms, versus
-- ~150ms warm (88ms planning + 279ms execution warm... rounding, warm total
-- well under 1s). 227's recycle terminated every idle authenticator
-- connection at once, so the next wave of requests had to re-plan from cold
-- across the board. Under that cold-plan load, PostgREST backends sat "idle
-- in transaction" longer than 5 seconds during the dashboard's parallel
-- query fan-out — a legitimate in-flight request, not a poisoned one.
--
-- User-visible symptom: the 5s ceiling then killed those connections
-- mid-request, surfacing as
--   FATAL: 25P03: terminating connection due to idle-in-transaction timeout
-- i.e. the fix for 25P02 produced a new, more visible failure (25P03) by
-- being too aggressive against this database's real planning cost. A human
-- applied `ALTER ROLE authenticator SET idle_in_transaction_session_timeout
-- = '60s'` directly to production to stop the bleeding before this migration
-- was written.
--
-- Why 60s, not some other number: this is a deliberate return to the value
-- production ran safely on for months before 2026-09-25 — not a fresh guess
-- picked mid-incident. It is the known-safe baseline, chosen precisely
-- because it is already proven, not because it is optimal.
--
-- What this does NOT do: this does NOT restore the pre-2026-09-25 behavior
-- of 0 (never timeout). That behavior is what let a single poisoned
-- connection serve 25P02 forever, which is the failure 226 was trying to
-- fix in the first place. 60s still bounds a stuck connection's lifetime —
-- it is a return to the last-known-safe timeout, not a return to "no
-- timeout at all".
--
-- Do not re-tighten this below 60s until the RLS plan complexity itself is
-- addressed — see docs/runbooks/rls-plan-complexity.md. The ordering matters:
-- fix the planning cost first, then a shorter timeout can be revisited
-- safely. Tightening the timeout again before that is the same mistake
-- repeated.
--
-- Do NOT add a pg_terminate_backend recycle (the migration-227 pattern) to
-- this migration or any follow-up that changes this setting. That recycle is
-- exactly what forced every authenticator connection to re-plan from cold
-- simultaneously and is what turned a tuning change into an incident.
-- Connections will pick up 60s naturally as they cycle through ordinary pool
-- churn (idle-close, then reopen on next use) — no forced recycle needed or
-- wanted here.

BEGIN;

ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '60s';

INSERT INTO public.schema_migrations (version, name)
VALUES ('228', 'authenticator-idle-timeout-revert')
ON CONFLICT (version) DO NOTHING;

COMMIT;
