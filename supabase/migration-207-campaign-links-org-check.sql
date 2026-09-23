-- Migration 207: campaign_services / campaign_categories cross-org write
-- guard (additive, REVERSIBLE)
--
-- Review finding on PR #296: campaign_services/campaign_categories'
-- WITH CHECK (migration-199) only verified the linked campaign belongs to
-- the caller's org — it never verified the linked service/category also
-- belongs to that same org. A manager who obtained another org's service
-- or category id could link their own campaign to it, and
-- get_active_campaign_discount_percent() (migration-200/208) would then
-- match purely on service_id/category_id with no org check of its own,
-- silently applying that org's campaign discount to a different org's
-- pricing — reachable from the dashboard view and the anonymous public
-- booking RPC alike. This is the same class of cross-tenant leak the
-- tenant-isolation rules this repo already follows everywhere else exist
-- to prevent; campaigns simply missed it when the feature shipped.
--
-- Fix: WITH CHECK now also requires the linked service's (or category's)
-- own org_id to match the campaign's org_id. USING is left exactly as it
-- was (it already scopes which rows are visible/targetable by the
-- campaign's org, which was never the gap — the gap was only in what a
-- write was allowed to newly point at).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Portable: no
-- hardcoded UUIDs.
--
-- Reversible (manual): re-apply migration-199's WITH CHECK clauses
-- verbatim (drop the added service.org_id/category.org_id match).

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
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      JOIN public.services s ON s.id = service_id
      WHERE c.id = campaign_id
        AND c.org_id = get_user_org_id()
        AND s.org_id = c.org_id
    )
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
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      JOIN public.service_categories sc ON sc.id = category_id
      WHERE c.id = campaign_id
        AND c.org_id = get_user_org_id()
        AND sc.org_id = c.org_id
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('207', 'campaign-links-org-check')
ON CONFLICT (version) DO NOTHING;
