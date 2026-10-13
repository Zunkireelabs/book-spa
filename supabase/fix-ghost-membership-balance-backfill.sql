-- One-off data fix: backfill missing membership_transactions ledger rows
-- for 3 memberships (PGP-0004 Ruby Palika, PGP-0006 Punit, PGP-0007 Raju
-- Bk, tier "Premium Grooming") imported from Grooming Pass Lazimpat.xlsx
-- with their current balance/total_deposited set directly, never through
-- the ledger -- i.e. "ghost balance": balance != 0 but zero transaction
-- rows, so membership_recompute() has nothing to recompute from and any
-- new transaction would wipe out the existing balance.
--
-- Reconstructs each membership's current numbers exactly (nothing visibly
-- changes): one deposit of total_deposited (the original pass purchase),
-- then one deduction of -(total_deposited - balance) for historical
-- redemptions that happened before this system existed.
--
-- Safe: all 3 already have activation_date set, so membership_recompute()
-- only updates total_deposited/balance on insert -- won't touch
-- activation/expiry dates.
--
-- Idempotent: skips any membership that already has ledger rows.
DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT id, org_id, total_deposited, balance, membership_number
    FROM public.memberships
    WHERE membership_number IN ('PGP-0004', 'PGP-0006', 'PGP-0007')
  LOOP
    IF EXISTS (SELECT 1 FROM public.membership_transactions WHERE membership_id = v_row.id) THEN
      RAISE NOTICE '% already has ledger rows, skipping', v_row.membership_number;
      CONTINUE;
    END IF;

    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_row.id, v_row.org_id, 'deposit', v_row.total_deposited,
            'Backfill: original Grooming Pass Lazimpat.xlsx import deposit');

    IF v_row.total_deposited > v_row.balance THEN
      INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
      VALUES (v_row.id, v_row.org_id, 'deduction', -(v_row.total_deposited - v_row.balance),
              'Backfill: historical redemptions before ledger tracking began');
    END IF;

    RAISE NOTICE 'Backfilled % (deposit %, net balance %)', v_row.membership_number, v_row.total_deposited, v_row.balance;
  END LOOP;
END $$;
