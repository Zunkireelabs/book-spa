-- Migration 058: customers-gender (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: public.customers.gender (text, nullable). Unlike
-- public.therapists.gender, the live schema has NO CHECK constraint restricting
-- customers.gender to a fixed set ('Male'::text = ANY..., etc. only exists on
-- therapists) — so this is left unconstrained free text, matching what's actually
-- live. This lines up with industries.enable_customer_gender, an existing per-org
-- toggle for whether the customer-gender field is shown/used at all.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS gender text;

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('058', 'customers-gender')
ON CONFLICT (version) DO NOTHING;
