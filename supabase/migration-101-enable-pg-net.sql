-- Migration 101: enable pg_net extension
--
-- pg_net gives Postgres async HTTP (net.http_post / net.http_get), used by
-- outreach_drain_outbox() (migration-108) to call the send-message Edge
-- Function without blocking the cron job on the HTTP round trip.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS. No data, no RLS, nothing to
-- revert beyond DROP EXTENSION IF EXISTS pg_net (harmless, not done here).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.schema_migrations (version, name)
VALUES ('101', 'enable-pg-net')
ON CONFLICT (version) DO NOTHING;

COMMIT;
