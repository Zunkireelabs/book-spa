-- One-off batch data fix: ~121 memberships (Nuad Thai Spa, created
-- 2026-08-29/09-01) whose membership_number was corrupted to the
-- customer's own phone number, same bug class as the single row fixed in
-- fix-membership-number-corruption.sql (PR #399/#401). Root cause: an
-- untracked ad-hoc SQL operation run directly against prod outside the
-- migration system -- confirmed no live app code path (enrollMember/
-- set_membership_number trigger) can produce this.
--
-- Scope: ONLY rows matching the phone-shaped pattern (-[0-9]{7,}$).
-- Deliberately excludes the 53 "NT_PCM_0063_0012"-style rows from the
-- legacy data-import-nuad-membership-history.sql import -- different,
-- intentional format, not corruption, out of scope for this fix.
--
-- Idempotent: re-running only touches rows still matching the bad pattern.
DO $$
DECLARE
  v_row record;
  v_prefix text;
  v_seq int;
  v_new_number text;
  v_fixed_count int := 0;
BEGIN
  FOR v_row IN
    SELECT m.id, m.org_id, m.tier_id
    FROM public.memberships m
    WHERE m.membership_number ~ '-[0-9]{7,}$'
    ORDER BY m.created_at, m.id
  LOOP
    SELECT code_prefix INTO v_prefix FROM public.membership_tiers WHERE id = v_row.tier_id;

    INSERT INTO public.membership_number_counters (org_id, tier_id, next_number)
    VALUES (v_row.org_id, v_row.tier_id, 2)
    ON CONFLICT (org_id, tier_id)
      DO UPDATE SET next_number = public.membership_number_counters.next_number + 1
    RETURNING next_number - 1 INTO v_seq;

    v_new_number := v_prefix || '-' || lpad(v_seq::text, 4, '0');

    UPDATE public.memberships SET membership_number = v_new_number WHERE id = v_row.id;

    v_fixed_count := v_fixed_count + 1;
  END LOOP;

  RAISE NOTICE 'Fixed % membership(s)', v_fixed_count;
END $$;
