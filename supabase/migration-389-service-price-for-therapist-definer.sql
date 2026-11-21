-- Migration 389 (ZNLY-223): service_price_for_therapist becomes SECURITY DEFINER.
-- It was SECURITY INVOKER and read therapists.price_tier_id, but anon only has column SELECT on (id, name, gender, is_active, branch_id)
-- (mig 256), so an anonymous online booking of a tiered service with a chosen team member failed (42501), as did the group/combo path.
-- Now it runs as the owner and returns ONLY a price. The tier price applies only when the team member is active and in the same org as the
-- service; otherwise (or with no tier row) it returns the service's own price, i.e. the Unassigned rate. No grants on therapists change.
-- Idempotent. Rollback: re-create it without SECURITY DEFINER (body in migration-382 era).
BEGIN;
CREATE OR REPLACE FUNCTION public.service_price_for_therapist(p_service_id uuid, p_therapist_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT stp.price_npr
      FROM public.service_tier_prices stp
      JOIN public.therapists t ON t.price_tier_id = stp.price_tier_id
      JOIN public.services s   ON s.id = stp.service_id
      WHERE stp.service_id = p_service_id
        AND t.id = p_therapist_id
        AND t.org_id = s.org_id
      LIMIT 1
    ),
    (SELECT s.price_npr FROM public.services s WHERE s.id = p_service_id)
  );
$$;
REVOKE ALL ON FUNCTION public.service_price_for_therapist(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_price_for_therapist(uuid, uuid) TO anon, authenticated, service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('389', 'service-price-for-therapist-definer')
ON CONFLICT (version) DO NOTHING;
COMMIT;
