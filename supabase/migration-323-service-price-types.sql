-- migration-323-service-price-types.sql
--
-- How a service is priced. Until now every service had exactly one number
-- (services.price_npr) and no way to say "free", "ask at the desk", or
-- "depends who does it".
--
-- Five types, agreed with the user on 2026-11-15:
--
--   fixed         one price for everyone. Today's behaviour, and the default,
--                 so nothing changes for the 196 existing services.
--   free          no charge. Distinct from a price of 0 only in intent, but
--                 the intent is what the booking screen needs to show.
--   calendar_only priced internally, hidden from the public booking flow.
--                 Staff see the amount; a customer online does not.
--   no_default    no price set at all — whoever takes the booking enters one.
--   tiered        price depends on which tier the assigned staff member is in.
--
-- Tiered pricing, in the user's words: "if the user selects tiered price then
-- they should be setting price for each tier employees… if the lower price is
-- 160 and upper is 380 then it should show Rs 160 - 380 of that particular
-- service but when the staff is assigned according to which staff assigned
-- charge accordingly… there should also be unassigned tier price. So that
-- when the staff doesnot have selected tier it will charge same unassigned
-- tier price."
--
-- So: the online flow shows a RANGE across all the tier prices; the booking
-- charges the assigned person's tier; and staff in no tier charge the
-- Unassigned rate.
--
-- The Unassigned rate is services.price_npr, not a new column. It already
-- means "the price when nothing more specific applies", which is exactly the
-- definition, and reusing it keeps one price to migrate, one to fall back to,
-- and one to show when a service later switches away from tiered. The UI
-- renders it as the first row of the tier grid, labelled Unassigned.

BEGIN;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'fixed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.services'::regclass AND conname = 'services_price_type_check'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_price_type_check
      CHECK (price_type IN ('fixed', 'free', 'calendar_only', 'no_default', 'tiered'));
  END IF;
END $$;

COMMENT ON COLUMN public.services.price_type IS
  'fixed | free | calendar_only | no_default | tiered. Defaults to fixed so '
  'existing services are unchanged. When tiered, services.price_npr is the '
  'Unassigned rate and service_tier_prices holds the rest. See migration-323.';

COMMENT ON COLUMN public.services.price_npr IS
  'The service price. Under price_type=tiered this is the UNASSIGNED rate — '
  'what staff with no tier charge — and per-tier prices live in '
  'service_tier_prices. Under free it is ignored; under no_default it is a '
  'suggestion the booker may overwrite. See migration-323.';

-- ── The price range shown to customers online ────────────────────────────────
-- Computed rather than stored: a stored min/max would go stale the moment a
-- tier price changes or a tier is deleted, and there is no trigger that could
-- catch every path into service_tier_prices.
--
-- Returns the Unassigned rate alongside the tier prices, because an untiered
-- staff member is a real thing a customer might be booked with — leaving it
-- out would advertise a floor the customer cannot actually get.
CREATE OR REPLACE FUNCTION public.service_price_range(p_service_id uuid)
RETURNS TABLE (min_price numeric, max_price numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT MIN(p), MAX(p)
  FROM (
    SELECT s.price_npr AS p FROM public.services s WHERE s.id = p_service_id
    UNION ALL
    SELECT stp.price_npr FROM public.service_tier_prices stp WHERE stp.service_id = p_service_id
  ) prices;
$$;

COMMENT ON FUNCTION public.service_price_range(uuid) IS
  'Lowest and highest price a customer could pay for this service, across the '
  'Unassigned rate and every tier price. Drives the "Rs 160 - 380" range in '
  'the public booking flow. See migration-323.';

-- ── What a specific staff member charges ─────────────────────────────────────
-- One place that answers "what does this person cost for this service", so the
-- booking screen, the payment screen and any report cannot drift apart.
--
-- Falls back to the Unassigned rate when the staff member has no tier, or has
-- one with no price set for this service. Absence of a tier price means "same
-- as Unassigned", never zero — a missing row must not make a service free.
CREATE OR REPLACE FUNCTION public.service_price_for_therapist(
  p_service_id uuid,
  p_therapist_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT stp.price_npr
      FROM public.service_tier_prices stp
      JOIN public.therapists t ON t.price_tier_id = stp.price_tier_id
      WHERE stp.service_id = p_service_id
        AND t.id = p_therapist_id
      LIMIT 1
    ),
    (SELECT s.price_npr FROM public.services s WHERE s.id = p_service_id)
  );
$$;

COMMENT ON FUNCTION public.service_price_for_therapist(uuid, uuid) IS
  'Price this staff member charges for this service: their tier price, or the '
  'Unassigned rate (services.price_npr) when they have no tier or no price is '
  'set for it. Never returns 0 for a missing tier row. See migration-323.';

-- ── Not done here, deliberately ──────────────────────────────────────────────
-- No backfill of price_type. Every existing service stays 'fixed', which is
-- exactly how they behave today — a migration that silently re-priced 196
-- services would be far worse than one that changes nothing.
--
-- Nothing written to bookings. The charge is computed from whoever actually
-- delivered the service, at payment time, per the decision recorded in
-- migration-319. The booking still carries its own amount columns as the
-- agreed quote.

INSERT INTO public.schema_migrations (version, name)
VALUES ('323', 'service-price-types')
ON CONFLICT (version) DO NOTHING;

COMMIT;
