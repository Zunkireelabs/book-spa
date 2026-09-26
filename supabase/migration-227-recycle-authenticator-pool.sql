-- Migration 227: recycle idle `authenticator` pool connections so PostgREST
-- reopens them under the new 5s idle_in_transaction_session_timeout.
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
-- user. Terminating it would drop that in-flight request. This migration
-- must never do that, so it filters strictly to
-- state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)')
-- and additionally excludes pg_backend_pid() (the connection running this
-- migration itself) as a defensive measure, even though this session runs
-- as `postgres`/the migration role, not `authenticator`.
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
         AND pid <> pg_backend_pid()
    ) t
   WHERE t.terminated;

  RAISE NOTICE 'migration-227: terminated % idle authenticator backend(s); PostgREST will reopen them transparently on next use', terminated_count;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('227', 'recycle-authenticator-pool')
ON CONFLICT (version) DO NOTHING;

COMMIT;
