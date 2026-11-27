-- Migration 435 (ZNLY-410 step 1): the bill number is fixed at the first print.
-- Why: a bill is built live from the booking / visit and its payments (nothing stored), but its NUMBER must never change once the customer
-- has it. The number is the visit's first booking number (BK-YYYYMMDD-NNNN), so no new counter: this table only remembers which booking
-- was chosen as the anchor, by whom and when. Orgs with "Several services in one booking" OFF (or a booking with no visit) anchor on the booking itself.
-- Writes only through fix_bill_number() (SECURITY DEFINER, same org/branch scope as extend_booking). Reads are org-scoped by RLS.
-- Reversible: DROP FUNCTION public.fix_bill_number(uuid, boolean); DROP TABLE public.bill_numbers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.bill_numbers (
  anchor_booking_id uuid PRIMARY KEY REFERENCES public.bookings(id),
  org_id            uuid NOT NULL REFERENCES public.organizations(id),
  bill_number       text NOT NULL,
  fixed_by          uuid,
  fixed_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_numbers_org ON public.bill_numbers (org_id);

ALTER TABLE public.bill_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_numbers_select ON public.bill_numbers;
CREATE POLICY bill_numbers_select ON public.bill_numbers FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()));
GRANT SELECT ON public.bill_numbers TO authenticated;   -- no INSERT/UPDATE/DELETE: only fix_bill_number() writes

-- Returns the bill number for the booking's unit, fixing it on first call. p_single = true forces the booking itself (tax-invoice orgs: one invoice per row).
CREATE OR REPLACE FUNCTION public.fix_bill_number(p_booking_id uuid, p_single boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role   user_role := get_user_role();
  v_org    uuid      := get_user_org_id();
  b        record;
  v_br_org uuid;
  v_multi  boolean;
  v_anchor uuid;
  v_number text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'BILL_REFUSED: You cannot print this bill.' USING ERRCODE = 'PT403';
  END IF;
  SELECT id, branch_id, visit_id, booking_number INTO b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_REFUSED: Could not find this booking.' USING ERRCODE = 'P0002'; END IF;
  SELECT br.org_id INTO v_br_org FROM public.branches br WHERE br.id = b.branch_id;
  IF v_br_org IS DISTINCT FROM v_org OR (v_role <> 'admin' AND NOT (b.branch_id = ANY (get_user_branch_ids()))) THEN
    RAISE EXCEPTION 'BILL_REFUSED: You cannot print this bill.' USING ERRCODE = 'PT403';
  END IF;

  SELECT COALESCE(o.multi_service_bookings, false) INTO v_multi FROM public.organizations o WHERE o.id = v_org;
  IF v_multi AND NOT COALESCE(p_single, false) AND b.visit_id IS NOT NULL THEN
    -- the visit's first booking number (cancelled rows count: the number must not move if the first service is cancelled)
    SELECT x.id, x.booking_number INTO v_anchor, v_number FROM public.bookings x WHERE x.visit_id = b.visit_id ORDER BY x.booking_number, x.id LIMIT 1;
  ELSE
    v_anchor := b.id; v_number := b.booking_number;
  END IF;

  -- first caller wins; everyone after gets the stored number
  INSERT INTO public.bill_numbers (anchor_booking_id, org_id, bill_number, fixed_by)
  VALUES (v_anchor, v_org, v_number, auth.uid())
  ON CONFLICT (anchor_booking_id) DO NOTHING;
  SELECT bn.bill_number INTO v_number FROM public.bill_numbers bn WHERE bn.anchor_booking_id = v_anchor;
  RETURN v_number;
END;
$function$;
REVOKE ALL ON FUNCTION public.fix_bill_number(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fix_bill_number(uuid, boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('435', 'bill-numbers')
ON CONFLICT (version) DO NOTHING;
COMMIT;
