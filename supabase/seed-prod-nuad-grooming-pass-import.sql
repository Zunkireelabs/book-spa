-- PROD promotion script: seed-prod-nuad-grooming-pass-import
-- Imports 6 "Premium Grooming Pass" members from `Grooming Pass Lazimpat.xlsx`
-- (Nuad Thai Spa, Lazimpat branch) into the existing `memberships` schema.
-- This is an NPR-wallet product (not session-based) so it uses `memberships`/
-- `membership_tiers`, not the migration-141 packages schema.
--
-- Portable: resolves org/branch/tier by name/slug, never hardcoded UUIDs.
-- Idempotent: WHERE NOT EXISTS keyed on natural uniqueness (tier name,
-- customer phone, membership per customer+tier).
--
-- NOT auto-applied by CI (not a supabase/migration-NNN-*.sql file) — manual
-- dashboard/MCP handoff per supabase/PROMOTION.md, same as other seed-prod-*
-- files.
--
-- Historical-record note: `memberships.total_deposited`/`balance` are
-- normally trigger-recomputed (`membership_recompute()`) from
-- `membership_transactions`, and `record_membership_transaction()`'s
-- deposit path sets `activation_date`/`expiry_date` to the CURRENT date +
-- tier validity, not any date the caller supplies. Since these are
-- historical records with known real issued/expiry dates, this script
-- inserts directly into `memberships` with those literal dates (bypassing
-- the RPC), and does NOT back-fill `membership_transactions` history —
-- same posture as the migration-141 packages import and the prior voucher
-- import (no historical ledger, balance/dates set directly on the
-- current-state row).
--
-- Excluded / flagged rows (not resolved by this script):
--   - "Raju BK" (sheet row 1, phone 9823287110): that phone number already
--     belongs to an existing customer, "aadrit bahadur shahh" (who already
--     has a Deluxe Club membership). Completely different name — likely a
--     typo in the sheet or a reused/shared number. SKIPPED per explicit
--     decision (2026-09-02) rather than guessing which identity is correct.
--     Needs manual resolution (confirm the real phone, or confirm it's an
--     alias) before this row can be added.
--   - "Shristi Raut" (sheet row 4): sheet listed Expiry Date as 22nd Apr
--     2026, identical to the Issued Date (a zero-length membership) — this
--     was a transcription typo confirmed corrected to 22nd Apr **2027** by
--     the user (2026-09-02). Imported with the corrected date, not the
--     sheet's literal (erroneous) value.
--
-- Tier: no "Premium Grooming Pass" tier existed on staging prior to this
-- script (only "Premium Club"/"Deluxe Club") — created here with
-- advance_amount = 15000 (matches every row's Amount) and validity_days =
-- 365 (matches every row's issued->expiry gap), code_prefix 'PGP' following
-- the 3-letter convention of the existing tiers (PCM/DCM).

BEGIN;

-- ============================================================
-- 1. membership_tiers: create "Premium Grooming Pass" if missing
-- ============================================================

INSERT INTO public.membership_tiers (org_id, name, advance_amount, validity_days, code_prefix)
SELECT o.id, 'Premium Grooming Pass', 15000.00, 365, 'PGP'
FROM public.organizations o
WHERE o.slug = 'nuad-thai-spa'
  AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers t
    WHERE t.org_id = o.id AND t.name = 'Premium Grooming Pass'
  );

-- ============================================================
-- 2. customers: create missing customers by phone (E.164), best-effort
--    match against existing customers by normalized phone otherwise
-- ============================================================

WITH src(full_name, phone_digits) AS (
  VALUES
    ('Sworup Raj Dhungana', '9843074784'),
    ('Aashi Agrawal',       '9802374514'),
    ('Shristi Raut',        '9841808394'),
    ('Punit Agrawal',       '9851108893'),
    ('Sonam Tamang',        '9851028271'),
    ('Basanta Tandon',      '9818802360')
)
INSERT INTO public.customers (org_id, branch_id, full_name, phone)
SELECT o.id, br.id, s.full_name, '+977' || s.phone_digits
FROM src s
JOIN public.organizations o ON o.slug = 'nuad-thai-spa'
JOIN public.branches br ON br.org_id = o.id AND br.name = 'Lazimpat'
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c
  WHERE c.org_id = o.id
    AND c.phone = '+977' || s.phone_digits
);

-- ============================================================
-- 3. memberships: one row per grooming-pass customer, historical dates
--    set directly (bypassing record_membership_transaction's
--    today-based activation logic), no membership_transactions back-fill
-- ============================================================

WITH src(full_name, phone_digits, issued_date, expiry_date, amount, remaining) AS (
  VALUES
    ('Sworup Raj Dhungana', '9843074784', DATE '2026-03-15', DATE '2027-03-15', 15000.00, 4350.00),
    ('Aashi Agrawal',       '9802374514', DATE '2026-04-08', DATE '2027-04-08', 15000.00, 1275.00),
    ('Shristi Raut',        '9841808394', DATE '2026-04-22', DATE '2027-04-22', 15000.00, 8925.00),
    ('Punit Agrawal',       '9851108893', DATE '2026-06-20', DATE '2027-06-20', 15000.00, 9750.00),
    ('Sonam Tamang',        '9851028271', DATE '2026-07-19', DATE '2027-07-19', 15000.00, 12900.00),
    ('Basanta Tandon',      '9818802360', DATE '2026-07-19', DATE '2027-07-19', 15000.00, 11925.00)
)
INSERT INTO public.memberships (
  org_id, customer_id, tier_id, total_deposited, balance,
  activation_date, expiry_date, notes
)
SELECT
  o.id, c.id, t.id, s.amount, s.remaining,
  s.issued_date, s.expiry_date,
  'Imported from Grooming Pass Lazimpat.xlsx (historical record, no transaction ledger back-filled)'
FROM src s
JOIN public.organizations o ON o.slug = 'nuad-thai-spa'
JOIN public.membership_tiers t ON t.org_id = o.id AND t.name = 'Premium Grooming Pass'
JOIN public.customers c
  ON c.org_id = o.id
 AND c.phone = '+977' || s.phone_digits
WHERE NOT EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.org_id = o.id AND m.customer_id = c.id AND m.tier_id = t.id
);

-- ============================================================
-- 4. Assertion: abort if the resolved row count isn't exactly 6
-- ============================================================

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.memberships m
  JOIN public.membership_tiers t ON t.id = m.tier_id
  JOIN public.organizations o ON o.id = m.org_id
  WHERE o.slug = 'nuad-thai-spa' AND t.name = 'Premium Grooming Pass';

  IF v_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 Premium Grooming Pass memberships after import, got %. Aborting.', v_count;
  END IF;
END $$;

COMMIT;

-- Verify:
-- SELECT c.full_name, c.phone, m.total_deposited, m.balance, m.activation_date, m.expiry_date, m.membership_number
-- FROM public.memberships m
-- JOIN public.customers c ON c.id = m.customer_id
-- JOIN public.membership_tiers t ON t.id = m.tier_id
-- WHERE t.name = 'Premium Grooming Pass'
-- ORDER BY c.full_name;
