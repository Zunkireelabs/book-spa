-- One-time follow-up to supabase/data-import-nuad-membership-history.sql.
--
-- Root cause: for 37 rows the source Excel's "Issued" cell had no year at all
-- (e.g. "29th Nov", "17TH MARCH"), so the import script's per-row UPDATE that
-- sets activation_date/expiry_date was skipped (see import-report.md's
-- "Imported with an unverified activation date" section). Per
-- migration-045-memberships.sql's trigger, activation_date/expiry_date get
-- auto-set to the day the deposit transaction is inserted the moment a
-- membership first crosses its tier threshold -- so every one of these 37
-- memberships shows the day the import script ran (2026-07-28) as its
-- "Activated" date on the membership card, instead of its real historical
-- date.
--
-- Fix: re-derived each missing year by placing the row's day/month against
-- the surrounding rows in the same sheet, which run in near-chronological
-- order in blocks of a few weeks at a time (verified programmatically: for
-- every row below, the day/month falls inside the run of confirmed dates
-- immediately around it, with no other year that also fits). This is an
-- inference, not a value the source states outright -- if Nuad Thai staff
-- have the physical/original signup date for any of these, prefer that.
--
-- Four of these people also received a historical renewal (applied as a
-- top-up deposit by fix-membership-import-round2.sql), which per
-- migration-054-renew-membership.sql's renew_membership() starts a *fresh*
-- activation/expiry cycle. Since round3.sql already reset those members'
-- ledger balance to reflect only the latest cycle, activation_date is set
-- here to the renewal date instead of the original enrollment date, to stay
-- consistent with how a real renewal would leave the row:
--   - rakesh adhukia   (NT_PCM_0039_2221) -> renewal date 2026-04-22
--   - LATA BHUSAL      (NT_PCM_0072_2778) -> renewal date 2026-05-12 (this
--     renewal's year WAS given in the source, unlike the original signup)
--   - Bishnu Sapkota   (NT_DCM_0034_5113) -> renewal date 2026-07-10
--
-- Mingma Sherpa (NT_PCM_0017_1187) is NOT included here. He also has a
-- historical renewal ("29th Nov", code "Renew", row 189 of the sheet), but
-- that row sits chronologically among April-July 2026 entries with no other
-- November date anywhere nearby -- there's no defensible year to infer, so
-- his activation_date is left untouched (still defaulted to the import run
-- date) pending a manual answer from Nuad Thai staff on his real renewal
-- date.
--
-- Staging-only -- this data was imported into staging only (see CLAUDE.md).
-- Idempotent: re-running just sets the same activation_date/expiry_date again.

DO $$
DECLARE
  v_org_id uuid;
  v_code text;
  v_date date;
  v_membership_id uuid;
  v_validity int;
  v_fixed int := 0;
  v_pairs text[][] := ARRAY[
    ARRAY['NT_DCM_0014_6513', '2025-11-11'],  -- Lin
    ARRAY['NT_PCM_0039_2221', '2026-04-22'],  -- rakesh adhukia (renewal date, see header)
    ARRAY['NT_DCM_0024_5282', '2025-04-01'],  -- LOPSANG JIGME
    ARRAY['NT_DCM_0027_5404', '2025-04-14'],  -- ANIL RAI
    ARRAY['NT_PCM_0046_8772', '2025-04-05'],  -- MADHU DIXIT DEVKOTA
    ARRAY['NT_DCM_0028_9725', '2025-05-01'],  -- Madhusudan Koirala
    ARRAY['NT_DCM_0029_0007', '2025-05-07'],  -- RUPAK GHIMIRE
    ARRAY['NT_DCM_0030_1066', '2025-05-11'],  -- Mr. Mittal
    ARRAY['NT_DCM_0031_8310', '2025-05-18'],  -- Mr. Subrat Basnet
    ARRAY['NT_PCM_0064_1474', '2025-06-17'],  -- SAURAV RAUNIYA
    ARRAY['NT_PCM_0065_2057', '2025-06-19'],  -- PITAMBER PAUDEL
    ARRAY['NT_PCM_0066_4054', '2025-06-19'],  -- RABIN GURUNG
    ARRAY['NT_PCM_0067_3515', '2025-06-21'],  -- ALOK BANSAL
    ARRAY['NT_PCM_0068_9244', '2025-06-28'],  -- SANJAY AGRAWAL
    ARRAY['NT_PCM_0069_8338', '2025-06-29'],  -- AURA SCHEEL
    ARRAY['NT_PCM_0070_3960', '2025-07-06'],  -- MANOJ PARAJULI
    ARRAY['NT_PCM_0071_4784', '2025-07-09'],  -- JHAINDRA GHIMIRE
    ARRAY['NT_PCM_0072_2778', '2026-05-12'],  -- LATA BHUSAL (renewal date, see header)
    ARRAY['NT_DCM_0033_2920', '2025-08-01'],  -- MR.CULLEN
    ARRAY['NT_DCM_0034_5113', '2026-07-10'],  -- Bishnu Sapkota (renewal date, see header)
    ARRAY['NT_PCM_0086_2882', '2025-09-20'],  -- Deepti Singh
    ARRAY['NT_PCM_0087_3729', '2025-10-09'],  -- LIU XU JUN
    ARRAY['NT_DCM_0037_7110', '2025-10-10'],  -- aadrit bahadur shahh
    ARRAY['NT_PCM_0089_4639', '2025-10-17'],  -- Vineet Sarda
    ARRAY['NT_DCM_0038_',     '2025-11-08'],  -- Satish Shrestha
    ARRAY['NT_PCM_0095_9051', '2025-11-17'],  -- Sadiksha Koirala
    ARRAY['NT_DCM_0039_0111', '2025-11-19'],  -- Lenni cheuig
    ARRAY['NT_PCM_0097_4057', '2025-11-20'],  -- Prapti KC
    ARRAY['NT_PCM_0098_1044', '2025-11-15'],  -- Sonakshi Rathi
    ARRAY['NT_PCM_0099_8059', '2025-11-25'],  -- Sarmila thapa
    ARRAY['NT_PCM_0100_1840', '2025-11-29'],  -- Abhisek Sarawgi
    ARRAY['NT_PCM_0103_3718', '2025-12-16'],  -- Nikita Saraf
    ARRAY['NT_PCM_0104_2110', '2025-12-20'],  -- Hikari Sapkota
    ARRAY['NT_PCM_0111_9850', '2026-01-13'],  -- Manish khetan
    ARRAY['NT_PCM_0131_1650', '2026-04-22'],  -- Bimal Kedia
    ARRAY['NT_PCM_0133_6444', '2026-04-26']   -- Gerasymenko Artemiy
  ];
  v_pair text[];
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'ABORT: org nuad-thai-spa not found';
    RETURN;
  END IF;

  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    v_code := v_pair[1];
    v_date := v_pair[2]::date;

    SELECT m.id, t.validity_days INTO v_membership_id, v_validity
    FROM public.memberships m
    JOIN public.membership_tiers t ON t.id = m.tier_id
    WHERE m.org_id = v_org_id AND m.membership_number = v_code;

    IF v_membership_id IS NULL THEN
      RAISE NOTICE 'SKIP %: membership not found', v_code;
      CONTINUE;
    END IF;

    UPDATE public.memberships
       SET activation_date = v_date,
           expiry_date     = v_date + (v_validity || ' days')::interval
     WHERE id = v_membership_id;

    v_fixed := v_fixed + 1;
    RAISE NOTICE 'Fixed %: activation_date -> %', v_code, v_date;
  END LOOP;

  RAISE NOTICE 'Done: % membership(s) corrected.', v_fixed;
END $$;
