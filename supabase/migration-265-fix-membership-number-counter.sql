-- Migration 265: replace COUNT(*)+1 membership-number generator with an
-- atomic per-(org, tier) counter -- fixes duplicate-key races/gap-reuse on
-- uniq_org_membership_number (migration-047's COUNT-based scheme).
--
-- Same bug class already fixed for voucher codes in migration-089/140
-- (voucher_code_counters) -- same atomic INSERT...ON CONFLICT DO UPDATE
-- pattern, applied here to memberships.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO UPDATE seed,
-- CREATE OR REPLACE FUNCTION, ON CONFLICT DO NOTHING on schema_migrations.
-- Portable: no hardcoded UUIDs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.membership_number_counters (
  org_id       uuid NOT NULL,
  tier_id      uuid NOT NULL REFERENCES public.membership_tiers(id),
  next_number  int NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, tier_id)
);

-- RLS enabled, zero policies -- default-deny all direct access; only
-- reachable via the SECURITY DEFINER trigger function (owner bypasses RLS).
-- Matches voucher_code_counters' posture exactly (migration-072).
ALTER TABLE public.membership_number_counters ENABLE ROW LEVEL SECURITY;

-- Ground-truth seed: next_number = 1 + the highest sequence number already
-- used in memberships.membership_number per (org, tier) -- never trust a
-- COUNT here, since undercounting (from past deletions) is exactly the bug.
INSERT INTO public.membership_number_counters (org_id, tier_id, next_number)
SELECT m.org_id, m.tier_id,
       COALESCE(MAX((regexp_match(m.membership_number, '-(\d+)$'))[1]::int), 0) + 1
FROM public.memberships m
WHERE m.membership_number IS NOT NULL
GROUP BY m.org_id, m.tier_id
ON CONFLICT (org_id, tier_id) DO UPDATE
  SET next_number = GREATEST(public.membership_number_counters.next_number, EXCLUDED.next_number);

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
    RETURN NEW;  -- caller supplied one (backfill / migration) -- trust it
  END IF;

  SELECT code_prefix INTO v_prefix
  FROM public.membership_tiers
  WHERE id = NEW.tier_id;

  IF v_prefix IS NULL OR length(v_prefix) = 0 THEN
    RAISE EXCEPTION 'set_membership_number: tier % has no code_prefix', NEW.tier_id;
  END IF;

  INSERT INTO public.membership_number_counters (org_id, tier_id, next_number)
  VALUES (NEW.org_id, NEW.tier_id, 2)
  ON CONFLICT (org_id, tier_id)
    DO UPDATE SET next_number = public.membership_number_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  NEW.membership_number := v_prefix || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('265', 'fix-membership-number-counter')
ON CONFLICT (version) DO NOTHING;

COMMIT;
