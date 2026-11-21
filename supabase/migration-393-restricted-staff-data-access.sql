-- migration-393-restricted-staff-data-access.sql  (ZNLY-235)
--
-- Restricted staff (users.calendar_visibility='own', can_view_customer_details=false,
-- can_view_prices=false) must not receive other people's rows, names, phones or money
-- from the API. Migration 322 limited the bookings ROWS; this closes the rest.
--
-- Design (lead-approved):
--  * ONE set of predicate functions is used by BOTH the RLS policies and the definer views,
--    so the views can never show a row RLS would hide (a definer view bypasses RLS).
--  * Normal roles (manager, admin, unrestricted staff, customers, anon) keep using the base
--    tables exactly as today: every new restrictive policy is true for them.
--  * A restricted login gets nothing from the sensitive base tables (where the restriction
--    applies) and reads through *_safe views, which filter rows and mask columns.
--  * No column REVOKE (it is role-wide). Writes a restricted login needs go through
--    SECURITY DEFINER RPCs (their UPDATE ... RETURNING would otherwise need SELECT visibility).

BEGIN;

-- ── Predicates (single source of truth) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caller_hides_details() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT u.role = 'staff' AND u.can_view_customer_details = false
                   FROM public.users u WHERE u.id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.caller_hides_prices() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT u.role = 'staff' AND u.can_view_prices = false
                   FROM public.users u WHERE u.id = auth.uid()), false);
$$;

-- Bookings the signed-in own-only login is on (junction OR legacy column). Same rule as 322.
CREATE OR REPLACE FUNCTION public.caller_own_booking_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.id FROM public.bookings b
  WHERE public.current_therapist_id() IS NOT NULL
    AND (b.therapist_id = public.current_therapist_id()
         OR EXISTS (SELECT 1 FROM public.booking_therapists bt
                    WHERE bt.booking_id = b.id AND bt.therapist_id = public.current_therapist_id()));
$$;

-- Bookings this caller may see at all: own-only logins -> their own; everyone else -> the
-- branch/org set payments already use (accessible_booking_ids).
CREATE OR REPLACE FUNCTION public.caller_visible_booking_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a FROM public.accessible_booking_ids() a
  WHERE NOT public.is_own_bookings_only()
     OR a IN (SELECT public.caller_own_booking_ids());
$$;

-- Masks (owner decision 2026-11-17): name = first name + last initial ("Sadin S."), a single word stays as is, never stars; phone = fixed width
-- first 2 digits + 5 dots + last 3 ("98•••••094"), no country code. Kept in step with src/services/dataMasking.js (vitest + harness assert the same literals).
CREATE OR REPLACE FUNCTION public.mask_person_name(n text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n IS NULL OR btrim(n) = '' THEN n
    WHEN array_length(regexp_split_to_array(btrim(n), '\s+'), 1) = 1 THEN btrim(n)
    ELSE (regexp_split_to_array(btrim(n), '\s+'))[1] || ' ' ||
         upper(left((regexp_split_to_array(btrim(n), '\s+'))[array_length(regexp_split_to_array(btrim(n), '\s+'), 1)], 1)) || '.'
  END;
$$;
CREATE OR REPLACE FUNCTION public.mask_phone_digits(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR p = '' THEN p
    WHEN length(regexp_replace(p, '\D', '', 'g')) < 5 THEN repeat('•', 10)
    ELSE left(right(regexp_replace(p, '\D', '', 'g'), 10), 2) || repeat('•', 5) || right(regexp_replace(p, '\D', '', 'g'), 3)
  END;
$$;

-- ── Bookings: rows (322 rewritten on the shared predicate) + no direct read when columns are hidden
DROP POLICY IF EXISTS "Own bookings only when restricted" ON public.bookings;
CREATE POLICY "Own bookings only when restricted" ON public.bookings AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_own_bookings_only()) OR id IN (SELECT public.caller_own_booking_ids()));

DROP POLICY IF EXISTS "Hidden columns read via bookings_safe" ON public.bookings;
CREATE POLICY "Hidden columns read via bookings_safe" ON public.bookings AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.caller_hides_details()) AND NOT (SELECT public.caller_hides_prices()));

-- ── Customers: own-only or no-details logins never read the base table.
DROP POLICY IF EXISTS "Restricted staff read customers via customers_safe" ON public.customers;
CREATE POLICY "Restricted staff read customers via customers_safe" ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_own_bookings_only()) AND NOT (SELECT public.caller_hides_details()));

-- ── Money tables: own-only -> only rows of own bookings; no-prices -> no direct read.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments','payment_refunds','booking_tips'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Restricted staff money rows" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Restricted staff money rows" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
      USING (NOT (SELECT public.caller_hides_prices())
             AND (NOT (SELECT public.is_own_bookings_only()) OR booking_id IN (SELECT public.caller_own_booking_ids())))$p$, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Restricted staff money rows" ON public.product_sales;
CREATE POLICY "Restricted staff money rows" ON public.product_sales AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.caller_hides_prices())
         AND (NOT (SELECT public.is_own_bookings_only()) OR booking_id IN (SELECT public.caller_own_booking_ids())));

DROP POLICY IF EXISTS "Restricted staff money rows" ON public.product_sale_payments;
CREATE POLICY "Restricted staff money rows" ON public.product_sale_payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.caller_hides_prices())
         AND (NOT (SELECT public.is_own_bookings_only())
              OR sale_id IN (SELECT ps.id FROM public.product_sales ps WHERE ps.booking_id IN (SELECT public.caller_own_booking_ids()))));

-- ── Safe views (definer: row filter via the shared predicates + masking) ───────────────
DROP VIEW IF EXISTS public.bookings_safe;
CREATE VIEW public.bookings_safe AS
SELECT
  b.id,
  b.booking_number,
  b.branch_id,
  b.room_id,
  b.service_id,
  b.therapist_id,
  CASE WHEN public.caller_hides_details() THEN public.mask_person_name(b.customer_name) ELSE b.customer_name END AS customer_name,
  CASE WHEN public.caller_hides_details() THEN NULL ELSE b.customer_email END AS customer_email,
  CASE WHEN public.caller_hides_details() THEN public.mask_phone_digits(b.customer_phone) ELSE b.customer_phone END AS customer_phone,
  b.customer_gender,
  b.date,
  b.start_time,
  b.end_time,
  b.start_datetime,
  b.end_datetime,
  b.status,
  b.special_requests,
  b.referred_by,
  b.payment_status,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE b.base_amount END AS base_amount,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE b.discount_amount END AS discount_amount,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE b.final_amount END AS final_amount,
  b.discount_status,
  b.discount_approved_by,
  b.discount_requested_by,
  b.discount_requested_to,
  b.discount_reason,
  b.service_name_snapshot,
  b.service_duration_snapshot,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE b.service_price_snapshot END AS service_price_snapshot,
  b.therapist_name_snapshot,
  b.room_name_snapshot,
  b.is_locked,
  b.booking_group_id,
  b.created_by,
  b.created_at,
  b.updated_at,
  b.customer_id,
  b.client_request_id,
  b.due_holder_name,
  b.referral_commission_type,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE b.referral_commission_value END AS referral_commission_value,
  b.customer_account_id,
  b.referral_source,
  b.referral_source_detail,
  b.cancellation_reason,
  CASE WHEN public.caller_hides_details() THEN public.mask_person_name(b.companion_name) ELSE b.companion_name END AS companion_name,
  CASE WHEN public.caller_hides_details() THEN public.mask_phone_digits(b.companion_phone) ELSE b.companion_phone END AS companion_phone,
  b.service_category_snapshot,
  b.gender_preference,
  b.acknowledged_at,
  b.acknowledged_by,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE b.member_discount END AS member_discount,
  b.availability_override_reason
FROM public.bookings b
WHERE b.id IN (SELECT public.caller_visible_booking_ids());

DROP VIEW IF EXISTS public.customers_safe;
CREATE VIEW public.customers_safe AS
SELECT c.id, c.branch_id,
  CASE WHEN public.caller_hides_details() THEN public.mask_person_name(c.full_name) ELSE c.full_name END AS full_name,
  CASE WHEN public.caller_hides_details() THEN public.mask_phone_digits(c.phone) ELSE c.phone END AS phone,
  CASE WHEN public.caller_hides_details() THEN NULL ELSE c.email END AS email,
  CASE WHEN public.caller_hides_details() THEN NULL ELSE c.notes END AS notes,
  c.is_active, c.created_at, c.org_id, c.gender,
  CASE WHEN public.caller_hides_details() THEN NULL ELSE c.date_of_birth END AS date_of_birth,
  c.client_source, c.referred_by, c.preferred_language, c.country, c.occupation,
  CASE WHEN public.caller_hides_details() THEN NULL ELSE c.additional_email END AS additional_email,
  CASE WHEN public.caller_hides_details() THEN NULL ELSE c.additional_phone END AS additional_phone,
  c.pronouns, c.tags
FROM public.customers c
WHERE c.org_id = (SELECT public.get_user_org_id())
  AND (NOT public.is_own_bookings_only()
       OR c.id IN (SELECT b.customer_id FROM public.bookings b WHERE b.id IN (SELECT public.caller_own_booking_ids())));

DROP VIEW IF EXISTS public.payments_safe;
CREATE VIEW public.payments_safe AS
SELECT p.id, p.booking_id, CASE WHEN public.caller_hides_prices() THEN NULL ELSE p.amount END AS amount,
       p.payment_mode, p.recorded_by, p.notes, p.created_at
FROM public.payments p WHERE p.booking_id IN (SELECT public.caller_visible_booking_ids());

DROP VIEW IF EXISTS public.payment_refunds_safe;
CREATE VIEW public.payment_refunds_safe AS
SELECT r.id, r.booking_id, r.org_id, CASE WHEN public.caller_hides_prices() THEN NULL ELSE r.amount END AS amount,
       r.refunded_by, r.reason, r.created_at
FROM public.payment_refunds r WHERE r.booking_id IN (SELECT public.caller_visible_booking_ids());

DROP VIEW IF EXISTS public.booking_tips_safe;
CREATE VIEW public.booking_tips_safe AS
SELECT t.id, t.booking_id, t.amount, t.recorded_by, t.notes, t.created_at, t.distributed_at, t.distributed_by, t.received_by
FROM public.booking_tips t WHERE t.booking_id IN (SELECT public.caller_visible_booking_ids());
-- (tips: a restricted person may see the tips on their own bookings: lead rule "earnings except their own commission and tips")

DROP VIEW IF EXISTS public.product_sales_safe;
CREATE VIEW public.product_sales_safe AS
SELECT s.id, s.org_id, s.branch_id, s.product_id, s.product_name, s.quantity,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE s.unit_price_npr END AS unit_price_npr,
  CASE WHEN public.caller_hides_prices() THEN NULL ELSE s.total_amount END AS total_amount,
  s.payment_mode, s.customer_id, s.sold_by, s.notes, s.created_at, s.refunded_at, s.refunded_by, s.refund_reason,
  s.variant_id, s.variant_name, s.booking_id, s.sold_by_therapist_id
FROM public.product_sales s
WHERE s.org_id = (SELECT public.get_user_org_id())
  AND (NOT public.is_own_bookings_only() OR s.booking_id IN (SELECT public.caller_own_booking_ids()));

REVOKE ALL ON public.bookings_safe, public.customers_safe, public.payments_safe, public.payment_refunds_safe,
              public.booking_tips_safe, public.product_sales_safe FROM PUBLIC, anon;
GRANT SELECT ON public.bookings_safe, public.customers_safe, public.payments_safe, public.payment_refunds_safe,
                public.booking_tips_safe, public.product_sales_safe TO authenticated;

-- ── Notifications: rows are per recipient but the text carries customer names and amounts. Restricted logins read a masked view,
-- cannot read the base table, and mark-read goes through RPCs (UPDATE ... WHERE needs SELECT visibility).
DROP POLICY IF EXISTS "Restricted staff read notifications via notifications_safe" ON public.notifications;
CREATE POLICY "Restricted staff read notifications via notifications_safe" ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.caller_hides_details()) AND NOT (SELECT public.caller_hides_prices()));

CREATE OR REPLACE FUNCTION public.mask_notification_text(t text, p_booking_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE nm text; r text := t;
BEGIN
  IF t IS NULL THEN RETURN t; END IF;
  IF public.caller_hides_details() THEN
    SELECT customer_name INTO nm FROM public.bookings WHERE id = p_booking_id;
    IF nm IS NOT NULL AND btrim(nm) <> '' THEN r := replace(r, nm, public.mask_person_name(nm)); END IF;
    r := regexp_replace(r, '(\+?\d[\d ()-]{8,}\d)', '', 'g');   -- any phone number in the text
  END IF;
  IF public.caller_hides_prices() THEN
    r := regexp_replace(r, '\s*\(?\s*(NPR|Rs\.?)\s?[0-9][0-9,.]*[^)·.]*\)?', '', 'gi');
  END IF;
  r := regexp_replace(regexp_replace(r, '(\s*·\s*){2,}', ' · ', 'g'), '(\s*·\s*)+$', '');  -- tidy separators left by the removals
  RETURN r;
END $$;
-- Called from the view, so it runs with the caller's EXECUTE right. It only ever returns the input text with a booking's own name masked.
REVOKE ALL ON FUNCTION public.mask_notification_text(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mask_notification_text(text, uuid) TO authenticated;

DROP VIEW IF EXISTS public.notifications_safe;
CREATE VIEW public.notifications_safe AS
SELECT n.id, n.user_id, n.type,
  public.mask_notification_text(n.title, n.booking_id) AS title,
  public.mask_notification_text(n.body, n.booking_id) AS body,
  n.booking_id, n.read, n.created_at, n.branch_id, n.category, n.actor_id
FROM public.notifications n WHERE n.user_id = auth.uid();


REVOKE ALL ON public.notifications_safe FROM PUBLIC, anon;
GRANT SELECT ON public.notifications_safe TO authenticated;

CREATE OR REPLACE FUNCTION public.restricted_mark_notifications_read(p_id uuid DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.notifications SET read = true WHERE user_id = auth.uid() AND read = false AND (p_id IS NULL OR id = p_id);
$$;
REVOKE ALL ON FUNCTION public.restricted_mark_notifications_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restricted_mark_notifications_read(uuid) TO authenticated;

-- ── Writes for restricted logins (their UPDATE ... RETURNING cannot read the base row) ──
CREATE OR REPLACE FUNCTION public.restricted_set_booking_status(p_booking_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR p_booking_id NOT IN (SELECT public.caller_visible_booking_ids()) THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT status::text INTO v_status FROM public.bookings WHERE id = p_booking_id;
  IF p_status IN ('Cancelled','No Show') AND coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.bookings
     SET status = p_status::booking_status,
         cancellation_reason = CASE WHEN p_status IN ('Cancelled','No Show') THEN p_reason ELSE cancellation_reason END
   WHERE id = p_booking_id;
  RETURN jsonb_build_object('id', p_booking_id, 'status', p_status, 'previous', v_status);
END $$;
REVOKE ALL ON FUNCTION public.restricted_set_booking_status(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restricted_set_booking_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restricted_set_booking_notes(p_booking_id uuid, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR p_booking_id NOT IN (SELECT public.caller_visible_booking_ids()) THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id AND (is_locked OR status::text IN ('Completed','Cancelled','No Show'))) THEN
    RAISE EXCEPTION 'This booking can no longer be changed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.bookings SET special_requests = nullif(btrim(p_notes), '') WHERE id = p_booking_id;
END $$;
REVOKE ALL ON FUNCTION public.restricted_set_booking_notes(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restricted_set_booking_notes(uuid,text) TO authenticated;

-- ── get_dashboard (definer RPC): it returns customer names ("Name · Service" labels, my_day.bookings[].customer) and, on the floor view,
-- every therapist's blocks. Wrap it: the original body is kept as _get_dashboard_unmasked (not callable by clients) and the public
-- get_dashboard masks the result for restricted callers. A later CREATE OR REPLACE of get_dashboard would drop this wrapper:
-- supabase/tests/znly-235.sql asserts the masking so that cannot happen silently.
DROP FUNCTION IF EXISTS public.mask_dashboard_label(text);
CREATE OR REPLACE FUNCTION public.mask_dashboard_label(l text, tail text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN l IS NULL THEN l
              WHEN position(' · ' in l) > 0 THEN public.mask_person_name(split_part(l, ' · ', 1)) || coalesce(' · ' || tail, '') || substr(l, position(' · ' in l))
              ELSE public.mask_person_name(l) || coalesce(' · ' || tail, '') END;
$$;

-- Last 3 digits of a booking's phone, so two "Sita S." can be told apart ("Sita S. · 094"). NULL when there is no phone.
CREATE OR REPLACE FUNCTION public.booking_phone_tail(p_booking_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT nullif(right(regexp_replace(coalesce(b.customer_phone, ''), '\D', '', 'g'), 3), '') FROM public.bookings b WHERE b.id = p_booking_id;
$$;
REVOKE ALL ON FUNCTION public.booking_phone_tail(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restrict_dashboard_json(j jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE own_only boolean := public.is_own_bookings_only(); hide boolean := public.caller_hides_details(); me uuid := public.current_therapist_id();
BEGIN
  IF j IS NULL OR NOT (own_only OR hide) THEN RETURN j; END IF;
  IF jsonb_typeof(j->'floor') = 'array' THEN
    j := jsonb_set(j, '{floor}', coalesce((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(f->'therapists') = 'array' THEN jsonb_set(f, '{therapists}', coalesce((
        SELECT jsonb_agg(CASE WHEN jsonb_typeof(t->'blocks') = 'array' THEN jsonb_set(t, '{blocks}', coalesce((
          SELECT jsonb_agg(CASE WHEN hide OR (own_only AND (t->>'therapist_id')::uuid IS DISTINCT FROM me)
                                THEN jsonb_set(b, '{label}', to_jsonb(public.mask_dashboard_label(b->>'label', public.booking_phone_tail(nullif(b->>'booking_id','')::uuid)))) ELSE b END ORDER BY bo)
          FROM jsonb_array_elements(t->'blocks') WITH ORDINALITY bb(b, bo)), '[]'::jsonb)) ELSE t END ORDER BY tord)
        FROM jsonb_array_elements(f->'therapists') WITH ORDINALITY tt(t, tord)), '[]'::jsonb)) ELSE f END ORDER BY ford)
      FROM jsonb_array_elements(j->'floor') WITH ORDINALITY ff(f, ford)), '[]'::jsonb));
  END IF;
  IF hide AND jsonb_typeof(j#>'{my_day,bookings}') = 'array' THEN
    j := jsonb_set(j, '{my_day,bookings}', coalesce((
      SELECT jsonb_agg(CASE WHEN b ? 'customer' THEN jsonb_set(jsonb_set(b, '{customer}', to_jsonb(public.mask_person_name(b->>'customer'))), '{customer_tail}', coalesce(to_jsonb(public.booking_phone_tail(nullif(b->>'id','')::uuid)), 'null'::jsonb)) ELSE b END ORDER BY bo)
      FROM jsonb_array_elements(j#>'{my_day,bookings}') WITH ORDINALITY bb(b, bo)), '[]'::jsonb));
  END IF;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.restrict_dashboard_json(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restrict_dashboard_json(jsonb) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public._get_dashboard_unmasked(uuid[],date)') IS NULL THEN
    ALTER FUNCTION public.get_dashboard(uuid[], date) RENAME TO _get_dashboard_unmasked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._get_dashboard_unmasked(uuid[], date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard(p_branch_ids uuid[], p_date date DEFAULT NULL::date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.restrict_dashboard_json(public._get_dashboard_unmasked(p_branch_ids, p_date));
$$;
REVOKE ALL ON FUNCTION public.get_dashboard(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard(uuid[], date) TO authenticated;

INSERT INTO public.schema_migrations (version, name) VALUES ('393', 'restricted-staff-data-access')
ON CONFLICT (version) DO NOTHING;
COMMIT;
