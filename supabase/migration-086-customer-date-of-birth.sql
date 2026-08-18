-- Migration 086: add customers.date_of_birth (additive, REVERSIBLE)
--
-- Membership enrollment wants an optional date of birth per customer, to
-- support the org's "free on your birthday" perk (previously only tracked
-- as memberships.birthday_perk_used_at — whether the perk was used, with no
-- stored date to check it against). Nullable and optional: staff can leave
-- it blank at enrollment time, same as email/gender already are.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible:
--   ALTER TABLE public.customers DROP COLUMN IF EXISTS date_of_birth;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS date_of_birth date;

INSERT INTO public.schema_migrations (version, name)
VALUES ('086', 'customer-date-of-birth')
ON CONFLICT (version) DO NOTHING;
