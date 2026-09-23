-- Migration 199: campaign_services / campaign_categories (additive, REVERSIBLE)
--
-- Join tables linking a campaign (migration-198) to the specific services
-- and/or categories it applies to — a campaign never applies to anything
-- not explicitly linked here. A campaign can link individual services,
-- whole categories, or both; migration-200's priority function checks
-- direct service links before category links.
--
-- RLS: same org-scoped shape as campaigns itself, resolved via a join back
-- to campaigns.org_id (these tables have no org_id column of their own —
-- a link only ever makes sense in the context of its parent campaign's
-- org, so scoping through the FK avoids a redundant, potentially
-- inconsistent duplicate org_id column).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.campaign_services;
--   DROP TABLE IF EXISTS public.campaign_categories;

CREATE TABLE IF NOT EXISTS public.campaign_services (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  UNIQUE (campaign_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  UNIQUE (campaign_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_services_campaign ON public.campaign_services(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_services_service ON public.campaign_services(service_id);
CREATE INDEX IF NOT EXISTS idx_campaign_categories_campaign ON public.campaign_categories(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_categories_category ON public.campaign_categories(category_id);

ALTER TABLE public.campaign_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org campaign_services" ON public.campaign_services;
CREATE POLICY "Users can read own org campaign_services"
  ON public.campaign_services FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "Manager and admin can write org campaign_services" ON public.campaign_services;
CREATE POLICY "Manager and admin can write org campaign_services"
  ON public.campaign_services FOR ALL
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.org_id = get_user_org_id())
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "Users can read own org campaign_categories" ON public.campaign_categories;
CREATE POLICY "Users can read own org campaign_categories"
  ON public.campaign_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "Manager and admin can write org campaign_categories" ON public.campaign_categories;
CREATE POLICY "Manager and admin can write org campaign_categories"
  ON public.campaign_categories FOR ALL
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.org_id = get_user_org_id())
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.org_id = get_user_org_id())
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('199', 'campaign-links')
ON CONFLICT (version) DO NOTHING;
