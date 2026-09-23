-- Migration 198: campaigns table (additive, REVERSIBLE)
--
-- A named, dated, client-curated promotional event (e.g. "Dashain Offer,"
-- "Father's Day Offer") — distinct from the per-service/category offer
-- toggle in migrations 185/186. A campaign only ever applies to the
-- specific services/categories explicitly linked to it (migration-199's
-- campaign_services/campaign_categories), runs for a date window instead
-- of a manual on/off toggle, and is meant to be shown prominently on the
-- website (banner + popup, migration-203's public_get_active_campaign),
-- unlike the quiet per-row badge the base offer system produces.
--
-- Percent-only, matching the category-level offer's existing reasoning
-- (migration-194): a campaign can span several differently-priced
-- services, so a single flat override number can't apply uniformly.
--
-- is_active is a staff master switch independent of the date window — a
-- campaign is only actually "live" when BOTH is_active = true AND today
-- falls within [start_date, end_date] (checked inline wherever pricing is
-- computed, migration-200 onward — no cron, matching how vouchers/
-- memberships already check their own date ranges at read time instead of
-- a background job).
--
-- RLS: strict org-scoped (get_user_org_id()/get_user_role()), mirroring
-- migration-072-vouchers.sql's policy shape. Deliberately NOT the
-- permissive USING(true) pattern service_categories carries (that pattern
-- predates org multi-tenancy and was the subject of a real cross-org leak
-- fix, migration-093-fix-cross-org-rls-leak.sql). No anon policy on this
-- table at all — public website access goes through a SECURITY DEFINER
-- RPC instead (migration-203), never a direct table grant.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.campaigns;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id),
  name              text NOT NULL,
  message           text,
  banner_image_url  text,
  discount_percent  numeric(5, 2) NOT NULL CHECK (discount_percent > 0 AND discount_percent < 100),
  start_date        date NOT NULL,
  end_date          date NOT NULL CHECK (end_date >= start_date),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org ON public.campaigns(org_id);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org campaigns" ON public.campaigns;
CREATE POLICY "Users can read own org campaigns"
  ON public.campaigns FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Manager and admin can create org campaigns" ON public.campaigns;
CREATE POLICY "Manager and admin can create org campaigns"
  ON public.campaigns FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can update org campaigns" ON public.campaigns;
CREATE POLICY "Manager and admin can update org campaigns"
  ON public.campaigns FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can delete org campaigns" ON public.campaigns;
CREATE POLICY "Manager and admin can delete org campaigns"
  ON public.campaigns FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('198', 'campaigns-table')
ON CONFLICT (version) DO NOTHING;
