-- Migration 226: shrink the authenticator idle-in-transaction abort window to 5s
-- Idempotent: ALTER ROLE ... SET is last-write-wins, safe to re-run.
-- Applied: stage 2026-09-26 / prod <not yet applied>.
--
-- When a PostgREST pool connection is left inside an aborted transaction, every
-- later request routed to it returns 25P02 until the connection is terminated.
-- The database-level default was raised from 0 (never) to 60s on 2026-09-25,
-- which is what stopped the failure being permanent. 5s is the same control,
-- tightened: PostgREST transactions are per-request and sub-second, so nothing
-- legitimate idles that long inside one.
--
-- This bounds the blast radius. It is not a root-cause fix — see
-- docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md
--
-- Limitations (do not oversell this as "self-heals in <=5s" without reading
-- both of these — the branch's design doc claims that bound, but this
-- migration alone cannot deliver it):
--
-- 1. ALTER ROLE ... SET takes effect at SESSION START, not immediately.
--    PostgREST's `authenticator` connections are long-lived pool members that
--    are opened once and reused for the life of the pool; an existing
--    connection keeps whatever idle_in_transaction_session_timeout was in
--    effect when IT connected (60s, per the 2026-09-25 change) until
--    PostgREST reconnects it or the whole service restarts. Nothing in this
--    migration, and nothing in the deploy pipeline, restarts PostgREST.
--
--    UPDATE: migration-227-recycle-authenticator-pool.sql now performs this
--    recycle — it terminates idle authenticator backends so PostgREST
--    reopens them and they inherit this setting. Do NOT rely on
--    `SELECT rolname, rolconfig FROM pg_roles` alone to verify this reached
--    the live pool — that query only proves the ROLE's default changed, not
--    that any open connection picked it up. There is no per-backend view of
--    a GUC's live value from another session, so the honest verification is
--    indirect: after 227 runs, confirm via
--      SELECT pid, backend_start, state FROM pg_stat_activity
--       WHERE usename = 'authenticator' ORDER BY backend_start;
--    that authenticator backends show a `backend_start` after 227 ran — a
--    recent backend_start means that connection is new and so inherited the
--    5s default. See migration-227's header comment for the full reasoning.
--
-- 2. The idle-in-transaction clock RESETS on every command received on that
--    connection, whether or not the transaction is aborted. A poisoned
--    connection that keeps getting picked up and used (by the pool's own
--    round-robin, or simply by traffic volume) more often than once every 5
--    seconds never accumulates 5 continuous idle seconds and so never gets
--    auto-terminated by this setting. Worse, this branch's own retry wrapper
--    (src/lib/supabaseRetry.js) works against this fix: each caller that hits
--    the poisoned connection fires up to 3 attempts within ~450ms, which is
--    additional traffic that keeps resetting the idle clock and makes the
--    5-second idle window *harder* to reach, not easier. The two defenses in
--    this branch are not purely additive — the retry layer can, in the worst
--    case, delay the self-heal this migration is meant to provide.

BEGIN;

ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '5s';

INSERT INTO public.schema_migrations (version, name)
VALUES ('226', 'authenticator-idle-timeout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
