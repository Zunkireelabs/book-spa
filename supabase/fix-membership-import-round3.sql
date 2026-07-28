-- One-time follow-up to supabase/fix-membership-import-round2.sql and
-- migration-061-renew-membership-forfeit-balance.sql.
--
-- Audit finding: round2.sql applied 22 historical renewals as a plain
-- deposit on the already-imported base membership. For 12 of those rows the
-- source explicitly said "CARD DONE" (fully spent), so the script zeroed the
-- balance first -- but the other 10 (Aanand Mishra, Birendra Shrestha,
-- Manisha Karki, Dennis Tiew, Amit Chaudhary, rakesh adhukia, Subhi Pradan,
-- Bimal Sawarthia, Lin, Barsha) still had a nonzero balance in the DB at
-- renewal time and the renewal deposit was simply added on top of it. The
-- same additive bug also affected any real renewal done through the app's
-- "Renew" button before migration-061 fixed renew_membership(). Symptom: a
-- membership shows the sum of every deposit it ever received (e.g. 400000)
-- instead of just its most recent renewal amount (e.g. 100000), which is
-- what the source sheet and the RenewModal's "starts a fresh cycle" copy
-- both expect.
--
-- Fix: for every membership, find the latest 'deposit' transaction whose
-- notes mark it as a renewal -- that's the start of the current cycle. If
-- the membership's live balance differs from SUM(amount) for transactions
-- at/after that point, insert one corrective 'adjustment' row that brings
-- the balance in line. Nothing is deleted -- every prior transaction stays
-- in the ledger/transaction history, only the live "current balance" is
-- corrected.
--
-- Staging-only. Safe to re-run: after the first run every membership's
-- balance already matches its since-last-renewal sum (this script's own
-- adjustment rows land after the same reset point, so they're included in
-- the recomputed sum), so a second run finds zero discrepancies and inserts
-- nothing.

DO $$
DECLARE
  v_org_id uuid;
  rec RECORD;
  n_fixed int := 0;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'ABORT: org nuad-thai-spa not found';
    RETURN;
  END IF;

  FOR rec IN
    WITH reset_point AS (
      SELECT membership_id, MAX(created_at) AS reset_at
      FROM public.membership_transactions
      WHERE org_id = v_org_id
        AND kind = 'deposit'
        AND notes ILIKE '%renewal%'
      GROUP BY membership_id
    ),
    since_reset AS (
      SELECT m.id AS membership_id,
             m.membership_number,
             m.balance AS db_balance,
             COALESCE(SUM(t.amount) FILTER (
               WHERE rp.reset_at IS NULL OR t.created_at >= rp.reset_at
             ), 0) AS should_be
      FROM public.memberships m
      LEFT JOIN reset_point rp ON rp.membership_id = m.id
      LEFT JOIN public.membership_transactions t ON t.membership_id = m.id
      WHERE m.org_id = v_org_id
      GROUP BY m.id, m.membership_number, m.balance
    )
    SELECT * FROM since_reset WHERE db_balance <> should_be
  LOOP
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (
      rec.membership_id, v_org_id, 'adjustment', (rec.should_be - rec.db_balance),
      'Balance audit correction: forfeited pre-renewal leftover balance so the current balance reflects only the latest renewal cycle. Full history preserved above this row.'
    );
    n_fixed := n_fixed + 1;
    RAISE NOTICE 'Corrected %: % -> %', rec.membership_number, rec.db_balance, rec.should_be;
  END LOOP;

  RAISE NOTICE 'Done: % membership(s) corrected.', n_fixed;
END $$;
