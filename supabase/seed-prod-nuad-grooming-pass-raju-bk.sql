-- PROD promotion script: seed-prod-nuad-grooming-pass-raju-bk
-- Adds "Raju BK" (sheet row 1 of `Grooming Pass Lazimpat.xlsx`), excluded from
-- the original 6-row grooming-pass import (seed-prod-nuad-grooming-pass-import.sql)
-- because the sheet's phone (9823287110) collided with an existing customer
-- ("aadrit bahadur shahh", Deluxe Club member).
--
-- User confirmed (2026-09-02) Raju BK's real phone is 9851097350 — not a
-- collision, sheet had a typo. Verified against production: +9779851097350
-- matches zero existing customers.
--
-- Portable, idempotent — same pattern as the original grooming-pass import.

BEGIN;

INSERT INTO public.customers (org_id, branch_id, full_name, phone)
SELECT o.id, br.id, 'Raju BK', '+9779851097350'
FROM public.organizations o
JOIN public.branches br ON br.org_id = o.id AND br.name = 'Lazimpat'
WHERE o.slug = 'nuad-thai-spa'
  AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.org_id = o.id AND c.phone = '+9779851097350'
  );

INSERT INTO public.memberships (
  org_id, customer_id, tier_id, total_deposited, balance,
  activation_date, expiry_date, notes
)
SELECT
  o.id, c.id, t.id, 15000.00, 9000.00,
  DATE '2025-12-10', DATE '2026-12-10',
  'Imported from Grooming Pass Lazimpat.xlsx (historical record, no transaction ledger back-filled). Phone corrected from sheet''s 9823287110 (collided with existing customer) to 9851097350 per client confirmation 2026-09-02.'
FROM public.organizations o
JOIN public.membership_tiers t ON t.org_id = o.id AND t.name = 'Premium Grooming Pass'
JOIN public.customers c ON c.org_id = o.id AND c.phone = '+9779851097350'
WHERE o.slug = 'nuad-thai-spa'
  AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = o.id AND m.customer_id = c.id AND m.tier_id = t.id
  );

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.memberships m
  JOIN public.customers c ON c.id = m.customer_id
  JOIN public.membership_tiers t ON t.id = m.tier_id
  JOIN public.organizations o ON o.id = m.org_id
  WHERE o.slug = 'nuad-thai-spa' AND t.name = 'Premium Grooming Pass' AND c.phone = '+9779851097350';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected 1 Raju BK Premium Grooming Pass membership after import, got %. Aborting.', v_count;
  END IF;
END $$;

COMMIT;
