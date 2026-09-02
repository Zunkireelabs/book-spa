-- PROD promotion script: seed-prod-nuad-sanepa-packages-import
-- Imports 2 active session packages from `Annual Package Details Sanepa.xlsx`
-- (Nuad Thai Spa, Sanepa branch) into the migration-141 packages schema.
-- Reuses the existing org-wide `Annual Package - 60 min` package_type
-- created by the earlier Lazimpat import (package_types has no branch_id —
-- it's an org-level catalog, shared across branches).
--
-- Portable: resolves org/branch/service by name/slug, never hardcoded UUIDs.
-- Idempotent: WHERE NOT EXISTS keyed on (org_id, package_type_id,
-- customer_id, issued_date, sessions_total).
--
-- NOT auto-applied by CI — manual dashboard/MCP handoff per PROMOTION.md.
--
-- Source sheet has 12 rows total; only 2 are imported here. Decisions
-- (2026-09-02):
--   - 9 of 12 rows show "Cleared" in the "Remaining session" column (0
--     sessions left). The packages table requires sessions_total > 0, and
--     the sheet has no original-purchase session count for these rows
--     (only current 0-remaining status) — user decided to SKIP these 9
--     rather than fabricate an original count. Not imported, not tracked
--     anywhere. Names/phones for reference if this needs revisiting:
--     Raj Kumar Malla (9851040471), Jyoti Agarwal (9802030713),
--     Shivani Moktan / "Shivani" (9866430740, likely the same person,
--     two sheet rows), Shreejana (9851027486), Manoj Kumar Shrestha's
--     FIRST sheet entry (984957513 — 9 digits, likely a typo, see below),
--     Sangya Bhattarai (9851345445), Bal Krishna Bhandari (9851062965),
--     Gopal Agarwal (9808000211), Sweta Dahal (9851046847).
--   - "Manoj Kumar Shrestha" appears twice in the sheet: once as
--     "Cleared" with phone 984957513 (9 digits — likely a typo dropping a
--     digit), once as "6 times" remaining with phone 9849575613 (10
--     digits, used here). Treated as the same person; only the second,
--     numerically-complete entry is imported.
--   - Both imported rows had Issued Date = Expiry Date in the sheet (a
--     zero-length-validity typo, same class as the Lazimpat Shristi Raut
--     row) — user confirmed +1 year from issued is correct: Madhu
--     Agarwal 31 May 2026 -> 31 May 2027; Manoj Kumar Shrestha
--     10 June 2025 -> 10 June 2026.
--   - `sessions_total` = the sheet's literal remaining count ("3 times" /
--     "6 times"), same convention as the Lazimpat import — no historical
--     redemption ledger back-filled (package_redemptions starts empty).

BEGIN;

-- ============================================================
-- 1. customers: create the 2 new customers (neither phone matched an
--    existing customer on this DB)
-- ============================================================

WITH src(full_name, phone_digits) AS (
  VALUES
    ('Madhu Agarwal',          '9851130940'),
    ('Manoj Kumar Shrestha',   '9849575613')
)
INSERT INTO public.customers (org_id, branch_id, full_name, phone)
SELECT o.id, br.id, s.full_name, '+977' || s.phone_digits
FROM src s
JOIN public.organizations o ON o.slug = 'nuad-thai-spa'
JOIN public.branches br ON br.org_id = o.id AND br.name = 'Sanepa'
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c
  WHERE c.org_id = o.id AND c.phone = '+977' || s.phone_digits
);

-- ============================================================
-- 2. packages: 2 rows, reusing the existing org-wide
--    "Annual Package - 60 min" package_type
-- ============================================================

WITH src(full_name, phone_digits, issued_date, expiry_date, paid_amount, sessions_total) AS (
  VALUES
    ('Madhu Agarwal',        '9851130940', DATE '2026-05-31', DATE '2027-05-31', 35280.00, 3),
    ('Manoj Kumar Shrestha', '9849575613', DATE '2025-06-10', DATE '2026-06-10', 35280.00, 6)
)
INSERT INTO public.packages (
  org_id, branch_id, package_type_id, service_id, customer_id,
  issued_date, expiry_date, paid_amount, sessions_total, remarks
)
SELECT
  o.id, br.id, pt.id, pt.service_id, c.id,
  s.issued_date, s.expiry_date, s.paid_amount, s.sessions_total,
  'Imported from Annual Package Details Sanepa.xlsx (historical record, no transaction ledger back-filled)'
FROM src s
JOIN public.organizations o ON o.slug = 'nuad-thai-spa'
JOIN public.branches br ON br.org_id = o.id AND br.name = 'Sanepa'
JOIN public.package_types pt ON pt.org_id = o.id AND pt.name = 'Annual Package - 60 min'
JOIN public.customers c ON c.org_id = o.id AND c.phone = '+977' || s.phone_digits
WHERE NOT EXISTS (
  SELECT 1 FROM public.packages p
  WHERE p.org_id = o.id AND p.package_type_id = pt.id AND p.customer_id = c.id
    AND p.issued_date = s.issued_date AND p.sessions_total = s.sessions_total
);

-- ============================================================
-- 3. Assertion: abort if the resolved row count isn't exactly 2
-- ============================================================

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.packages p
  JOIN public.branches br ON br.id = p.branch_id
  JOIN public.organizations o ON o.id = p.org_id
  WHERE o.slug = 'nuad-thai-spa' AND br.name = 'Sanepa';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 Sanepa packages after import, got %. Aborting.', v_count;
  END IF;
END $$;

COMMIT;

-- Verify:
-- SELECT c.full_name, c.phone, pt.name AS package_type, p.issued_date,
--        p.expiry_date, p.paid_amount, p.sessions_total
-- FROM public.packages p
-- JOIN public.customers c ON c.id = p.customer_id
-- JOIN public.package_types pt ON pt.id = p.package_type_id
-- JOIN public.branches br ON br.id = p.branch_id
-- WHERE br.name = 'Sanepa'
-- ORDER BY c.full_name;
