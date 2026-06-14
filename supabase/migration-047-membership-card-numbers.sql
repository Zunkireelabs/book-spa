-- Migration 047: human-readable membership card numbers (additive, REVERSIBLE)
--
-- Adds a printable / speakable card number to every membership so staff can find
-- a member by quoting the number (e.g., "PCM-0042") and so the card can appear
-- on a digital/physical pass.
--
-- Format: <tier prefix>-<4-digit sequence per (org, tier)>
--   Premium Club  → PCM-0001, PCM-0002, …
--   Deluxe  Club  → DCM-0001, DCM-0002, …
--
-- The prefix lives on the tier (code_prefix column) so future tiers can pick
-- their own letters without code changes. The sequence is computed at INSERT
-- time by a BEFORE trigger; a UNIQUE(org_id, membership_number) backstops the
-- (rare, manual) concurrent-enroll race.
--
-- Idempotent (CREATE … IF NOT EXISTS, CREATE OR REPLACE, guarded ALTERs) and
-- portable (no UUIDs).
--
-- Reversible:
--   DROP TRIGGER  IF EXISTS trg_set_membership_number ON public.memberships;
--   DROP FUNCTION IF EXISTS public.set_membership_number();
--   ALTER TABLE public.memberships
--     DROP CONSTRAINT IF EXISTS uniq_org_membership_number,
--     DROP COLUMN     IF EXISTS membership_number;
--   ALTER TABLE public.membership_tiers DROP COLUMN IF EXISTS code_prefix;

-- ============================================================
-- 1. membership_tiers.code_prefix
-- ============================================================

ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS code_prefix text NOT NULL DEFAULT '';

-- Seed the existing two tiers. Re-runs are no-ops because the WHERE filter
-- only matches rows that still have the default empty prefix.
UPDATE public.membership_tiers SET code_prefix = 'PCM'
 WHERE name = 'Premium Club' AND (code_prefix IS NULL OR code_prefix = '');

UPDATE public.membership_tiers SET code_prefix = 'DCM'
 WHERE name = 'Deluxe Club'  AND (code_prefix IS NULL OR code_prefix = '');

-- Verify before locking the rule in. If a tier was added between migrations 045
-- and 047 without a prefix, fail loud so the admin sets one before the trigger
-- starts depending on it.
DO $$
DECLARE n_missing int;
BEGIN
  SELECT count(*) INTO n_missing
  FROM public.membership_tiers
  WHERE code_prefix IS NULL OR code_prefix = '';
  IF n_missing > 0 THEN
    RAISE EXCEPTION 'migration-047: % membership_tiers rows still have an empty code_prefix; set one before continuing', n_missing;
  END IF;
END $$;

ALTER TABLE public.membership_tiers
  ADD CONSTRAINT membership_tiers_code_prefix_nonempty
  CHECK (length(btrim(code_prefix)) > 0);

-- ============================================================
-- 2. memberships.membership_number + UNIQUE backstop
-- ============================================================

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS membership_number text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_membership_number
  ON public.memberships(org_id, membership_number)
  WHERE membership_number IS NOT NULL;

-- ============================================================
-- 3. BEFORE INSERT trigger to generate the number
-- ============================================================
-- Counts the existing memberships at the SAME tier in the SAME org and adds 1,
-- padded to 4 digits. e.g., the 7th Premium-Club member in Nuad Thai Spa lands
-- as PCM-0007.

CREATE OR REPLACE FUNCTION public.set_membership_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_seq    int;
BEGIN
  IF NEW.membership_number IS NOT NULL AND length(NEW.membership_number) > 0 THEN
    RETURN NEW;  -- caller supplied one (backfill / migration) — trust it
  END IF;

  SELECT code_prefix INTO v_prefix
  FROM public.membership_tiers
  WHERE id = NEW.tier_id;

  IF v_prefix IS NULL OR length(v_prefix) = 0 THEN
    RAISE EXCEPTION 'set_membership_number: tier % has no code_prefix', NEW.tier_id;
  END IF;

  SELECT COALESCE(count(*), 0) + 1 INTO v_seq
  FROM public.memberships
  WHERE org_id = NEW.org_id AND tier_id = NEW.tier_id;

  NEW.membership_number := v_prefix || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_membership_number ON public.memberships;
CREATE TRIGGER trg_set_membership_number
  BEFORE INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_membership_number();

-- ============================================================
-- 4. Backfill any existing rows (created before this migration)
-- ============================================================
-- Order by created_at ASC inside each (org, tier) so the first-enrolled member
-- gets sequence 1. Skip rows that already have a number.

WITH numbered AS (
  SELECT m.id,
         t.code_prefix || '-' ||
         lpad(row_number() OVER (PARTITION BY m.org_id, m.tier_id ORDER BY m.created_at, m.id)::text, 4, '0')
         AS new_number
  FROM public.memberships m
  JOIN public.membership_tiers t ON t.id = m.tier_id
  WHERE m.membership_number IS NULL
)
UPDATE public.memberships m
   SET membership_number = numbered.new_number
  FROM numbered
 WHERE m.id = numbered.id;

-- ============================================================
-- 5. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('047', 'membership-card-numbers')
ON CONFLICT (version) DO NOTHING;
