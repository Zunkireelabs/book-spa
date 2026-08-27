-- supabase/migration-114-commission-tables.sql
-- Per-org commission config. Immutable history (no UPDATE/DELETE) — a rate
-- change closes the open row and inserts a new one; a collection correction is
-- a new (possibly negative) row. RLS on, no policies: reachable only via the
-- platform SECURITY DEFINER RPCs.

DO $$ BEGIN
  CREATE TYPE public.commission_basis AS ENUM ('vat_inclusive', 'vat_exclusive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.org_commission_rates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id),
  rate_percent     numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  commission_basis public.commission_basis NOT NULL,
  vat_rate_percent numeric(5,2) NOT NULL DEFAULT 13.00 CHECK (vat_rate_percent >= 0),
  effective_from   date NOT NULL,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES auth.users(id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_commission_rates_org ON public.org_commission_rates (org_id, effective_from);

CREATE TABLE IF NOT EXISTS public.org_commission_collections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  amount_collected numeric(10,2) NOT NULL,
  collected_at     date NOT NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES auth.users(id),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_commission_collections_org ON public.org_commission_collections (org_id);

ALTER TABLE public.org_commission_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_commission_collections ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all to authenticated/anon; definer RPCs bypass as owner.

INSERT INTO public.schema_migrations (version, name)
VALUES ('114', 'commission-tables') ON CONFLICT (version) DO NOTHING;
