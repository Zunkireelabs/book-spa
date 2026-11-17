-- LOCAL-ONLY repair for samis-qc, Lazimpat Studio, 17 Nov 2026 (ZNLY-234). NEVER run on stage or production.
--   psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f scripts/repair-samis-17nov-local.sql
-- What happened: the day was closed with 3 bookings still Confirmed (BK-20261117-0004 Dolma Sherpa, part-paid; -0001; -0013). Closing locks every
-- booking, so they could not be completed, cancelled or marked no-show. Close Day now refuses that (migration 392); this repairs the one local day.
-- What it does (idempotent, resolved by org slug + booking number, never by UUID):
--   1. UNLOCKS exactly those three bookings (is_locked = false) so staff can finish them in the app (Complete / No-show / Cancel, and collect
--      Dolma's balance). The status is left as it is: the repair does not decide the outcome, a person does.
--   2. Fixes the closed day's stored buckets: card_total 0 -> 800 (Mastercard 500 + Visa 300), fonepay_total 1,300 -> 500 (MobileBanking).
--      Money in 28,550, taken 26,050 and cash 24,750 are already right and are not touched.
-- It runs as the database owner with the booking-immutability trigger switched off for this one transaction (that trigger blocks every change to
-- a locked booking, by design); it is switched back on before COMMIT, and the script aborts if the guard below does not match.
BEGIN;
DO $$
DECLARE v_org uuid; v_n int; v_branch uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'samis-qc';
  IF v_org IS NULL THEN RAISE EXCEPTION 'samis-qc not found: this repair is for the local QC database only'; END IF;
  SELECT br.id INTO v_branch FROM public.branches br WHERE br.org_id = v_org AND br.name = 'Lazimpat Studio';
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Lazimpat Studio not found in samis-qc'; END IF;

  ALTER TABLE public.bookings DISABLE TRIGGER trg_enforce_booking_immutability;
  UPDATE public.bookings SET is_locked = false
   WHERE branch_id = v_branch AND date = DATE '2026-11-17' AND is_locked
     AND booking_number IN ('BK-20261117-0004', 'BK-20261117-0001', 'BK-20261117-0013')
     AND status IN ('Pending', 'Confirmed', 'In-Progress');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ALTER TABLE public.bookings ENABLE TRIGGER trg_enforce_booking_immutability;
  RAISE NOTICE 'unlocked % booking(s)', v_n;

  UPDATE public.daily_reports SET card_total = 800, fonepay_total = 500
   WHERE branch_id = v_branch AND report_date = DATE '2026-11-17' AND card_total = 0 AND fonepay_total = 1300;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'corrected % daily_reports row(s)', v_n;
END $$;
COMMIT;
