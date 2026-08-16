-- Migration 079: branches.open_time / close_time / timezone
--
-- These columns are already live on staging/production (added directly via
-- the dashboard SQL editor at some point, never captured in a migration) —
-- src/services/api.js has queried them since branch-hours logic was added
-- (getCalendarBookings selects open_time, close_time, timezone together).
-- schema.sql's branches CREATE TABLE never picked them up, so a fresh
-- bootstrap (e.g. local OrbStack, see supabase/LOCAL_DEV.md) fails with
-- "column branches.open_time does not exist" and then, once that's patched,
-- "column branches.timezone does not exist". This backfills all three
-- idempotently so schema.sql + migrations alone reproduce staging/prod.
--
-- Defaults match the fallback values api.js already uses when these columns
-- are null (see openTime/closeTime/timezone fallback at
-- src/services/api.js:2910-2912) and organizations.timezone's default
-- (migration-009).

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS open_time time NOT NULL DEFAULT '09:00:00',
  ADD COLUMN IF NOT EXISTS close_time time NOT NULL DEFAULT '21:00:00',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kathmandu';

INSERT INTO public.schema_migrations (version, name)
VALUES ('079', 'branch-hours')
ON CONFLICT (version) DO NOTHING;
