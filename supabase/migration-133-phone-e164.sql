-- Migration 133: canonical E.164 phone storage (data backfill + self-healing triggers)
--
-- Until now every phone number was normalised in JS to "last 10 digits"
-- (`.replace(/\D/g,'').slice(-10)`). That is correct only for Nepal (+977 plus a
-- 10-digit national number). For any other country the dial code was silently
-- dropped or mangled:
--   * `customers.phone` stored an 8-digit Singapore national as `6591234567`
--     (the "65" glued in), so that customer never matched themselves again;
--   * two different countries' numbers sharing their last 10 digits collapsed
--     into one customer record and one "outstanding balance".
-- Meanwhile `bookings.customer_phone` was stored with the dial code prepended
-- but no separator (`+9779841234567`), a third format nothing else agreed with.
--
-- This migration makes ONE canonical format the rule everywhere — E.164:
-- a leading "+" then digits only, no spaces or dashes ("+9779841234567").
--
--   1. public.normalize_phone_e164(text)  — the shared normaliser. Mirrors
--      src/utils/phone.js `toE164()` exactly: keep an explicit "+"; otherwise a
--      value of 10 digits or fewer is treated as a bare Nepal national number
--      and gets "+977" prepended; anything longer is assumed to already carry a
--      country code.
--   2. Pre-flight guard — RAISE (aborting the migration) if normalising
--      `customers.phone` would merge two distinct customer rows in one org, so
--      duplicates are resolved by a human rather than silently collapsed or
--      hitting `customers_org_nphone_uniq` (migration-036) mid-backfill.
--   3. Backfill `customers.phone` and `bookings.customer_phone` to E.164 (the
--      bookings backfill briefly disables trg_enforce_booking_immutability so
--      locked/Completed bookings' customer_phone still gets normalised).
--   4. BEFORE INSERT/UPDATE triggers on both columns so every future write —
--      from any code path, staff form, or ad hoc SQL — is canonicalised too.
--
-- `customers_org_nphone_uniq` (an expression index that already strips
-- non-digits) keeps working unchanged; the normalised values stay unique per
-- org, they are just longer now (they include the country code).
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, the backfill only
-- touches rows whose value actually changes, ON CONFLICT DO NOTHING.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual — data cannot be un-normalised, but the machinery drops):
--   DROP TRIGGER IF EXISTS bookings_normalize_phone ON public.bookings;
--   DROP TRIGGER IF EXISTS customers_normalize_phone ON public.customers;
--   DROP FUNCTION IF EXISTS public.trg_bookings_normalize_phone();
--   DROP FUNCTION IF EXISTS public.trg_customers_normalize_phone();
--   DROP FUNCTION IF EXISTS public.normalize_phone_e164(text);

-- ============================================================
-- 1. Shared normaliser
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_phone_e164(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trim   text := btrim(coalesce(p_raw, ''));
  v_plus   boolean := left(v_trim, 1) = '+';
  v_digits text := regexp_replace(v_trim, '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;
  IF v_plus THEN
    RETURN '+' || v_digits;
  END IF;
  -- No explicit "+": 10 digits or fewer is a bare Nepal national number.
  IF length(v_digits) <= 10 THEN
    RETURN '+977' || v_digits;
  END IF;
  -- Longer values already carry a country code (either +977… or a real one).
  RETURN '+' || v_digits;
END;
$$;

-- ============================================================
-- 2. Pre-flight: refuse to run if the backfill would merge customers
-- ============================================================

DO $$
DECLARE
  v_org   uuid;
  v_nphone text;
  v_ids   uuid[];
BEGIN
  SELECT c.org_id, public.normalize_phone_e164(c.phone), array_agg(c.id ORDER BY c.id)
    INTO v_org, v_nphone, v_ids
  FROM public.customers c
  WHERE c.phone IS NOT NULL
  GROUP BY c.org_id, public.normalize_phone_e164(c.phone)
  HAVING count(*) > 1
  LIMIT 1;

  IF v_org IS NOT NULL THEN
    RAISE EXCEPTION
      'migration-133: normalising customers.phone would merge % rows in org % onto % — merge/clean these duplicates first: %',
      array_length(v_ids, 1), v_org, v_nphone, v_ids;
  END IF;
END $$;

-- ============================================================
-- 3. Backfill (only rows that actually change)
-- ============================================================

UPDATE public.customers
SET phone = public.normalize_phone_e164(phone)
WHERE phone IS NOT NULL
  AND phone IS DISTINCT FROM public.normalize_phone_e164(phone);

-- trg_enforce_booking_immutability (schema.sql) rejects ANY UPDATE on a locked
-- (day-closed) or Completed booking, including this backfill's own write to
-- customer_phone. Disable it for just this one-time, system-level normalisation;
-- future writes to customer_phone on a locked booking still go through the
-- self-healing trigger below AND remain subject to the immutability check.
ALTER TABLE public.bookings DISABLE TRIGGER trg_enforce_booking_immutability;

UPDATE public.bookings
SET customer_phone = public.normalize_phone_e164(customer_phone)
WHERE customer_phone IS NOT NULL
  AND customer_phone IS DISTINCT FROM public.normalize_phone_e164(customer_phone);

ALTER TABLE public.bookings ENABLE TRIGGER trg_enforce_booking_immutability;

-- ============================================================
-- 4. Self-healing triggers for every future write
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_customers_normalize_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone := public.normalize_phone_e164(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_normalize_phone ON public.customers;
CREATE TRIGGER customers_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_customers_normalize_phone();

CREATE OR REPLACE FUNCTION public.trg_bookings_normalize_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.customer_phone := public.normalize_phone_e164(NEW.customer_phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_normalize_phone ON public.bookings;
CREATE TRIGGER bookings_normalize_phone
  BEFORE INSERT OR UPDATE OF customer_phone ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bookings_normalize_phone();

-- ============================================================
-- 5. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('133', 'phone-e164') ON CONFLICT (version) DO NOTHING;
