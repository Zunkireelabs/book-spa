-- Migration 266: keep membership_number_counters in sync when a caller
-- bypasses auto-generation by supplying an explicit membership_number
-- (backfill/import path in set_membership_number(), migration-047/265).
--
-- Without this, a manually-inserted number ahead of the counter's current
-- next_number would eventually collide with a future auto-generated one,
-- since the bypass path never touched membership_number_counters.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, ON CONFLICT DO NOTHING on
-- schema_migrations. Portable: no hardcoded UUIDs.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_membership_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_seq    int;
  v_manual_seq int;
BEGIN
  IF NEW.membership_number IS NOT NULL AND length(NEW.membership_number) > 0 THEN
    -- Caller supplied one (backfill / migration) -- trust it, but keep the
    -- counter in sync so auto-generation never falls behind and later
    -- collides with this manually-inserted number.
    v_manual_seq := (regexp_match(NEW.membership_number, '-(\d+)$'))[1]::int;
    IF v_manual_seq IS NOT NULL THEN
      INSERT INTO public.membership_number_counters (org_id, tier_id, next_number)
      VALUES (NEW.org_id, NEW.tier_id, v_manual_seq + 1)
      ON CONFLICT (org_id, tier_id) DO UPDATE
        SET next_number = GREATEST(public.membership_number_counters.next_number, v_manual_seq + 1);
    END IF;
    RETURN NEW;
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
VALUES ('266', 'sync-membership-number-counter-on-manual-insert')
ON CONFLICT (version) DO NOTHING;

COMMIT;
