-- Migration 436 (ZNLY-410 step 2, part A): the customer's bill link + the public bill page.
-- bill_links: one ACTIVE link per bill (per visit, or per exact set of bookings for a checkout bundle). The token is long and random (64 hex).
-- Writes only through share_bill() / turn_off_bill_link() (staff, same scope as fix_bill_number, migration 435).
-- get_public_bill(token) is the ONLY thing anon can call: it returns that one bill (rows, payments, refunds, tips, products, business + branch,
-- frozen tax-invoice fields) with the customer's phone masked, or {"active": false}. Nothing else becomes readable by anon.
-- "Updated <date>" (F3): a fingerprint of the bill's money is stored with the link; when the bill's figures differ on the next view the link
-- records updated_at. Reversible: DROP FUNCTION share_bill, turn_off_bill_link, get_public_bill, _bill_*; DROP TABLE bill_links.
BEGIN;

CREATE TABLE IF NOT EXISTS public.bill_links (
  token          text PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  unit_key       text NOT NULL,
  visit_id       uuid NULL,
  booking_ids    uuid[] NOT NULL,
  bill_number    text NOT NULL,
  fingerprint    text NOT NULL,
  updated_at     timestamptz NULL,
  active         boolean NOT NULL DEFAULT true,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  turned_off_by  uuid,
  turned_off_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_links_active ON public.bill_links (org_id, unit_key) WHERE active;
ALTER TABLE public.bill_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_links_select ON public.bill_links;
CREATE POLICY bill_links_select ON public.bill_links FOR SELECT TO authenticated USING (org_id = (SELECT get_user_org_id()));
REVOKE ALL ON public.bill_links FROM anon;   -- Supabase grants anon on new public tables by default
GRANT SELECT ON public.bill_links TO authenticated;   -- no write grants, no anon access: RPCs only

-- ── private helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._bill_short_name(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN array_length(w, 1) > 1 THEN w[1] || ' ' || left(w[array_length(w, 1)], 1) || '.' ELSE COALESCE(w[1], '') END
  FROM (SELECT regexp_split_to_array(btrim(COALESCE(p_name, '')), '\s+') AS w) x $$;

-- +977 98•• ••4128 (Nepal mobile); anything else: first 3 + •••• + last 4.
CREATE OR REPLACE FUNCTION public._bill_mask_phone(p_phone text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_phone IS NULL OR length(p_phone) < 7 THEN NULL
              WHEN p_phone ~ '^\+977\d{10}$' THEN '+977 ' || substr(p_phone, 5, 2) || '•• ••' || right(p_phone, 4)
              ELSE left(p_phone, 3) || '•••• ' || right(p_phone, 4) END $$;

-- What the customer would read as "the bill's figures": any change to this string is an update.
CREATE OR REPLACE FUNCTION public._bill_fingerprint(p_ids uuid[]) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(
    COALESCE((SELECT string_agg(b.id::text || ':' || b.status::text || ':' || b.final_amount::text || ':' || b.discount_amount::text, ',' ORDER BY b.id) FROM bookings b WHERE b.id = ANY (p_ids)), '') || '|' ||
    COALESCE((SELECT string_agg(p.id::text || ':' || p.amount::text, ',' ORDER BY p.id) FROM payments p WHERE p.booking_id = ANY (p_ids)), '') || '|' ||
    COALESCE((SELECT string_agg(r.id::text || ':' || r.amount::text, ',' ORDER BY r.id) FROM payment_refunds r WHERE r.booking_id = ANY (p_ids)), '') || '|' ||
    COALESCE((SELECT string_agg(s.id::text || ':' || s.total_amount::text || ':' || (s.refunded_at IS NOT NULL)::text, ',' ORDER BY s.id) FROM product_sales s WHERE s.booking_id = ANY (p_ids)), '')) $$;
REVOKE ALL ON FUNCTION public._bill_fingerprint(uuid[]) FROM PUBLIC, anon, authenticated;

-- ── share_bill: the link for this bill (created on first use) + the fixed bill number ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.share_bill(p_booking_id uuid, p_extra_ids uuid[] DEFAULT '{}')
 RETURNS TABLE(bill_number text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role   user_role := get_user_role();
  v_org    uuid      := get_user_org_id();
  b        record;
  v_multi  boolean;
  v_bill   boolean;
  v_ids    uuid[];
  v_visit  uuid;
  v_key    text;
  v_anchor uuid;
  v_number text;
  v_token  text;
  v_extra  uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_extra_ids, '{}')) x WHERE x IS NOT NULL AND x <> p_booking_id);
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'BILL_REFUSED: You cannot share this bill.' USING ERRCODE = 'PT403';
  END IF;
  SELECT id, branch_id, visit_id INTO b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_REFUSED: Could not find this booking.' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(o.multi_service_bookings, false), COALESCE(o.settings->>'billing_enabled', 'false') = 'true' INTO v_multi, v_bill FROM public.organizations o WHERE o.id = v_org;

  IF cardinality(v_extra) > 0 THEN                                   -- a checkout of several bookings: exactly that set
    v_ids := p_booking_id || v_extra;
  ELSIF v_multi AND NOT v_bill AND b.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.booking_id = p_booking_id) THEN
    v_visit := b.visit_id;                                           -- a visit: every row of it (also rows added later)
    v_ids := ARRAY(SELECT x.id FROM public.bookings x WHERE x.visit_id = b.visit_id);
  ELSE
    v_ids := ARRAY[p_booking_id];
  END IF;

  -- every booking must be the caller's org and (non-admin) branch
  IF (SELECT count(*) FROM public.bookings x JOIN public.branches br ON br.id = x.branch_id
       WHERE x.id = ANY (v_ids) AND br.org_id = v_org AND (v_role = 'admin' OR x.branch_id = ANY (get_user_branch_ids()))) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'BILL_REFUSED: You cannot share this bill.' USING ERRCODE = 'PT403';
  END IF;

  IF v_visit IS NOT NULL THEN
    v_number := public.fix_bill_number(p_booking_id, false);
    v_key := 'v:' || v_visit::text;
  ELSE
    SELECT x.id INTO v_anchor FROM public.bookings x WHERE x.id = ANY (v_ids) ORDER BY x.booking_number, x.id LIMIT 1;
    v_number := public.fix_bill_number(v_anchor, true);
    v_key := 'b:' || array_to_string(ARRAY(SELECT i::text FROM unnest(v_ids) i ORDER BY i::text), ',');
  END IF;

  SELECT l.token INTO v_token FROM public.bill_links l WHERE l.org_id = v_org AND l.unit_key = v_key AND l.active;
  IF v_token IS NULL THEN
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO public.bill_links (token, org_id, unit_key, visit_id, booking_ids, bill_number, fingerprint, created_by)
    VALUES (v_token, v_org, v_key, v_visit, v_ids, v_number, public._bill_fingerprint(v_ids), auth.uid())
    ON CONFLICT (org_id, unit_key) WHERE active DO NOTHING;
    SELECT l.token INTO v_token FROM public.bill_links l WHERE l.org_id = v_org AND l.unit_key = v_key AND l.active;
  END IF;
  RETURN QUERY SELECT v_number, v_token;
END;
$function$;
REVOKE ALL ON FUNCTION public.share_bill(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_bill(uuid, uuid[]) TO authenticated;

-- ── turn_off_bill_link: the old link stops working; sending again makes a new one ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.turn_off_bill_link(p_token text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role user_role := get_user_role(); v_org uuid := get_user_org_id(); l record;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'BILL_REFUSED: You cannot change this bill link.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO l FROM public.bill_links WHERE token = p_token AND org_id = v_org;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_role <> 'admin' AND NOT EXISTS (SELECT 1 FROM public.bookings x WHERE x.id = ANY (l.booking_ids) AND x.branch_id = ANY (get_user_branch_ids())) THEN
    RAISE EXCEPTION 'BILL_REFUSED: You cannot change this bill link.' USING ERRCODE = 'PT403';
  END IF;
  UPDATE public.bill_links SET active = false, turned_off_by = auth.uid(), turned_off_at = now() WHERE token = p_token AND active;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.turn_off_bill_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.turn_off_bill_link(text) TO authenticated;

-- ── get_public_bill: anon, one bill ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_bill(p_token text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  l record; v_ids uuid[]; v_fp text; v_first record; v_org record; v_branch record; v_inv jsonb; v_updated timestamptz;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT * INTO l FROM public.bill_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT o.name, o.logo_url, o.settings->>'billing_footer_text' AS footer INTO v_org FROM public.organizations o WHERE o.id = l.org_id;
  IF NOT l.active THEN RETURN jsonb_build_object('active', false, 'businessName', v_org.name); END IF;

  v_ids := CASE WHEN l.visit_id IS NOT NULL THEN ARRAY(SELECT x.id FROM public.bookings x WHERE x.visit_id = l.visit_id) ELSE l.booking_ids END;

  -- "Updated": the money changed since the last time anyone looked
  v_fp := public._bill_fingerprint(v_ids);
  IF v_fp <> l.fingerprint THEN
    UPDATE public.bill_links SET fingerprint = v_fp, updated_at = now() WHERE token = p_token;
    v_updated := now();
  ELSE v_updated := l.updated_at; END IF;

  SELECT b.customer_name, b.customer_phone, b.branch_id INTO v_first FROM public.bookings b WHERE b.id = ANY (v_ids) ORDER BY b.start_time, b.booking_number LIMIT 1;
  SELECT br.name, br.address, br.phone INTO v_branch FROM public.branches br WHERE br.id = v_first.branch_id;
  -- The frozen tax invoice only belongs to a bill of ONE booking (an invoiced booking is its own bill, as in share_bill). Only what the bill prints: no internal ids.
  IF cardinality(v_ids) = 1 THEN
    SELECT (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(to_jsonb(i)) e WHERE e.key !~ '(^id$|_id$|^issued_by$)') INTO v_inv FROM public.invoices i WHERE i.booking_id = v_ids[1];
    IF v_inv IS NOT NULL THEN v_inv := jsonb_set(v_inv, '{buyer_phone}', to_jsonb(public._bill_mask_phone(v_inv->>'buyer_phone'))); END IF;   -- masked on the public page too
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'billNumber', l.bill_number,
    'createdAt', l.created_at,
    'updatedAt', v_updated,
    'org', jsonb_build_object('name', v_org.name, 'logoUrl', v_org.logo_url, 'footer', COALESCE(v_org.footer, '')),
    'branch', jsonb_build_object('name', v_branch.name, 'address', v_branch.address, 'phone', v_branch.phone),
    'customer', jsonb_build_object('name', v_first.customer_name, 'phone', public._bill_mask_phone(v_first.customer_phone)),
    'invoice', v_inv,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'visitId', b.visit_id, 'bookingNumber', b.booking_number, 'date', b.date, 'startTime', b.start_time, 'endTime', b.end_time,
        'status', b.status, 'service', COALESCE(s.name, b.service_name_snapshot, 'Service'),
        'staff', public._bill_short_name(COALESCE(t.name, b.therapist_name_snapshot)),
        'base', COALESCE(b.base_amount, 0), 'discount', COALESCE(b.discount_amount, 0), 'final', COALESCE(b.final_amount, 0),
        'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('amount', p.amount, 'mode', p.payment_mode, 'at', p.created_at) ORDER BY p.created_at) FROM payments p WHERE p.booking_id = b.id), '[]'::jsonb),
        'refunds', COALESCE((SELECT jsonb_agg(jsonb_build_object('amount', r.amount, 'at', r.created_at) ORDER BY r.created_at) FROM payment_refunds r WHERE r.booking_id = b.id), '[]'::jsonb),
        'tip', COALESCE((SELECT sum(bt.amount) FROM booking_tips bt WHERE bt.booking_id = b.id), 0)
      ) ORDER BY b.start_time, b.booking_number)
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.id = ANY (v_ids)), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bookingId', ps.booking_id,
        'name', ps.product_name || CASE WHEN ps.variant_name IS NOT NULL THEN ' · ' || ps.variant_name ELSE '' END,
        'qty', ps.quantity, 'amount', ps.total_amount,
        'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('amount', x.amount, 'mode', x.payment_mode, 'at', x.created_at)) FROM product_sale_payments x WHERE x.sale_id = ps.id), '[]'::jsonb)))
      FROM product_sales ps WHERE ps.booking_id = ANY (v_ids) AND ps.refunded_at IS NULL), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_bill(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_bill(text) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name) VALUES ('436', 'bill-links') ON CONFLICT (version) DO NOTHING;
COMMIT;
