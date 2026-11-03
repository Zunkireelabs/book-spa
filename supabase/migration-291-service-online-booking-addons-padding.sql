-- Migration 291: Online Booking settings + Add-ons + Padding/Processing time
--
-- Three independent, additive Service Detail features, all requested together:
-- 1. "Clients can book this service online" — services.bookable_online. Default
--    true so every existing service keeps its current (implicitly bookable)
--    behavior; staff can opt individual services out of the public booking
--    widget without deactivating them for in-person/staff booking.
-- 2. Add-ons: services.is_addon flags a service as eligible to be offered as an
--    add-on to OTHER services. service_addons is the per-service picklist of
--    which add-on services to actually offer alongside a given service — kept
--    as a separate junction (mirrors service_therapists/combo_package_components)
--    rather than a single flag, since "eligible to be an add-on" and "offered
--    alongside THIS service" are different questions (an add-on-eligible
--    service isn't auto-attached to every other service).
-- 3. Padding/processing time — padding_before_minutes blocks additional calendar
--    time before the appointment (setup); padding_after_minutes + padding_after_type
--    blocks time after it, either as plain "padding" (cleanup, staff busy) or
--    "processing" (e.g. color processing — client's time, not necessarily staff-
--    blocking, call sites that care about the distinction can branch on the type).
--    This migration only adds the columns + Service Detail form support — it does
--    NOT yet change createBooking/calendar conflict-checking to actually honor
--    padding; that's a separate, larger booking-flow change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS throughout.
-- Reversible:
--   DROP TABLE IF EXISTS public.service_addons;
--   ALTER TABLE public.services
--     DROP COLUMN IF EXISTS bookable_online,
--     DROP COLUMN IF EXISTS is_addon,
--     DROP COLUMN IF EXISTS padding_before_minutes,
--     DROP COLUMN IF EXISTS padding_after_minutes,
--     DROP COLUMN IF EXISTS padding_after_type;

BEGIN;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS bookable_online boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_addon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS padding_before_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS padding_after_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS padding_after_type text NOT NULL DEFAULT 'padding';

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_padding_before_minutes_check;
ALTER TABLE public.services
  ADD CONSTRAINT services_padding_before_minutes_check CHECK (padding_before_minutes >= 0);

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_padding_after_minutes_check;
ALTER TABLE public.services
  ADD CONSTRAINT services_padding_after_minutes_check CHECK (padding_after_minutes >= 0);

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_padding_after_type_check;
ALTER TABLE public.services
  ADD CONSTRAINT services_padding_after_type_check CHECK (padding_after_type IN ('padding', 'processing'));

CREATE TABLE IF NOT EXISTS public.service_addons (
  service_id       uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  addon_service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, addon_service_id),
  CONSTRAINT service_addons_no_self_reference CHECK (service_id != addon_service_id)
);

CREATE INDEX IF NOT EXISTS idx_service_addons_service ON public.service_addons(service_id);

ALTER TABLE public.service_addons ENABLE ROW LEVEL SECURITY;

-- Same shape as service_therapists/combo_package_components: SELECT for any
-- in-org authenticated user (the public booking widget needs to read this to
-- offer add-ons at checkout — anon read follows further below), ALL for
-- manager/admin, scoped through the parent service's org_id (no org_id column
-- on this table itself).
DROP POLICY IF EXISTS "Users can read own org service addons" ON public.service_addons;
CREATE POLICY "Users can read own org service addons"
  ON public.service_addons FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_addons.service_id
        AND s.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Admin can manage service addons" ON public.service_addons;
CREATE POLICY "Admin can manage service addons"
  ON public.service_addons FOR ALL
  TO authenticated
  USING (
    get_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_addons.service_id
        AND s.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_addons.service_id
        AND s.org_id = get_user_org_id()
    )
  );

-- Anonymous (public booking widget) can read add-ons for any active, online-
-- bookable service — mirrors "Anonymous can read active services".
DROP POLICY IF EXISTS "Anonymous can read addons for bookable services" ON public.service_addons;
CREATE POLICY "Anonymous can read addons for bookable services"
  ON public.service_addons FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_addons.service_id
        AND s.is_active = true
        AND s.bookable_online = true
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('291', 'service-online-booking-addons-padding')
ON CONFLICT (version) DO NOTHING;

COMMIT;
