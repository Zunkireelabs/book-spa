-- One-time data backfill: historical Nuad Thai Club Membership records
-- imported from "NUAD THAI CLUB MEMBERSHIP.xlsx" (client-provided spreadsheet).
--
-- This is a ONE-TIME DATA LOAD for a single tenant (Nuad Thai Spa), not a
-- repeatable schema migration -- intentionally NOT registered in
-- public.schema_migrations and NOT added to supabase/PROMOTION.md's pending-
-- migration manifest.
--
-- Idempotent: each row checks for an existing membership with the same
-- membership_number (the original Excel "Code") before inserting, and reuses
-- an existing customer by (org_id, normalized phone) via the same unique
-- index the app itself enforces (migration-036, customers_org_nphone_uniq)
-- rather than creating a duplicate.
--
-- Every row is wrapped in its own DO block with an EXCEPTION handler so one
-- bad row logs a NOTICE and is skipped rather than aborting the whole script.
--
-- What this script deliberately does NOT do (see
-- docs/feature/membership-import/import-report.md for the full list and why):
--   - Renewal rows (12 people who appear twice in the sheet) are NOT
--     imported here -- only the original/base enrollment is. Apply the
--     renewal manually via the Top-Up button once this script has run.
--   - Rows where the source data doesn't unambiguously give us something the
--     database requires (e.g. no branch at all) are skipped, not guessed.
--   - The "Customise Corporate Mem" row (no matching tier yet) is skipped.
--   - No value is invented: dates without a confirmed year are left as raw
--     text in notes, not backdated with a guess.


-- ---- Row 4: Birendra Shrestha (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 4 (%): organization nuad-thai-spa not found', 'Birendra Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 4 (%): branch % not found', 'Birendra Shrestha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 4 (%): tier % not found', 'Birendra Shrestha', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0009_6153') THEN
    RAISE NOTICE 'SKIP row 4 (%): membership_number % already imported', 'Birendra Shrestha', 'NT_DCM_0009_6153';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9808596153'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Birendra Shrestha', '9808596153', 'biren195@gmail.com',
            'Imported from historical Excel (row 4).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0009_6153', 'DOB: 2025-08-19 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-16'::date,
         expiry_date = '2024-10-16'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 4: % -> membership %', 'Birendra Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 4 (%): %', 'Birendra Shrestha', SQLERRM;
END $$;

-- ---- Row 6: Aswin Giri (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 6 (%): organization nuad-thai-spa not found', 'Aswin Giri';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 6 (%): branch % not found', 'Aswin Giri', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 6 (%): tier % not found', 'Aswin Giri', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0010_8763') THEN
    RAISE NOTICE 'SKIP row 6 (%): membership_number % already imported', 'Aswin Giri', 'NT_PCM_0010_8763';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851058763'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Aswin Giri', '9851058763', NULL,
            'Imported from historical Excel (row 6).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0010_8763', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-26'::date,
         expiry_date = '2024-10-26'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 6: % -> membership %', 'Aswin Giri', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 6 (%): %', 'Aswin Giri', SQLERRM;
END $$;

-- ---- Row 11: Manisha Karki (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 11 (%): organization nuad-thai-spa not found', 'Manisha Karki';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 11 (%): branch % not found', 'Manisha Karki', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 11 (%): tier % not found', 'Manisha Karki', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0013_7706') THEN
    RAISE NOTICE 'SKIP row 11 (%): membership_number % already imported', 'Manisha Karki', 'NT_PCM_0013_7706';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9863947706'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Manisha Karki', '9863947706', 'mk14.karki@gmail.com',
            'Imported from historical Excel (row 11).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0013_7706', 'DOB: 2025-09-12 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-11-10'::date,
         expiry_date = '2024-11-10'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 11: % -> membership %', 'Manisha Karki', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 11 (%): %', 'Manisha Karki', SQLERRM;
END $$;

-- ---- Row 18: Mingma Sherpa (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 18 (%): organization nuad-thai-spa not found', 'Mingma Sherpa';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 18 (%): branch % not found', 'Mingma Sherpa', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 18 (%): tier % not found', 'Mingma Sherpa', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0017_1187') THEN
    RAISE NOTICE 'SKIP row 18 (%): membership_number % already imported', 'Mingma Sherpa', 'NT_PCM_0017_1187';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851111187'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Mingma Sherpa', '9851111187', NULL,
            'Imported from historical Excel (row 18).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0017_1187', 'DOB: 2025-06-16 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 18: % -> membership %', 'Mingma Sherpa', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 18 (%): %', 'Mingma Sherpa', SQLERRM;
END $$;

-- ---- Row 21: Dennis Tiew (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 21 (%): organization nuad-thai-spa not found', 'Dennis Tiew';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 21 (%): branch % not found', 'Dennis Tiew', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 21 (%): tier % not found', 'Dennis Tiew', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0016_4845') THEN
    RAISE NOTICE 'SKIP row 21 (%): membership_number % already imported', 'Dennis Tiew', 'NT_DCM_0016_4845';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9820134845'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Dennis Tiew', '9820134845', NULL,
            'Imported from historical Excel (row 21).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0016_4845', 'DOB: 2025-10-26 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-15'::date,
         expiry_date = '2025-12-15'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 21: % -> membership %', 'Dennis Tiew', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 21 (%): %', 'Dennis Tiew', SQLERRM;
END $$;

-- ---- Row 25: Amit Chaudhary (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 25 (%): organization nuad-thai-spa not found', 'Amit Chaudhary';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 25 (%): branch % not found', 'Amit Chaudhary', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 25 (%): tier % not found', 'Amit Chaudhary', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0021_1515') THEN
    RAISE NOTICE 'SKIP row 25 (%): membership_number % already imported', 'Amit Chaudhary', 'NT_PCM_0021_1515';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802051515'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Amit Chaudhary', '9802051515', NULL,
            'Imported from historical Excel (row 25).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0021_1515', 'DOB: 2025-12-24 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-28'::date,
         expiry_date = '2025-12-28'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 25: % -> membership %', 'Amit Chaudhary', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 25 (%): %', 'Amit Chaudhary', SQLERRM;
END $$;

-- ---- Row 40: Prashish Rajbhandari (Deluxe Club, Lazimpat) ----------------------------------
-- SKIPPED: no Issued date at all in the source (raw value '-') -- don't
-- fabricate an activation date. A later renewal for this person also exists
-- in the source (code NT_PCM_0110_9851) but is intentionally left
-- unresolved too -- see supabase/fix-membership-import-round2.sql.
DO $$
BEGIN
  RAISE NOTICE 'SKIP row 40 (%): no Issued date in source', 'Prashish Rajbhandari';
END $$;

-- ---- Row 50: rakesh adhukia (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 50 (%): organization nuad-thai-spa not found', 'rakesh adhukia';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 50 (%): branch % not found', 'rakesh adhukia', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 50 (%): tier % not found', 'rakesh adhukia', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0039_2221') THEN
    RAISE NOTICE 'SKIP row 50 (%): membership_number % already imported', 'rakesh adhukia', 'NT_PCM_0039_2221';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '980202227'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'rakesh adhukia', '980202227', NULL,
            'Imported from historical Excel (row 50).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0039_2221', 'DOB: 1975-09-08 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 50: % -> membership %', 'rakesh adhukia', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 50 (%): %', 'rakesh adhukia', SQLERRM;
END $$;

-- ---- Row 56: Subhi Pradan (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 56 (%): organization nuad-thai-spa not found', 'Subhi Pradan';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 56 (%): branch % not found', 'Subhi Pradan', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 56 (%): tier % not found', 'Subhi Pradan', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0025_6975') THEN
    RAISE NOTICE 'SKIP row 56 (%): membership_number % already imported', 'Subhi Pradan', 'NT_DCM_0025_6975';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9818936975'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Subhi Pradan', '9818936975', NULL,
            'Imported from historical Excel (row 56).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0025_6975', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-05'::date,
         expiry_date = '2025-04-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 56: % -> membership %', 'Subhi Pradan', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 56 (%): %', 'Subhi Pradan', SQLERRM;
END $$;

-- ---- Row 91: LATA BHUSAL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 91 (%): organization nuad-thai-spa not found', 'LATA BHUSAL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 91 (%): branch % not found', 'LATA BHUSAL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 91 (%): tier % not found', 'LATA BHUSAL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0072_2778') THEN
    RAISE NOTICE 'SKIP row 91 (%): membership_number % already imported', 'LATA BHUSAL', 'NT_PCM_0072_2778';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9861582778'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'LATA BHUSAL', '9861582778', NULL,
            'Imported from historical Excel (row 91).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0072_2778', 'DOB: 08/SEPT')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 91: % -> membership %', 'LATA BHUSAL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 91 (%): %', 'LATA BHUSAL', SQLERRM;
END $$;

-- ---- Row 95: MANJU TIWARI (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 95 (%): organization nuad-thai-spa not found', 'MANJU TIWARI';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 95 (%): branch % not found', 'MANJU TIWARI', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 95 (%): tier % not found', 'MANJU TIWARI', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0076_3942') THEN
    RAISE NOTICE 'SKIP row 95 (%): membership_number % already imported', 'MANJU TIWARI', 'NT_PCM_0076_3942';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9861493942'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'MANJU TIWARI', '9861493942', NULL,
            'Imported from historical Excel (row 95).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0076_3942', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-07-30'::date,
         expiry_date = '2025-07-30'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 95: % -> membership %', 'MANJU TIWARI', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 95 (%): %', 'MANJU TIWARI', SQLERRM;
END $$;

-- ---- Row 103: Bishnu Sapkota (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 103 (%): organization nuad-thai-spa not found', 'Bishnu Sapkota';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 103 (%): branch % not found', 'Bishnu Sapkota', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 103 (%): tier % not found', 'Bishnu Sapkota', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0034_5113') THEN
    RAISE NOTICE 'SKIP row 103 (%): membership_number % already imported', 'Bishnu Sapkota', 'NT_DCM_0034_5113';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851035113'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bishnu Sapkota', '9851035113', NULL,
            'Imported from historical Excel (row 103).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0034_5113', 'DOB: 25TH JULY')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 103: % -> membership %', 'Bishnu Sapkota', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 103 (%): %', 'Bishnu Sapkota', SQLERRM;
END $$;

-- ---- Row 1: Ayush Nepal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 1 (%): organization nuad-thai-spa not found', 'Ayush Nepal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 1 (%): branch % not found', 'Ayush Nepal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 1 (%): tier % not found', 'Ayush Nepal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0008_1381') THEN
    RAISE NOTICE 'SKIP row 1 (%): membership_number % already imported', 'Ayush Nepal', 'NT_PCM_0008_1381';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9808091381'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Ayush Nepal', '9808091381', NULL,
            'Imported from historical Excel (row 1).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0008_1381', 'DOB: 2025-09-19 00:00:00')
  RETURNING id INTO v_membership_id;

  RAISE NOTICE 'Imported row 1: % -> membership %', 'Ayush Nepal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 1 (%): %', 'Ayush Nepal', SQLERRM;
END $$;

-- ---- Row 2: Niraj Agrawal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 2 (%): organization nuad-thai-spa not found', 'Niraj Agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 2 (%): branch % not found', 'Niraj Agrawal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 2 (%): tier % not found', 'Niraj Agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0009_7283') THEN
    RAISE NOTICE 'SKIP row 2 (%): membership_number % already imported', 'Niraj Agrawal', 'NT_PCM_0009_7283';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9803707283'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Niraj Agrawal', '9803707283', 'electroniraj2012@gmail.com',
            'Imported from historical Excel (row 2).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0009_7283', 'DOB: 1st July')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-07'::date,
         expiry_date = '2024-10-07'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 2: % -> membership %', 'Niraj Agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 2 (%): %', 'Niraj Agrawal', SQLERRM;
END $$;

-- ---- Row 3: Aanand Mishra (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 3 (%): organization nuad-thai-spa not found', 'Aanand Mishra';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 3 (%): branch % not found', 'Aanand Mishra', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 3 (%): tier % not found', 'Aanand Mishra', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0008_9080') THEN
    RAISE NOTICE 'SKIP row 3 (%): membership_number % already imported', 'Aanand Mishra', 'NT_DCM_0008_9080';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9803409080'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Aanand Mishra', '9803409080', 'aanandmishrh85@gmail.com',
            'Imported from historical Excel (row 3).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0008_9080', 'DOB: 2025-02-14 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-15'::date,
         expiry_date = '2024-10-15'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 3: % -> membership %', 'Aanand Mishra', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 3 (%): %', 'Aanand Mishra', SQLERRM;
END $$;

-- ---- Row 5: PRINCI KOIRALA (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 5 (%): organization nuad-thai-spa not found', 'PRINCI KOIRALA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 5 (%): branch % not found', 'PRINCI KOIRALA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 5 (%): tier % not found', 'PRINCI KOIRALA', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0010_4775') THEN
    RAISE NOTICE 'SKIP row 5 (%): membership_number % already imported', 'PRINCI KOIRALA', 'NT_DCM_0010_4775';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841544775'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'PRINCI KOIRALA', '9841544775', 'prinsea14@gmail.com',
            'Imported from historical Excel (row 5).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0010_4775', 'DOB: 2025-04-30 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-23'::date,
         expiry_date = '2024-10-23'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 5: % -> membership %', 'PRINCI KOIRALA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 5 (%): %', 'PRINCI KOIRALA', SQLERRM;
END $$;

-- ---- Row 7: ANDREW PENG (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 7 (%): organization nuad-thai-spa not found', 'ANDREW PENG';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 7 (%): branch % not found', 'ANDREW PENG', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 7 (%): tier % not found', 'ANDREW PENG', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0011_6966') THEN
    RAISE NOTICE 'SKIP row 7 (%): membership_number % already imported', 'ANDREW PENG', 'NT_DCM_0011_6966';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9767936966'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'ANDREW PENG', '9767936966', NULL,
            'Imported from historical Excel (row 7).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0011_6966', 'DOB: 2025-06-21 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-30'::date,
         expiry_date = '2024-10-30'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 7: % -> membership %', 'ANDREW PENG', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 7 (%): %', 'ANDREW PENG', SQLERRM;
END $$;

-- ---- Row 8: Himanshu Golchha (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 8 (%): organization nuad-thai-spa not found', 'Himanshu Golchha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 8 (%): branch % not found', 'Himanshu Golchha', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 8 (%): tier % not found', 'Himanshu Golchha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0011_0777') THEN
    RAISE NOTICE 'SKIP row 8 (%): membership_number % already imported', 'Himanshu Golchha', 'NT_PCM_0011_0777';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801010777'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Himanshu Golchha', '9801010777', 'himanshugolchha@gmail.com',
            'Imported from historical Excel (row 8).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0011_0777', 'DOB: 2025-10-21 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-10-31'::date,
         expiry_date = '2024-10-31'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 8: % -> membership %', 'Himanshu Golchha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 8 (%): %', 'Himanshu Golchha', SQLERRM;
END $$;

-- ---- Row 9: Anita sariya (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 9 (%): organization nuad-thai-spa not found', 'Anita sariya';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 9 (%): branch % not found', 'Anita sariya', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 9 (%): tier % not found', 'Anita sariya', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0012_5149') THEN
    RAISE NOTICE 'SKIP row 9 (%): membership_number % already imported', 'Anita sariya', 'NT_PCM_0012_5149';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851015149'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Anita sariya', '9851015149', NULL,
            'Imported from historical Excel (row 9).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0012_5149', 'DOB: 2025-10-13 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-11-02'::date,
         expiry_date = '2024-11-02'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 9: % -> membership %', 'Anita sariya', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 9 (%): %', 'Anita sariya', SQLERRM;
END $$;

-- ---- Row 10: Peter Wei (Deluxe Club, Lazimpat) ----------------------------------
-- SKIPPED: no Issued date at all in the source (raw value None) -- don't
-- fabricate an activation date.
DO $$
BEGIN
  RAISE NOTICE 'SKIP row 10 (%): no Issued date in source', 'Peter Wei';
END $$;

-- ---- Row 12: Pratik Man Singh (Deluxe Club, Sanepa) ----------------------------------
-- SKIPPED: no Issued date at all in the source (raw value None) -- don't
-- fabricate an activation date. (His later Premium Club card, code
-- NT_PCM_0123_4310 / row 159, has its own valid Issued date and imports
-- normally further down -- that one is a separate customer record, keyed by
-- a different phone number in the source, so it's unaffected by this skip.)
DO $$
BEGIN
  RAISE NOTICE 'SKIP row 12 (%): no Issued date in source', 'Pratik Man Singh';
END $$;

-- ---- Row 13: Barsha (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 13 (%): organization nuad-thai-spa not found', 'Barsha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 13 (%): branch % not found', 'Barsha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 13 (%): tier % not found', 'Barsha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0014_7755') THEN
    RAISE NOTICE 'SKIP row 13 (%): membership_number % already imported', 'Barsha', 'NT_PCM_0014_7755';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9803617755'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Barsha', '9803617755', NULL,
            'Imported from historical Excel (row 13).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0014_7755', 'DOB: 2025-11-02 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-11-14'::date,
         expiry_date = '2024-11-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 13: % -> membership %', 'Barsha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 13 (%): %', 'Barsha', SQLERRM;
END $$;

-- ---- Row 14: Sheke (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 14 (%): organization nuad-thai-spa not found', 'Sheke';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 14 (%): branch % not found', 'Sheke', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 14 (%): tier % not found', 'Sheke', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0014_4798') THEN
    RAISE NOTICE 'SKIP row 14 (%): membership_number % already imported', 'Sheke', 'NT_DCM_0014_4798';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9709714798'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sheke', '9709714798', NULL,
            'Imported from historical Excel (row 14).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0014_4798', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-11-15'::date,
         expiry_date = '2024-11-15'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 14: % -> membership %', 'Sheke', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 14 (%): %', 'Sheke', SQLERRM;
END $$;

-- ---- Row 15: Surendra Lama (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 15 (%): organization nuad-thai-spa not found', 'Surendra Lama';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 15 (%): branch % not found', 'Surendra Lama', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 15 (%): tier % not found', 'Surendra Lama', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0015_0350') THEN
    RAISE NOTICE 'SKIP row 15 (%): membership_number % already imported', 'Surendra Lama', 'NT_PCM_0015_0350';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851090350'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Surendra Lama', '9851090350', 'lamasurendra226@gmail.com',
            'Imported from historical Excel (row 15).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0015_0350', 'DOB: 2025-09-11 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-11-27'::date,
         expiry_date = '2024-11-27'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 15: % -> membership %', 'Surendra Lama', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 15 (%): %', 'Surendra Lama', SQLERRM;
END $$;

-- ---- Row 16: Bimal Sawarthia (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 16 (%): organization nuad-thai-spa not found', 'Bimal Sawarthia';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 16 (%): branch % not found', 'Bimal Sawarthia', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 16 (%): tier % not found', 'Bimal Sawarthia', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0016_0407') THEN
    RAISE NOTICE 'SKIP row 16 (%): membership_number % already imported', 'Bimal Sawarthia', 'NT_PCM_0016_0407';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801020407'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bimal Sawarthia', '9801020407', NULL,
            'Imported from historical Excel (row 16).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0016_0407', 'DOB: 2025-12-02 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2024-11-30'::date,
         expiry_date = '2024-11-30'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 16: % -> membership %', 'Bimal Sawarthia', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 16 (%): %', 'Bimal Sawarthia', SQLERRM;
END $$;

-- ---- Row 17: Lin (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 17 (%): organization nuad-thai-spa not found', 'Lin';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 17 (%): branch % not found', 'Lin', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 17 (%): tier % not found', 'Lin', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0014_6513') THEN
    RAISE NOTICE 'SKIP row 17 (%): membership_number % already imported', 'Lin', 'NT_DCM_0014_6513';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9745616513'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Lin', '9745616513', NULL,
            'Imported from historical Excel (row 17).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0014_6513', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 17: % -> membership %', 'Lin', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 17 (%): %', 'Lin', SQLERRM;
END $$;

-- ---- Row 19: Sahil Agarwal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 19 (%): organization nuad-thai-spa not found', 'Sahil Agarwal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 19 (%): branch % not found', 'Sahil Agarwal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 19 (%): tier % not found', 'Sahil Agarwal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0018_7111') THEN
    RAISE NOTICE 'SKIP row 19 (%): membership_number % already imported', 'Sahil Agarwal', 'NT_PCM_0018_7111';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801057111'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sahil Agarwal', '9801057111', 'casahil.ktm@gmail.com',
            'Imported from historical Excel (row 19).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0018_7111', 'DOB: 2025-01-06 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-04'::date,
         expiry_date = '2025-12-04'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 19: % -> membership %', 'Sahil Agarwal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 19 (%): %', 'Sahil Agarwal', SQLERRM;
END $$;

-- ---- Row 20: Sabina Lama (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 20 (%): organization nuad-thai-spa not found', 'Sabina Lama';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 20 (%): branch % not found', 'Sabina Lama', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 20 (%): tier % not found', 'Sabina Lama', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0015_9066') THEN
    RAISE NOTICE 'SKIP row 20 (%): membership_number % already imported', 'Sabina Lama', 'NT_DCM_0015_9066';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9810239066'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sabina Lama', '9810239066', 'lamasabina62@gmail.com',
            'Imported from historical Excel (row 20).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0015_9066', 'DOB: 2025-07-14 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-14'::date,
         expiry_date = '2025-12-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 20: % -> membership %', 'Sabina Lama', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 20 (%): %', 'Sabina Lama', SQLERRM;
END $$;

-- ---- Row 22: Jayanthi Ramesh (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 22 (%): organization nuad-thai-spa not found', 'Jayanthi Ramesh';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 22 (%): branch % not found', 'Jayanthi Ramesh', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 22 (%): tier % not found', 'Jayanthi Ramesh', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0019_7202') THEN
    RAISE NOTICE 'SKIP row 22 (%): membership_number % already imported', 'Jayanthi Ramesh', 'NT_PCM_0019_7202';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9708217202'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Jayanthi Ramesh', '9708217202', NULL,
            'Imported from historical Excel (row 22).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0019_7202', 'DOB: 2025-06-12 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-18'::date,
         expiry_date = '2025-12-18'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 22: % -> membership %', 'Jayanthi Ramesh', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 22 (%): %', 'Jayanthi Ramesh', SQLERRM;
END $$;

-- ---- Row 23: Pradip Kumar (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 23 (%): organization nuad-thai-spa not found', 'Pradip Kumar';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 23 (%): branch % not found', 'Pradip Kumar', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 23 (%): tier % not found', 'Pradip Kumar', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0017_0259') THEN
    RAISE NOTICE 'SKIP row 23 (%): membership_number % already imported', 'Pradip Kumar', 'NT_DCM_0017_0259';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9808250259'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Pradip Kumar', '9808250259', NULL,
            'Imported from historical Excel (row 23).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0017_0259', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-19'::date,
         expiry_date = '2025-12-19'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 23: % -> membership %', 'Pradip Kumar', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 23 (%): %', 'Pradip Kumar', SQLERRM;
END $$;

-- ---- Row 24: Samjhana Shrestha (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 24 (%): organization nuad-thai-spa not found', 'Samjhana Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 24 (%): branch % not found', 'Samjhana Shrestha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 24 (%): tier % not found', 'Samjhana Shrestha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0020_6018') THEN
    RAISE NOTICE 'SKIP row 24 (%): membership_number % already imported', 'Samjhana Shrestha', 'NT_PCM_0020_6018';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9808416018'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Samjhana Shrestha', '9808416018', NULL,
            'Imported from historical Excel (row 24).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0020_6018', 'DOB: 2025-02-01 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-21'::date,
         expiry_date = '2025-12-21'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 24: % -> membership %', 'Samjhana Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 24 (%): %', 'Samjhana Shrestha', SQLERRM;
END $$;

-- ---- Row 26: Diptee Acharya (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 26 (%): organization nuad-thai-spa not found', 'Diptee Acharya';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 26 (%): branch % not found', 'Diptee Acharya', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 26 (%): tier % not found', 'Diptee Acharya', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0022_4153') THEN
    RAISE NOTICE 'SKIP row 26 (%): membership_number % already imported', 'Diptee Acharya', 'NT_PCM_0022_4153';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9815034153'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Diptee Acharya', '9815034153', NULL,
            'Imported from historical Excel (row 26).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0022_4153', 'DOB: 2025-03-09 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-03'::date,
         expiry_date = '2025-01-03'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 26: % -> membership %', 'Diptee Acharya', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 26 (%): %', 'Diptee Acharya', SQLERRM;
END $$;

-- ---- Row 27: Deepa Gurung (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 27 (%): organization nuad-thai-spa not found', 'Deepa Gurung';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 27 (%): branch % not found', 'Deepa Gurung', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 27 (%): tier % not found', 'Deepa Gurung', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0018_9760') THEN
    RAISE NOTICE 'SKIP row 27 (%): membership_number % already imported', 'Deepa Gurung', 'NT_DCM_0018_9760';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9709839760'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Deepa Gurung', '9709839760', NULL,
            'Imported from historical Excel (row 27).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0018_9760', 'DOB: 2025-11-21 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-05'::date,
         expiry_date = '2025-01-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 27: % -> membership %', 'Deepa Gurung', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 27 (%): %', 'Deepa Gurung', SQLERRM;
END $$;

-- ---- Row 28: Prem Gaha Magar (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 28 (%): organization nuad-thai-spa not found', 'Prem Gaha Magar';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 28 (%): branch % not found', 'Prem Gaha Magar', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 28 (%): tier % not found', 'Prem Gaha Magar', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0023_6140') THEN
    RAISE NOTICE 'SKIP row 28 (%): membership_number % already imported', 'Prem Gaha Magar', 'NT_PCM_0023_6140';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9823406140'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Prem Gaha Magar', '9823406140', NULL,
            'Imported from historical Excel (row 28).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0023_6140', 'DOB: 2025-02-09 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-10'::date,
         expiry_date = '2025-01-10'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 28: % -> membership %', 'Prem Gaha Magar', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 28 (%): %', 'Prem Gaha Magar', SQLERRM;
END $$;

-- ---- Row 29: Shuva kanta Sharma (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 29 (%): organization nuad-thai-spa not found', 'Shuva kanta Sharma';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 29 (%): branch % not found', 'Shuva kanta Sharma', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 29 (%): tier % not found', 'Shuva kanta Sharma', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0024_2621') THEN
    RAISE NOTICE 'SKIP row 29 (%): membership_number % already imported', 'Shuva kanta Sharma', 'NT_PCM_0024_2621';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851022621'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Shuva kanta Sharma', '9851022621', NULL,
            'Imported from historical Excel (row 29).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0024_2621', 'DOB: 2025-02-11 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-14'::date,
         expiry_date = '2025-01-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 29: % -> membership %', 'Shuva kanta Sharma', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 29 (%): %', 'Shuva kanta Sharma', SQLERRM;
END $$;

-- ---- Row 30: John Robson (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 30 (%): organization nuad-thai-spa not found', 'John Robson';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 30 (%): branch % not found', 'John Robson', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 30 (%): tier % not found', 'John Robson', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0021_0203') THEN
    RAISE NOTICE 'SKIP row 30 (%): membership_number % already imported', 'John Robson', 'NT_DCM_0021_0203';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801040203'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'John Robson', '9801040203', NULL,
            'Imported from historical Excel (row 30).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0021_0203', 'DOB: 2025-01-19 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-16'::date,
         expiry_date = '2025-01-16'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 30: % -> membership %', 'John Robson', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 30 (%): %', 'John Robson', SQLERRM;
END $$;

-- ---- Row 31: Rosy pun (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 31 (%): organization nuad-thai-spa not found', 'Rosy pun';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 31 (%): branch % not found', 'Rosy pun', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 31 (%): tier % not found', 'Rosy pun', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0019_1699') THEN
    RAISE NOTICE 'SKIP row 31 (%): membership_number % already imported', 'Rosy pun', 'NT_DCM_0019_1699';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9803431699'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rosy pun', '9803431699', NULL,
            'Imported from historical Excel (row 31).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0019_1699', 'DOB: 2025-11-03 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-22'::date,
         expiry_date = '2025-01-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 31: % -> membership %', 'Rosy pun', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 31 (%): %', 'Rosy pun', SQLERRM;
END $$;

-- ---- Row 32: Dilli Ram Pangeni (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 32 (%): organization nuad-thai-spa not found', 'Dilli Ram Pangeni';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 32 (%): branch % not found', 'Dilli Ram Pangeni', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 32 (%): tier % not found', 'Dilli Ram Pangeni', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0025_0252') THEN
    RAISE NOTICE 'SKIP row 32 (%): membership_number % already imported', 'Dilli Ram Pangeni', 'NT_PCM_0025_0252';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851040252'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Dilli Ram Pangeni', '9851040252', NULL,
            'Imported from historical Excel (row 32).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0025_0252', 'DOB: 2025-11-13 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-24'::date,
         expiry_date = '2025-01-24'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 32: % -> membership %', 'Dilli Ram Pangeni', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 32 (%): %', 'Dilli Ram Pangeni', SQLERRM;
END $$;

-- ---- Row 33: Prakash K.C (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 33 (%): organization nuad-thai-spa not found', 'Prakash K.C';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 33 (%): branch % not found', 'Prakash K.C', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 33 (%): tier % not found', 'Prakash K.C', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0026_7002') THEN
    RAISE NOTICE 'SKIP row 33 (%): membership_number % already imported', 'Prakash K.C', 'NT_PCM_0026_7002';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851097002'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Prakash K.C', '9851097002', NULL,
            'Imported from historical Excel (row 33).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0026_7002', 'DOB: 1983-06-29 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-01-27'::date,
         expiry_date = '2025-01-27'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 33: % -> membership %', 'Prakash K.C', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 33 (%): %', 'Prakash K.C', SQLERRM;
END $$;

-- ---- Row 34: Rekha manandhar (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 34 (%): organization nuad-thai-spa not found', 'Rekha manandhar';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 34 (%): branch % not found', 'Rekha manandhar', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 34 (%): tier % not found', 'Rekha manandhar', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0020_2285') THEN
    RAISE NOTICE 'SKIP row 34 (%): membership_number % already imported', 'Rekha manandhar', 'NT_DCM_0020_2285';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9779841148369'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rekha manandhar', '9779841148369', NULL,
            'Imported from historical Excel (row 34).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0020_2285', 'DOB: 1985-01-01 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-03'::date,
         expiry_date = '2025-02-03'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 34: % -> membership %', 'Rekha manandhar', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 34 (%): %', 'Rekha manandhar', SQLERRM;
END $$;

-- ---- Row 35: Jinne Singh (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 35 (%): organization nuad-thai-spa not found', 'Jinne Singh';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 35 (%): branch % not found', 'Jinne Singh', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 35 (%): tier % not found', 'Jinne Singh', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0027_4704') THEN
    RAISE NOTICE 'SKIP row 35 (%): membership_number % already imported', 'Jinne Singh', 'NT_PCM_0027_4704';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801084704'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Jinne Singh', '9801084704', NULL,
            'Imported from historical Excel (row 35).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0027_4704', 'DOB: 2025-02-02 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-02'::date,
         expiry_date = '2025-02-02'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 35: % -> membership %', 'Jinne Singh', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 35 (%): %', 'Jinne Singh', SQLERRM;
END $$;

-- ---- Row 36: Shekhar Agrawal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 36 (%): organization nuad-thai-spa not found', 'Shekhar Agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 36 (%): branch % not found', 'Shekhar Agrawal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 36 (%): tier % not found', 'Shekhar Agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0028_0736') THEN
    RAISE NOTICE 'SKIP row 36 (%): membership_number % already imported', 'Shekhar Agrawal', 'NT_PCM_0028_0736';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801020736'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Shekhar Agrawal', '9801020736', NULL,
            'Imported from historical Excel (row 36).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0028_0736', 'DOB: 1986-05-12 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-05'::date,
         expiry_date = '2025-02-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 36: % -> membership %', 'Shekhar Agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 36 (%): %', 'Shekhar Agrawal', SQLERRM;
END $$;

-- ---- Row 37: Cindy Hu (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 37 (%): organization nuad-thai-spa not found', 'Cindy Hu';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 37 (%): branch % not found', 'Cindy Hu', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 37 (%): tier % not found', 'Cindy Hu', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0029_2904') THEN
    RAISE NOTICE 'SKIP row 37 (%): membership_number % already imported', 'Cindy Hu', 'NT_PCM_0029_2904';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9707802904'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Cindy Hu', '9707802904', NULL,
            'Imported from historical Excel (row 37).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0029_2904', 'DOB: 1997-01-28 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-08'::date,
         expiry_date = '2025-02-08'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 37: % -> membership %', 'Cindy Hu', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 37 (%): %', 'Cindy Hu', SQLERRM;
END $$;

-- ---- Row 38: Thinley Yanchen (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 38 (%): organization nuad-thai-spa not found', 'Thinley Yanchen';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 38 (%): branch % not found', 'Thinley Yanchen', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 38 (%): tier % not found', 'Thinley Yanchen', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0030_1913') THEN
    RAISE NOTICE 'SKIP row 38 (%): membership_number % already imported', 'Thinley Yanchen', 'NT_PCM_0030_1913';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841251913'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Thinley Yanchen', '9841251913', NULL,
            'Imported from historical Excel (row 38).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0030_1913', 'DOB: 1967-05-03 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-09'::date,
         expiry_date = '2025-02-09'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 38: % -> membership %', 'Thinley Yanchen', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 38 (%): %', 'Thinley Yanchen', SQLERRM;
END $$;

-- ---- Row 39: Tian (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 39 (%): organization nuad-thai-spa not found', 'Tian';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 39 (%): branch % not found', 'Tian', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 39 (%): tier % not found', 'Tian', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0031_9802') THEN
    RAISE NOTICE 'SKIP row 39 (%): membership_number % already imported', 'Tian', 'NT_PCM_0031_9802';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9745619802'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Tian', '9745619802', NULL,
            'Imported from historical Excel (row 39).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0031_9802', 'DOB: 1986-11-03 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-14'::date,
         expiry_date = '2025-02-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 39: % -> membership %', 'Tian', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 39 (%): %', 'Tian', SQLERRM;
END $$;

-- ---- Row 41: Rakesh Agarwal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 41 (%): organization nuad-thai-spa not found', 'Rakesh Agarwal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 41 (%): branch % not found', 'Rakesh Agarwal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 41 (%): tier % not found', 'Rakesh Agarwal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0032_6968') THEN
    RAISE NOTICE 'SKIP row 41 (%): membership_number % already imported', 'Rakesh Agarwal', 'NT_PCM_0032_6968';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801006968'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rakesh Agarwal', '9801006968', NULL,
            'Imported from historical Excel (row 41).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0032_6968', 'DOB: 1976-12-03 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-26'::date,
         expiry_date = '2025-02-26'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 41: % -> membership %', 'Rakesh Agarwal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 41 (%): %', 'Rakesh Agarwal', SQLERRM;
END $$;

-- ---- Row 42: Rachana Shrestha (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 42 (%): organization nuad-thai-spa not found', 'Rachana Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 42 (%): branch % not found', 'Rachana Shrestha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 42 (%): tier % not found', 'Rachana Shrestha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0033_9810') THEN
    RAISE NOTICE 'SKIP row 42 (%): membership_number % already imported', 'Rachana Shrestha', 'NT_PCM_0033_9810';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851039810'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rachana Shrestha', '9851039810', NULL,
            'Imported from historical Excel (row 42).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0033_9810', 'DOB: 1973-02-11 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-26'::date,
         expiry_date = '2025-02-26'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 42: % -> membership %', 'Rachana Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 42 (%): %', 'Rachana Shrestha', SQLERRM;
END $$;

-- ---- Row 43: Sujan Shrestha (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 43 (%): organization nuad-thai-spa not found', 'Sujan Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 43 (%): branch % not found', 'Sujan Shrestha', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 43 (%): tier % not found', 'Sujan Shrestha', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0022_7204') THEN
    RAISE NOTICE 'SKIP row 43 (%): membership_number % already imported', 'Sujan Shrestha', 'NT_DCM_0022_7204';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Sujan Shrestha', NULL, NULL,
          'Imported from historical Excel (row 43). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0022_7204', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-02-27'::date,
         expiry_date = '2025-02-27'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 43: % -> membership %', 'Sujan Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 43 (%): %', 'Sujan Shrestha', SQLERRM;
END $$;

-- ---- Row 44: Chanyeong Moon (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 44 (%): organization nuad-thai-spa not found', 'Chanyeong Moon';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 44 (%): branch % not found', 'Chanyeong Moon', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 44 (%): tier % not found', 'Chanyeong Moon', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0034_5529') THEN
    RAISE NOTICE 'SKIP row 44 (%): membership_number % already imported', 'Chanyeong Moon', 'NT_PCM_0034_5529';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851422259'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Chanyeong Moon', '9851422259', NULL,
            'Imported from historical Excel (row 44).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0034_5529', 'DOB: 1990-02-13 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-01'::date,
         expiry_date = '2025-03-01'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 44: % -> membership %', 'Chanyeong Moon', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 44 (%): %', 'Chanyeong Moon', SQLERRM;
END $$;

-- ---- Row 45: Aarati Upadhyay (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 45 (%): organization nuad-thai-spa not found', 'Aarati Upadhyay';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 45 (%): branch % not found', 'Aarati Upadhyay', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 45 (%): tier % not found', 'Aarati Upadhyay', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0023_2222') THEN
    RAISE NOTICE 'SKIP row 45 (%): membership_number % already imported', 'Aarati Upadhyay', 'NT_DCM_0023_2222';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9849982222'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Aarati Upadhyay', '9849982222', NULL,
            'Imported from historical Excel (row 45).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0023_2222', 'DOB: 2025-05-07 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-10'::date,
         expiry_date = '2025-03-10'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 45: % -> membership %', 'Aarati Upadhyay', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 45 (%): %', 'Aarati Upadhyay', SQLERRM;
END $$;

-- ---- Row 46: Sita Rupakheti (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 46 (%): organization nuad-thai-spa not found', 'Sita Rupakheti';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 46 (%): branch % not found', 'Sita Rupakheti', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 46 (%): tier % not found', 'Sita Rupakheti', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0035_7937') THEN
    RAISE NOTICE 'SKIP row 46 (%): membership_number % already imported', 'Sita Rupakheti', 'NT_PCM_0035_7937';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841547937'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sita Rupakheti', '9841547937', NULL,
            'Imported from historical Excel (row 46).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0035_7937', 'DOB: 2025-08-21 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-11'::date,
         expiry_date = '2025-03-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 46: % -> membership %', 'Sita Rupakheti', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 46 (%): %', 'Sita Rupakheti', SQLERRM;
END $$;

-- ---- Row 47: Suman Gautam (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 47 (%): organization nuad-thai-spa not found', 'Suman Gautam';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 47 (%): branch % not found', 'Suman Gautam', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 47 (%): tier % not found', 'Suman Gautam', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0036_5117') THEN
    RAISE NOTICE 'SKIP row 47 (%): membership_number % already imported', 'Suman Gautam', 'NT_PCM_0036_5117';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9705115117'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Suman Gautam', '9705115117', NULL,
            'Imported from historical Excel (row 47).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0036_5117', 'DOB: 2025-07-21 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-11'::date,
         expiry_date = '2025-03-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 47: % -> membership %', 'Suman Gautam', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 47 (%): %', 'Suman Gautam', SQLERRM;
END $$;

-- ---- Row 48: Arati Jyoti (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 48 (%): organization nuad-thai-spa not found', 'Arati Jyoti';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 48 (%): branch % not found', 'Arati Jyoti', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 48 (%): tier % not found', 'Arati Jyoti', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0037_2546') THEN
    RAISE NOTICE 'SKIP row 48 (%): membership_number % already imported', 'Arati Jyoti', 'NT_PCM_0037_2546';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851022546'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Arati Jyoti', '9851022546', NULL,
            'Imported from historical Excel (row 48).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0037_2546', 'DOB: 2025-01-23 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 99999.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-23'::date,
         expiry_date = '2025-03-23'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 48: % -> membership %', 'Arati Jyoti', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 48 (%): %', 'Arati Jyoti', SQLERRM;
END $$;

-- ---- Row 49: Giresh Chand (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 49 (%): organization nuad-thai-spa not found', 'Giresh Chand';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 49 (%): branch % not found', 'Giresh Chand', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 49 (%): tier % not found', 'Giresh Chand', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0038_0699') THEN
    RAISE NOTICE 'SKIP row 49 (%): membership_number % already imported', 'Giresh Chand', 'NT_PCM_0038_0699';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841615093'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Giresh Chand', '9841615093', NULL,
            'Imported from historical Excel (row 49).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0038_0699', 'DOB: 2025-04-11 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-29'::date,
         expiry_date = '2025-03-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 49: % -> membership %', 'Giresh Chand', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 49 (%): %', 'Giresh Chand', SQLERRM;
END $$;

-- ---- Row 51: MANOJ/VINEET (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 51 (%): organization nuad-thai-spa not found', 'MANOJ/VINEET';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 51 (%): branch % not found', 'MANOJ/VINEET', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 51 (%): tier % not found', 'MANOJ/VINEET', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0040_3437') THEN
    RAISE NOTICE 'SKIP row 51 (%): membership_number % already imported', 'MANOJ/VINEET', 'NT_PCM_0040_3437';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'MANOJ/VINEET', NULL, NULL,
          'Imported from historical Excel (row 51). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0040_3437', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-03-31'::date,
         expiry_date = '2025-03-31'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 51: % -> membership %', 'MANOJ/VINEET', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 51 (%): %', 'MANOJ/VINEET', SQLERRM;
END $$;

-- ---- Row 52: LOPSANG JIGME (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 52 (%): organization nuad-thai-spa not found', 'LOPSANG JIGME';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 52 (%): branch % not found', 'LOPSANG JIGME', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 52 (%): tier % not found', 'LOPSANG JIGME', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0024_5282') THEN
    RAISE NOTICE 'SKIP row 52 (%): membership_number % already imported', 'LOPSANG JIGME', 'NT_DCM_0024_5282';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9808835282'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'LOPSANG JIGME', '9808835282', NULL,
            'Imported from historical Excel (row 52).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0024_5282', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 52: % -> membership %', 'LOPSANG JIGME', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 52 (%): %', 'LOPSANG JIGME', SQLERRM;
END $$;

-- ---- Row 53: Sagar Gurung (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 53 (%): organization nuad-thai-spa not found', 'Sagar Gurung';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 53 (%): branch % not found', 'Sagar Gurung', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 53 (%): tier % not found', 'Sagar Gurung', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0041_6326') THEN
    RAISE NOTICE 'SKIP row 53 (%): membership_number % already imported', 'Sagar Gurung', 'NT_PCM_0041_6326';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9861486326'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sagar Gurung', '9861486326', NULL,
            'Imported from historical Excel (row 53).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0041_6326', 'DOB: 2025-09-13 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-04'::date,
         expiry_date = '2025-04-04'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 53: % -> membership %', 'Sagar Gurung', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 53 (%): %', 'Sagar Gurung', SQLERRM;
END $$;

-- ---- Row 54: DWARIKA SHRESTHA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 54 (%): organization nuad-thai-spa not found', 'DWARIKA SHRESTHA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 54 (%): branch % not found', 'DWARIKA SHRESTHA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 54 (%): tier % not found', 'DWARIKA SHRESTHA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0042_0477') THEN
    RAISE NOTICE 'SKIP row 54 (%): membership_number % already imported', 'DWARIKA SHRESTHA', 'NT_PCM_0042_0477';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851020477'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'DWARIKA SHRESTHA', '9851020477', NULL,
            'Imported from historical Excel (row 54).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0042_0477', 'DOB: 2025-07-15 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-05'::date,
         expiry_date = '2025-04-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 54: % -> membership %', 'DWARIKA SHRESTHA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 54 (%): %', 'DWARIKA SHRESTHA', SQLERRM;
END $$;

-- ---- Row 55: SAGAR DHAKAL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 55 (%): organization nuad-thai-spa not found', 'SAGAR DHAKAL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 55 (%): branch % not found', 'SAGAR DHAKAL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 55 (%): tier % not found', 'SAGAR DHAKAL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0043_5216') THEN
    RAISE NOTICE 'SKIP row 55 (%): membership_number % already imported', 'SAGAR DHAKAL', 'NT_PCM_0043_5216';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851055216'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'SAGAR DHAKAL', '9851055216', NULL,
            'Imported from historical Excel (row 55).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0043_5216', 'DOB: 2025-04-26 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-05'::date,
         expiry_date = '2025-04-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 55: % -> membership %', 'SAGAR DHAKAL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 55 (%): %', 'SAGAR DHAKAL', SQLERRM;
END $$;

-- ---- Row 57: Vishakha Sawawagi (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 57 (%): organization nuad-thai-spa not found', 'Vishakha Sawawagi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 57 (%): branch % not found', 'Vishakha Sawawagi', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 57 (%): tier % not found', 'Vishakha Sawawagi', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0026_2666') THEN
    RAISE NOTICE 'SKIP row 57 (%): membership_number % already imported', 'Vishakha Sawawagi', 'NT_DCM_0026_2666';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802752666'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Vishakha Sawawagi', '9802752666', NULL,
            'Imported from historical Excel (row 57).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0026_2666', 'DOB: 2025-09-22 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-05'::date,
         expiry_date = '2025-04-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 57: % -> membership %', 'Vishakha Sawawagi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 57 (%): %', 'Vishakha Sawawagi', SQLERRM;
END $$;

-- ---- Row 57: Dan Bahadur (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 57 (%): organization nuad-thai-spa not found', 'Dan Bahadur';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 57 (%): branch % not found', 'Dan Bahadur', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 57 (%): tier % not found', 'Dan Bahadur', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0044_3861') THEN
    RAISE NOTICE 'SKIP row 57 (%): membership_number % already imported', 'Dan Bahadur', 'NT_PCM_0044_3861';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Dan Bahadur', NULL, NULL,
          'Imported from historical Excel (row 57). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0044_3861', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-11'::date,
         expiry_date = '2025-04-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 57: % -> membership %', 'Dan Bahadur', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 57 (%): %', 'Dan Bahadur', SQLERRM;
END $$;

-- ---- Row 58: Atit Shrestha (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 58 (%): organization nuad-thai-spa not found', 'Atit Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 58 (%): branch % not found', 'Atit Shrestha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 58 (%): tier % not found', 'Atit Shrestha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0045_5216') THEN
    RAISE NOTICE 'SKIP row 58 (%): membership_number % already imported', 'Atit Shrestha', 'NT_PCM_0045_5216';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Atit Shrestha', NULL, NULL,
          'Imported from historical Excel (row 58). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0045_5216', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-11'::date,
         expiry_date = '2025-04-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 58: % -> membership %', 'Atit Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 58 (%): %', 'Atit Shrestha', SQLERRM;
END $$;

-- ---- Row 59: ANIL RAI (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 59 (%): organization nuad-thai-spa not found', 'ANIL RAI';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 59 (%): branch % not found', 'ANIL RAI', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 59 (%): tier % not found', 'ANIL RAI', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0027_5404') THEN
    RAISE NOTICE 'SKIP row 59 (%): membership_number % already imported', 'ANIL RAI', 'NT_DCM_0027_5404';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9861705404'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'ANIL RAI', '9861705404', NULL,
            'Imported from historical Excel (row 59).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0027_5404', 'DOB: 17/10/1989')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 59: % -> membership %', 'ANIL RAI', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 59 (%): %', 'ANIL RAI', SQLERRM;
END $$;

-- ---- Row 60: MADHU DIXIT DEVKOTA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 60 (%): organization nuad-thai-spa not found', 'MADHU DIXIT DEVKOTA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 60 (%): branch % not found', 'MADHU DIXIT DEVKOTA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 60 (%): tier % not found', 'MADHU DIXIT DEVKOTA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0046_8772') THEN
    RAISE NOTICE 'SKIP row 60 (%): membership_number % already imported', 'MADHU DIXIT DEVKOTA', 'NT_PCM_0046_8772';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9857108772'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'MADHU DIXIT DEVKOTA', '9857108772', NULL,
            'Imported from historical Excel (row 60).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0046_8772', 'DOB: 25/05/60')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 60: % -> membership %', 'MADHU DIXIT DEVKOTA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 60 (%): %', 'MADHU DIXIT DEVKOTA', SQLERRM;
END $$;

-- ---- Row 61: Sanjeev Aryal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 61 (%): organization nuad-thai-spa not found', 'Sanjeev Aryal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 61 (%): branch % not found', 'Sanjeev Aryal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 61 (%): tier % not found', 'Sanjeev Aryal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0047_6574') THEN
    RAISE NOTICE 'SKIP row 61 (%): membership_number % already imported', 'Sanjeev Aryal', 'NT_PCM_0047_6574';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '980106674'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sanjeev Aryal', '980106674', NULL,
            'Imported from historical Excel (row 61).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0047_6574', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-18'::date,
         expiry_date = '2025-04-18'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 61: % -> membership %', 'Sanjeev Aryal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 61 (%): %', 'Sanjeev Aryal', SQLERRM;
END $$;

-- ---- Row 62: Aryan (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 62 (%): organization nuad-thai-spa not found', 'Aryan';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 62 (%): branch % not found', 'Aryan', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 62 (%): tier % not found', 'Aryan', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0048_1999') THEN
    RAISE NOTICE 'SKIP row 62 (%): membership_number % already imported', 'Aryan', 'NT_PCM_0048_1999';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801451999'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Aryan', '9801451999', NULL,
            'Imported from historical Excel (row 62).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0048_1999', 'DOB: 12-')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-19'::date,
         expiry_date = '2025-04-19'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 62: % -> membership %', 'Aryan', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 62 (%): %', 'Aryan', SQLERRM;
END $$;

-- ---- Row 63: Tenzing Nyiden lama (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 63 (%): organization nuad-thai-spa not found', 'Tenzing Nyiden lama';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 63 (%): branch % not found', 'Tenzing Nyiden lama', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 63 (%): tier % not found', 'Tenzing Nyiden lama', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0049_5707') THEN
    RAISE NOTICE 'SKIP row 63 (%): membership_number % already imported', 'Tenzing Nyiden lama', 'NT_PCM_0049_5707';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Tenzing Nyiden lama', NULL, NULL,
          'Imported from historical Excel (row 63). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0049_5707', 'DOB: 2025-10-29 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-22'::date,
         expiry_date = '2025-04-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 63: % -> membership %', 'Tenzing Nyiden lama', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 63 (%): %', 'Tenzing Nyiden lama', SQLERRM;
END $$;

-- ---- Row 64: Rajan Rayamajhi (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 64 (%): organization nuad-thai-spa not found', 'Rajan Rayamajhi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 64 (%): branch % not found', 'Rajan Rayamajhi', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 64 (%): tier % not found', 'Rajan Rayamajhi', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0050_0758') THEN
    RAISE NOTICE 'SKIP row 64 (%): membership_number % already imported', 'Rajan Rayamajhi', 'NT_PCM_0050_0758';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Rajan Rayamajhi', NULL, NULL,
          'Imported from historical Excel (row 64). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0050_0758', 'DOB: 2025-08-25 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-04-25'::date,
         expiry_date = '2025-04-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 64: % -> membership %', 'Rajan Rayamajhi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 64 (%): %', 'Rajan Rayamajhi', SQLERRM;
END $$;

-- ---- Row 65: Madhusudan Koirala (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 65 (%): organization nuad-thai-spa not found', 'Madhusudan Koirala';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 65 (%): branch % not found', 'Madhusudan Koirala', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 65 (%): tier % not found', 'Madhusudan Koirala', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0028_9725') THEN
    RAISE NOTICE 'SKIP row 65 (%): membership_number % already imported', 'Madhusudan Koirala', 'NT_DCM_0028_9725';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841569725'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Madhusudan Koirala', '9841569725', NULL,
            'Imported from historical Excel (row 65).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0028_9725', 'DOB: 2025-09-28 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 65: % -> membership %', 'Madhusudan Koirala', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 65 (%): %', 'Madhusudan Koirala', SQLERRM;
END $$;

-- ---- Row 66: Chand/Anita (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 66 (%): organization nuad-thai-spa not found', 'Chand/Anita';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 66 (%): branch % not found', 'Chand/Anita', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 66 (%): tier % not found', 'Chand/Anita', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0051_4856') THEN
    RAISE NOTICE 'SKIP row 66 (%): membership_number % already imported', 'Chand/Anita', 'NT_PCM_0051_4856';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851114863'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Chand/Anita', '9851114863', NULL,
            'Imported from historical Excel (row 66).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0051_4856', 'DOB: 2025-06-18 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 65000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-03'::date,
         expiry_date = '2025-05-03'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 66: % -> membership %', 'Chand/Anita', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 66 (%): %', 'Chand/Anita', SQLERRM;
END $$;

-- ---- Row 67: RUPAK GHIMIRE (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 67 (%): organization nuad-thai-spa not found', 'RUPAK GHIMIRE';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 67 (%): branch % not found', 'RUPAK GHIMIRE', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 67 (%): tier % not found', 'RUPAK GHIMIRE', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0029_0007') THEN
    RAISE NOTICE 'SKIP row 67 (%): membership_number % already imported', 'RUPAK GHIMIRE', 'NT_DCM_0029_0007';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802900007'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'RUPAK GHIMIRE', '9802900007', NULL,
            'Imported from historical Excel (row 67).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0029_0007', 'DOB: 7TH DEC,1982')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 67: % -> membership %', 'RUPAK GHIMIRE', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 67 (%): %', 'RUPAK GHIMIRE', SQLERRM;
END $$;

-- ---- Row 68: SANDEEP SHAH BANIYA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 68 (%): organization nuad-thai-spa not found', 'SANDEEP SHAH BANIYA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 68 (%): branch % not found', 'SANDEEP SHAH BANIYA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 68 (%): tier % not found', 'SANDEEP SHAH BANIYA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0052_7600') THEN
    RAISE NOTICE 'SKIP row 68 (%): membership_number % already imported', 'SANDEEP SHAH BANIYA', 'NT_PCM_0052_7600';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9708067600'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'SANDEEP SHAH BANIYA', '9708067600', NULL,
            'Imported from historical Excel (row 68).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0052_7600', 'DOB: 18-APRI')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-10'::date,
         expiry_date = '2025-05-10'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 68: % -> membership %', 'SANDEEP SHAH BANIYA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 68 (%): %', 'SANDEEP SHAH BANIYA', SQLERRM;
END $$;

-- ---- Row 69: Mr. Mittal (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 69 (%): organization nuad-thai-spa not found', 'Mr. Mittal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 69 (%): branch % not found', 'Mr. Mittal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 69 (%): tier % not found', 'Mr. Mittal', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0030_1066') THEN
    RAISE NOTICE 'SKIP row 69 (%): membership_number % already imported', 'Mr. Mittal', 'NT_DCM_0030_1066';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9862681066'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Mr. Mittal', '9862681066', NULL,
            'Imported from historical Excel (row 69).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0030_1066', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 69: % -> membership %', 'Mr. Mittal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 69 (%): %', 'Mr. Mittal', SQLERRM;
END $$;

-- ---- Row 70: Mr. Subrat Basnet (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 70 (%): organization nuad-thai-spa not found', 'Mr. Subrat Basnet';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 70 (%): branch % not found', 'Mr. Subrat Basnet', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 70 (%): tier % not found', 'Mr. Subrat Basnet', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0031_8310') THEN
    RAISE NOTICE 'SKIP row 70 (%): membership_number % already imported', 'Mr. Subrat Basnet', 'NT_DCM_0031_8310';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801018310'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Mr. Subrat Basnet', '9801018310', NULL,
            'Imported from historical Excel (row 70).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0031_8310', 'DOB: 3RD NOV-85')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 70: % -> membership %', 'Mr. Subrat Basnet', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 70 (%): %', 'Mr. Subrat Basnet', SQLERRM;
END $$;

-- ---- Row 71: Alish Maharjan (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 71 (%): organization nuad-thai-spa not found', 'Alish Maharjan';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 71 (%): branch % not found', 'Alish Maharjan', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 71 (%): tier % not found', 'Alish Maharjan', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0053_8567') THEN
    RAISE NOTICE 'SKIP row 71 (%): membership_number % already imported', 'Alish Maharjan', 'NT_PCM_0053_8567';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Alish Maharjan', NULL, NULL,
          'Imported from historical Excel (row 71). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0053_8567', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-16'::date,
         expiry_date = '2025-05-16'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 71: % -> membership %', 'Alish Maharjan', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 71 (%): %', 'Alish Maharjan', SQLERRM;
END $$;

-- ---- Row 72: Rs Bhandari (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 72 (%): organization nuad-thai-spa not found', 'Rs Bhandari';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 72 (%): branch % not found', 'Rs Bhandari', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 72 (%): tier % not found', 'Rs Bhandari', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0054_0958') THEN
    RAISE NOTICE 'SKIP row 72 (%): membership_number % already imported', 'Rs Bhandari', 'NT_PCM_0054_0958';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Rs Bhandari', NULL, NULL,
          'Imported from historical Excel (row 72). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0054_0958', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-16'::date,
         expiry_date = '2025-05-16'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 72: % -> membership %', 'Rs Bhandari', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 72 (%): %', 'Rs Bhandari', SQLERRM;
END $$;

-- ---- Row 73: ANKITA AGGRAWAL (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 73 (%): organization nuad-thai-spa not found', 'ANKITA AGGRAWAL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 73 (%): branch % not found', 'ANKITA AGGRAWAL', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 73 (%): tier % not found', 'ANKITA AGGRAWAL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0055_7222') THEN
    RAISE NOTICE 'SKIP row 73 (%): membership_number % already imported', 'ANKITA AGGRAWAL', 'NT_PCM_0055_7222';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9813157222'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'ANKITA AGGRAWAL', '9813157222', NULL,
            'Imported from historical Excel (row 73).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0055_7222', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-21'::date,
         expiry_date = '2025-05-21'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 73: % -> membership %', 'ANKITA AGGRAWAL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 73 (%): %', 'ANKITA AGGRAWAL', SQLERRM;
END $$;

-- ---- Row 74: SURAJ GOYAL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 74 (%): organization nuad-thai-spa not found', 'SURAJ GOYAL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 74 (%): branch % not found', 'SURAJ GOYAL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 74 (%): tier % not found', 'SURAJ GOYAL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0056_3349') THEN
    RAISE NOTICE 'SKIP row 74 (%): membership_number % already imported', 'SURAJ GOYAL', 'NT_PCM_0056_3349';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841563349'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'SURAJ GOYAL', '9841563349', NULL,
            'Imported from historical Excel (row 74).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0056_3349', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-24'::date,
         expiry_date = '2025-05-24'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 74: % -> membership %', 'SURAJ GOYAL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 74 (%): %', 'SURAJ GOYAL', SQLERRM;
END $$;

-- ---- Row 75: TENZING SONAM (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 75 (%): organization nuad-thai-spa not found', 'TENZING SONAM';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 75 (%): branch % not found', 'TENZING SONAM', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 75 (%): tier % not found', 'TENZING SONAM', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0057_4883') THEN
    RAISE NOTICE 'SKIP row 75 (%): membership_number % already imported', 'TENZING SONAM', 'NT_PCM_0057_4883';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9813304883'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'TENZING SONAM', '9813304883', NULL,
            'Imported from historical Excel (row 75).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0057_4883', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-25'::date,
         expiry_date = '2025-05-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 75: % -> membership %', 'TENZING SONAM', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 75 (%): %', 'TENZING SONAM', SQLERRM;
END $$;

-- ---- Row 76: NARENDRA BALLAB PANTA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 76 (%): organization nuad-thai-spa not found', 'NARENDRA BALLAB PANTA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 76 (%): branch % not found', 'NARENDRA BALLAB PANTA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 76 (%): tier % not found', 'NARENDRA BALLAB PANTA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0058_4179') THEN
    RAISE NOTICE 'SKIP row 76 (%): membership_number % already imported', 'NARENDRA BALLAB PANTA', 'NT_PCM_0058_4179';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851014179'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'NARENDRA BALLAB PANTA', '9851014179', NULL,
            'Imported from historical Excel (row 76).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0058_4179', 'DOB: 7TH')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-28'::date,
         expiry_date = '2025-05-28'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 76: % -> membership %', 'NARENDRA BALLAB PANTA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 76 (%): %', 'NARENDRA BALLAB PANTA', SQLERRM;
END $$;

-- ---- Row 77: RIKZEN SHERPA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 77 (%): organization nuad-thai-spa not found', 'RIKZEN SHERPA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 77 (%): branch % not found', 'RIKZEN SHERPA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 77 (%): tier % not found', 'RIKZEN SHERPA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0059_9088') THEN
    RAISE NOTICE 'SKIP row 77 (%): membership_number % already imported', 'RIKZEN SHERPA', 'NT_PCM_0059_9088';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801049088'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'RIKZEN SHERPA', '9801049088', NULL,
            'Imported from historical Excel (row 77).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0059_9088', 'DOB: 30TH DEC')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-28'::date,
         expiry_date = '2025-05-28'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 77: % -> membership %', 'RIKZEN SHERPA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 77 (%): %', 'RIKZEN SHERPA', SQLERRM;
END $$;

-- ---- Row 78: Sabina Lama (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 78 (%): organization nuad-thai-spa not found', 'Sabina Lama';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 78 (%): branch % not found', 'Sabina Lama', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 78 (%): tier % not found', 'Sabina Lama', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0060_5050') THEN
    RAISE NOTICE 'SKIP row 78 (%): membership_number % already imported', 'Sabina Lama', 'NT_PCM_0060_5050';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851165050'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sabina Lama', '9851165050', NULL,
            'Imported from historical Excel (row 78).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0060_5050', 'DOB: 14TH JULY')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-29'::date,
         expiry_date = '2025-05-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 78: % -> membership %', 'Sabina Lama', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 78 (%): %', 'Sabina Lama', SQLERRM;
END $$;

-- ---- Row 79: RANJIT ACHARYA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 79 (%): organization nuad-thai-spa not found', 'RANJIT ACHARYA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 79 (%): branch % not found', 'RANJIT ACHARYA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 79 (%): tier % not found', 'RANJIT ACHARYA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0061_1213') THEN
    RAISE NOTICE 'SKIP row 79 (%): membership_number % already imported', 'RANJIT ACHARYA', 'NT_PCM_0061_1213';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851021213'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'RANJIT ACHARYA', '9851021213', NULL,
            'Imported from historical Excel (row 79).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0061_1213', 'DOB: 6th aug')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-05-31'::date,
         expiry_date = '2025-05-31'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 79: % -> membership %', 'RANJIT ACHARYA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 79 (%): %', 'RANJIT ACHARYA', SQLERRM;
END $$;

-- ---- Row 80: Barkha Aggarwal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 80 (%): organization nuad-thai-spa not found', 'Barkha Aggarwal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 80 (%): branch % not found', 'Barkha Aggarwal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 80 (%): tier % not found', 'Barkha Aggarwal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0062_2525') THEN
    RAISE NOTICE 'SKIP row 80 (%): membership_number % already imported', 'Barkha Aggarwal', 'NT_PCM_0062_2525';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851232525'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Barkha Aggarwal', '9851232525', NULL,
            'Imported from historical Excel (row 80).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0062_2525', 'DOB: 2025-05-25 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-06-01'::date,
         expiry_date = '2025-06-01'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 80: % -> membership %', 'Barkha Aggarwal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 80 (%): %', 'Barkha Aggarwal', SQLERRM;
END $$;

-- ---- Row 81: Dipak Atal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 81 (%): organization nuad-thai-spa not found', 'Dipak Atal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 81 (%): branch % not found', 'Dipak Atal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 81 (%): tier % not found', 'Dipak Atal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0063_0012') THEN
    RAISE NOTICE 'SKIP row 81 (%): membership_number % already imported', 'Dipak Atal', 'NT_PCM_0063_0012';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802790012'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Dipak Atal', '9802790012', NULL,
            'Imported from historical Excel (row 81).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0063_0012', 'DOB: 2025-11-06 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 90000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-06-11'::date,
         expiry_date = '2025-06-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 81: % -> membership %', 'Dipak Atal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 81 (%): %', 'Dipak Atal', SQLERRM;
END $$;

-- ---- Row 82: SAURAV RAUNIYA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 82 (%): organization nuad-thai-spa not found', 'SAURAV RAUNIYA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 82 (%): branch % not found', 'SAURAV RAUNIYA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 82 (%): tier % not found', 'SAURAV RAUNIYA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0064_1474') THEN
    RAISE NOTICE 'SKIP row 82 (%): membership_number % already imported', 'SAURAV RAUNIYA', 'NT_PCM_0064_1474';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '98188814174'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'SAURAV RAUNIYA', '98188814174', NULL,
            'Imported from historical Excel (row 82).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0064_1474', 'DOB: 17TH JUNE')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 82: % -> membership %', 'SAURAV RAUNIYA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 82 (%): %', 'SAURAV RAUNIYA', SQLERRM;
END $$;

-- ---- Row 83: PITAMBER PAUDEL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 83 (%): organization nuad-thai-spa not found', 'PITAMBER PAUDEL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 83 (%): branch % not found', 'PITAMBER PAUDEL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 83 (%): tier % not found', 'PITAMBER PAUDEL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0065_2057') THEN
    RAISE NOTICE 'SKIP row 83 (%): membership_number % already imported', 'PITAMBER PAUDEL', 'NT_PCM_0065_2057';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851072057'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'PITAMBER PAUDEL', '9851072057', NULL,
            'Imported from historical Excel (row 83).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0065_2057', 'DOB: 2025-06-28 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 83: % -> membership %', 'PITAMBER PAUDEL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 83 (%): %', 'PITAMBER PAUDEL', SQLERRM;
END $$;

-- ---- Row 84: RABIN GURUNG (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 84 (%): organization nuad-thai-spa not found', 'RABIN GURUNG';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 84 (%): branch % not found', 'RABIN GURUNG', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 84 (%): tier % not found', 'RABIN GURUNG', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0066_4054') THEN
    RAISE NOTICE 'SKIP row 84 (%): membership_number % already imported', 'RABIN GURUNG', 'NT_PCM_0066_4054';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851034054'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'RABIN GURUNG', '9851034054', NULL,
            'Imported from historical Excel (row 84).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0066_4054', 'DOB: 27TH APRIL')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 84: % -> membership %', 'RABIN GURUNG', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 84 (%): %', 'RABIN GURUNG', SQLERRM;
END $$;

-- ---- Row 85: ALOK BANSAL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 85 (%): organization nuad-thai-spa not found', 'ALOK BANSAL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 85 (%): branch % not found', 'ALOK BANSAL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 85 (%): tier % not found', 'ALOK BANSAL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0067_3515') THEN
    RAISE NOTICE 'SKIP row 85 (%): membership_number % already imported', 'ALOK BANSAL', 'NT_PCM_0067_3515';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851103515'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'ALOK BANSAL', '9851103515', NULL,
            'Imported from historical Excel (row 85).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0067_3515', 'DOB: 14/07/1981')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 85: % -> membership %', 'ALOK BANSAL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 85 (%): %', 'ALOK BANSAL', SQLERRM;
END $$;

-- ---- Row 86: SANJAY AGRAWAL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 86 (%): organization nuad-thai-spa not found', 'SANJAY AGRAWAL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 86 (%): branch % not found', 'SANJAY AGRAWAL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 86 (%): tier % not found', 'SANJAY AGRAWAL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0068_9244') THEN
    RAISE NOTICE 'SKIP row 86 (%): membership_number % already imported', 'SANJAY AGRAWAL', 'NT_PCM_0068_9244';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851079244'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'SANJAY AGRAWAL', '9851079244', NULL,
            'Imported from historical Excel (row 86).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0068_9244', 'DOB: 1975-11-08 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 86: % -> membership %', 'SANJAY AGRAWAL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 86 (%): %', 'SANJAY AGRAWAL', SQLERRM;
END $$;

-- ---- Row 87: AURA SCHEEL (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 87 (%): organization nuad-thai-spa not found', 'AURA SCHEEL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 87 (%): branch % not found', 'AURA SCHEEL', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 87 (%): tier % not found', 'AURA SCHEEL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0069_8338') THEN
    RAISE NOTICE 'SKIP row 87 (%): membership_number % already imported', 'AURA SCHEEL', 'NT_PCM_0069_8338';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9708528338'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'AURA SCHEEL', '9708528338', NULL,
            'Imported from historical Excel (row 87).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0069_8338', 'DOB: 27/07/1983')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 87: % -> membership %', 'AURA SCHEEL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 87 (%): %', 'AURA SCHEEL', SQLERRM;
END $$;

-- ---- Row 88: AYUSH SHARMA (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 88 (%): organization nuad-thai-spa not found', 'AYUSH SHARMA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 88 (%): branch % not found', 'AYUSH SHARMA', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 88 (%): tier % not found', 'AYUSH SHARMA', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0032_8310') THEN
    RAISE NOTICE 'SKIP row 88 (%): membership_number % already imported', 'AYUSH SHARMA', 'NT_DCM_0032_8310';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'AYUSH SHARMA', NULL, NULL,
          'Imported from historical Excel (row 88). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0032_8310', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-06-28'::date,
         expiry_date = '2025-06-28'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 88: % -> membership %', 'AYUSH SHARMA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 88 (%): %', 'AYUSH SHARMA', SQLERRM;
END $$;

-- ---- Row 89: MANOJ PARAJULI (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 89 (%): organization nuad-thai-spa not found', 'MANOJ PARAJULI';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 89 (%): branch % not found', 'MANOJ PARAJULI', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 89 (%): tier % not found', 'MANOJ PARAJULI', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0070_3960') THEN
    RAISE NOTICE 'SKIP row 89 (%): membership_number % already imported', 'MANOJ PARAJULI', 'NT_PCM_0070_3960';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851003960'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'MANOJ PARAJULI', '9851003960', NULL,
            'Imported from historical Excel (row 89).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0070_3960', 'DOB: 29TH JUNE')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 15000.0,
          NULL);

  RAISE NOTICE 'Imported row 89: % -> membership %', 'MANOJ PARAJULI', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 89 (%): %', 'MANOJ PARAJULI', SQLERRM;
END $$;

-- ---- Row 90: JHAINDRA GHIMIRE (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 90 (%): organization nuad-thai-spa not found', 'JHAINDRA GHIMIRE';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 90 (%): branch % not found', 'JHAINDRA GHIMIRE', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 90 (%): tier % not found', 'JHAINDRA GHIMIRE', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0071_4784') THEN
    RAISE NOTICE 'SKIP row 90 (%): membership_number % already imported', 'JHAINDRA GHIMIRE', 'NT_PCM_0071_4784';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851024784'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'JHAINDRA GHIMIRE', '9851024784', NULL,
            'Imported from historical Excel (row 90).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0071_4784', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 90: % -> membership %', 'JHAINDRA GHIMIRE', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 90 (%): %', 'JHAINDRA GHIMIRE', SQLERRM;
END $$;

-- ---- Row 92: Anisha Agrawal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 92 (%): organization nuad-thai-spa not found', 'Anisha Agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 92 (%): branch % not found', 'Anisha Agrawal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 92 (%): tier % not found', 'Anisha Agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0073_8042') THEN
    RAISE NOTICE 'SKIP row 92 (%): membership_number % already imported', 'Anisha Agrawal', 'NT_PCM_0073_8042';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851008042'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Anisha Agrawal', '9851008042', NULL,
            'Imported from historical Excel (row 92).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0073_8042', 'DOB: 28TH SEP')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-07-19'::date,
         expiry_date = '2025-07-19'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 92: % -> membership %', 'Anisha Agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 92 (%): %', 'Anisha Agrawal', SQLERRM;
END $$;

-- ---- Row 93: Saadgi (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 93 (%): organization nuad-thai-spa not found', 'Saadgi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 93 (%): branch % not found', 'Saadgi', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 93 (%): tier % not found', 'Saadgi', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0074_0912') THEN
    RAISE NOTICE 'SKIP row 93 (%): membership_number % already imported', 'Saadgi', 'NT_PCM_0074_0912';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Saadgi', NULL, NULL,
          'Imported from historical Excel (row 93). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0074_0912', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-07-20'::date,
         expiry_date = '2025-07-20'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 93: % -> membership %', 'Saadgi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 93 (%): %', 'Saadgi', SQLERRM;
END $$;

-- ---- Row 94: BHARTI GOEL (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 94 (%): organization nuad-thai-spa not found', 'BHARTI GOEL';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 94 (%): branch % not found', 'BHARTI GOEL', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 94 (%): tier % not found', 'BHARTI GOEL', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0075_1831') THEN
    RAISE NOTICE 'SKIP row 94 (%): membership_number % already imported', 'BHARTI GOEL', 'NT_PCM_0075_1831';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'BHARTI GOEL', NULL, NULL,
          'Imported from historical Excel (row 94). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0075_1831', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-07-25'::date,
         expiry_date = '2025-07-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 94: % -> membership %', 'BHARTI GOEL', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 94 (%): %', 'BHARTI GOEL', SQLERRM;
END $$;

-- ---- Row 96: MATEO GROSS (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 96 (%): organization nuad-thai-spa not found', 'MATEO GROSS';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 96 (%): branch % not found', 'MATEO GROSS', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 96 (%): tier % not found', 'MATEO GROSS', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0077_0202') THEN
    RAISE NOTICE 'SKIP row 96 (%): membership_number % already imported', 'MATEO GROSS', 'NT_PCM_0077_0202';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801040202'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'MATEO GROSS', '9801040202', NULL,
            'Imported from historical Excel (row 96).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0077_0202', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-07-31'::date,
         expiry_date = '2025-07-31'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 96: % -> membership %', 'MATEO GROSS', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 96 (%): %', 'MATEO GROSS', SQLERRM;
END $$;

-- ---- Row 97: MR.CULLEN (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 97 (%): organization nuad-thai-spa not found', 'MR.CULLEN';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 97 (%): branch % not found', 'MR.CULLEN', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 97 (%): tier % not found', 'MR.CULLEN', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0033_2920') THEN
    RAISE NOTICE 'SKIP row 97 (%): membership_number % already imported', 'MR.CULLEN', 'NT_DCM_0033_2920';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'MR.CULLEN', NULL, NULL,
          'Imported from historical Excel (row 97). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0033_2920', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 97: % -> membership %', 'MR.CULLEN', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 97 (%): %', 'MR.CULLEN', SQLERRM;
END $$;

-- ---- Row 98: RAJESH BUDHITYA (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 98 (%): organization nuad-thai-spa not found', 'RAJESH BUDHITYA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 98 (%): branch % not found', 'RAJESH BUDHITYA', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 98 (%): tier % not found', 'RAJESH BUDHITYA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0078_7000') THEN
    RAISE NOTICE 'SKIP row 98 (%): membership_number % already imported', 'RAJESH BUDHITYA', 'NT_PCM_0078_7000';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801077000'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'RAJESH BUDHITYA', '9801077000', NULL,
            'Imported from historical Excel (row 98).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0078_7000', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-08-16'::date,
         expiry_date = '2025-08-16'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 98: % -> membership %', 'RAJESH BUDHITYA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 98 (%): %', 'RAJESH BUDHITYA', SQLERRM;
END $$;

-- ---- Row 100: Sushil Pandey (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 100 (%): organization nuad-thai-spa not found', 'Sushil Pandey';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 100 (%): branch % not found', 'Sushil Pandey', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 100 (%): tier % not found', 'Sushil Pandey', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0079_4247') THEN
    RAISE NOTICE 'SKIP row 100 (%): membership_number % already imported', 'Sushil Pandey', 'NT_PCM_0079_4247';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9809484247'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sushil Pandey', '9809484247', NULL,
            'Imported from historical Excel (row 100).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0079_4247', 'DOB: 2025-07-23 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-08-17'::date,
         expiry_date = '2025-08-17'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 100: % -> membership %', 'Sushil Pandey', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 100 (%): %', 'Sushil Pandey', SQLERRM;
END $$;

-- ---- Row 101: Tashi Dorjee (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 101 (%): organization nuad-thai-spa not found', 'Tashi Dorjee';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 101 (%): branch % not found', 'Tashi Dorjee', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 101 (%): tier % not found', 'Tashi Dorjee', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0080_5313') THEN
    RAISE NOTICE 'SKIP row 101 (%): membership_number % already imported', 'Tashi Dorjee', 'NT_PCM_0080_5313';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9840325313'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Tashi Dorjee', '9840325313', NULL,
            'Imported from historical Excel (row 101).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0080_5313', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-08-22'::date,
         expiry_date = '2025-08-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 101: % -> membership %', 'Tashi Dorjee', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 101 (%): %', 'Tashi Dorjee', SQLERRM;
END $$;

-- ---- Row 102: Yuko Kawatani (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 102 (%): organization nuad-thai-spa not found', 'Yuko Kawatani';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 102 (%): branch % not found', 'Yuko Kawatani', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 102 (%): tier % not found', 'Yuko Kawatani', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0081_1207') THEN
    RAISE NOTICE 'SKIP row 102 (%): membership_number % already imported', 'Yuko Kawatani', 'NT_PCM_0081_1207';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851081207'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Yuko Kawatani', '9851081207', NULL,
            'Imported from historical Excel (row 102).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0081_1207', 'DOB: 2025-01-12 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-08-24'::date,
         expiry_date = '2025-08-24'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 102: % -> membership %', 'Yuko Kawatani', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 102 (%): %', 'Yuko Kawatani', SQLERRM;
END $$;

-- ---- Row 104: Srijan Shrestha (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 104 (%): organization nuad-thai-spa not found', 'Srijan Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 104 (%): branch % not found', 'Srijan Shrestha', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 104 (%): tier % not found', 'Srijan Shrestha', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0035_5333') THEN
    RAISE NOTICE 'SKIP row 104 (%): membership_number % already imported', 'Srijan Shrestha', 'NT_DCM_0035_5333';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802035333'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Srijan Shrestha', '9802035333', NULL,
            'Imported from historical Excel (row 104).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0035_5333', 'DOB: 2025-02-07 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-08-29'::date,
         expiry_date = '2025-08-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 104: % -> membership %', 'Srijan Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 104 (%): %', 'Srijan Shrestha', SQLERRM;
END $$;

-- ---- Row 105: Sudip Upriti (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 105 (%): organization nuad-thai-spa not found', 'Sudip Upriti';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 105 (%): branch % not found', 'Sudip Upriti', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 105 (%): tier % not found', 'Sudip Upriti', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0082_7660') THEN
    RAISE NOTICE 'SKIP row 105 (%): membership_number % already imported', 'Sudip Upriti', 'NT_PCM_0082_7660';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9861177660'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sudip Upriti', '9861177660', NULL,
            'Imported from historical Excel (row 105).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0082_7660', 'DOB: 2025-03-18 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-08-30'::date,
         expiry_date = '2025-08-30'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 105: % -> membership %', 'Sudip Upriti', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 105 (%): %', 'Sudip Upriti', SQLERRM;
END $$;

-- ---- Row 106: Nem Bin Shakya (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 106 (%): organization nuad-thai-spa not found', 'Nem Bin Shakya';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 106 (%): branch % not found', 'Nem Bin Shakya', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 106 (%): tier % not found', 'Nem Bin Shakya', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0036_3272') THEN
    RAISE NOTICE 'SKIP row 106 (%): membership_number % already imported', 'Nem Bin Shakya', 'NT_DCM_0036_3272';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851023272'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Nem Bin Shakya', '9851023272', NULL,
            'Imported from historical Excel (row 106).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0036_3272', 'DOB: 2025-07-01 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-09-02'::date,
         expiry_date = '2025-09-02'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 106: % -> membership %', 'Nem Bin Shakya', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 106 (%): %', 'Nem Bin Shakya', SQLERRM;
END $$;

-- ---- Row 107: lalit agrawal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 107 (%): organization nuad-thai-spa not found', 'lalit agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 107 (%): branch % not found', 'lalit agrawal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 107 (%): tier % not found', 'lalit agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0083_7817') THEN
    RAISE NOTICE 'SKIP row 107 (%): membership_number % already imported', 'lalit agrawal', 'NT_PCM_0083_7817';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9852027817'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'lalit agrawal', '9852027817', NULL,
            'Imported from historical Excel (row 107).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0083_7817', 'DOB: 1981-01-02 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-09-05'::date,
         expiry_date = '2025-09-05'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 107: % -> membership %', 'lalit agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 107 (%): %', 'lalit agrawal', SQLERRM;
END $$;

-- ---- Row 108: Dipak Bista (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 108 (%): organization nuad-thai-spa not found', 'Dipak Bista';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 108 (%): branch % not found', 'Dipak Bista', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 108 (%): tier % not found', 'Dipak Bista', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0084_0935') THEN
    RAISE NOTICE 'SKIP row 108 (%): membership_number % already imported', 'Dipak Bista', 'NT_PCM_0084_0935';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851190973'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Dipak Bista', '9851190973', NULL,
            'Imported from historical Excel (row 108).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0084_0935', 'DOB: 2025-08-01 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-09-14'::date,
         expiry_date = '2025-09-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 108: % -> membership %', 'Dipak Bista', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 108 (%): %', 'Dipak Bista', SQLERRM;
END $$;

-- ---- Row 109: Prakriti Kc (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 109 (%): organization nuad-thai-spa not found', 'Prakriti Kc';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 109 (%): branch % not found', 'Prakriti Kc', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 109 (%): tier % not found', 'Prakriti Kc', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0085_1052') THEN
    RAISE NOTICE 'SKIP row 109 (%): membership_number % already imported', 'Prakriti Kc', 'NT_PCM_0085_1052';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851061052'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Prakriti Kc', '9851061052', NULL,
            'Imported from historical Excel (row 109).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0085_1052', 'DOB: 2025-06-04 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-09-17'::date,
         expiry_date = '2025-09-17'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 109: % -> membership %', 'Prakriti Kc', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 109 (%): %', 'Prakriti Kc', SQLERRM;
END $$;

-- ---- Row 110: Deepti Singh (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 110 (%): organization nuad-thai-spa not found', 'Deepti Singh';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 110 (%): branch % not found', 'Deepti Singh', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 110 (%): tier % not found', 'Deepti Singh', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0086_2882') THEN
    RAISE NOTICE 'SKIP row 110 (%): membership_number % already imported', 'Deepti Singh', 'NT_PCM_0086_2882';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851112882'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Deepti Singh', '9851112882', NULL,
            'Imported from historical Excel (row 110).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0086_2882', 'DOB: 11th nov')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 110: % -> membership %', 'Deepti Singh', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 110 (%): %', 'Deepti Singh', SQLERRM;
END $$;

-- ---- Row 111: LIU XU JUN (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 111 (%): organization nuad-thai-spa not found', 'LIU XU JUN';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 111 (%): branch % not found', 'LIU XU JUN', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 111 (%): tier % not found', 'LIU XU JUN', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0087_3729') THEN
    RAISE NOTICE 'SKIP row 111 (%): membership_number % already imported', 'LIU XU JUN', 'NT_PCM_0087_3729';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9810323729'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'LIU XU JUN', '9810323729', NULL,
            'Imported from historical Excel (row 111).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0087_3729', 'DOB: 2025-07-13 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 111: % -> membership %', 'LIU XU JUN', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 111 (%): %', 'LIU XU JUN', SQLERRM;
END $$;

-- ---- Row 112: aadrit bahadur shahh (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 112 (%): organization nuad-thai-spa not found', 'aadrit bahadur shahh';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 112 (%): branch % not found', 'aadrit bahadur shahh', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 112 (%): tier % not found', 'aadrit bahadur shahh', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0037_7110') THEN
    RAISE NOTICE 'SKIP row 112 (%): membership_number % already imported', 'aadrit bahadur shahh', 'NT_DCM_0037_7110';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9823287110'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'aadrit bahadur shahh', '9823287110', NULL,
            'Imported from historical Excel (row 112).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0037_7110', 'DOB: 2005-05-16 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 112: % -> membership %', 'aadrit bahadur shahh', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 112 (%): %', 'aadrit bahadur shahh', SQLERRM;
END $$;

-- ---- Row 113: Riken Maharjan (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 113 (%): organization nuad-thai-spa not found', 'Riken Maharjan';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 113 (%): branch % not found', 'Riken Maharjan', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 113 (%): tier % not found', 'Riken Maharjan', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0088_8000') THEN
    RAISE NOTICE 'SKIP row 113 (%): membership_number % already imported', 'Riken Maharjan', 'NT_PCM_0088_8000';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851138000'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Riken Maharjan', '9851138000', NULL,
            'Imported from historical Excel (row 113).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0088_8000', 'DOB: 2025-11-28 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-10-14'::date,
         expiry_date = '2025-10-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 113: % -> membership %', 'Riken Maharjan', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 113 (%): %', 'Riken Maharjan', SQLERRM;
END $$;

-- ---- Row 114: Vineet Sarda (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 114 (%): organization nuad-thai-spa not found', 'Vineet Sarda';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 114 (%): branch % not found', 'Vineet Sarda', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 114 (%): tier % not found', 'Vineet Sarda', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0089_4639') THEN
    RAISE NOTICE 'SKIP row 114 (%): membership_number % already imported', 'Vineet Sarda', 'NT_PCM_0089_4639';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801034629'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Vineet Sarda', '9801034629', NULL,
            'Imported from historical Excel (row 114).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0089_4639', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 114: % -> membership %', 'Vineet Sarda', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 114 (%): %', 'Vineet Sarda', SQLERRM;
END $$;

-- ---- Row 115: Sangya Bhattarai (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 115 (%): organization nuad-thai-spa not found', 'Sangya Bhattarai';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 115 (%): branch % not found', 'Sangya Bhattarai', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 115 (%): tier % not found', 'Sangya Bhattarai', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0090_4573') THEN
    RAISE NOTICE 'SKIP row 115 (%): membership_number % already imported', 'Sangya Bhattarai', 'NT_PCM_0090_4573';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801044573'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sangya Bhattarai', '9801044573', NULL,
            'Imported from historical Excel (row 115).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0090_4573', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-10-24'::date,
         expiry_date = '2025-10-24'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 115: % -> membership %', 'Sangya Bhattarai', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 115 (%): %', 'Sangya Bhattarai', SQLERRM;
END $$;

-- ---- Row 116: Surendra Silwal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 116 (%): organization nuad-thai-spa not found', 'Surendra Silwal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 116 (%): branch % not found', 'Surendra Silwal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 116 (%): tier % not found', 'Surendra Silwal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0091_1277') THEN
    RAISE NOTICE 'SKIP row 116 (%): membership_number % already imported', 'Surendra Silwal', 'NT_PCM_0091_1277';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Surendra Silwal', NULL, NULL,
          'Imported from historical Excel (row 116). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0091_1277', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-10-29'::date,
         expiry_date = '2025-10-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 116: % -> membership %', 'Surendra Silwal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 116 (%): %', 'Surendra Silwal', SQLERRM;
END $$;

-- ---- Row 117: Bonetta Ramsey (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 117 (%): organization nuad-thai-spa not found', 'Bonetta Ramsey';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 117 (%): branch % not found', 'Bonetta Ramsey', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 117 (%): tier % not found', 'Bonetta Ramsey', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0092_1600') THEN
    RAISE NOTICE 'SKIP row 117 (%): membership_number % already imported', 'Bonetta Ramsey', 'NT_PCM_0092_1600';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801101600'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bonetta Ramsey', '9801101600', NULL,
            'Imported from historical Excel (row 117).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0092_1600', 'DOB: 2025-01-26 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-10-30'::date,
         expiry_date = '2025-10-30'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 117: % -> membership %', 'Bonetta Ramsey', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 117 (%): %', 'Bonetta Ramsey', SQLERRM;
END $$;

-- ---- Row 118: Rina Singh (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 118 (%): organization nuad-thai-spa not found', 'Rina Singh';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 118 (%): branch % not found', 'Rina Singh', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 118 (%): tier % not found', 'Rina Singh', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0093_2700') THEN
    RAISE NOTICE 'SKIP row 118 (%): membership_number % already imported', 'Rina Singh', 'NT_PCM_0093_2700';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851122700'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rina Singh', '9851122700', NULL,
            'Imported from historical Excel (row 118).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0093_2700', 'DOB: 2025-03-07 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-11-02'::date,
         expiry_date = '2025-11-02'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 118: % -> membership %', 'Rina Singh', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 118 (%): %', 'Rina Singh', SQLERRM;
END $$;

-- ---- Row 119: Liao Xiaoping (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 119 (%): organization nuad-thai-spa not found', 'Liao Xiaoping';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 119 (%): branch % not found', 'Liao Xiaoping', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 119 (%): tier % not found', 'Liao Xiaoping', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0094_0888') THEN
    RAISE NOTICE 'SKIP row 119 (%): membership_number % already imported', 'Liao Xiaoping', 'NT_PCM_0094_0888';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802020888'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Liao Xiaoping', '9802020888', NULL,
            'Imported from historical Excel (row 119).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0094_0888', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-11-08'::date,
         expiry_date = '2025-11-08'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 119: % -> membership %', 'Liao Xiaoping', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 119 (%): %', 'Liao Xiaoping', SQLERRM;
END $$;

-- ---- Row 120: Satish Shrestha (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 120 (%): organization nuad-thai-spa not found', 'Satish Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 120 (%): branch % not found', 'Satish Shrestha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 120 (%): tier % not found', 'Satish Shrestha', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0038_') THEN
    RAISE NOTICE 'SKIP row 120 (%): membership_number % already imported', 'Satish Shrestha', 'NT_DCM_0038_';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Satish Shrestha', NULL, NULL,
          'Imported from historical Excel (row 120). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0038_', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 120: % -> membership %', 'Satish Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 120 (%): %', 'Satish Shrestha', SQLERRM;
END $$;

-- ---- Row 121: Sadiksha Koirala (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 121 (%): organization nuad-thai-spa not found', 'Sadiksha Koirala';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 121 (%): branch % not found', 'Sadiksha Koirala', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 121 (%): tier % not found', 'Sadiksha Koirala', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0095_9051') THEN
    RAISE NOTICE 'SKIP row 121 (%): membership_number % already imported', 'Sadiksha Koirala', 'NT_PCM_0095_9051';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9861039051'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sadiksha Koirala', '9861039051', NULL,
            'Imported from historical Excel (row 121).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0095_9051', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 121: % -> membership %', 'Sadiksha Koirala', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 121 (%): %', 'Sadiksha Koirala', SQLERRM;
END $$;

-- ---- Row 122: Lenni cheuig (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 122 (%): organization nuad-thai-spa not found', 'Lenni cheuig';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 122 (%): branch % not found', 'Lenni cheuig', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 122 (%): tier % not found', 'Lenni cheuig', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0039_0111') THEN
    RAISE NOTICE 'SKIP row 122 (%): membership_number % already imported', 'Lenni cheuig', 'NT_DCM_0039_0111';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9743900111'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Lenni cheuig', '9743900111', NULL,
            'Imported from historical Excel (row 122).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0039_0111', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 122: % -> membership %', 'Lenni cheuig', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 122 (%): %', 'Lenni cheuig', SQLERRM;
END $$;

-- ---- Row 123: Laura Jalasjoki (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 123 (%): organization nuad-thai-spa not found', 'Laura Jalasjoki';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 123 (%): branch % not found', 'Laura Jalasjoki', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 123 (%): tier % not found', 'Laura Jalasjoki', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0096_9779') THEN
    RAISE NOTICE 'SKIP row 123 (%): membership_number % already imported', 'Laura Jalasjoki', 'NT_PCM_0096_9779';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9824799779'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Laura Jalasjoki', '9824799779', NULL,
            'Imported from historical Excel (row 123).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0096_9779', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-11-22'::date,
         expiry_date = '2025-11-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 123: % -> membership %', 'Laura Jalasjoki', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 123 (%): %', 'Laura Jalasjoki', SQLERRM;
END $$;

-- ---- Row 124: Prapti KC (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 124 (%): organization nuad-thai-spa not found', 'Prapti KC';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 124 (%): branch % not found', 'Prapti KC', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 124 (%): tier % not found', 'Prapti KC', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0097_4057') THEN
    RAISE NOTICE 'SKIP row 124 (%): membership_number % already imported', 'Prapti KC', 'NT_PCM_0097_4057';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851224057'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Prapti KC', '9851224057', NULL,
            'Imported from historical Excel (row 124).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0097_4057', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 124: % -> membership %', 'Prapti KC', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 124 (%): %', 'Prapti KC', SQLERRM;
END $$;

-- ---- Row 125: Sonakshi Rathi (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 125 (%): organization nuad-thai-spa not found', 'Sonakshi Rathi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 125 (%): branch % not found', 'Sonakshi Rathi', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 125 (%): tier % not found', 'Sonakshi Rathi', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0098_1044') THEN
    RAISE NOTICE 'SKIP row 125 (%): membership_number % already imported', 'Sonakshi Rathi', 'NT_PCM_0098_1044';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9805671044'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sonakshi Rathi', '9805671044', NULL,
            'Imported from historical Excel (row 125).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0098_1044', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 125: % -> membership %', 'Sonakshi Rathi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 125 (%): %', 'Sonakshi Rathi', SQLERRM;
END $$;

-- ---- Row 126: Sarmila thapa (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 126 (%): organization nuad-thai-spa not found', 'Sarmila thapa';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 126 (%): branch % not found', 'Sarmila thapa', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 126 (%): tier % not found', 'Sarmila thapa', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0099_8059') THEN
    RAISE NOTICE 'SKIP row 126 (%): membership_number % already imported', 'Sarmila thapa', 'NT_PCM_0099_8059';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851148059'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sarmila thapa', '9851148059', NULL,
            'Imported from historical Excel (row 126).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0099_8059', 'DOB: 8th july')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 126: % -> membership %', 'Sarmila thapa', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 126 (%): %', 'Sarmila thapa', SQLERRM;
END $$;

-- ---- Row 127: Sweta Dahal (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 127 (%): organization nuad-thai-spa not found', 'Sweta Dahal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 127 (%): branch % not found', 'Sweta Dahal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 127 (%): tier % not found', 'Sweta Dahal', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0040_6847') THEN
    RAISE NOTICE 'SKIP row 127 (%): membership_number % already imported', 'Sweta Dahal', 'NT_DCM_0040_6847';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851046847'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sweta Dahal', '9851046847', NULL,
            'Imported from historical Excel (row 127).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0040_6847', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-11-28'::date,
         expiry_date = '2025-11-28'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 127: % -> membership %', 'Sweta Dahal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 127 (%): %', 'Sweta Dahal', SQLERRM;
END $$;

-- ---- Row 128: Abhisek Sarawgi (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 128 (%): organization nuad-thai-spa not found', 'Abhisek Sarawgi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 128 (%): branch % not found', 'Abhisek Sarawgi', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 128 (%): tier % not found', 'Abhisek Sarawgi', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0100_1840') THEN
    RAISE NOTICE 'SKIP row 128 (%): membership_number % already imported', 'Abhisek Sarawgi', 'NT_PCM_0100_1840';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841221840'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Abhisek Sarawgi', '9841221840', NULL,
            'Imported from historical Excel (row 128).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0100_1840', 'DOB: 29th sept')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 128: % -> membership %', 'Abhisek Sarawgi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 128 (%): %', 'Abhisek Sarawgi', SQLERRM;
END $$;

-- ---- Row 129: Beena Agarwal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 129 (%): organization nuad-thai-spa not found', 'Beena Agarwal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 129 (%): branch % not found', 'Beena Agarwal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 129 (%): tier % not found', 'Beena Agarwal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0101_4322') THEN
    RAISE NOTICE 'SKIP row 129 (%): membership_number % already imported', 'Beena Agarwal', 'NT_PCM_0101_4322';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851014322'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Beena Agarwal', '9851014322', NULL,
            'Imported from historical Excel (row 129).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0101_4322', 'DOB: 2025-06-04 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-11-29'::date,
         expiry_date = '2025-11-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 129: % -> membership %', 'Beena Agarwal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 129 (%): %', 'Beena Agarwal', SQLERRM;
END $$;

-- ---- Row 130: Mibilea Shakya (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 130 (%): organization nuad-thai-spa not found', 'Mibilea Shakya';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 130 (%): branch % not found', 'Mibilea Shakya', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 130 (%): tier % not found', 'Mibilea Shakya', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0041_4820') THEN
    RAISE NOTICE 'SKIP row 130 (%): membership_number % already imported', 'Mibilea Shakya', 'NT_DCM_0041_4820';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851044820'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Mibilea Shakya', '9851044820', NULL,
            'Imported from historical Excel (row 130).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0041_4820', 'DOB: 2025-09-14 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-06'::date,
         expiry_date = '2025-12-06'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 130: % -> membership %', 'Mibilea Shakya', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 130 (%): %', 'Mibilea Shakya', SQLERRM;
END $$;

-- ---- Row 131: Bishnu Regmi (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 131 (%): organization nuad-thai-spa not found', 'Bishnu Regmi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 131 (%): branch % not found', 'Bishnu Regmi', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 131 (%): tier % not found', 'Bishnu Regmi', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0102_1496') THEN
    RAISE NOTICE 'SKIP row 131 (%): membership_number % already imported', 'Bishnu Regmi', 'NT_PCM_0102_1496';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851401496'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bishnu Regmi', '9851401496', NULL,
            'Imported from historical Excel (row 131).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0102_1496', 'DOB: 2025-07-07 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-11'::date,
         expiry_date = '2025-12-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 131: % -> membership %', 'Bishnu Regmi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 131 (%): %', 'Bishnu Regmi', SQLERRM;
END $$;

-- ---- Row 132: Nikita Saraf (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 132 (%): organization nuad-thai-spa not found', 'Nikita Saraf';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 132 (%): branch % not found', 'Nikita Saraf', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 132 (%): tier % not found', 'Nikita Saraf', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0103_3718') THEN
    RAISE NOTICE 'SKIP row 132 (%): membership_number % already imported', 'Nikita Saraf', 'NT_PCM_0103_3718';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802013718'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Nikita Saraf', '9802013718', NULL,
            'Imported from historical Excel (row 132).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0103_3718', 'DOB: 2025-11-28 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  RAISE NOTICE 'Imported row 132: % -> membership %', 'Nikita Saraf', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 132 (%): %', 'Nikita Saraf', SQLERRM;
END $$;

-- ---- Row 133: Hikari Sapkota (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 133 (%): organization nuad-thai-spa not found', 'Hikari Sapkota';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 133 (%): branch % not found', 'Hikari Sapkota', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 133 (%): tier % not found', 'Hikari Sapkota', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0104_2110') THEN
    RAISE NOTICE 'SKIP row 133 (%): membership_number % already imported', 'Hikari Sapkota', 'NT_PCM_0104_2110';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Hikari Sapkota', NULL, NULL,
          'Imported from historical Excel (row 133). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0104_2110', 'DOB: 2025-12-20 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 133: % -> membership %', 'Hikari Sapkota', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 133 (%): %', 'Hikari Sapkota', SQLERRM;
END $$;

-- ---- Row 134: Shivalika Rana (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 134 (%): organization nuad-thai-spa not found', 'Shivalika Rana';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 134 (%): branch % not found', 'Shivalika Rana', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 134 (%): tier % not found', 'Shivalika Rana', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0105_0265') THEN
    RAISE NOTICE 'SKIP row 134 (%): membership_number % already imported', 'Shivalika Rana', 'NT_PCM_0105_0265';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '98010650265'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Shivalika Rana', '98010650265', NULL,
            'Imported from historical Excel (row 134).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0105_0265', 'DOB: 2025-11-10 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-24'::date,
         expiry_date = '2025-12-24'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 134: % -> membership %', 'Shivalika Rana', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 134 (%): %', 'Shivalika Rana', SQLERRM;
END $$;

-- ---- Row 135: Sneha Prasai (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 135 (%): organization nuad-thai-spa not found', 'Sneha Prasai';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 135 (%): branch % not found', 'Sneha Prasai', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 135 (%): tier % not found', 'Sneha Prasai', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0106_8259') THEN
    RAISE NOTICE 'SKIP row 135 (%): membership_number % already imported', 'Sneha Prasai', 'NT_PCM_0106_8259';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9849168259'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sneha Prasai', '9849168259', NULL,
            'Imported from historical Excel (row 135).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0106_8259', 'DOB: 2025-06-29 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-18'::date,
         expiry_date = '2025-12-18'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 135: % -> membership %', 'Sneha Prasai', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 135 (%): %', 'Sneha Prasai', SQLERRM;
END $$;

-- ---- Row 136: Rupa Thapa (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 136 (%): organization nuad-thai-spa not found', 'Rupa Thapa';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 136 (%): branch % not found', 'Rupa Thapa', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 136 (%): tier % not found', 'Rupa Thapa', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0107_4920') THEN
    RAISE NOTICE 'SKIP row 136 (%): membership_number % already imported', 'Rupa Thapa', 'NT_PCM_0107_4920';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841234920'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rupa Thapa', '9841234920', NULL,
            'Imported from historical Excel (row 136).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0107_4920', 'DOB: 2025-05-14 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2025-12-25'::date,
         expiry_date = '2025-12-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 136: % -> membership %', 'Rupa Thapa', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 136 (%): %', 'Rupa Thapa', SQLERRM;
END $$;

-- ---- Row 137: Rajil Bajacharya (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 137 (%): organization nuad-thai-spa not found', 'Rajil Bajacharya';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 137 (%): branch % not found', 'Rajil Bajacharya', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 137 (%): tier % not found', 'Rajil Bajacharya', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0108_5217') THEN
    RAISE NOTICE 'SKIP row 137 (%): membership_number % already imported', 'Rajil Bajacharya', 'NT_PCM_0108_5217';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9860165217'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rajil Bajacharya', '9860165217', NULL,
            'Imported from historical Excel (row 137).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0108_5217', 'DOB: 2026-11-19 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-12-26'::date,
         expiry_date = '2026-12-26'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 137: % -> membership %', 'Rajil Bajacharya', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 137 (%): %', 'Rajil Bajacharya', SQLERRM;
END $$;

-- ---- Row 138: Heemani Mukhia (Deluxe Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 138 (%): organization nuad-thai-spa not found', 'Heemani Mukhia';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 138 (%): branch % not found', 'Heemani Mukhia', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 138 (%): tier % not found', 'Heemani Mukhia', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0042_3936') THEN
    RAISE NOTICE 'SKIP row 138 (%): membership_number % already imported', 'Heemani Mukhia', 'NT_DCM_0042_3936';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9813763936'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Heemani Mukhia', '9813763936', NULL,
            'Imported from historical Excel (row 138).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0042_3936', 'DOB: 2026-09-15 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-12-28'::date,
         expiry_date = '2026-12-28'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 138: % -> membership %', 'Heemani Mukhia', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 138 (%): %', 'Heemani Mukhia', SQLERRM;
END $$;

-- ---- Row 139: Mahesh Mahato (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 139 (%): organization nuad-thai-spa not found', 'Mahesh Mahato';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 139 (%): branch % not found', 'Mahesh Mahato', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 139 (%): tier % not found', 'Mahesh Mahato', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0043_5297') THEN
    RAISE NOTICE 'SKIP row 139 (%): membership_number % already imported', 'Mahesh Mahato', 'NT_DCM_0043_5297';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851035297'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Mahesh Mahato', '9851035297', NULL,
            'Imported from historical Excel (row 139).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0043_5297', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-06'::date,
         expiry_date = '2026-01-06'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 139: % -> membership %', 'Mahesh Mahato', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 139 (%): %', 'Mahesh Mahato', SQLERRM;
END $$;

-- ---- Row 140: Farah (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 140 (%): organization nuad-thai-spa not found', 'Farah';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 140 (%): branch % not found', 'Farah', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 140 (%): tier % not found', 'Farah', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0109_9786') THEN
    RAISE NOTICE 'SKIP row 140 (%): membership_number % already imported', 'Farah', 'NT_PCM_0109_9786';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801069786'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Farah', '9801069786', NULL,
            'Imported from historical Excel (row 140).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0109_9786', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-09'::date,
         expiry_date = '2026-01-09'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 140: % -> membership %', 'Farah', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 140 (%): %', 'Farah', SQLERRM;
END $$;

-- ---- Row 142: Manish khetan (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 142 (%): organization nuad-thai-spa not found', 'Manish khetan';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 142 (%): branch % not found', 'Manish khetan', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 142 (%): tier % not found', 'Manish khetan', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0111_9850') THEN
    RAISE NOTICE 'SKIP row 142 (%): membership_number % already imported', 'Manish khetan', 'NT_PCM_0111_9850';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801089850'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Manish khetan', '9801089850', NULL,
            'Imported from historical Excel (row 142).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0111_9850', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 142: % -> membership %', 'Manish khetan', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 142 (%): %', 'Manish khetan', SQLERRM;
END $$;

-- ---- Row 144: sakshi lila (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 144 (%): organization nuad-thai-spa not found', 'sakshi lila';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 144 (%): branch % not found', 'sakshi lila', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 144 (%): tier % not found', 'sakshi lila', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0112_9241') THEN
    RAISE NOTICE 'SKIP row 144 (%): membership_number % already imported', 'sakshi lila', 'NT_PCM_0112_9241';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9818449241'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'sakshi lila', '9818449241', NULL,
            'Imported from historical Excel (row 144).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0112_9241', 'DOB: 2026-08-27 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-17'::date,
         expiry_date = '2026-01-17'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 144: % -> membership %', 'sakshi lila', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 144 (%): %', 'sakshi lila', SQLERRM;
END $$;

-- ---- Row 146: shazia ibrahim (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 146 (%): organization nuad-thai-spa not found', 'shazia ibrahim';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 146 (%): branch % not found', 'shazia ibrahim', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 146 (%): tier % not found', 'shazia ibrahim', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0114_1371') THEN
    RAISE NOTICE 'SKIP row 146 (%): membership_number % already imported', 'shazia ibrahim', 'NT_PCM_0114_1371';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9823261371'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'shazia ibrahim', '9823261371', NULL,
            'Imported from historical Excel (row 146).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0114_1371', 'DOB: 2026-05-04 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-21'::date,
         expiry_date = '2026-01-21'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 146: % -> membership %', 'shazia ibrahim', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 146 (%): %', 'shazia ibrahim', SQLERRM;
END $$;

-- ---- Row 147: Ameer Bidari (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 147 (%): organization nuad-thai-spa not found', 'Ameer Bidari';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 147 (%): branch % not found', 'Ameer Bidari', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 147 (%): tier % not found', 'Ameer Bidari', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0115_9593') THEN
    RAISE NOTICE 'SKIP row 147 (%): membership_number % already imported', 'Ameer Bidari', 'NT_PCM_0115_9593';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851109593'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Ameer Bidari', '9851109593', NULL,
            'Imported from historical Excel (row 147).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0115_9593', 'DOB: 2026-04-04 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-23'::date,
         expiry_date = '2026-01-23'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 147: % -> membership %', 'Ameer Bidari', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 147 (%): %', 'Ameer Bidari', SQLERRM;
END $$;

-- ---- Row 148: Hari batta (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 148 (%): organization nuad-thai-spa not found', 'Hari batta';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 148 (%): branch % not found', 'Hari batta', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 148 (%): tier % not found', 'Hari batta', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0116_1537') THEN
    RAISE NOTICE 'SKIP row 148 (%): membership_number % already imported', 'Hari batta', 'NT_PCM_0116_1537';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851051537'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Hari batta', '9851051537', NULL,
            'Imported from historical Excel (row 148).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0116_1537', 'DOB: 2026-02-22 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-29'::date,
         expiry_date = '2026-01-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 148: % -> membership %', 'Hari batta', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 148 (%): %', 'Hari batta', SQLERRM;
END $$;

-- ---- Row 149: Rubee Palikhe (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 149 (%): organization nuad-thai-spa not found', 'Rubee Palikhe';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 149 (%): branch % not found', 'Rubee Palikhe', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 149 (%): tier % not found', 'Rubee Palikhe', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0117_3820') THEN
    RAISE NOTICE 'SKIP row 149 (%): membership_number % already imported', 'Rubee Palikhe', 'NT_PCM_0117_3820';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851153820'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Rubee Palikhe', '9851153820', NULL,
            'Imported from historical Excel (row 149).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0117_3820', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-27'::date,
         expiry_date = '2026-01-27'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 149: % -> membership %', 'Rubee Palikhe', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 149 (%): %', 'Rubee Palikhe', SQLERRM;
END $$;

-- ---- Row 150: vishal and sonal agrawal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 150 (%): organization nuad-thai-spa not found', 'vishal and sonal agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 150 (%): branch % not found', 'vishal and sonal agrawal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 150 (%): tier % not found', 'vishal and sonal agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0118_9938') THEN
    RAISE NOTICE 'SKIP row 150 (%): membership_number % already imported', 'vishal and sonal agrawal', 'NT_PCM_0118_9938';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841019938'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'vishal and sonal agrawal', '9841019938', NULL,
            'Imported from historical Excel (row 150).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0118_9938', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-29'::date,
         expiry_date = '2026-01-29'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 150: % -> membership %', 'vishal and sonal agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 150 (%): %', 'vishal and sonal agrawal', SQLERRM;
END $$;

-- ---- Row 151: Ajay Konale (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 151 (%): organization nuad-thai-spa not found', 'Ajay Konale';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 151 (%): branch % not found', 'Ajay Konale', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 151 (%): tier % not found', 'Ajay Konale', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0044_3000') THEN
    RAISE NOTICE 'SKIP row 151 (%): membership_number % already imported', 'Ajay Konale', 'NT_DCM_0044_3000';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9707083000'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Ajay Konale', '9707083000', NULL,
            'Imported from historical Excel (row 151).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0044_3000', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-31'::date,
         expiry_date = '2026-01-31'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 151: % -> membership %', 'Ajay Konale', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 151 (%): %', 'Ajay Konale', SQLERRM;
END $$;

-- ---- Row 152: Dije Shrestha (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 152 (%): organization nuad-thai-spa not found', 'Dije Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 152 (%): branch % not found', 'Dije Shrestha', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 152 (%): tier % not found', 'Dije Shrestha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0119_8480') THEN
    RAISE NOTICE 'SKIP row 152 (%): membership_number % already imported', 'Dije Shrestha', 'NT_PCM_0119_8480';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851038480'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Dije Shrestha', '9851038480', NULL,
            'Imported from historical Excel (row 152).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0119_8480', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-01-31'::date,
         expiry_date = '2026-01-31'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 152: % -> membership %', 'Dije Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 152 (%): %', 'Dije Shrestha', SQLERRM;
END $$;

-- ---- Row 153: Bishnu Sharma (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 153 (%): organization nuad-thai-spa not found', 'Bishnu Sharma';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 153 (%): branch % not found', 'Bishnu Sharma', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 153 (%): tier % not found', 'Bishnu Sharma', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0120_5235') THEN
    RAISE NOTICE 'SKIP row 153 (%): membership_number % already imported', 'Bishnu Sharma', 'NT_PCM_0120_5235';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851345235'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bishnu Sharma', '9851345235', NULL,
            'Imported from historical Excel (row 153).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0120_5235', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-02-03'::date,
         expiry_date = '2026-02-03'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 153: % -> membership %', 'Bishnu Sharma', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 153 (%): %', 'Bishnu Sharma', SQLERRM;
END $$;

-- ---- Row 154: Subani Moktan Tamang (Deluxe Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 154 (%): organization nuad-thai-spa not found', 'Subani Moktan Tamang';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 154 (%): branch % not found', 'Subani Moktan Tamang', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 154 (%): tier % not found', 'Subani Moktan Tamang', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0045_9783') THEN
    RAISE NOTICE 'SKIP row 154 (%): membership_number % already imported', 'Subani Moktan Tamang', 'NT_DCM_0045_9783';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9803739783'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Subani Moktan Tamang', '9803739783', NULL,
            'Imported from historical Excel (row 154).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0045_9783', 'DOB: 2026-12-31 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-02-22'::date,
         expiry_date = '2026-02-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 154: % -> membership %', 'Subani Moktan Tamang', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 154 (%): %', 'Subani Moktan Tamang', SQLERRM;
END $$;

-- ---- Row 155: Manish Mundhra (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 155 (%): organization nuad-thai-spa not found', 'Manish Mundhra';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 155 (%): branch % not found', 'Manish Mundhra', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 155 (%): tier % not found', 'Manish Mundhra', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0121_1342') THEN
    RAISE NOTICE 'SKIP row 155 (%): membership_number % already imported', 'Manish Mundhra', 'NT_PCM_0121_1342';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801051342'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Manish Mundhra', '9801051342', NULL,
            'Imported from historical Excel (row 155).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0121_1342', 'DOB: 21/04/1973')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-02-25'::date,
         expiry_date = '2026-02-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 155: % -> membership %', 'Manish Mundhra', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 155 (%): %', 'Manish Mundhra', SQLERRM;
END $$;

-- ---- Row 156: Sangeeta Jain (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 156 (%): organization nuad-thai-spa not found', 'Sangeeta Jain';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 156 (%): branch % not found', 'Sangeeta Jain', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 156 (%): tier % not found', 'Sangeeta Jain', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0122_4033') THEN
    RAISE NOTICE 'SKIP row 156 (%): membership_number % already imported', 'Sangeeta Jain', 'NT_PCM_0122_4033';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802024033'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sangeeta Jain', '9802024033', NULL,
            'Imported from historical Excel (row 156).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0122_4033', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-02-26'::date,
         expiry_date = '2026-02-26'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 156: % -> membership %', 'Sangeeta Jain', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 156 (%): %', 'Sangeeta Jain', SQLERRM;
END $$;

-- ---- Row 159: Pratik Man Singh (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 159 (%): organization nuad-thai-spa not found', 'Pratik Man Singh';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 159 (%): branch % not found', 'Pratik Man Singh', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 159 (%): tier % not found', 'Pratik Man Singh', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0123_4310') THEN
    RAISE NOTICE 'SKIP row 159 (%): membership_number % already imported', 'Pratik Man Singh', 'NT_PCM_0123_4310';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851124310'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Pratik Man Singh', '9851124310', NULL,
            'Imported from historical Excel (row 159).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0123_4310', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-02-27'::date,
         expiry_date = '2026-02-27'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 159: % -> membership %', 'Pratik Man Singh', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 159 (%): %', 'Pratik Man Singh', SQLERRM;
END $$;

-- ---- Row 160: Sunnie Joshi (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 160 (%): organization nuad-thai-spa not found', 'Sunnie Joshi';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 160 (%): branch % not found', 'Sunnie Joshi', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 160 (%): tier % not found', 'Sunnie Joshi', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0046_8229') THEN
    RAISE NOTICE 'SKIP row 160 (%): membership_number % already imported', 'Sunnie Joshi', 'NT_DCM_0046_8229';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851258229'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sunnie Joshi', '9851258229', NULL,
            'Imported from historical Excel (row 160).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0046_8229', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-03-01'::date,
         expiry_date = '2026-03-01'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 160: % -> membership %', 'Sunnie Joshi', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 160 (%): %', 'Sunnie Joshi', SQLERRM;
END $$;

-- ---- Row 161: Suyog Adhikari (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 161 (%): organization nuad-thai-spa not found', 'Suyog Adhikari';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 161 (%): branch % not found', 'Suyog Adhikari', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 161 (%): tier % not found', 'Suyog Adhikari', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0124_1772') THEN
    RAISE NOTICE 'SKIP row 161 (%): membership_number % already imported', 'Suyog Adhikari', 'NT_PCM_0124_1772';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851091772'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Suyog Adhikari', '9851091772', NULL,
            'Imported from historical Excel (row 161).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0124_1772', 'DOB: 2026-12-26 00:00:00')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-03-08'::date,
         expiry_date = '2026-03-08'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 161: % -> membership %', 'Suyog Adhikari', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 161 (%): %', 'Suyog Adhikari', SQLERRM;
END $$;

-- ---- Row 163: Sarswati Rai (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 163 (%): organization nuad-thai-spa not found', 'Sarswati Rai';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 163 (%): branch % not found', 'Sarswati Rai', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 163 (%): tier % not found', 'Sarswati Rai', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0047_9437') THEN
    RAISE NOTICE 'SKIP row 163 (%): membership_number % already imported', 'Sarswati Rai', 'NT_DCM_0047_9437';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9808119437'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sarswati Rai', '9808119437', NULL,
            'Imported from historical Excel (row 163).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0047_9437', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-03-14'::date,
         expiry_date = '2026-03-14'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 163: % -> membership %', 'Sarswati Rai', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 163 (%): %', 'Sarswati Rai', SQLERRM;
END $$;

-- ---- Row 164: Mahesh Khadga (Premium Club, Thamel) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 164 (%): organization nuad-thai-spa not found', 'Mahesh Khadga';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Thamel';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 164 (%): branch % not found', 'Mahesh Khadga', 'Thamel';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 164 (%): tier % not found', 'Mahesh Khadga', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0125_3278') THEN
    RAISE NOTICE 'SKIP row 164 (%): membership_number % already imported', 'Mahesh Khadga', 'NT_PCM_0125_3278';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '970543278'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Mahesh Khadga', '970543278', NULL,
            'Imported from historical Excel (row 164).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0125_3278', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-03-17'::date,
         expiry_date = '2026-03-17'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 164: % -> membership %', 'Mahesh Khadga', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 164 (%): %', 'Mahesh Khadga', SQLERRM;
END $$;

-- ---- Row 166: Pragya Shah (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 166 (%): organization nuad-thai-spa not found', 'Pragya Shah';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 166 (%): branch % not found', 'Pragya Shah', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 166 (%): tier % not found', 'Pragya Shah', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0126_1123') THEN
    RAISE NOTICE 'SKIP row 166 (%): membership_number % already imported', 'Pragya Shah', 'NT_PCM_0126_1123';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801021123'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Pragya Shah', '9801021123', NULL,
            'Imported from historical Excel (row 166).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0126_1123', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-03-22'::date,
         expiry_date = '2026-03-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 166: % -> membership %', 'Pragya Shah', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 166 (%): %', 'Pragya Shah', SQLERRM;
END $$;

-- ---- Row 167: Amrita bhusal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 167 (%): organization nuad-thai-spa not found', 'Amrita bhusal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 167 (%): branch % not found', 'Amrita bhusal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 167 (%): tier % not found', 'Amrita bhusal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0127_3750') THEN
    RAISE NOTICE 'SKIP row 167 (%): membership_number % already imported', 'Amrita bhusal', 'NT_PCM_0127_3750';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9869073750'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Amrita bhusal', '9869073750', NULL,
            'Imported from historical Excel (row 167).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0127_3750', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-03-26'::date,
         expiry_date = '2026-03-26'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 167: % -> membership %', 'Amrita bhusal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 167 (%): %', 'Amrita bhusal', SQLERRM;
END $$;

-- ---- Row 170: Amrit Shrestha (Premium Club, Bhaisepati) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 170 (%): organization nuad-thai-spa not found', 'Amrit Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Bhaisepati';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 170 (%): branch % not found', 'Amrit Shrestha', 'Bhaisepati';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 170 (%): tier % not found', 'Amrit Shrestha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0128_5241') THEN
    RAISE NOTICE 'SKIP row 170 (%): membership_number % already imported', 'Amrit Shrestha', 'NT_PCM_0128_5241';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9705415241'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Amrit Shrestha', '9705415241', 'realamritshrestha@gmail.com',
            'Imported from historical Excel (row 170).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0128_5241', 'DOB: 17/08/1999')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-04-09'::date,
         expiry_date = '2026-04-09'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 170: % -> membership %', 'Amrit Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 170 (%): %', 'Amrit Shrestha', SQLERRM;
END $$;

-- ---- Row 172: Gitanjali Rana (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 172 (%): organization nuad-thai-spa not found', 'Gitanjali Rana';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 172 (%): branch % not found', 'Gitanjali Rana', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 172 (%): tier % not found', 'Gitanjali Rana', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0129_6711') THEN
    RAISE NOTICE 'SKIP row 172 (%): membership_number % already imported', 'Gitanjali Rana', 'NT_PCM_0129_6711';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851020337'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Gitanjali Rana', '9851020337', NULL,
            'Imported from historical Excel (row 172).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0129_6711', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-04-17'::date,
         expiry_date = '2026-04-17'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 172: % -> membership %', 'Gitanjali Rana', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 172 (%): %', 'Gitanjali Rana', SQLERRM;
END $$;

-- ---- Row 173: Sumitra Gurung (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 173 (%): organization nuad-thai-spa not found', 'Sumitra Gurung';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 173 (%): branch % not found', 'Sumitra Gurung', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 173 (%): tier % not found', 'Sumitra Gurung', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0130_9444') THEN
    RAISE NOTICE 'SKIP row 173 (%): membership_number % already imported', 'Sumitra Gurung', 'NT_PCM_0130_9444';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9802018426'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sumitra Gurung', '9802018426', 'sumitragurung078@gmail.com',
            'Imported from historical Excel (row 173).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0130_9444', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-04-20'::date,
         expiry_date = '2026-04-20'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 173: % -> membership %', 'Sumitra Gurung', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 173 (%): %', 'Sumitra Gurung', SQLERRM;
END $$;

-- ---- Row 176: Bimal Kedia (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 176 (%): organization nuad-thai-spa not found', 'Bimal Kedia';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 176 (%): branch % not found', 'Bimal Kedia', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 176 (%): tier % not found', 'Bimal Kedia', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0131_1650') THEN
    RAISE NOTICE 'SKIP row 176 (%): membership_number % already imported', 'Bimal Kedia', 'NT_PCM_0131_1650';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851021650'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bimal Kedia', '9851021650', NULL,
            'Imported from historical Excel (row 176).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0131_1650', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 176: % -> membership %', 'Bimal Kedia', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 176 (%): %', 'Bimal Kedia', SQLERRM;
END $$;

-- ---- Row 178: Bisakha Shah (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 178 (%): organization nuad-thai-spa not found', 'Bisakha Shah';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 178 (%): branch % not found', 'Bisakha Shah', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 178 (%): tier % not found', 'Bisakha Shah', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0132_2549') THEN
    RAISE NOTICE 'SKIP row 178 (%): membership_number % already imported', 'Bisakha Shah', 'NT_PCM_0132_2549';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851042549'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Bisakha Shah', '9851042549', NULL,
            'Imported from historical Excel (row 178).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0132_2549', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-04-25'::date,
         expiry_date = '2026-04-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 178: % -> membership %', 'Bisakha Shah', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 178 (%): %', 'Bisakha Shah', SQLERRM;
END $$;

-- ---- Row 179: Gerasymenko Artemiy (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 179 (%): organization nuad-thai-spa not found', 'Gerasymenko Artemiy';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 179 (%): branch % not found', 'Gerasymenko Artemiy', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 179 (%): tier % not found', 'Gerasymenko Artemiy', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0133_6444') THEN
    RAISE NOTICE 'SKIP row 179 (%): membership_number % already imported', 'Gerasymenko Artemiy', 'NT_PCM_0133_6444';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9820166444'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Gerasymenko Artemiy', '9820166444', NULL,
            'Imported from historical Excel (row 179).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0133_6444', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  RAISE NOTICE 'Imported row 179: % -> membership %', 'Gerasymenko Artemiy', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 179 (%): %', 'Gerasymenko Artemiy', SQLERRM;
END $$;

-- ---- Row 180: Sabita Agrawal (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 180 (%): organization nuad-thai-spa not found', 'Sabita Agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 180 (%): branch % not found', 'Sabita Agrawal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 180 (%): tier % not found', 'Sabita Agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0134_1919') THEN
    RAISE NOTICE 'SKIP row 180 (%): membership_number % already imported', 'Sabita Agrawal', 'NT_PCM_0134_1919';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9801451919'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Sabita Agrawal', '9801451919', NULL,
            'Imported from historical Excel (row 180).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0134_1919', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-05-06'::date,
         expiry_date = '2026-05-06'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 180: % -> membership %', 'Sabita Agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 180 (%): %', 'Sabita Agrawal', SQLERRM;
END $$;

-- ---- Row 184: Sweta Shrestha/Atit Shrestha (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 184 (%): organization nuad-thai-spa not found', 'Sweta Shrestha/Atit Shrestha';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 184 (%): branch % not found', 'Sweta Shrestha/Atit Shrestha', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 184 (%): tier % not found', 'Sweta Shrestha/Atit Shrestha', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0035_5216') THEN
    RAISE NOTICE 'SKIP row 184 (%): membership_number % already imported', 'Sweta Shrestha/Atit Shrestha', 'NT_PCM_0035_5216';
    RETURN;
  END IF;

  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
  VALUES (v_org_id, v_branch_id, 'Sweta Shrestha/Atit Shrestha', NULL, NULL,
          'Imported from historical Excel (row 184). No phone number given in source.')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0035_5216', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-05-11'::date,
         expiry_date = '2026-05-11'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 184: % -> membership %', 'Sweta Shrestha/Atit Shrestha', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 184 (%): %', 'Sweta Shrestha/Atit Shrestha', SQLERRM;
END $$;

-- ---- Row 188: Raj Kumar Agrawal (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 188 (%): organization nuad-thai-spa not found', 'Raj Kumar Agrawal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 188 (%): branch % not found', 'Raj Kumar Agrawal', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 188 (%): tier % not found', 'Raj Kumar Agrawal', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0037_1370') THEN
    RAISE NOTICE 'SKIP row 188 (%): membership_number % already imported', 'Raj Kumar Agrawal', 'NT_PCM_0037_1370';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851001370'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Raj Kumar Agrawal', '9851001370', NULL,
            'Imported from historical Excel (row 188).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0037_1370', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-05-27'::date,
         expiry_date = '2026-05-27'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 188: % -> membership %', 'Raj Kumar Agrawal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 188 (%): %', 'Raj Kumar Agrawal', SQLERRM;
END $$;

-- ---- Row 194: Ritu Vaidya (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 194 (%): organization nuad-thai-spa not found', 'Ritu Vaidya';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 194 (%): branch % not found', 'Ritu Vaidya', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 194 (%): tier % not found', 'Ritu Vaidya', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0048_3112') THEN
    RAISE NOTICE 'SKIP row 194 (%): membership_number % already imported', 'Ritu Vaidya', 'NT_DCM_0048_3112';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851023112'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Ritu Vaidya', '9851023112', NULL,
            'Imported from historical Excel (row 194).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0048_3112', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-06-18'::date,
         expiry_date = '2026-06-18'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 194: % -> membership %', 'Ritu Vaidya', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 194 (%): %', 'Ritu Vaidya', SQLERRM;
END $$;

-- ---- Row 195: Akhil shaji (Premium Club, Thamel) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 195 (%): organization nuad-thai-spa not found', 'Akhil shaji';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Thamel';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 195 (%): branch % not found', 'Akhil shaji', 'Thamel';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 195 (%): tier % not found', 'Akhil shaji', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0038_8612') THEN
    RAISE NOTICE 'SKIP row 195 (%): membership_number % already imported', 'Akhil shaji', 'NT_PCM_0038_8612';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9713558612'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Akhil shaji', '9713558612', NULL,
            'Imported from historical Excel (row 195).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0038_8612', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-06-22'::date,
         expiry_date = '2026-06-22'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 195: % -> membership %', 'Akhil shaji', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 195 (%): %', 'Akhil shaji', SQLERRM;
END $$;

-- ---- Row 196: Dineeta (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 196 (%): organization nuad-thai-spa not found', 'Dineeta';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 196 (%): branch % not found', 'Dineeta', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 196 (%): tier % not found', 'Dineeta', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0039_7948') THEN
    RAISE NOTICE 'SKIP row 196 (%): membership_number % already imported', 'Dineeta', 'NT_PCM_0039_7948';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9803417948'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Dineeta', '9803417948', NULL,
            'Imported from historical Excel (row 196).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0039_7948', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-06-25'::date,
         expiry_date = '2026-06-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 196: % -> membership %', 'Dineeta', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 196 (%): %', 'Dineeta', SQLERRM;
END $$;

-- ---- Row 197: Pradeep Pandey (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 197 (%): organization nuad-thai-spa not found', 'Pradeep Pandey';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 197 (%): branch % not found', 'Pradeep Pandey', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 197 (%): tier % not found', 'Pradeep Pandey', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0040_1929') THEN
    RAISE NOTICE 'SKIP row 197 (%): membership_number % already imported', 'Pradeep Pandey', 'NT_PCM_0040_1929';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841741929'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Pradeep Pandey', '9841741929', NULL,
            'Imported from historical Excel (row 197).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0040_1929', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-06-25'::date,
         expiry_date = '2026-06-25'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 197: % -> membership %', 'Pradeep Pandey', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 197 (%): %', 'Pradeep Pandey', SQLERRM;
END $$;

-- ---- Row 199: Manju Hamal (Deluxe Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 199 (%): organization nuad-thai-spa not found', 'Manju Hamal';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 199 (%): branch % not found', 'Manju Hamal', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 199 (%): tier % not found', 'Manju Hamal', 'Deluxe Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0049_8869') THEN
    RAISE NOTICE 'SKIP row 199 (%): membership_number % already imported', 'Manju Hamal', 'NT_DCM_0049_8869';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841508869'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Manju Hamal', '9841508869', NULL,
            'Imported from historical Excel (row 199).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_DCM_0049_8869', 'DOB: 10th bhadra')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-06-30'::date,
         expiry_date = '2026-06-30'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 199: % -> membership %', 'Manju Hamal', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 199 (%): %', 'Manju Hamal', SQLERRM;
END $$;

-- ---- Row 200: Ganesh Khatri (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 200 (%): organization nuad-thai-spa not found', 'Ganesh Khatri';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 200 (%): branch % not found', 'Ganesh Khatri', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 200 (%): tier % not found', 'Ganesh Khatri', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0041_7764') THEN
    RAISE NOTICE 'SKIP row 200 (%): membership_number % already imported', 'Ganesh Khatri', 'NT_PCM_0041_7764';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9858027764'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Ganesh Khatri', '9858027764', NULL,
            'Imported from historical Excel (row 200).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0041_7764', 'DOB: 20/05/84')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-07-01'::date,
         expiry_date = '2026-07-01'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 200: % -> membership %', 'Ganesh Khatri', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 200 (%): %', 'Ganesh Khatri', SQLERRM;
END $$;

-- ---- Row 201: Girdhari Sharma (Premium Club, Sanepa) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 201 (%): organization nuad-thai-spa not found', 'Girdhari Sharma';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Sanepa';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 201 (%): branch % not found', 'Girdhari Sharma', 'Sanepa';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 201 (%): tier % not found', 'Girdhari Sharma', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0042_7741') THEN
    RAISE NOTICE 'SKIP row 201 (%): membership_number % already imported', 'Girdhari Sharma', 'NT_PCM_0042_7741';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9841337741'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'Girdhari Sharma', '9841337741', NULL,
            'Imported from historical Excel (row 201).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0042_7741', 'DOB: 9841337741.0')
  RETURNING id INTO v_membership_id;

  RAISE NOTICE 'Imported row 201: % -> membership %', 'Girdhari Sharma', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 201 (%): %', 'Girdhari Sharma', SQLERRM;
END $$;

-- ---- Row 204: PRAFULL VAIDYA (Premium Club, Lazimpat) ----------------------------------
DO $$
DECLARE
  v_org_id     uuid;
  v_branch_id  uuid;
  v_tier_id    uuid;
  v_customer_id uuid;
  v_membership_id uuid;
  v_validity_days int;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'SKIP row 204 (%): organization nuad-thai-spa not found', 'PRAFULL VAIDYA';
    RETURN;
  END IF;

  SELECT id INTO v_branch_id FROM public.branches WHERE org_id = v_org_id AND name = 'Lazimpat';
  IF v_branch_id IS NULL THEN
    RAISE NOTICE 'SKIP row 204 (%): branch % not found', 'PRAFULL VAIDYA', 'Lazimpat';
    RETURN;
  END IF;

  SELECT id, validity_days INTO v_tier_id, v_validity_days
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP row 204 (%): tier % not found', 'PRAFULL VAIDYA', 'Premium Club';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0043_3934') THEN
    RAISE NOTICE 'SKIP row 204 (%): membership_number % already imported', 'PRAFULL VAIDYA', 'NT_PCM_0043_3934';
    RETURN;
  END IF;

  -- Look up first, insert only if not found. Avoids depending on ON CONFLICT
  -- matching customers_org_nphone_uniq's expression byte-for-byte -- a plain
  -- WHERE match is robust to whatever that index's exact definition is, and
  -- this script runs single-threaded so there's no real race to guard against.
  SELECT id INTO v_customer_id FROM public.customers
   WHERE org_id = v_org_id
     AND regexp_replace(coalesce(phone,''), '\D', '', 'g') = '9851023934'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, notes)
    VALUES (v_org_id, v_branch_id, 'PRAFULL VAIDYA', '9851023934', NULL,
            'Imported from historical Excel (row 204).')
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, membership_number, notes)
  VALUES (v_org_id, v_customer_id, v_tier_id, 'NT_PCM_0043_3934', NULL)
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000.0,
          NULL);

  UPDATE public.memberships
     SET activation_date = '2026-07-18'::date,
         expiry_date = '2026-07-18'::date + (v_validity_days || ' days')::interval
   WHERE id = v_membership_id;

  RAISE NOTICE 'Imported row 204: % -> membership %', 'PRAFULL VAIDYA', v_membership_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED row 204 (%): %', 'PRAFULL VAIDYA', SQLERRM;
END $$;

-- =====================================================================
-- Verification
-- =====================================================================
SELECT t.name AS tier, b.name AS branch, count(*) AS imported,
       count(*) FILTER (WHERE m.activation_date IS NOT NULL) AS activated
FROM public.memberships m
JOIN public.membership_tiers t ON t.id = m.tier_id
JOIN public.customers c ON c.id = m.customer_id
JOIN public.branches b ON b.id = c.branch_id
WHERE m.notes LIKE '%Imported from historical Excel%'
GROUP BY t.name, b.name
ORDER BY t.name, b.name;
