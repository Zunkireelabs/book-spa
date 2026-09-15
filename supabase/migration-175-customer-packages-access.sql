-- ============================================================
-- Migration 175: customer self-read access for packages
-- ============================================================
--
-- packages/package_types/package_redemptions (migration-141) currently only
-- grant staff/manager/admin SELECT — there's no customer-facing policy, so
-- a customer session querying them (or package_balances, which is
-- security_invoker = true and therefore inherits whatever RLS the querying
-- role has) gets zero rows. This adds the customer counterpart, same
-- pattern already used for vouchers (migration-082) and memberships
-- (migration-065).
--
-- The package_redemptions policy is required even though the customer UI
-- never queries that table directly — package_balances' sessions_used
-- aggregate joins it, and being security_invoker, that join is itself
-- RLS-filtered; without this policy every package would show
-- sessions_used = 0 regardless of actual redemptions. The package_types
-- policy is needed so the package_type:package_type_id(name) embed doesn't
-- null out for a customer session.
--
-- Idempotent (DROP POLICY IF EXISTS + CREATE POLICY), additive/reversible
-- (DROP POLICY the three below to revert). Gated on to_regclass so this
-- no-ops safely if packages was ever absent in some environment, matching
-- migration-065's own pattern for membership tables.
--
-- Safe to run multiple times.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.package_types') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "customer reads own org package types" ON public.package_types;
  CREATE POLICY "customer reads own org package types" ON public.package_types
    FOR SELECT
    USING (org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid()));

  DROP POLICY IF EXISTS "customer reads own packages" ON public.packages;
  CREATE POLICY "customer reads own packages" ON public.packages
    FOR SELECT
    USING (
      customer_id IN (
        SELECT customer_id FROM public.customer_accounts
        WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
      )
    );

  DROP POLICY IF EXISTS "customer reads own package redemptions" ON public.package_redemptions;
  CREATE POLICY "customer reads own package redemptions" ON public.package_redemptions
    FOR SELECT
    USING (
      package_id IN (
        SELECT id FROM public.packages WHERE customer_id IN (
          SELECT customer_id FROM public.customer_accounts
          WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
        )
      )
    );
END;
$$;

-- ============================================================
-- MIGRATION 175 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('175', 'customer-packages-access')
ON CONFLICT (version) DO NOTHING;
