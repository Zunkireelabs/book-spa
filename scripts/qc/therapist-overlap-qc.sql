-- ZNLY-351 QC harness: therapist double-booking guard (migration 414).
-- One transaction that ROLLS BACK: leaves no data. Safe on local, staging and a prod-shaped rehearsal copy.
-- NEVER run on PROD (it disables/enables triggers inside the rolled-back transaction, which takes table locks).
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v org_slug=nuad-thai-spa -f scripts/qc/therapist-overlap-qc.sql
-- Discovers its own staff / service by org slug. New rows are 60+ days ahead (after the guard's cutoff) so they never touch
-- real bookings. Only the guards under test run (the other booking triggers are switched off inside the transaction).
-- A SKIP means the tenant has no data for that case; it is shown, never counted as a pass.
\set ON_ERROR_STOP on
\if :{?org_slug}
\else
  \set org_slug nuad-thai-spa
\endif
\pset format aligned
BEGIN;
SELECT set_config('qc.org_slug', :'org_slug', true);
CREATE TEMP TABLE qc (n serial, result text, name text, expected text, got text);

ALTER TABLE public.bookings DISABLE TRIGGER USER;
ALTER TABLE public.booking_therapists DISABLE TRIGGER USER;
ALTER TABLE public.bookings ENABLE TRIGGER trg_compute_datetimes;
ALTER TABLE public.bookings ENABLE TRIGGER trg_zz_bookings_therapist_junction_overlap;
ALTER TABLE public.booking_therapists ENABLE TRIGGER trg_booking_therapists_overlap;

CREATE FUNCTION pg_temp.rec(p_name text, p_expected text, p_got text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO qc (result, name, expected, got)
  VALUES (CASE WHEN p_expected IS NOT DISTINCT FROM p_got THEN 'PASS' ELSE 'FAIL' END, p_name, p_expected, p_got);
$$;
CREATE FUNCTION pg_temp.skip(p_name text, p_why text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO qc (result, name, expected, got) VALUES ('SKIP', p_name, '-', p_why);
$$;

-- 'ok' or the SQLSTATE of the refusal. Returns the new id through the temp table last_id.
CREATE TEMP TABLE last_id (id uuid);
CREATE FUNCTION pg_temp.book(p_th uuid, p_day date, p_start time, p_cust text, p_status text DEFAULT 'Confirmed')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_branch uuid; v_svc uuid;
  has_snap boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'service_name_snapshot');
BEGIN
  SELECT t.branch_id INTO v_branch FROM public.therapists t WHERE t.id = p_th;
  SELECT s.id INTO v_svc FROM public.services s JOIN public.branches b ON b.org_id = s.org_id
   WHERE b.id = v_branch AND s.is_active AND s.duration_minutes >= 45 ORDER BY s.duration_minutes, s.created_at LIMIT 1;
  DELETE FROM last_id;
  -- Production also has NOT NULL service snapshot columns that no trigger fills there (ZNLY-352); local does not have them.
  -- Fill them when the column exists, so the same harness runs on local, staging and a prod-shaped copy.
  EXECUTE format($q$INSERT INTO public.bookings (branch_id, service_id, therapist_id, customer_name, date, start_time, end_time,
                       start_datetime, end_datetime, base_amount, final_amount, status %s)
                     VALUES (%L, %L, %L, %L, %L, %L, %L, now(), now(), 100, 100, %L %s) RETURNING id$q$,
    CASE WHEN has_snap THEN ', service_name_snapshot, service_duration_snapshot, service_price_snapshot' ELSE '' END,
    v_branch, v_svc, p_th, p_cust, p_day, p_start, p_start + interval '1 minute', p_status,
    CASE WHEN has_snap THEN ', ''QC'', 60, 100' ELSE '' END) INTO v_id;
  INSERT INTO last_id VALUES (v_id);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

CREATE FUNCTION pg_temp.companion(p_booking uuid, p_th uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.booking_therapists (booking_id, therapist_id) VALUES (p_booking, p_th);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

CREATE TEMP TABLE staff AS
  SELECT t.id, row_number() OVER (ORDER BY t.created_at, t.id) AS rn
  FROM public.therapists t JOIN public.branches b ON b.id = t.branch_id JOIN public.organizations o ON o.id = b.org_id
  WHERE o.slug = current_setting('qc.org_slug') AND t.is_active;
SELECT count(*) AS staff_found FROM staff \gset

DO $$
DECLARE
  d  date := (now() AT TIME ZONE 'Asia/Kathmandu')::date + 60;
  a  uuid := (SELECT id FROM staff WHERE rn = 1);
  b  uuid := (SELECT id FROM staff WHERE rn = 2);
  c  uuid := (SELECT id FROM staff WHERE rn = 3);
  e1 uuid; e2 uuid; dur interval;
BEGIN
  IF a IS NULL THEN
    PERFORM pg_temp.skip('all cases', 'tenant has no active staff'); RETURN;
  END IF;
  -- the booking length comes from the service (compute trigger): read it back from the first booking
  PERFORM pg_temp.rec('first booking is accepted', 'ok', pg_temp.book(a, d, '10:00', 'QC one'));
  SELECT id INTO e1 FROM last_id;
  SELECT end_time - start_time INTO dur FROM public.bookings WHERE id = e1;
  PERFORM pg_temp.rec('overlap, different customer: refused (23P01)', '23P01', pg_temp.book(a, d, time '10:00' + dur / 2, 'QC two'));
  PERFORM pg_temp.rec('overlap, same customer: refused (23P01)', '23P01', pg_temp.book(a, d, time '10:00' + dur / 4, 'QC one'));
  PERFORM pg_temp.rec('exact same slot: refused (23P01)', '23P01', pg_temp.book(a, d, '10:00', 'QC three'));
  PERFORM pg_temp.rec('back-to-back after (end = start): allowed', 'ok', pg_temp.book(a, d, time '10:00' + dur, 'QC four'));
  PERFORM pg_temp.rec('back-to-back before (end = start): allowed', 'ok', pg_temp.book(a, d, time '10:00' - dur, 'QC five'));

  UPDATE public.bookings SET status = 'Cancelled' WHERE id = e1;
  PERFORM pg_temp.rec('cancelled booking frees the slot', 'ok', pg_temp.book(a, d, '10:00', 'QC six'));
  SELECT id INTO e2 FROM last_id;
  PERFORM pg_temp.rec('no-show is ignored by the guard', 'ok', pg_temp.book(a, d, '10:00', 'QC seven', 'No Show'));

  BEGIN
    UPDATE public.bookings SET start_time = time '10:00' + dur / 2 WHERE id = e2;
    PERFORM pg_temp.rec('moving a booking onto another one: refused', '23P01', 'ok');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('moving a booking onto another one: refused', '23P01', SQLSTATE);
  END;
  -- (moves e2 from 10:00 onto the back-to-back booking at 10:00 + dur)
  BEGIN
    UPDATE public.bookings SET start_time = time '10:00' + dur - dur / 4 WHERE id = e2;
    PERFORM pg_temp.rec('moving a booking onto the next one: refused', '23P01', 'ok');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('moving a booking onto the next one: refused', '23P01', SQLSTATE);
  END;

  IF b IS NULL THEN
    PERFORM pg_temp.skip('couple second therapist cases', 'tenant has only one active staff member');
  ELSE
    -- couple booking E: primary a, companion b
    PERFORM pg_temp.book(a, d + 1, '14:00', 'QC couple');
    SELECT id INTO e1 FROM last_id;
    PERFORM pg_temp.rec('couple: second therapist added', 'ok', pg_temp.companion(e1, b));
    PERFORM pg_temp.rec('couple: second therapist booked elsewhere at that time: refused (23P01)', '23P01',
                        pg_temp.book(b, d + 1, time '14:00' + dur / 2, 'QC other'));
    -- b has their own booking G; companion b added to a booking that overlaps G is refused
    PERFORM pg_temp.book(b, d + 1, '18:00', 'QC own');
    PERFORM pg_temp.book(a, d + 1, time '18:00' + dur / 2, 'QC couple2');
    SELECT id INTO e2 FROM last_id;
    PERFORM pg_temp.rec('couple: companion overlapping their own other booking: refused (23P01)', '23P01',
                        pg_temp.companion(e2, b));
    IF c IS NULL THEN
      PERFORM pg_temp.skip('couple: third therapist added as companion at a free time', 'tenant has fewer than three active staff');
    ELSE
      PERFORM pg_temp.rec('couple: third therapist added as companion at a free time: allowed', 'ok',
                          pg_temp.companion((SELECT id FROM public.bookings WHERE customer_name = 'QC couple2'), c));
    END IF;
  END IF;
END $$;

-- A pre-cutoff overlapping pair (old production data) can still be edited. Needs such a pair in the copy; SKIP otherwise.
DO $$
DECLARE v_id uuid; v_n int;
BEGIN
  SELECT x.id INTO v_id FROM public.bookings x JOIN public.bookings y
    ON y.therapist_id = x.therapist_id AND y.id <> x.id
   AND tstzrange(x.start_datetime, x.end_datetime) && tstzrange(y.start_datetime, y.end_datetime)
  WHERE x.status NOT IN ('Cancelled', 'No Show') AND y.status NOT IN ('Cancelled', 'No Show')
    AND x.start_datetime < '2026-11-21 18:15:00+00'::timestamptz AND y.start_datetime < '2026-11-21 18:15:00+00'::timestamptz
  LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM pg_temp.skip('old overlapping row can still be updated', 'no old overlapping pair in this database'); RETURN;
  END IF;
  BEGIN
    UPDATE public.bookings SET status = 'Completed' WHERE id = v_id AND status <> 'Completed';
    PERFORM pg_temp.rec('old overlapping row can still be updated', 'ok', 'ok');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('old overlapping row can still be updated', 'ok', SQLSTATE);
  END;
END $$;

SELECT result, name, expected, got FROM qc ORDER BY n;
SELECT count(*) FILTER (WHERE result = 'FAIL') AS fails, count(*) FILTER (WHERE result = 'PASS') AS passes,
       count(*) FILTER (WHERE result = 'SKIP') AS skips FROM qc \gset
\if :{?fails}
\endif
SELECT CASE WHEN :fails > 0 THEN 1 / 0 ELSE 1 END AS harness_ok;
ROLLBACK;
