-- Migration 398: "Cash expected in the drawer" subtracts only refunds paid out in CASH (ZNLY-258, found in the CP8 rehearsal 18 Nov 2026)
--
-- Before: cash_expected = cash in - ALL refunds. A refund of a card / online payment goes back to the card, not out of the till, so the drawer was
-- understated (BK-20261115-0021: 2,000 refunded to a Nabil Card took 2,000 off a drawer that never held it).
-- Now:    cash_expected = cash in - cash refunds.  taken / by_method / refunds are unchanged (every refund still comes off the takings).
-- Design: payment_refunds.cash_amount = the part of the refund that was paid back in cash. A cancellation refunds EVERY payment on the booking,
--   so a split-paid booking (cash + card) has a cash part and a card part; one number per refund stays correct for splits and needs no row split.
--   Derived from the original payments: sum of the booking's payments whose canonical mode is 'Cash' (capped at the refund amount).
--   Product refunds are unchanged: their rows already carry the sale's own tender mode, so only Cash tenders count.
-- Touches: payment_refunds (+cash_amount, backfill), handle_booking_cancellation_refund (stamps cash_amount), new _dashboard_cash_refund_rows /
--   _dashboard_cash_refunds, and the cash_expected / after_close.cash figures in _get_dashboard_unmasked (get_dashboard's body), get_day_money, _dashboard_at_close,
--   _dashboard_after_close. The JS twin (src/lib/dayMoney.js, api.js getDayMoneyForDate/getDailySummary) reads the new cash_refunds figure.
-- Applied: stage - / prod -.

BEGIN;

ALTER TABLE public.payment_refunds ADD COLUMN IF NOT EXISTS cash_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.payment_refunds DROP CONSTRAINT IF EXISTS chk_payment_refunds_cash_amount;
ALTER TABLE public.payment_refunds ADD CONSTRAINT chk_payment_refunds_cash_amount CHECK (cash_amount >= 0 AND cash_amount <= amount);

-- Backfill: the cash part of each refund = the cash paid on that booking, allocated SEQUENTIALLY across the booking's refunds (oldest first), so the
-- cash handed back never adds up to more than the cash that came in (a booking refunded twice would otherwise count its cash twice). Never more than the
-- refund itself. Idempotent (only rows still at 0; the allocation is a pure function of the rows, so a re-run gives the same numbers).
WITH alloc AS (
  SELECT rf.id,
         GREATEST(0, LEAST(rf.amount,
           COALESCE((SELECT sum(p.amount) FROM public.payments p
                      WHERE p.booking_id = rf.booking_id AND public._dashboard_canon_mode(p.payment_mode) = 'Cash'), 0)
           - COALESCE(sum(rf.amount) OVER (PARTITION BY rf.booking_id ORDER BY rf.created_at, rf.id
                                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))) AS cash
    FROM public.payment_refunds rf
)
UPDATE public.payment_refunds rf
   SET cash_amount = alloc.cash
  FROM alloc
 WHERE alloc.id = rf.id AND rf.cash_amount = 0 AND alloc.cash > 0;

-- A cancellation refunds every payment; stamp the cash part. (Body = migration 335's, plus cash_amount.)
CREATE OR REPLACE FUNCTION public.handle_booking_cancellation_refund()
RETURNS trigger AS $$
DECLARE
  v_amount  numeric(10,2);
  v_cash    numeric(10,2);
  v_org_id  uuid;
BEGIN
  IF NEW.status = 'Cancelled'
     AND OLD.status IS DISTINCT FROM 'Cancelled'
     AND OLD.payment_status IN ('paid', 'partial') THEN

    SELECT COALESCE(SUM(amount), 0),
           COALESCE(SUM(amount) FILTER (WHERE public._dashboard_canon_mode(payment_mode) = 'Cash'), 0)
      INTO v_amount, v_cash
    FROM public.payments
    WHERE booking_id = NEW.id;

    IF v_amount > 0 THEN
      SELECT br.org_id INTO v_org_id
      FROM public.branches br
      WHERE br.id = NEW.branch_id;

      INSERT INTO public.payment_refunds (booking_id, org_id, amount, cash_amount, refunded_by, reason)
      VALUES (NEW.id, v_org_id, v_amount, v_cash, auth.uid(), 'Full refund on booking cancellation');

      NEW.payment_status := 'refunded';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- The refunds that left the till: same rows and shape as _dashboard_refund_rows, but only the cash part (booking refunds: cash_amount;
-- product refunds: the sale tenders whose canonical mode is Cash).
CREATE OR REPLACE FUNCTION public._dashboard_cash_refund_rows(p_branches uuid[], p_day date)
RETURNS TABLE (amount numeric, branch_id uuid, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH w AS (SELECT p_day::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d0, (p_day + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d1)
  SELECT rf.cash_amount, rb.branch_id, rf.created_at FROM public.payment_refunds rf JOIN public.bookings rb ON rb.id = rf.booking_id, w
   WHERE rb.branch_id = ANY (p_branches) AND rf.created_at >= w.d0 AND rf.created_at < w.d1 AND rf.cash_amount > 0
  UNION ALL
  SELECT sp.amount, ps.branch_id, ps.refunded_at FROM public.product_sale_payments sp JOIN public.product_sales ps ON ps.id = sp.sale_id, w
   WHERE ps.branch_id = ANY (p_branches) AND ps.refunded_at >= w.d0 AND ps.refunded_at < w.d1 AND ps.created_at < w.d0
     AND public._dashboard_canon_mode(sp.payment_mode) = 'Cash';
$$;
REVOKE ALL ON FUNCTION public._dashboard_cash_refund_rows(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dashboard_cash_refunds(p_branches uuid[], p_day date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT COALESCE(sum(amount), 0) FROM public._dashboard_cash_refund_rows(p_branches, p_day); $$;
REVOKE ALL ON FUNCTION public._dashboard_cash_refunds(uuid[], date) FROM PUBLIC, anon, authenticated;

-- Cash part of "taken after the close", the closed day's figures and the day money (bodies = migration 392, cash refunds instead of all refunds).

CREATE OR REPLACE FUNCTION public._dashboard_after_close(p_branches uuid[], p_day date)
RETURNS TABLE (amount numeric, cash numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH closed AS (SELECT dr.branch_id, dr.closed_at FROM public.daily_reports dr WHERE dr.branch_id = ANY (p_branches) AND dr.report_date = p_day),
  i AS (SELECT mi.payment_mode, mi.amount FROM public._dashboard_money_in(p_branches, p_day) mi JOIN closed c ON c.branch_id = mi.branch_id AND mi.at > c.closed_at),
  r AS (SELECT rr.amount FROM public._dashboard_refund_rows(p_branches, p_day) rr JOIN closed c ON c.branch_id = rr.branch_id AND rr.at > c.closed_at)
  SELECT COALESCE((SELECT sum(amount) FROM i), 0) - COALESCE((SELECT sum(amount) FROM r), 0),
         COALESCE((SELECT sum(amount) FROM i WHERE payment_mode = 'Cash'), 0) - COALESCE((SELECT sum(rr.amount) FROM public._dashboard_cash_refund_rows(p_branches, p_day) rr JOIN closed c ON c.branch_id = rr.branch_id AND rr.at > c.closed_at), 0);
$$;
REVOKE ALL ON FUNCTION public._dashboard_after_close(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dashboard_at_close(p_branches uuid[], p_day date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_c timestamptz; v_in numeric; v_cash numeric; v_ref numeric; v_cref numeric;
BEGIN
  IF cardinality(p_branches) <> 1 THEN RETURN NULL; END IF;
  SELECT dr.closed_at INTO v_c FROM public.daily_reports dr WHERE dr.branch_id = p_branches[1] AND dr.report_date = p_day;
  IF v_c IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(mi.amount), 0), COALESCE(sum(mi.amount) FILTER (WHERE mi.payment_mode = 'Cash'), 0) INTO v_in, v_cash
    FROM public._dashboard_money_in(p_branches, p_day) mi WHERE mi.at <= v_c;
  SELECT COALESCE(sum(rr.amount), 0) INTO v_ref FROM public._dashboard_refund_rows(p_branches, p_day) rr WHERE rr.at <= v_c;
  SELECT COALESCE(sum(rr.amount), 0) INTO v_cref FROM public._dashboard_cash_refund_rows(p_branches, p_day) rr WHERE rr.at <= v_c;
  RETURN jsonb_build_object('closed_at', v_c,
    'by_method', COALESCE((SELECT jsonb_object_agg(x.payment_mode, x.total) FROM (
        SELECT mi.payment_mode, sum(mi.amount) AS total FROM public._dashboard_money_in(p_branches, p_day) mi WHERE mi.at <= v_c GROUP BY mi.payment_mode) x), '{}'),
    'refunds', v_ref, 'cash_refunds', v_cref, 'taken', v_in - v_ref, 'cash_expected', v_cash - v_cref);
END;
$$;
REVOKE ALL ON FUNCTION public._dashboard_at_close(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_day_money(p_branch_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_org uuid; v_ids uuid[]; v_refunds numeric; v_cash_refunds numeric; v_in numeric; v_cash numeric; v_svc numeric;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN RETURN '{}'::jsonb; END IF;
  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids FROM public.branches br
   WHERE br.org_id = v_org AND (p_branch_id IS NULL OR br.id = p_branch_id)
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;
  v_refunds := public._dashboard_refunds(v_ids, p_date);
  v_cash_refunds := public._dashboard_cash_refunds(v_ids, p_date);
  SELECT COALESCE(sum(amount), 0), COALESCE(sum(amount) FILTER (WHERE payment_mode = 'Cash'), 0), COALESCE(sum(amount) FILTER (WHERE src = 'booking'), 0)
    INTO v_in, v_cash, v_svc FROM public._dashboard_money_in(v_ids, p_date);
  RETURN jsonb_build_object(
    'by_method', COALESCE((SELECT jsonb_object_agg(m.payment_mode, m.total) FROM (
        SELECT mi.payment_mode, sum(mi.amount) AS total FROM public._dashboard_money_in(v_ids, p_date) mi GROUP BY mi.payment_mode) m), '{}'),
    'refunds', v_refunds, 'cash_refunds', v_cash_refunds, 'taken', v_in - v_refunds, 'cash_expected', v_cash - v_cash_refunds, 'service_in', v_svc,
    'after_close', (SELECT jsonb_build_object('amount', ac.amount, 'cash', ac.cash) FROM public._dashboard_after_close(v_ids, p_date) ac),   -- ZNLY-234: taken after the day was closed
    'at_close', public._dashboard_at_close(v_ids, p_date),   -- ZNLY-234: what the closed day held at close (NULL when open)
    -- where the non-booking money came from: product / voucher / membership / package
    'sources', COALESCE((SELECT jsonb_object_agg(x.src, x.total) FROM (
        SELECT mi.src, sum(mi.amount) AS total FROM public._dashboard_money_in(v_ids, p_date) mi WHERE mi.src <> 'booking' GROUP BY mi.src) x), '{}'));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_day_money(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_day_money(uuid, date) TO authenticated;

-- get_dashboard is a thin wrapper since migration 393; the ~250-line body lives in _get_dashboard_unmasked (migration 392's). It changes in exactly one place, its money block. Patched in place from the live definition so the
-- rest stays byte for byte what is deployed; the DO block RAISES if the text it expects is not there (so it can never half-apply).
DO $patch$
DECLARE
  v_def text;
  v_old text := $o$'cash_expected', COALESCE((SELECT sum(mi.amount) FROM public._dashboard_money_in(v_ids, v_date) mi WHERE mi.payment_mode = 'Cash'), 0)
                  - public._dashboard_refunds(v_ids, v_date),$o$;
  v_new text := $n$'cash_refunds', public._dashboard_cash_refunds(v_ids, v_date),
             'cash_expected', COALESCE((SELECT sum(mi.amount) FROM public._dashboard_money_in(v_ids, v_date) mi WHERE mi.payment_mode = 'Cash'), 0)
                  - public._dashboard_cash_refunds(v_ids, v_date),$n$;
BEGIN
  SELECT pg_get_functiondef('public._get_dashboard_unmasked(uuid[], date)'::regprocedure) INTO v_def;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'migration 398: _get_dashboard_unmasked cash_expected text not found, definition changed; patch by hand';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('398', 'cash-refunds-drawer')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
