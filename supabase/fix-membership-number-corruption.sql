-- One-off data fix: the membership row whose membership_number was
-- corrupted to a customer-phone-shaped value ("LZP-PCM-9801020407" --
-- the digits after the last dash are literally customer Bimal Sawarthia's
-- phone +9779801020407, minus the country code) instead of a real
-- PREFIX-NNNN card number. See PR #399 for the defensive migration fix
-- (prevents future crashes on malformed data); this repairs the one row
-- originally reported.
--
-- NOTE: this touches only the single reported row. A broader sweep found
-- ~175 memberships.membership_number values that don't match PREFIX-NNNN,
-- in three distinct bulk-import batches (two more phone-corrupted batches
-- plus a differently-formatted legacy-sequence batch) -- those are a
-- separate, intentionally-deferred decision, NOT covered by this script.
--
-- Requires migration-265/266 (membership_number_counters) to already be
-- live -- run scripts/migrate-status.sh prod first if unsure.
--
-- Safe to re-run: no-ops if the row's membership_number no longer matches
-- the known-bad value (i.e., already fixed).
DO $$
DECLARE
  v_row record;
  v_prefix text;
  v_seq int;
BEGIN
  SELECT m.id, m.org_id, m.tier_id INTO v_row
  FROM public.memberships m
  WHERE m.membership_number = 'LZP-PCM-9801020407'  -- exact known-bad value from the CI error
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE NOTICE 'No row with the known-bad membership_number found -- already fixed or value differs, check manually.';
    RETURN;
  END IF;

  SELECT code_prefix INTO v_prefix FROM public.membership_tiers WHERE id = v_row.tier_id;

  INSERT INTO public.membership_number_counters (org_id, tier_id, next_number)
  VALUES (v_row.org_id, v_row.tier_id, 2)
  ON CONFLICT (org_id, tier_id)
    DO UPDATE SET next_number = public.membership_number_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  UPDATE public.memberships
  SET membership_number = v_prefix || '-' || lpad(v_seq::text, 4, '0')
  WHERE id = v_row.id;

  RAISE NOTICE 'Fixed membership % -> %', v_row.id, v_prefix || '-' || lpad(v_seq::text, 4, '0');
END $$;
