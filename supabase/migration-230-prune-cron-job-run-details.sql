-- Migration 230: bound cron.job_run_details growth with a retention job
-- Idempotent: CREATE OR REPLACE FUNCTION + cron.schedule upserts by job name.
-- Applied: stage <pending> / prod <pending>.
--
-- WHY THIS EXISTS — measured on production 2026-09-27.
--
-- pg_cron writes one row to cron.job_run_details per job execution and NEVER
-- prunes it. On production that table had grown to 18,961 rows dating back to
-- 2026-06-13 (3,640 kB), and its own bookkeeping had become one of the most
-- expensive things the database does:
--
--   insert into cron.job_run_details ...   1,514 calls   81,923 ms   54.11 ms mean
--   update cron.job_run_details set ...        2 calls   16,064 ms  8031.82 ms mean
--   update cron.job_run_details set ...       11 calls    6,240 ms   567.24 ms mean
--
-- That is ~15% of ALL query execution time in an 18-hour window, spent entirely
-- on recording that cron jobs ran. For comparison, every application query
-- combined (bookings, payments, attendance, rooms) was ~10.6% over the same
-- window. A 54 ms INSERT and an 8-second UPDATE against a 3.6 MB table are both
-- symptoms of accumulated bloat, not of the write volume itself.
--
-- Context for why this matters more than the raw numbers suggest: production
-- runs on a Supabase MICRO instance (2 shared vCPU, 1 GB RAM) by deliberate
-- choice after the 2026-09-26 outage — the decision was to find the waste
-- rather than buy headroom. See docs/superpowers/specs/2026-09-27-perf-audit.md.
--
-- WHAT THIS DOES NOT DO:
--
--   * It does not set cron.log_run = off. That would stop the writes entirely
--     but also destroy the run history, which is how we confirmed the pg_cron
--     jobs were healthy during the 2026-09-25/26 incidents. Observability is
--     worth more than the remaining cost once retention is bounded.
--   * It does not VACUUM. VACUUM cannot run inside a transaction block, and
--     this migration is transactional. After the initial DELETE below removes
--     ~17k rows, autovacuum will reclaim the space on its own schedule. If the
--     INSERT/UPDATE timings above have not improved within a day, run
--     `VACUUM (ANALYZE) cron.job_run_details;` manually as a one-off — it is
--     not a schema change and does not belong in the ledger.
--
-- RETENTION WINDOW: 7 days. The busiest job (outreach-drain-outbox, every 5
-- minutes) produces 288 rows/day, so 7 days across all 5 jobs settles at
-- roughly 2.5k rows — two orders of magnitude below where it was, while still
-- covering a full week of incident history.

BEGIN;

CREATE OR REPLACE FUNCTION public.prune_cron_job_run_details(retain_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  deleted integer;
BEGIN
  IF retain_days < 1 THEN
    RAISE EXCEPTION 'retain_days must be >= 1, got %', retain_days;
  END IF;

  -- start_time is NULL for a run still in 'connecting'/'running' state, so the
  -- NOT NULL guard keeps in-flight rows out of the delete regardless of age.
  DELETE FROM cron.job_run_details
   WHERE start_time IS NOT NULL
     AND start_time < now() - make_interval(days => retain_days);

  GET DIAGNOSTICS deleted = ROW_COUNT;

  IF deleted > 0 THEN
    RAISE NOTICE 'prune_cron_job_run_details: deleted % row(s) older than % day(s)', deleted, retain_days;
  END IF;

  RETURN deleted;
END;
$function$;

COMMENT ON FUNCTION public.prune_cron_job_run_details(integer) IS
  'Deletes cron.job_run_details rows older than retain_days (default 7). pg_cron never prunes this table; on production it reached 18,961 rows and ~15% of total query execution time went to its own INSERT/UPDATE bookkeeping. Scheduled daily as ''prune-cron-job-run-details''. See migration 230.';

-- Daily at 00:20 UTC (05:05 NPT) — deliberately offset from the 00:15 UTC
-- notify-left-behind-bookings and outreach-scan-winback jobs so the prune's
-- DELETE does not contend with them writing their own run rows.
SELECT cron.schedule(
  'prune-cron-job-run-details',
  '20 0 * * *',
  $cron$SELECT public.prune_cron_job_run_details(7)$cron$
);

-- One-time catch-up for the backlog that accumulated before this job existed.
-- Safe to re-run: on a second application there is simply nothing older than
-- 7 days left to delete.
SELECT public.prune_cron_job_run_details(7);

INSERT INTO public.schema_migrations (version, name)
VALUES ('230', 'prune-cron-job-run-details')
ON CONFLICT (version) DO NOTHING;

COMMIT;
