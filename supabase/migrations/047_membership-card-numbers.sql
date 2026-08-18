-- Migration 047: membership-card-numbers (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: physical/printed membership CARD numbers. schema.sql has
-- no literal "card_number" column anywhere, but it does have
-- memberships.membership_number (text) and membership_tiers.code_prefix (text,
-- non-empty), plus a set_membership_number() BEFORE INSERT trigger that auto-assigns
-- "<tier code_prefix>-<zero-padded sequence>" (e.g. "GLD-0001") the first time a
-- membership row is created, unless a value was already supplied (used for
-- backfill). That auto-numbering scheme is the closest, and only, candidate in the
-- schema for what a migration named "membership-card-numbers" would add, so this
-- file attributes membership_number + code_prefix + the numbering trigger to 047.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, guarded CHECK add, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS + CREATE).

-- 1. membership_tiers.code_prefix: the prefix printed on cards for that tier.
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS code_prefix text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_tiers_code_prefix_nonempty'
  ) THEN
    ALTER TABLE public.membership_tiers
      ADD CONSTRAINT membership_tiers_code_prefix_nonempty CHECK (length(btrim(code_prefix)) > 0);
  END IF;
END $$;

-- 2. memberships.membership_number: the assigned card number, unique per org.
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS membership_number text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_membership_number
  ON public.memberships USING btree (org_id, membership_number)
  WHERE (membership_number IS NOT NULL);

-- 3. set_membership_number(): auto-assigns "<prefix>-NNNN" on insert, unless the
--    caller already supplied one (trusted verbatim — used by backfills/migrations).
CREATE OR REPLACE FUNCTION public.set_membership_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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

-- 4. Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('047', 'membership-card-numbers')
ON CONFLICT (version) DO NOTHING;
