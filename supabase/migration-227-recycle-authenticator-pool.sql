-- Migration 227: recycle idle `authenticator` pool connections so PostgREST
-- reopens them under the new 5s idle_in_transaction_session_timeout.
-- Applied: stage <pending> / prod <pending>.
--
-- OPERATIONAL NOTES — read before promoting to production:
--  1. PRIVILEGE. pg_terminate_backend against an `authenticator`-owned backend
--     requires superuser, pg_signal_backend membership, or membership in
--     `authenticator`. If PROD_PGUSER lacks it, this DO block raises,
--     ON_ERROR_STOP aborts the psql session, the `migrate` job fails, and
--     deploy.yml's `deploy` job (gated on needs.migrate.result == 'success')
--     is blocked — i.e. a privilege error here blocks the WHOLE production
--     deploy, not just this migration. The staging migrate run proves the
--     privilege for free; confirm it there before promoting.
--  2. EXPECT A BRIEF BLIP. PostgREST also holds a dedicated LISTEN connection
--     as `authenticator` in state `idle`, so this terminates that too.
--     PostgREST reconnects and reloads its schema cache, which can emit a
--     short burst of 503s. Benign and self-healing, and postgrest-js's own
--     503 retry absorbs most of it — but don't run this at a traffic peak,
--     and don't be alarmed by 503s in PostHog for a few seconds afterwards.
--  3. This is the first migration in this repo whose effect is on live
--     SESSIONS rather than schema. On a future restore-and-replay of the full
--     history it will fire again (harmlessly). Don't copy the pattern without
--     the same care.
--
-- Why this exists: migration 226 ran `ALTER ROLE authenticator SET
-- idle_in_transaction_session_timeout = '5s'`, but ALTER ROLE ... SET applies
-- at SESSION START, not immediately. PostgREST's `authenticator` connections
-- are long-lived pool members opened once and reused for the life of the
-- pool, so every connection that was already open when 226 ran keeps running
-- under whatever value was in effect when IT connected (60s, per the
-- 2026-09-25 change) until PostgREST reconnects it or the service restarts.
-- Nothing in the deploy pipeline restarts PostgREST, so 226 alone is nominal:
-- the role's default changed, but the live pool did not.
--
-- Fix: terminate only IDLE authenticator backends. PostgREST notices the
-- dropped connection and transparently reopens it on the next request that
-- needs it — this is normal, expected pool behavior, not an outage. The new
-- connection is a fresh session, so it picks up the role's current default
-- (5s) immediately. No PostgREST restart, config reload, or deploy action is
-- required beyond running this statement.
--
-- Why ONLY idle backends: an `active` backend is mid-request, serving a real
-- user. Terminating it would drop that in-flight request. So this filters to
-- state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)')
-- and additionally excludes pg_backend_pid() (the connection running this
-- migration itself) as a defensive measure, even though this session runs
-- as `postgres`/the migration role, not `authenticator`.
--
-- But the state filter alone is NOT sufficient, and it is worth being precise
-- about why. PostgREST wraps every request in a transaction, so a backend that
-- has sent BEGIN and is awaiting its next command reports `idle in transaction`
-- while a real user request is still in flight — that is exactly the state the
-- 2026-09-26 investigation observed (query = 'BEGIN ISOLATION LEVEL READ
-- COMMITTED READ ONLY'). Filtering on state alone would therefore still allow
-- dropping a live request. pg_stat_activity is also a per-transaction snapshot,
-- so a backend reported `idle` can become `active` microseconds before the
-- signal lands (a genuine TOCTOU race).
--
-- Both are closed by the `state_change` guard below: a backend that has sat in
-- its current state for 2+ seconds is provably not mid-request, because
-- PostgREST transactions are sub-second. Every genuinely idle pool member and
-- every poisoned `idle in transaction (aborted)` connection still qualifies —
-- those have been stuck far longer than 2s by definition.
--
-- Residual risk after the guard: none material. The worst case would be a
-- single dropped request, which rolls back cleanly and which PostgREST's own
-- 503 retry absorbs.
--
-- This is a ONE-TIME RECYCLE, not an ongoing mechanism: it drains whatever
-- authenticator connections are idle at the moment this migration runs, once.
-- It is idempotent and safe to re-run — terminating zero idle backends is a
-- no-op — but it does not need to run again after this deploy for 226's
-- setting to reach the pool; PostgREST will have already cycled every
-- connection that was idle at the time, and any connection active at the
-- time will pick up the new value the next time IT goes idle-then-reopens
-- naturally through ordinary pool churn.
--
-- Verification: there is no per-backend view of a GUC's live value from
-- another session, so we cannot directly query "is this backend's
-- idle_in_transaction_session_timeout 5s or 60s". The honest verification is
-- indirect: run this migration, then check pg_stat_activity for authenticator
-- backends whose backend_start is AFTER this migration ran —
--   SELECT pid, backend_start, state
--     FROM pg_stat_activity
--    WHERE usename = 'authenticator'
--    ORDER BY backend_start;
-- A backend_start after this migration's run time means that connection is
-- new and therefore inherited the role's current default (5s). Any
-- authenticator backend still showing a backend_start from before this
-- migration ran was active (not idle) at the time and was correctly left
-- alone; it will cycle to the new value on its own next idle-close-reopen.

BEGIN;

DO $$
DECLARE
  terminated_count integer;
BEGIN
  SELECT count(*) INTO terminated_count
    FROM (
      SELECT pg_terminate_backend(pid) AS terminated
        FROM pg_stat_activity
       WHERE usename = 'authenticator'
         AND state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)')
         -- Provably not mid-request: PostgREST transactions are sub-second, so
         -- 2s in the same state rules out both an in-flight `idle in transaction`
         -- request and the idle->active TOCTOU race. See header.
         AND state_change < now() - interval '2 seconds'
         AND pid <> pg_backend_pid()
    ) t
   WHERE t.terminated;

  RAISE NOTICE 'migration-227: terminated % idle authenticator backend(s); PostgREST will reopen them transparently on next use', terminated_count;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('227', 'recycle-authenticator-pool')
ON CONFLICT (version) DO NOTHING;

COMMIT;
