-- Migration 229: reap poisoned (aborted-transaction) authenticator backends every minute
-- Idempotent: CREATE OR REPLACE FUNCTION + cron.schedule upserts by job name.
-- Applied: stage <pending> / prod <pending>.
--
-- WHY THIS EXISTS — the full causal chain, established 2026-09-26:
--
--   1. This database's RLS plan is enormous (~671 nodes, 325+ nested InitPlans)
--      because several policies reference OTHER RLS-protected tables, which
--      recursively expands those tables' policies. See
--      docs/runbooks/rls-plan-complexity.md.
--   2. A staff dashboard page load fires ~8-10 concurrent queries. Each must
--      plan that tree. Under that concurrency, queries were measured running
--      20+ seconds on production.
--   3. A query that exceeds statement_timeout is cancelled (57014,
--      "canceling statement due to statement timeout"), which ABORTS its
--      transaction.
--   4. PostgREST returns that connection to its pool WITHOUT a ROLLBACK, so the
--      backend sits in state 'idle in transaction (aborted)'.
--   5. Every subsequent request routed to that connection returns 25P02,
--      "current transaction is aborted, commands ignored until end of
--      transaction block" — until something terminates the backend.
--
-- That chain is the root cause of the 2026-09-25 and 2026-09-26 incidents. The
-- real fix is step 1 (reduce the planning cost). This migration addresses step
-- 5 only: it bounds how long a poisoned connection can keep failing requests.
-- It is a mitigation, not a cure. Do not let it substitute for the RLS work.
--
-- WHY A REAPER RATHER THAN A SHORTER idle_in_transaction_session_timeout:
--
-- Migration 226 tried exactly that (60s -> 5s) and it made production worse.
-- PostgREST wraps every request in a transaction, so a HEALTHY backend awaiting
-- its next command legitimately sits in 'idle in transaction' — and under the
-- slow planning above, it can sit there past 5s. The blanket timeout therefore
-- killed live requests mid-flight; users saw "terminating connection due to
-- idle-in-transaction timeout" (25P03). Migration 228 reverted it to 60s.
--
-- This reaper cannot repeat that mistake. It matches ONLY
-- 'idle in transaction (aborted)' — a transaction that has already failed and
-- from which nothing can ever commit. Terminating one is provably incapable of
-- dropping an in-flight request, which is exactly the property the 5s timeout
-- lacked. Plain 'idle in transaction' and 'active' are never touched.

BEGIN;

CREATE OR REPLACE FUNCTION public.reap_aborted_authenticator_backends()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  reaped integer;
BEGIN
  SELECT count(*) INTO reaped
    FROM (
      SELECT pg_terminate_backend(pid) AS terminated
        FROM pg_stat_activity
       WHERE usename = 'authenticator'
         -- ONLY aborted transactions. Never 'active' (mid-request), and never
         -- plain 'idle in transaction' (PostgREST's normal between-commands
         -- state, which migration 226 wrongly treated as safe to kill).
         AND state = 'idle in transaction (aborted)'
         AND pid <> pg_backend_pid()
    ) t
   WHERE t.terminated;

  IF reaped > 0 THEN
    RAISE NOTICE 'reap_aborted_authenticator_backends: terminated % poisoned backend(s)', reaped;
  END IF;

  RETURN reaped;
END;
$function$;

COMMENT ON FUNCTION public.reap_aborted_authenticator_backends() IS
  'Terminates PostgREST authenticator backends stuck in an aborted transaction, which would otherwise serve 25P02 to every request routed to them. Mitigation for the RLS-planning-cost chain documented in migration 229 and docs/runbooks/rls-plan-complexity.md. Only touches state = ''idle in transaction (aborted)''.';

-- Every minute. cron.schedule upserts by job name, so re-running this
-- migration updates the existing job rather than creating a duplicate.
SELECT cron.schedule(
  'reap-aborted-authenticator',
  '* * * * *',
  $cron$SELECT public.reap_aborted_authenticator_backends()$cron$
);

INSERT INTO public.schema_migrations (version, name)
VALUES ('229', 'reap-aborted-authenticator-backends')
ON CONFLICT (version) DO NOTHING;

COMMIT;
