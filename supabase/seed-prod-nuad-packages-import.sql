-- PROD promotion script: seed-prod-nuad-packages-import
-- Imports the 28 "Annual Package" customers from
-- `Annual Package Details lazimpat.xlsx` (Nuad Thai Spa, Lazimpat branch)
-- into the migration-141 `package_types` / `packages` tables. Replaces the
-- manually-maintained Excel workbook with the new service-packages schema
-- (mirrors how seed-prod-nuad-vouchers-import.sql replaced the old voucher
-- tracking spreadsheet).
--
-- Run in the target Supabase SQL editor (staging or production) AFTER
-- migration-141-service-packages.sql has been applied. NOT auto-applied by
-- CI -- this is data, not a tracked schema migration (see CLAUDE.md /
-- supabase/PROMOTION.md: seed-prod-*.sql stays a manual dashboard/MCP step).
--
-- Idempotent, portable:
--   - org_id resolved via organizations.slug = 'nuad-thai-spa'
--   - branch_id resolved via branches.name = 'Lazimpat'
--   - service_id resolved via exact services.name match (no hardcoded UUIDs)
--   - package_types insert uses WHERE NOT EXISTS keyed on
--     (org_id, service_id, name) -- migration-141 does not define a unique
--     constraint on package_types beyond the primary key, so this is the
--     natural idempotency key for a re-run.
--   - packages insert uses WHERE NOT EXISTS keyed on
--     (org_id, package_type_id, guest_name, issued_date, sessions_total,
--     paid_amount) -- packages has no natural unique key either; this tuple
--     is specific enough that a re-run of this exact script is a no-op,
--     while still allowing a genuinely new package for the same person to be
--     inserted later.
--
-- Customer matching: customers.phone is stored as '+977' followed by the
-- bare 10-digit number. The sheet's Contact Number column is bare 10 digits,
-- so the match is `customers.phone = '+977' || <sheet number>`. Best-effort:
-- when no customers row matches, customer_id stays NULL and guest_name /
-- guest_info (free text) carry the sheet data instead.
--
-- ============================================================
-- Two rows flagged for CLIENT CONFIRMATION (do not resolve here):
-- ============================================================
--   - "Amit/Bhim Rokka" (sheet row 5): two names, two phone numbers in one
--     sheet row. Stored literally as guest_name / guest_info; customer_id
--     is left NULL because the combined phone field will never match a
--     single customers.phone value. Needs client confirmation of which
--     person actually owns this package.
--   - "Rajesh Kavra/Milind Kavra" (sheet row 23): same pattern, same
--     handling, same flag.
--
-- ============================================================
-- Judgment call flagged for CLIENT CONFIRMATION:
-- ============================================================
--   - Sauna (sheet row 1, "Sradda"): no dedicated "Annual Package - Sauna"
--     service exists in the catalog (unlike the three Oil Massage
--     durations, which each have a matching "Annual Package - N min"
--     service). This script binds the Sauna package_types row to the only
--     Sauna-related service in the org's catalog, 'SAUNA - 30min', as the
--     closest available match. This is a ruling, not a fact read off the
--     sheet -- flag for client confirmation.
--
-- ============================================================
-- Already-expired packages (imported as-is, not extended):
-- ============================================================
-- 20 of the 28 rows have an expiry_date before today (2026-09-02) --
-- issued 2021-2025 on ~365-day validity. `package_balances` (migration-141)
-- correctly computes status = 'expired' for these via the view; they are
-- NOT back-dated or extended to look current. See docs/session-logs for the
-- full by-name list.

BEGIN;

-- ============================================================
-- 1. package_types -- one row per distinct service in the sheet
--    (Sauna, 60 min, 90 min, 120 min Oil Massage)
-- ============================================================

INSERT INTO public.package_types (org_id, service_id, name, default_sessions, standard_price)
SELECT o.id, s.id, 'Annual Package - Sauna', NULL, NULL
FROM public.organizations o
JOIN public.services s ON s.org_id = o.id AND s.name = 'SAUNA - 30min'
WHERE o.slug = 'nuad-thai-spa'
AND NOT EXISTS (
  SELECT 1 FROM public.package_types pt
  WHERE pt.org_id = o.id AND pt.service_id = s.id AND pt.name = 'Annual Package - Sauna'
);

INSERT INTO public.package_types (org_id, service_id, name, default_sessions, standard_price)
SELECT o.id, s.id, 'Annual Package - 60 min', NULL, s.price_npr
FROM public.organizations o
JOIN public.services s ON s.org_id = o.id AND s.name = 'Annual Package - 60 min'
WHERE o.slug = 'nuad-thai-spa'
AND NOT EXISTS (
  SELECT 1 FROM public.package_types pt
  WHERE pt.org_id = o.id AND pt.service_id = s.id AND pt.name = 'Annual Package - 60 min'
);

INSERT INTO public.package_types (org_id, service_id, name, default_sessions, standard_price)
SELECT o.id, s.id, 'Annual Package - 90 min', NULL, s.price_npr
FROM public.organizations o
JOIN public.services s ON s.org_id = o.id AND s.name = 'Annual Package - 90 min'
WHERE o.slug = 'nuad-thai-spa'
AND NOT EXISTS (
  SELECT 1 FROM public.package_types pt
  WHERE pt.org_id = o.id AND pt.service_id = s.id AND pt.name = 'Annual Package - 90 min'
);

INSERT INTO public.package_types (org_id, service_id, name, default_sessions, standard_price)
SELECT o.id, s.id, 'Annual Package - 120 min', NULL, s.price_npr
FROM public.organizations o
JOIN public.services s ON s.org_id = o.id AND s.name = 'Annual Package - 120 min'
WHERE o.slug = 'nuad-thai-spa'
AND NOT EXISTS (
  SELECT 1 FROM public.package_types pt
  WHERE pt.org_id = o.id AND pt.service_id = s.id AND pt.name = 'Annual Package - 120 min'
);

-- ============================================================
-- 2. packages -- 28 rows from "Annual Package Details lazimpat.xlsx"
-- ============================================================

INSERT INTO public.packages (
  org_id, branch_id, package_type_id, service_id, customer_id,
  guest_name, guest_info, issued_date, expiry_date, paid_amount, sessions_total
)
SELECT
  o.id, br.id, pt.id, svc.id, cust.id,
  v.guest_name, v.phone_digits, v.issued_date, v.expiry_date, v.paid_amount, v.sessions_total
FROM public.organizations o
JOIN public.branches br ON br.org_id = o.id AND br.name = 'Lazimpat'
CROSS JOIN (VALUES
  -- (guest_name, phone_digits, sheet_service, issued_date, expiry_date, paid_amount, sessions_total)
  ('Sradda',                       '9856029214',            'Sauna',               DATE '2025-10-21', DATE '2026-10-21', 9000.00,  10),
  ('Ganesh Lama',                  '9851050754',            '90 min Oil Massage',  DATE '2026-05-14', DATE '2027-05-14', 40000.00, 1),
  ('Sajan/Shristi',                '9851117114',            '90 min Oil Massage',  DATE '2026-07-18', DATE '2027-07-18', 48720.00, 8),
  ('Dana zhang',                   '9828868886',            '60 min oil Massage',  DATE '2025-08-16', DATE '2026-08-16', 35280.00, 3),
  ('Amit/Bhim Rokka',              '9813660255/9801023284', '90 min Oil Massage',  DATE '2025-10-24', DATE '2026-10-24', 41720.00, 3),
  ('Aditya Sanghai',               '9801012293',            '60 min Oil Massage',  DATE '2025-12-13', DATE '2026-12-13', 35280.00, 2),
  ('Dr.Birendra Kumar Bista',      '9852022059',            '90 min Oil Massage',  DATE '2024-08-31', DATE '2025-08-31', 48720.00, 3),
  ('Puspa Bhandari',               '9841265283',            '90 min Oil Massage',  DATE '2025-10-05', DATE '2026-10-05', 48720.00, 1),
  ('Srijana Jyoti',                '9851058788',            '60 min Oil Massage',  DATE '2026-06-23', DATE '2027-06-23', 35280.00, 10),
  ('Liu Gang',                     NULL,                    '60 min Oil Massage',  DATE '2023-03-25', DATE '2024-03-25', 35000.00, 1),
  ('Pawan Kumar Agrawal',          '9801022330',            '60 min Oil Massage',  DATE '2024-08-23', DATE '2025-08-23', 35280.00, 2),
  ('Tsering Lhayang',              '9810321411',            '60 min Oil Massage',  DATE '2023-06-04', DATE '2024-06-04', 35280.00, 5),
  ('Mahendra Lal Shrestha',        '9851039830',            '90 min Oil Massage',  DATE '2023-04-01', DATE '2024-04-01', 48720.00, 11),
  ('Sandeep',                      '9803290499',            '90 min Oil Massage',  DATE '2022-08-11', DATE '2023-08-11', 41760.00, 7),
  ('DM Shrestha',                  '9851020303',            '60 min Oil Massage',  DATE '2024-09-07', DATE '2025-09-07', 35280.00, 9),
  ('Ibrahim',                      '9801588888',            '90 min Oil Massage',  DATE '2023-10-13', DATE '2024-10-13', 41760.00, 2),
  ('Ibrahim',                      '9801588888',            '60 min Oil Massage',  DATE '2023-10-13', DATE '2024-10-13', 30240.00, 4),
  ('Bishal Kc',                    '9801083163',            '90 min Oil Massage',  DATE '2022-10-01', DATE '2023-10-01', 41760.00, 10),
  ('Nawaraj Burlakoti',            '9851036400',            '90 min Oil Massage',  DATE '2022-02-22', DATE '2023-02-22', 41760.00, 5),
  ('Gio',                          '9808080777',            '120 min Oil Massage', DATE '2022-05-29', DATE '2023-05-29', 63840.00, 3),
  ('Romi Gauchan Thakali',         '9851021644',            '90 min Oil Massage',  DATE '2023-10-17', DATE '2024-10-17', 41760.00, 2),
  ('Shikhar',                      '9851087055',            '60 Min Oil Massage',  DATE '2023-06-12', DATE '2024-06-12', 35280.00, 10),
  ('Rajesh Kavra/Milind Kavra',    '9801020131/9814302424', '60 Min Oil Massage',  DATE '2024-08-20', DATE '2025-08-20', 35280.00, 5),
  ('Mimi Sherpa',                  '9766486815',            '60 Min Oil Massage',  DATE '2024-09-05', DATE '2025-09-05', 35280.00, 1),
  ('Madhu Agrawal',                '9851130940',            '60 Min Oil Massage',  DATE '2022-10-28', DATE '2023-10-28', 30240.00, 1),
  ('Bhadra Shahi',                 '9851059596',            '90 min Oil Massage',  DATE '2021-06-24', DATE '2022-06-24', 41760.00, 2),
  ('Ruth',                         '9827710119',            '90 min Oil Massage',  DATE '2023-08-26', DATE '2024-08-26', 48720.00, 1),
  ('Gaurav Sharda',                '9801000075',            '60 min Oil Massage',  DATE '2026-07-04', DATE '2027-07-04', 35280.00, 6)
) AS v(guest_name, phone_digits, sheet_service, issued_date, expiry_date, paid_amount, sessions_total)
-- Normalize the sheet's inconsistently-cased service strings to the
-- catalog's exact services.name.
JOIN public.services svc
  ON svc.org_id = o.id
  AND svc.name = CASE
    WHEN v.sheet_service ILIKE '%sauna%' THEN 'SAUNA - 30min'
    WHEN v.sheet_service ILIKE '60%'     THEN 'Annual Package - 60 min'
    WHEN v.sheet_service ILIKE '90%'     THEN 'Annual Package - 90 min'
    WHEN v.sheet_service ILIKE '120%'    THEN 'Annual Package - 120 min'
  END
JOIN public.package_types pt
  ON pt.org_id = o.id AND pt.service_id = svc.id
-- Best-effort phone match: only attempt when phone_digits is a clean
-- 10-digit number (guards out NULL / the two ambiguous "num1/num2" rows).
LEFT JOIN public.customers cust
  ON cust.org_id = o.id
  AND v.phone_digits ~ '^[0-9]{10}$'
  AND cust.phone = '+977' || v.phone_digits
WHERE o.slug = 'nuad-thai-spa'
AND NOT EXISTS (
  SELECT 1 FROM public.packages p
  WHERE p.org_id = o.id
    AND p.package_type_id = pt.id
    AND p.guest_name = v.guest_name
    AND p.issued_date = v.issued_date
    AND p.sessions_total = v.sessions_total
    AND p.paid_amount = v.paid_amount
);

-- ============================================================
-- 3. Assertion -- abort and roll back if the import is incomplete.
--    A plain JOIN keyed on exact name matches silently inserts zero rows
--    for any service/package-type name that fails to resolve (no error,
--    COMMIT still succeeds) -- this is real production customer financial
--    data, so a partial, silently-incomplete run must not be allowed to
--    stand. Scoped to org + branch so it stays meaningful (doesn't count
--    unrelated orgs' packages) and idempotent on re-run: WHERE NOT EXISTS
--    above means a second run against an already-imported DB inserts zero
--    additional rows but the 28 existing ones still satisfy this count.
-- ============================================================

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.packages p
  JOIN public.branches br ON br.id = p.branch_id
  JOIN public.organizations o ON o.id = p.org_id
  WHERE o.slug = 'nuad-thai-spa' AND br.name = 'Lazimpat';

  IF v_count <> 28 THEN
    RAISE EXCEPTION 'Expected 28 Lazimpat packages after import, got %. Aborting -- check service/package_type name resolution.', v_count;
  END IF;
END $$;

COMMIT;

-- Verify:
-- SELECT count(*) FROM public.packages p
-- JOIN public.branches br ON br.id = p.branch_id AND br.name = 'Lazimpat';
-- -- expect 28
--
-- SELECT pt.name, count(*) FROM public.packages p
-- JOIN public.package_types pt ON pt.id = p.package_type_id
-- GROUP BY pt.name ORDER BY pt.name;
--
-- SELECT pb.guest_name, pb.status, pb.sessions_remaining, pb.expiry_date
-- FROM public.package_balances pb
-- JOIN public.packages p ON p.id = pb.package_id
-- JOIN public.branches br ON br.id = p.branch_id AND br.name = 'Lazimpat'
-- ORDER BY pb.expiry_date;
