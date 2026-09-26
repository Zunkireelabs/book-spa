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

BEGIN;

ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '5s';

INSERT INTO public.schema_migrations (version, name)
VALUES ('226', 'authenticator-idle-timeout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
