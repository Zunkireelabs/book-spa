-- Migration 053: customers.gender (additive, REVERSIBLE)
--
-- Adds a gender field on the customer record itself. Until now gender was
-- only ever captured per-booking (bookings.customer_gender, free text, used
-- for therapist-gender-preference matching) -- there was nowhere to store it
-- against the customer's own profile, so staff enrolling a member had no way
-- to record it. Free-text like bookings.customer_gender (not the stricter
-- 'Male'/'Female' CHECK used on therapists.gender), since the customer-facing
-- booking flow already offers a third "Other" option.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- Portable: no UUIDs.
--
-- Reversible:
--   ALTER TABLE public.customers DROP COLUMN IF EXISTS gender;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS gender text;

INSERT INTO public.schema_migrations (version, name)
VALUES ('053', 'customers-gender')
ON CONFLICT (version) DO NOTHING;
