-- Migration 027: schema_migrations tracking table + baseline backfill
--
-- Problem: Zenly runs two completely separate Supabase databases (staging +
-- production) and migrations are loose .sql files applied by hand in each
-- dashboard. There is no record of WHAT has been applied WHERE, so every
-- stage->main promotion is guesswork and risks double-applying or skipping SQL.
--
-- Fix: a tracking table that records every applied migration. This migration
-- creates it and backfills everything already live in BOTH databases as of
-- 2026-06-03, so both start from a truthful baseline. From here on, each new
-- migration records itself (see supabase/PROMOTION.md), and the pending-check
-- query in that runbook tells you exactly what a given database is missing.
--
-- Idempotent: safe to re-run in either database.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version    text PRIMARY KEY,
  name       text,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Project rule: every table has RLS. No policies on purpose -> app clients
-- (anon/authenticated) are fully denied. Only the dashboard/MCP postgres role,
-- which bypasses RLS, reads or writes this operational metadata table.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- Baseline: everything already applied in BOTH databases.
-- '001' represents the base schema (schema.sql + rls.sql). Migration 008
-- shipped as two files (008a/008b). 013 never existed and is intentionally
-- skipped. This list is identical for staging and production.
INSERT INTO public.schema_migrations (version, name) VALUES
  ('001','baseline schema (schema.sql + rls.sql)'),
  ('002','missing-tables'),
  ('003','add-discount-reason'),
  ('004','backfill-customers'),
  ('005','admin-write-policies'),
  ('006','enable-realtime'),
  ('007','room-delete-policy'),
  ('008a','anon-booking-policies'),
  ('008b','staff-service-delete-policies'),
  ('009','create-organizations'),
  ('010','add-org-id-to-tables'),
  ('011','org-rls-helper'),
  ('012','org-rls-policies'),
  ('014','service-images-storage'),
  ('015','add-industries'),
  ('016','therapist-display-order'),
  ('017','room-display-order'),
  ('018','user-pin'),
  ('019','room-amenities'),
  ('020','booking-therapists'),
  ('021','therapist-position'),
  ('022','service-staff-flag'),
  ('023','booking-therapist-times'),
  ('024','branch-excluded-service-categories'),
  ('025','booking-number-race-fix'),
  ('026','discount-on-completed-unpaid'),
  ('027','schema-migrations-tracking')
ON CONFLICT (version) DO NOTHING;

-- Verify
SELECT count(*) AS total_applied FROM public.schema_migrations;
SELECT version, name, applied_at
FROM public.schema_migrations
ORDER BY version;
