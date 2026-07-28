-- One-time follow-up to supabase/data-import-nuad-membership-history.sql.
-- Applies corrections identified after cross-checking the imported staging
-- data back against the source Excel ("NUAD THAI CLUB MEMBERSHIP.xlsx"):
--
--   1. Deletes 3 memberships that were imported despite having no Issued
--      date at all in the source (raw value None or '-') -- per the rule
--      that a card with no issued/activation date shouldn't have been
--      imported in the first place. Cascades to their deposit transaction.
--   2. Applies 22 renewals ("Renew"/"Renue"-coded rows in the source, plus
--      2 that got a real-looking code instead of the literal word, plus
--      Aswin Giri who was re-issued under his EXACT original code with an
--      explicit "Renue it" note) as a deposit on the matching already-
--      imported base membership. Birendra Shrestha's renewal moved him from
--      Deluxe to Premium Club, so his tier is upgraded first.
--   3. Zeroes the wallet balance on every already-imported membership the
--      source flagged "CARD DONE" (wallet fully spent before this system
--      existed). Where that membership also gets a renewal in step 2, the
--      zero-out runs FIRST so the final balance is just the renewal amount.
--
-- Staging-only -- this data was never imported into production.
-- Not idempotent by design (deletes + ledger inserts) -- run once.

-- ============================================================
-- 1. Delete memberships with no Issued date in the source
-- ============================================================

-- Peter Wei -- no Issued date in source
DELETE FROM public.memberships WHERE membership_number = 'NT_DCM_0012_5578';

-- Pratik Man Singh (original Deluxe card) -- no Issued date in source
DELETE FROM public.memberships WHERE membership_number = 'NT_DCM_0013_1501';

-- Prashish Rajbhandari (original Deluxe card) -- no Issued date in source; renewal NT_PCM_0110_9851 intentionally not applied, left unresolved
DELETE FROM public.memberships WHERE membership_number = 'NT_DCM_0021_0690';

-- ============================================================
-- 2. Apply renewals as a deposit on the matching base membership
-- ============================================================

-- Aanand Mishra -- base NT_DCM_0008_9080
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0008_9080';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Aanand Mishra: base membership NT_DCM_0008_9080 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000, 'Renewal (from historical Excel import), issued 2026-05-09.');

  RAISE NOTICE 'Applied renewal for Aanand Mishra: +50000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Aanand Mishra: %', SQLERRM;
END $$;

-- Birendra Shrestha -- base NT_DCM_0009_6153 (tier upgrade to Premium Club)
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
  v_tier_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0009_6153';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Birendra Shrestha: base membership NT_DCM_0009_6153 not found'; RETURN;
  END IF;

  SELECT id INTO v_tier_id FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Premium Club';
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Birendra Shrestha: tier Premium Club not found'; RETURN;
  END IF;
  UPDATE public.memberships SET tier_id = v_tier_id WHERE id = v_membership_id;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-01-18.');

  RAISE NOTICE 'Applied renewal for Birendra Shrestha: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Birendra Shrestha: %', SQLERRM;
END $$;

-- Manisha Karki -- base NT_PCM_0013_7706
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0013_7706';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Manisha Karki: base membership NT_PCM_0013_7706 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-05-23.');

  RAISE NOTICE 'Applied renewal for Manisha Karki: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Manisha Karki: %', SQLERRM;
END $$;

-- Mingma Sherpa -- base NT_PCM_0017_1187
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0017_1187';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Mingma Sherpa: base membership NT_PCM_0017_1187 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued date as recorded in source: ''29th Nov'' (no confirmed year).');

  RAISE NOTICE 'Applied renewal for Mingma Sherpa: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Mingma Sherpa: %', SQLERRM;
END $$;

-- Dennis Tiew -- base NT_DCM_0016_4845
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0016_4845';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Dennis Tiew: base membership NT_DCM_0016_4845 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000, 'Renewal (from historical Excel import), issued 2026-05-16.');

  RAISE NOTICE 'Applied renewal for Dennis Tiew: +50000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Dennis Tiew: %', SQLERRM;
END $$;

-- Amit Chaudhary -- base NT_PCM_0021_1515
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0021_1515';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Amit Chaudhary: base membership NT_PCM_0021_1515 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued date as recorded in source: ''28TH JU'' (no confirmed year).');

  RAISE NOTICE 'Applied renewal for Amit Chaudhary: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Amit Chaudhary: %', SQLERRM;
END $$;

-- rakesh adhukia -- base NT_PCM_0039_2221
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0039_2221';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for rakesh adhukia: base membership NT_PCM_0039_2221 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued date as recorded in source: ''22nd April'' (no confirmed year).');

  RAISE NOTICE 'Applied renewal for rakesh adhukia: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for rakesh adhukia: %', SQLERRM;
END $$;

-- Subhi Pradan -- base NT_DCM_0025_6975
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0025_6975';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Subhi Pradan: base membership NT_DCM_0025_6975 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000, 'Renewal (from historical Excel import), issued 2025-04-05.');

  RAISE NOTICE 'Applied renewal for Subhi Pradan: +50000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Subhi Pradan: %', SQLERRM;
END $$;

-- Aryan -- base NT_PCM_0048_1999
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0048_1999';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Aryan: base membership NT_PCM_0048_1999 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-05-09.');

  RAISE NOTICE 'Applied renewal for Aryan: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Aryan: %', SQLERRM;
END $$;

-- Tenzing Nyiden lama -- base NT_PCM_0049_5707
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0049_5707';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Tenzing Nyiden lama: base membership NT_PCM_0049_5707 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-04-21.');

  RAISE NOTICE 'Applied renewal for Tenzing Nyiden lama: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Tenzing Nyiden lama: %', SQLERRM;
END $$;

-- Madhusudan Koirala -- base NT_DCM_0028_9725
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0028_9725';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Madhusudan Koirala: base membership NT_DCM_0028_9725 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000, 'Renewal (from historical Excel import), issued 2026-03-06.');

  RAISE NOTICE 'Applied renewal for Madhusudan Koirala: +50000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Madhusudan Koirala: %', SQLERRM;
END $$;

-- Narendra Ballab Panta -- base NT_PCM_0058_4179
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0058_4179';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Narendra Ballab Panta: base membership NT_PCM_0058_4179 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-03-24.');

  RAISE NOTICE 'Applied renewal for Narendra Ballab Panta: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Narendra Ballab Panta: %', SQLERRM;
END $$;

-- Aura Scheel -- base NT_PCM_0069_8338
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0069_8338';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Aura Scheel: base membership NT_PCM_0069_8338 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-05-19.');

  RAISE NOTICE 'Applied renewal for Aura Scheel: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Aura Scheel: %', SQLERRM;
END $$;

-- Lata Bhusal -- base NT_PCM_0072_2778
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0072_2778';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Lata Bhusal: base membership NT_PCM_0072_2778 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-05-12.');

  RAISE NOTICE 'Applied renewal for Lata Bhusal: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Lata Bhusal: %', SQLERRM;
END $$;

-- Bishnu Sapkota -- base NT_DCM_0034_5113
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0034_5113';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Bishnu Sapkota: base membership NT_DCM_0034_5113 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000, 'Renewal (from historical Excel import), issued date as recorded in source: ''10TH JULY'' (no confirmed year).');

  RAISE NOTICE 'Applied renewal for Bishnu Sapkota: +50000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Bishnu Sapkota: %', SQLERRM;
END $$;

-- Liu Xu Jun -- base NT_PCM_0087_3729
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0087_3729';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Liu Xu Jun: base membership NT_PCM_0087_3729 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-03-06.');

  RAISE NOTICE 'Applied renewal for Liu Xu Jun: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Liu Xu Jun: %', SQLERRM;
END $$;

-- Hikari Sapkota -- base NT_PCM_0104_2110
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0104_2110';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Hikari Sapkota: base membership NT_PCM_0104_2110 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-04-14.');

  RAISE NOTICE 'Applied renewal for Hikari Sapkota: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Hikari Sapkota: %', SQLERRM;
END $$;

-- Manju Tiwari -- base NT_PCM_0076_3942
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0076_3942';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Manju Tiwari: base membership NT_PCM_0076_3942 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-07-05.');

  RAISE NOTICE 'Applied renewal for Manju Tiwari: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Manju Tiwari: %', SQLERRM;
END $$;

-- Bimal Sawarthia -- base NT_PCM_0016_0407
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0016_0407';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Bimal Sawarthia: base membership NT_PCM_0016_0407 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2026-03-14.');

  RAISE NOTICE 'Applied renewal for Bimal Sawarthia: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Bimal Sawarthia: %', SQLERRM;
END $$;

-- Lin -- base NT_DCM_0014_6513
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_DCM_0014_6513';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Lin: base membership NT_DCM_0014_6513 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 50000, 'Renewal (from historical Excel import), issued 2026-05-09.');

  RAISE NOTICE 'Applied renewal for Lin: +50000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Lin: %', SQLERRM;
END $$;

-- Barsha -- base NT_PCM_0014_7755
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0014_7755';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Barsha: base membership NT_PCM_0014_7755 not found'; RETURN;
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issue date not recorded in source.');

  RAISE NOTICE 'Applied renewal for Barsha: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Barsha: %', SQLERRM;
END $$;

-- Aswin Giri -- base NT_PCM_0010_8763
DO $$
DECLARE
  v_org_id uuid;
  v_membership_id uuid;
  v_balance numeric(12,2);
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = 'NT_PCM_0010_8763';
  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'SKIP renewal for Aswin Giri: base membership NT_PCM_0010_8763 not found'; RETURN;
  END IF;

  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
    VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent) before this renewal.');
  END IF;

  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
  VALUES (v_membership_id, v_org_id, 'deposit', 100000, 'Renewal (from historical Excel import), issued 2025-08-16.');

  RAISE NOTICE 'Applied renewal for Aswin Giri: +100000';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED renewal for Aswin Giri: %', SQLERRM;
END $$;

-- ============================================================
-- 3. Zero wallet balance for CARD DONE memberships with no renewal (74)
-- ============================================================

DO $$
DECLARE
  v_org_id uuid;
  v_code text;
  v_membership_id uuid;
  v_balance numeric(12,2);
  v_codes text[] := ARRAY[
    'NT_DCM_0020_2285',
    'NT_DCM_0021_0203',
    'NT_DCM_0023_2222',
    'NT_DCM_0027_5404',
    'NT_DCM_0029_0007',
    'NT_DCM_0030_1066',
    'NT_DCM_0032_8310',
    'NT_DCM_0033_2920',
    'NT_DCM_0035_5333',
    'NT_DCM_0036_3272',
    'NT_DCM_0037_7110',
    'NT_DCM_0038_',
    'NT_DCM_0039_0111',
    'NT_DCM_0040_6847',
    'NT_DCM_0041_4820',
    'NT_PCM_0008_1381',
    'NT_PCM_0015_0350',
    'NT_PCM_0026_7002',
    'NT_PCM_0027_4704',
    'NT_PCM_0032_6968',
    'NT_PCM_0033_9810',
    'NT_PCM_0043_5216',
    'NT_PCM_0044_3861',
    'NT_PCM_0046_8772',
    'NT_PCM_0047_6574',
    'NT_PCM_0050_0758',
    'NT_PCM_0051_4856',
    'NT_PCM_0052_7600',
    'NT_PCM_0053_8567',
    'NT_PCM_0054_0958',
    'NT_PCM_0055_7222',
    'NT_PCM_0056_3349',
    'NT_PCM_0057_4883',
    'NT_PCM_0059_9088',
    'NT_PCM_0060_5050',
    'NT_PCM_0061_1213',
    'NT_PCM_0062_2525',
    'NT_PCM_0063_0012',
    'NT_PCM_0064_1474',
    'NT_PCM_0065_2057',
    'NT_PCM_0066_4054',
    'NT_PCM_0067_3515',
    'NT_PCM_0068_9244',
    'NT_PCM_0070_3960',
    'NT_PCM_0071_4784',
    'NT_PCM_0073_8042',
    'NT_PCM_0074_0912',
    'NT_PCM_0075_1831',
    'NT_PCM_0077_0202',
    'NT_PCM_0078_7000',
    'NT_PCM_0079_4247',
    'NT_PCM_0080_5313',
    'NT_PCM_0081_1207',
    'NT_PCM_0082_7660',
    'NT_PCM_0083_7817',
    'NT_PCM_0084_0935',
    'NT_PCM_0085_1052',
    'NT_PCM_0086_2882',
    'NT_PCM_0088_8000',
    'NT_PCM_0089_4639',
    'NT_PCM_0090_4573',
    'NT_PCM_0091_1277',
    'NT_PCM_0092_1600',
    'NT_PCM_0093_2700',
    'NT_PCM_0094_0888',
    'NT_PCM_0095_9051',
    'NT_PCM_0096_9779',
    'NT_PCM_0097_4057',
    'NT_PCM_0098_1044',
    'NT_PCM_0099_8059',
    'NT_PCM_0100_1840',
    'NT_PCM_0101_4322',
    'NT_PCM_0102_1496',
    'NT_PCM_0103_3718'
  ];
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  FOREACH v_code IN ARRAY v_codes LOOP
    SELECT id, balance INTO v_membership_id, v_balance FROM public.memberships WHERE org_id = v_org_id AND membership_number = v_code;
    IF v_membership_id IS NULL THEN
      RAISE NOTICE 'SKIP zero-out for %: membership not found', v_code;
      CONTINUE;
    END IF;
    IF v_balance <> 0 THEN
      INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, notes)
      VALUES (v_membership_id, v_org_id, 'adjustment', -v_balance, 'Wallet balance zeroed -- source marked CARD DONE (fully spent).');
      RAISE NOTICE 'Zeroed %: was %', v_code, v_balance;
    END IF;
  END LOOP;
END $$;
