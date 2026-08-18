-- migration-025: make booking_number generation concurrency-safe
--
-- Problem: generate_booking_number() derived the per-day sequence from
-- COUNT(*) WHERE date = NEW.date. Two inserts for the same date running
-- concurrently both read the same COUNT and both pass the WHILE-EXISTS check
-- (uncommitted rows are invisible across transactions), so both generate the
-- same BK-YYYYMMDD-XXXX and the second commit fails with
-- bookings_booking_number_key (23505).
--
-- Fix part 1: take a per-date transaction-scoped advisory lock before computing
-- the sequence. Concurrent inserts for the same date now serialize — the second
-- waits until the first commits, then COUNT reflects the new row. The lock is
-- released automatically at transaction end. The WHILE loop is kept as a
-- backstop for non-contiguous numbers left by deletions.
--
-- Fix part 2 (the real culprit): RLS is enabled on bookings and this trigger ran
-- SECURITY INVOKER, so its internal COUNT(*) and WHILE-EXISTS queries only saw
-- the CALLER's RLS-visible rows (their own branch). An authenticated manager
-- creating a booking could not see other branches' rows for the same date, so
-- COUNT under-counted and generated an already-used BK number — which the
-- table-level UNIQUE constraint (RLS-independent) then rejected with 23505. This
-- is why `postgres` (RLS-bypassing) worked but app users failed. Marking the
-- function SECURITY DEFINER makes the counting queries run as the function owner
-- (RLS-bypassing), so COUNT/EXISTS see every row regardless of caller branch.

CREATE OR REPLACE FUNCTION generate_booking_number()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  date_part text;
  seq_num integer;
  new_number text;
BEGIN
  date_part := to_char(NEW.date, 'YYYYMMDD');

  -- Serialize booking-number generation per date to avoid the concurrent
  -- COUNT(*) race. Held until the transaction commits/rolls back.
  PERFORM pg_advisory_xact_lock(hashtext('booking_number:' || date_part));

  SELECT COUNT(*) + 1 INTO seq_num
  FROM bookings
  WHERE date = NEW.date;

  new_number := 'BK-' || date_part || '-' || lpad(seq_num::text, 4, '0');

  -- Backstop for gaps from deleted rows.
  WHILE EXISTS (SELECT 1 FROM bookings WHERE booking_number = new_number) LOOP
    seq_num := seq_num + 1;
    new_number := 'BK-' || date_part || '-' || lpad(seq_num::text, 4, '0');
  END LOOP;

  NEW.booking_number := new_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
