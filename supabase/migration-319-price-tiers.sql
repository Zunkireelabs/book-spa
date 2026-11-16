-- migration-319-price-tiers.sql
--
-- Tiered pricing: a customer who asks for a specific staff member pays that
-- person's tier price; "Any available" pays the service's base price.
--
-- Decisions baked in here (agreed with the user, 2026-11-15):
--   * A tier is a NAMED GROUP you add staff to. It does NOT replace
--     therapists.position, which stays a job title (Therapist, Chef,
--     Receptionist). A "Junior" tier sitting beside a "Senior Therapist"
--     position is expected — one is pricing, the other is a job.
--   * Price is per service, per tier. Not a percentage, not a flat uplift.
--   * No floor rule: a tier price may be below the service's base price.
--     Junior at 3,800 against a 4,200 base is intentional.
--   * The bill reflects WHO ACTUALLY DELIVERED, not who was quoted. Payment is
--     taken at/after service, so the booking price is a quote and the charge is
--     computed at payment time. That is why there is no refund machinery here
--     and nothing in this migration touches `payments`.

BEGIN;

-- ── 1. The tiers themselves ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.price_tiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Two tiers with the same name in one org would be indistinguishable in the
-- assignment popover. Case-insensitive, since "Senior" and "senior" are the
-- same tier to everyone except Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS price_tiers_org_name_uniq
  ON public.price_tiers (org_id, lower(name));

CREATE INDEX IF NOT EXISTS price_tiers_org_sort_idx
  ON public.price_tiers (org_id, sort_order);

COMMENT ON TABLE public.price_tiers IS
  'Named skill/price groups staff are assigned to (Junior, Senior, Master). '
  'Independent of therapists.position, which remains a job title. '
  'sort_order is display only and does not affect pricing. See migration-319.';

-- ── 2. Which tier a staff member is in ───────────────────────────────────────
-- One tier per person. NULL means untiered: they charge the service's base
-- price, same as "Any available".
ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS price_tier_id uuid REFERENCES public.price_tiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS therapists_price_tier_idx
  ON public.therapists (price_tier_id)
  WHERE price_tier_id IS NOT NULL;

COMMENT ON COLUMN public.therapists.price_tier_id IS
  'Price tier this staff member belongs to, or NULL to charge base price. '
  'ON DELETE SET NULL: deleting a tier un-tiers its staff rather than '
  'deleting them. See migration-319.';

-- ── 3. The price of one service for one tier ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_tier_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  price_tier_id  uuid NOT NULL REFERENCES public.price_tiers(id) ON DELETE CASCADE,
  price_npr      numeric(10,2) NOT NULL CHECK (price_npr >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One price per (service, tier). Without this a service could carry two
-- conflicting Senior prices and the booking flow would pick arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS service_tier_prices_uniq
  ON public.service_tier_prices (service_id, price_tier_id);

CREATE INDEX IF NOT EXISTS service_tier_prices_tier_idx
  ON public.service_tier_prices (price_tier_id);

COMMENT ON TABLE public.service_tier_prices IS
  'Price of one service for one tier. A missing row means that tier charges '
  'the service base price (services.price_npr) — absence is the fallback, not '
  'zero. No floor rule: a tier price may be below base. See migration-319.';

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- Both tables are org-scoped configuration, same posture as services: readable
-- by anyone signed in to the org (the booking flow needs prices), writable by
-- manager and above.
ALTER TABLE public.price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_tier_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read org price tiers" ON public.price_tiers;
CREATE POLICY "Staff can read org price tiers"
  ON public.price_tiers FOR SELECT TO authenticated
  USING (org_id = (SELECT u.org_id FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Manager can write org price tiers" ON public.price_tiers;
CREATE POLICY "Manager can write org price tiers"
  ON public.price_tiers FOR ALL TO authenticated
  USING (
    org_id = (SELECT u.org_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) IN ('manager', 'admin')
  )
  WITH CHECK (
    org_id = (SELECT u.org_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) IN ('manager', 'admin')
  );

-- service_tier_prices has no org_id of its own — scope through the tier, which
-- does. Wrapped in a subquery so the planner evaluates auth.uid() once per
-- statement rather than per row (the initplan pattern checked by
-- scripts/check-rls-initplan.sh).
DROP POLICY IF EXISTS "Staff can read org service tier prices" ON public.service_tier_prices;
CREATE POLICY "Staff can read org service tier prices"
  ON public.service_tier_prices FOR SELECT TO authenticated
  USING (
    price_tier_id IN (
      SELECT t.id FROM public.price_tiers t
      WHERE t.org_id = (SELECT u.org_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Manager can write org service tier prices" ON public.service_tier_prices;
CREATE POLICY "Manager can write org service tier prices"
  ON public.service_tier_prices FOR ALL TO authenticated
  USING (
    price_tier_id IN (
      SELECT t.id FROM public.price_tiers t
      WHERE t.org_id = (SELECT u.org_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
    )
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) IN ('manager', 'admin')
  )
  WITH CHECK (
    price_tier_id IN (
      SELECT t.id FROM public.price_tiers t
      WHERE t.org_id = (SELECT u.org_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
    )
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) IN ('manager', 'admin')
  );

-- The customer booking flow reads prices anonymously, same as it reads
-- services and active therapists today.
DROP POLICY IF EXISTS "Anonymous can read price tiers" ON public.price_tiers;
CREATE POLICY "Anonymous can read price tiers"
  ON public.price_tiers FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anonymous can read service tier prices" ON public.service_tier_prices;
CREATE POLICY "Anonymous can read service tier prices"
  ON public.service_tier_prices FOR SELECT TO anon USING (true);

-- ── 5. Deliberately NOT done here ────────────────────────────────────────────
-- No seed tiers. An org with no tiers behaves exactly as it does today: every
-- booking charges services.price_npr. The feature is opt-in per tenant.
--
-- No changes to bookings or payments. The quoted price already lives in
-- bookings.base_amount/final_amount, and the charge is recomputed at payment
-- time from whoever actually delivered — that is application logic, not a
-- schema change, and payments are immutable by design.

INSERT INTO public.schema_migrations (version, name)
VALUES ('319', 'price-tiers')
ON CONFLICT (version) DO NOTHING;

COMMIT;
