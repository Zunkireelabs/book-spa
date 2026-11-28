-- Migration 430 (ZNLY-402, piece 5): booking-level, all-or-nothing server functions (contract: temp_ss/piece5-contract.md)
--
-- Why: a "booking" can hold several service rows (bookings.visit_id, migration 427; per-org switch multi_service_bookings, migration 428). Until now every
-- change to such a booking was a loop of single-row calls from the browser, so a refusal on row 2 left row 1 already changed. These seven functions do
-- the whole booking in ONE transaction and take p_dry_run: true = run the real change, collect a verdict per row, then roll everything back.
--
--   visit_create(p_branch_id, p_customer, p_services, p_override_reason, p_dry_run)
--   visit_update(p_visit_key, p_changes, p_override_reason, p_dry_run)
--   visit_set_status(p_visit_key, p_status, p_reason, p_dry_run)            Cancelled | No Show, untouched rows only
--   visit_remove_service(p_booking_id, p_reason, p_dry_run)                 one row; verdict 'last' when it is the only active row
--   visit_reschedule(p_visit_key, p_date, p_start_time, p_dry_run, p_override_reason, p_reason)
--   visit_apply_discount(p_visit_key, p_lines, p_reason, p_dry_run, p_requested_to)
--   visit_set_staff(p_visit_key, p_lines, p_notes, p_dry_run, p_override_reason)
--
-- HOW the checks stay identical to today: nothing is re-implemented that a trigger already enforces. Each row is written with a normal INSERT/UPDATE (or
-- reschedule_booking, migration 429), so the existing triggers decide: staff availability / override (361), same-staff overlap per org allow_staff_overlap
-- (424), room capacity, day lock + immutability (392), tier price, no-future-status, midnight. A trigger refusal ("CODE: plain text") is caught per row
-- and becomes that row's verdict. After the last row: any 'warn'/'block' (or p_dry_run) raises the private sentinel VD001, which rolls back every row
-- of this call (a sub-transaction), and the function returns ok=false / the dry-run preview as normal jsonb. Nothing is half done.
-- What the triggers do NOT cover is ported here once, as the single rule for multi-service bookings: the discount rules (api.js applyDiscount, 4076) and
-- the status rules (VALID_TRANSITIONS).
--
-- Verdicts: 'change' (will change / changed), 'keep' (left alone, with the reason), 'warn' (a manager/admin may override with a reason: OFF_SHIFT,
-- ON_BREAK, BLOCKED, OTHER_BRANCH), 'block' (hard stop: today's hard rules), 'last' (visit_remove_service only).
-- Same scoping as reschedule_booking: SECURITY DEFINER, search_path set, role staff/manager/admin, caller's org, non-admin = own branches, own-only
-- logins only see their own bookings. Anon has no access. Returns jsonb: { ok, dry_run, error:{code,message}|null, rows:[...], totals:{...} }.
-- A combo booking (booking_combo_items) or a row with extra staff (booking_therapists > 1) is refused with COMBO_USE_SINGLE_EDIT / MULTI_STAFF_USE_SINGLE_EDIT;
-- the api.js wrapper then routes that booking to today's single-booking path, so editing is never worse than before.
--
-- Idempotent (CREATE OR REPLACE). Reversible: DROP FUNCTION public.visit_*(...) and public._visit_*(...). No data is changed by the migration itself.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── private helpers (not callable by clients) ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- What a role may direct-apply as a discount. MUST equal src/services/discountLimits.js DISCOUNT_LIMITS (a unit test reads this file and compares).
CREATE OR REPLACE FUNCTION public._visit_discount_limit(p_role user_role)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT CASE p_role::text WHEN 'staff' THEN 0.50 WHEN 'manager' THEN 1.00 WHEN 'admin' THEN 1.00 ELSE 0 END $$;

-- Hard ceiling of what may even be REQUESTED (api.js STAFF_REQUEST_CEILING 0.50 for staff, role limit for manager/admin).
CREATE OR REPLACE FUNCTION public._visit_discount_ceiling(p_role user_role)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT CASE p_role::text WHEN 'staff' THEN 0.50 WHEN 'manager' THEN 1.00 WHEN 'admin' THEN 1.00 ELSE 0 END $$;

-- Sentinel error code used to roll a call back after its verdicts are collected.
-- (SQLSTATE 'VD001': custom, never raised by the app's own triggers.)

-- Turns a caught error into { code, message, overridable } with NO SQL text. Triggers raise "CODE: plain sentence".
CREATE OR REPLACE FUNCTION public._visit_classify(p_state text, p_msg text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_code text := substring(p_msg from '^([A-Z][A-Z0-9_]{2,}):');
  v_text text;
  v_role user_role := public.get_user_role();
BEGIN
  IF v_code IS NOT NULL THEN
    v_text := btrim(regexp_replace(p_msg, '^[A-Z][A-Z0-9_]*:\s*', ''));
    RETURN jsonb_build_object('code', v_code, 'message', v_text,
      'overridable', (p_state = 'PT409' AND v_code IN ('OFF_SHIFT','ON_BREAK','BLOCKED','OTHER_BRANCH') AND v_role IN ('manager','admin')));
  END IF;
  IF p_state = '23P01' THEN
    RETURN jsonb_build_object('code', 'THERAPIST_CONFLICT', 'message', 'That staff member is already booked during this time.', 'overridable', false);
  END IF;
  IF p_state = 'P0003' THEN
    RETURN jsonb_build_object('code', 'SCHEDULING_CONFLICT', 'message', 'This time conflicts with an existing booking.', 'overridable', false);
  END IF;
  -- "function_name: plain sentence" refusals written by our own functions
  IF p_msg ~ '^[a-z_]+: ' THEN
    RETURN jsonb_build_object('code', 'REFUSED', 'message', btrim(regexp_replace(p_msg, '^[a-z_]+:\s*', '')), 'overridable', false);
  END IF;
  RETURN jsonb_build_object('code', 'SAVE_FAILED', 'message', 'This change could not be saved. Nothing was changed.', 'overridable', false);
END $$;

CREATE OR REPLACE FUNCTION public._visit_row_json(p_id uuid, p_number text, p_service text, p_start time, p_staff text, p_verdict text, p_reason text)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT jsonb_build_object('booking_id', p_id, 'booking_number', p_number, 'service', p_service,
                                'start', to_char(p_start, 'HH24:MI'), 'staff', p_staff, 'verdict', p_verdict, 'reason', p_reason) $$;

CREATE OR REPLACE FUNCTION public._visit_result(p_rows jsonb, p_error jsonb, p_dry boolean, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'ok', p_error IS NULL, 'dry_run', COALESCE(p_dry, false), 'error', p_error,
    'code', p_error->>'code', 'message', p_error->>'message',
    'verdict', CASE WHEN jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) = 1 THEN p_rows->0->>'verdict' END,
    'rows', COALESCE(p_rows, '[]'::jsonb),
    'totals', jsonb_build_object(
      'rows',   jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)),
      'change', (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e WHERE e->>'verdict' = 'change'),
      'keep',   (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e WHERE e->>'verdict' = 'keep'),
      'warn',   (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e WHERE e->>'verdict' = 'warn'),
      'block',  (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e WHERE e->>'verdict' = 'block'),
      'last',   (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e WHERE e->>'verdict' = 'last')
    ) || COALESCE(p_extra, '{}'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public._visit_refuse(p_code text, p_message text, p_dry boolean DEFAULT false, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT public._visit_result(p_rows, jsonb_build_object('code', p_code, 'message', p_message), p_dry) $$;

-- The caller must be staff / manager / admin (same rule as reschedule_booking).
CREATE OR REPLACE FUNCTION public._visit_assert_caller()
 RETURNS user_role LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_role user_role := public.get_user_role();
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED: Staff, manager or admin sign-in required.' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_role;
END $$;

CREATE OR REPLACE FUNCTION public._visit_caller_ok()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT auth.uid() IS NOT NULL AND public.get_user_role() IN ('staff', 'manager', 'admin') $$;

-- The rows of one booking, locked FOR UPDATE, ordered by time. p_key is a visit_id OR a booking id:
--   a booking id whose visit_id is NULL  -> just that row (an OFF org's booking is the single row)
--   a booking id whose visit_id is set   -> every row of that visit
--   an uuid that is no booking id        -> treated as the visit_id
-- Scoped like reschedule_booking: caller's org, non-admins only their branches, own-only logins only their own bookings.
CREATE OR REPLACE FUNCTION public._visit_rows(p_key uuid)
 RETURNS SETOF public.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_role  user_role := public._visit_assert_caller();
  v_org   uuid := public.get_user_org_id();
  v_vid   uuid;
  v_found boolean := false;
BEGIN
  SELECT b.visit_id, true INTO v_vid, v_found FROM public.bookings b WHERE b.id = p_key;
  IF NOT COALESCE(v_found, false) THEN v_vid := p_key; END IF;
  RETURN QUERY
    SELECT b.* FROM public.bookings b
      JOIN public.branches br ON br.id = b.branch_id
     WHERE br.org_id = v_org
       AND (v_role = 'admin' OR b.branch_id = ANY (public.get_user_branch_ids()))
       AND (NOT public.is_own_bookings_only() OR b.id IN (SELECT public.caller_visible_booking_ids()))
       AND ((COALESCE(v_found, false) AND v_vid IS NULL AND b.id = p_key) OR (v_vid IS NOT NULL AND b.visit_id = v_vid))
     ORDER BY b.start_datetime, b.booking_number
       FOR UPDATE OF b;
END $$;

-- Untouched = still safe to change as a whole: waiting or confirmed, nothing paid, day not closed.
-- (Started / done / cancelled rows and paid rows are "touched": they stay.)
CREATE OR REPLACE FUNCTION public._visit_touched_reason(b public.bookings)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN b.status::text = 'In-Progress'          THEN 'Already started'
    WHEN b.status::text = 'Completed'            THEN 'Already done'
    WHEN b.status::text = 'Cancelled'            THEN 'Already cancelled'
    WHEN b.status::text = 'No Show'              THEN 'Already marked no-show'
    WHEN b.payment_status IN ('paid', 'partial') THEN 'Already paid: use Correct as admin'
    ELSE NULL END
$$;

-- Inserts ONE service row (same fields createBooking writes for the desk). p_ctx = customer/shared fields, p_svc = the service line.
-- Triggers do all the availability / overlap / room / price-snapshot / number work. Rooms: an explicit room_id is used as given; none given =
-- the first active room that accepts the row (the capacity trigger decides), unless the industry has no rooms; room_id 'none' = no room.
CREATE OR REPLACE FUNCTION public._visit_insert_row(p_branch uuid, p_ctx jsonb, p_svc jsonb, p_visit_id uuid, p_group_id uuid, p_override text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id        uuid := gen_random_uuid();
  v_svc       record;
  v_tids      uuid[] := ARRAY[]::uuid[];
  v_tid       uuid;
  v_room_in   text := NULLIF(btrim(COALESCE(p_svc->>'room_id', '')), '');
  v_rooms_on  boolean;
  v_room      uuid;
  v_base      numeric;
  v_override  text := NULLIF(btrim(COALESCE(p_svc->>'override_reason', p_override, '')), '');
  v_try       uuid;
  v_done      boolean := false;
  v_last_err  text; v_last_state text;
BEGIN
  SELECT s.id, s.org_id, s.effective_price_npr, s.price_type, s.is_couple, s.is_combo, s.name
    INTO v_svc FROM public.services_with_offer_pricing s WHERE s.id = (p_svc->>'service_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_NOT_IN_BUSINESS: This service is not offered by this business.'; END IF;
  PERFORM public._visit_assert_service(p_branch, v_svc.id);
  IF v_svc.is_combo THEN
    RAISE EXCEPTION 'COMBO_USE_SINGLE_EDIT: % is a combo service and is booked on its own.', v_svc.name;
  END IF;
  IF p_group_id IS NOT NULL AND v_svc.is_couple THEN
    RAISE EXCEPTION 'COUPLE_SERVICE_NOT_ALLOWED_IN_GROUP: % is a couple service and cannot be one of several services in a group.', v_svc.name;
  END IF;

  IF p_svc ? 'therapist_ids' AND jsonb_typeof(p_svc->'therapist_ids') = 'array' THEN
    SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_tids FROM jsonb_array_elements_text(p_svc->'therapist_ids') x WHERE NULLIF(x, '') IS NOT NULL;
  ELSIF NULLIF(p_svc->>'therapist_id', '') IS NOT NULL THEN
    v_tids := ARRAY[(p_svc->>'therapist_id')::uuid];
  END IF;
  v_tid := v_tids[1];
  FOREACH v_try IN ARRAY v_tids LOOP
    PERFORM public._visit_assert_staff(p_branch, v_try, ((p_svc->>'date')::date + (p_svc->>'start_time')::time) AT TIME ZONE 'Asia/Kathmandu');
  END LOOP;

  v_base := v_svc.effective_price_npr;
  IF v_svc.price_type = 'tiered' AND v_tid IS NOT NULL THEN
    v_base := COALESCE(public.service_price_for_therapist(v_svc.id, v_tid), v_base);
  END IF;

  SELECT COALESCE(i.enable_rooms, true) INTO v_rooms_on
    FROM public.branches br JOIN public.organizations o ON o.id = br.org_id LEFT JOIN public.industries i ON i.id = o.industry_type
   WHERE br.id = p_branch;
  v_rooms_on := COALESCE(v_rooms_on, true);

  FOR v_try IN
    SELECT x FROM (
      SELECT CASE WHEN NOT v_rooms_on OR v_room_in = 'none' THEN NULL
                  WHEN v_room_in IS NOT NULL THEN v_room_in::uuid END AS x, 0 AS ord
      UNION ALL
      SELECT r.id, 1 + row_number() OVER (ORDER BY r.name) FROM public.rooms r
       WHERE v_rooms_on AND v_room_in IS NULL AND r.branch_id = p_branch AND r.is_active
    ) q
    WHERE (v_room_in IS NOT NULL OR NOT v_rooms_on OR q.ord > 0)
      AND NOT (v_room_in IS NULL AND v_rooms_on AND q.ord = 0)
    ORDER BY q.ord
  LOOP
    IF v_try IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = v_try AND r.branch_id = p_branch AND r.is_active) THEN
      RAISE EXCEPTION 'INVALID_ROOM: Selected room is not available at this location.';
    END IF;
    BEGIN
      INSERT INTO public.bookings (
        id, branch_id, room_id, service_id, therapist_id, customer_id, customer_name, customer_email, customer_phone, customer_gender,
        is_walk_in, walk_in_label, special_requests, referred_by, referral_source, referral_source_detail, customer_account_id,
        gender_preference, companion_name, companion_phone,
        date, start_time, base_amount, discount_amount, created_by, booking_group_id, visit_id, availability_override_reason)
      VALUES (
        v_id, p_branch, v_try, v_svc.id, v_tid,
        NULLIF(p_ctx->>'customer_id', '')::uuid, COALESCE(NULLIF(p_ctx->>'customer_name', ''), 'Walk-in'),
        NULLIF(p_ctx->>'customer_email', ''), NULLIF(p_ctx->>'customer_phone', ''), NULLIF(p_ctx->>'customer_gender', ''),
        COALESCE((p_ctx->>'is_walk_in')::boolean, false), NULLIF(p_ctx->>'walk_in_label', ''),
        NULLIF(p_ctx->>'special_requests', ''), NULLIF(p_ctx->>'referred_by', ''), NULLIF(p_ctx->>'referral_source', ''),
        NULLIF(p_ctx->>'referral_source_detail', ''), NULLIF(p_ctx->>'customer_account_id', '')::uuid,
        NULLIF(p_ctx->>'gender_preference', ''), NULLIF(p_ctx->>'companion_name', ''), NULLIF(p_ctx->>'companion_phone', ''),
        (p_svc->>'date')::date, (p_svc->>'start_time')::time, v_base, 0, auth.uid(), p_group_id, p_visit_id, v_override);
      v_done := true;
      EXIT;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_last_err = MESSAGE_TEXT;
      v_last_state := SQLSTATE;
      -- an explicit room (or no room) is final; an auto-pick moves on to the next room only when THIS room is the problem
      IF v_room_in IS NOT NULL OR NOT v_rooms_on OR v_last_err NOT LIKE 'ROOM_AT_CAPACITY%' THEN
        RAISE EXCEPTION '%', v_last_err USING ERRCODE = v_last_state;
      END IF;
    END;
  END LOOP;
  IF NOT v_done THEN
    RAISE EXCEPTION 'ROOMS_FULL: No room is free at this time.' USING ERRCODE = 'P0003';
  END IF;

  -- companions (the primary's junction row is written by trg_sync_booking_therapists_from_booking)
  IF array_length(v_tids, 1) > 1 THEN
    INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time, availability_override_reason)
    SELECT v_id, t, b.start_time, b.end_time, v_override FROM unnest(v_tids[2:]) t, public.bookings b WHERE b.id = v_id
    ON CONFLICT (booking_id, therapist_id) DO NOTHING;
  END IF;
  -- the reason authorises THIS insert only; never leave it on the row
  UPDATE public.bookings SET availability_override_reason = NULL WHERE id = v_id AND availability_override_reason IS NOT NULL;
  UPDATE public.booking_therapists SET availability_override_reason = NULL WHERE booking_id = v_id AND availability_override_reason IS NOT NULL;
  RETURN v_id;
END $$;

-- Rewrites the junction row of a single-staff row after its staff / room / time / service changed (assignTherapist + updateBookingDetails do the same).
CREATE OR REPLACE FUNCTION public._visit_sync_junction(p_booking_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.booking_therapists WHERE booking_id = p_booking_id;
  INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time, room_id)
  SELECT b.id, b.therapist_id, b.start_time, b.end_time, b.room_id FROM public.bookings b WHERE b.id = p_booking_id AND b.therapist_id IS NOT NULL;
END $$;

-- SECURITY: the visit_* functions bypass RLS (SECURITY DEFINER), so every id the caller passes is checked here, explicitly, against the caller's
-- own business. A service must belong to the branch's org, be switched on, and be offered at this branch (same rules as the screens / createBooking:
-- branch_service_links "no rows anywhere = offered everywhere, rows but none for this branch = restricted elsewhere", and the branch's excluded
-- service categories). Plain codes: SERVICE_NOT_IN_BUSINESS / SERVICE_NOT_AVAILABLE / SERVICE_NOT_AT_BRANCH.
CREATE OR REPLACE FUNCTION public._visit_assert_service(p_branch uuid, p_service uuid)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org uuid; v_excl text[]; sv record;
BEGIN
  SELECT br.org_id, br.excluded_service_categories INTO v_org, v_excl FROM public.branches br WHERE br.id = p_branch;
  SELECT s.org_id, s.is_active, s.category INTO sv FROM public.services s WHERE s.id = p_service;
  IF NOT FOUND OR v_org IS NULL OR sv.org_id IS DISTINCT FROM v_org OR v_org IS DISTINCT FROM public.get_user_org_id() THEN
    RAISE EXCEPTION 'SERVICE_NOT_IN_BUSINESS: This service is not offered by this business.';
  END IF;
  IF NOT COALESCE(sv.is_active, true) THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE: This service is switched off.';
  END IF;
  IF sv.category IS NOT NULL AND sv.category = ANY (COALESCE(v_excl, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'SERVICE_NOT_AT_BRANCH: This service is not offered at this location.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.branch_service_links l WHERE l.service_id = p_service)
     AND NOT EXISTS (SELECT 1 FROM public.branch_service_links l WHERE l.service_id = p_service AND l.branch_id = p_branch) THEN
    RAISE EXCEPTION 'SERVICE_NOT_AT_BRANCH: This service is not offered at this location.';
  END IF;
END $$;

-- A staff member must belong to the caller's business, be active, and work at the booking's branch: their home branch, or a transfer window
-- (staff_transfers) that has them there at that time (the same rule the staff picker uses). STAFF_NOT_IN_BUSINESS / THERAPIST_INACTIVE / STAFF_NOT_IN_BRANCH.
CREATE OR REPLACE FUNCTION public._visit_assert_staff(p_branch uuid, p_therapist uuid, p_at timestamptz)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t record;
BEGIN
  IF p_therapist IS NULL THEN RETURN; END IF;
  SELECT x.org_id, x.branch_id, x.is_active INTO t FROM public.therapists x WHERE x.id = p_therapist;
  IF NOT FOUND OR t.org_id IS DISTINCT FROM public.get_user_org_id() THEN
    RAISE EXCEPTION 'STAFF_NOT_IN_BUSINESS: This staff member does not work for this business.';
  END IF;
  IF NOT COALESCE(t.is_active, true) THEN
    RAISE EXCEPTION 'THERAPIST_INACTIVE: That staff member is no longer active.';
  END IF;
  IF t.branch_id IS DISTINCT FROM p_branch
     AND NOT EXISTS (SELECT 1 FROM public._staff_transfer_windows(ARRAY[p_therapist]) w
                      WHERE w.to_branch_id = p_branch AND w.ws <= COALESCE(p_at, now()) AND COALESCE(p_at, now()) < w.we) THEN
    RAISE EXCEPTION 'STAFF_NOT_IN_BRANCH: This staff member does not work at this location.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._visit_discount_limit(user_role), public._visit_discount_ceiling(user_role), public._visit_classify(text, text),
  public._visit_row_json(uuid, text, text, time, text, text, text), public._visit_result(jsonb, jsonb, boolean, jsonb),
  public._visit_refuse(text, text, boolean, jsonb), public._visit_assert_caller(), public._visit_caller_ok(), public._visit_rows(uuid),
  public._visit_touched_reason(public.bookings), public._visit_insert_row(uuid, jsonb, jsonb, uuid, uuid, text),
  public._visit_sync_junction(uuid), public._visit_assert_service(uuid, uuid), public._visit_assert_staff(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 1. visit_create ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_customer: { customer_id?, name, phone, email, gender, is_walk_in?, walk_in_label?, special_requests?, referred_by?, referral_source?,
--               referral_source_detail?, gender_preference? }   (phone already in E.164: the api.js wrapper normalises it)
-- p_services: [{ service_id, date, start_time, therapist_id? | therapist_ids?[], room_id? ('none' = no room), override_reason? }]  one row each.
-- Rows get ONE visit_id when the org has multi_service_bookings ON and there are 2+ services; OFF org with 2+ services = one booking_group_id (as today).
CREATE OR REPLACE FUNCTION public.visit_create(p_branch_id uuid, p_customer jsonb, p_services jsonb, p_override_reason text DEFAULT NULL, p_dry_run boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_role   user_role;
  v_org    uuid;
  v_multi  boolean;
  v_n      int := COALESCE(jsonb_array_length(p_services), 0);
  v_vid    uuid;
  v_gid    uuid;
  v_ctx    jsonb := COALESCE(p_customer, '{}'::jsonb);
  v_cid    uuid;
  v_walk   boolean := COALESCE((p_customer->>'is_walk_in')::boolean, false);
  v_phone  text := NULLIF(btrim(COALESCE(p_customer->>'phone', '')), '');
  v_rows   jsonb := '[]'::jsonb;
  v_err    jsonb := NULL;
  v_cls    jsonb;
  v_i      int := 0;
  s        jsonb;
  v_new    uuid;
  b        record;
  v_verdict text;
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  v_role := public.get_user_role();
  SELECT br.org_id, COALESCE(o.multi_service_bookings, false) INTO v_org, v_multi
    FROM public.branches br JOIN public.organizations o ON o.id = br.org_id WHERE br.id = p_branch_id;
  IF v_org IS DISTINCT FROM public.get_user_org_id() OR (v_role <> 'admin' AND NOT (p_branch_id = ANY (public.get_user_branch_ids()))) THEN
    RETURN public._visit_refuse('NOT_ALLOWED', 'This location is not one of yours.', p_dry_run);
  END IF;
  IF v_n = 0 THEN RETURN public._visit_refuse('NO_SERVICES', 'Select at least one service.', p_dry_run); END IF;

  IF v_n > 1 THEN
    IF v_multi THEN v_vid := gen_random_uuid(); ELSE v_gid := gen_random_uuid(); END IF;
  END IF;

  BEGIN
    IF NULLIF(p_customer->>'customer_account_id', '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.customer_accounts ca WHERE ca.id = (p_customer->>'customer_account_id')::uuid AND ca.org_id = v_org) THEN
      RAISE EXCEPTION 'CUSTOMER_NOT_IN_BUSINESS: This customer does not belong to this business.';
    END IF;
    -- the customer: a known profile, or find/create by phone (same rules as createBooking); a walk-in has none
    IF NOT v_walk THEN
      v_cid := NULLIF(p_customer->>'customer_id', '')::uuid;
      IF v_cid IS NOT NULL THEN
        SELECT c.full_name, c.phone, c.email INTO b FROM public.customers c WHERE c.id = v_cid AND c.org_id = v_org;
        IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_IN_BUSINESS: This customer does not belong to this business.'; END IF;
        v_ctx := v_ctx || jsonb_build_object('customer_name', b.full_name, 'customer_phone', b.phone, 'customer_email', b.email);
      ELSE
        IF v_phone IS NULL AND COALESCE((SELECT o.require_customer_phone FROM public.organizations o WHERE o.id = v_org), true) THEN
          RAISE EXCEPTION 'PHONE_REQUIRED: Phone number is required.';
        END IF;
        IF NULLIF(btrim(COALESCE(p_customer->>'name', '')), '') IS NULL THEN
          RAISE EXCEPTION 'NAME_REQUIRED: Customer name is required.';
        END IF;
        SELECT f.id INTO v_cid FROM public.find_customer_for_booking(v_org, v_phone, NULLIF(lower(btrim(COALESCE(p_customer->>'email', ''))), '')) f;
        IF v_cid IS NOT NULL THEN
          UPDATE public.customers SET full_name = btrim(p_customer->>'name'), phone = COALESCE(v_phone, phone),
                 email = COALESCE(NULLIF(lower(btrim(COALESCE(p_customer->>'email', ''))), ''), email)
           WHERE id = v_cid;
        ELSE
          v_cid := public.create_customer_for_booking(v_org, p_branch_id, p_customer->>'name', v_phone, p_customer->>'email', p_customer->>'gender');
        END IF;
        v_ctx := v_ctx || jsonb_build_object('customer_name', btrim(p_customer->>'name'), 'customer_phone', v_phone);
      END IF;
      v_ctx := v_ctx || jsonb_build_object('customer_id', v_cid);
    ELSE
      v_ctx := v_ctx || jsonb_build_object('customer_name', CASE WHEN NULLIF(btrim(COALESCE(p_customer->>'walk_in_label', '')), '') IS NULL
                                                                  THEN 'Walk-in' ELSE 'Walk-in · ' || btrim(p_customer->>'walk_in_label') END,
                                           'customer_id', NULL, 'customer_phone', NULL, 'customer_email', NULL);
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(p_services) LOOP
      v_i := v_i + 1;
      BEGIN
        v_new := public._visit_insert_row(p_branch_id, v_ctx || jsonb_build_object('customer_gender', p_customer->>'gender'), s, v_vid, v_gid, p_override_reason);
        SELECT * INTO b FROM public.bookings WHERE id = v_new;
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'change', NULL);
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_verdict := CASE WHEN (v_cls->>'overridable')::boolean AND NULLIF(btrim(COALESCE(s->>'override_reason', p_override_reason, '')), '') IS NULL THEN 'warn' ELSE 'block' END;
        v_rows := v_rows || public._visit_row_json(NULL, NULL, (SELECT name FROM public.services WHERE id = NULLIF(s->>'service_id', '')::uuid),
                                                   NULLIF(s->>'start_time', '')::time, NULL, v_verdict, v_cls->>'message');
        IF v_err IS NULL THEN
          v_err := jsonb_build_object('code', CASE WHEN v_verdict = 'warn' THEN 'NEEDS_OVERRIDE' ELSE v_cls->>'code' END,
                                      'message', v_cls->>'message', 'row', v_i - 1, 'underlying_code', v_cls->>'code');
        END IF;
      END;
    END LOOP;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_create: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  RETURN public._visit_result(v_rows, v_err, p_dry_run, jsonb_build_object('visit_id', v_vid, 'booking_group_id', v_gid));
END $$;

-- ── 2. visit_update ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_changes: {
--   special_requests?, referred_by?,                       applied to every row that can still change (not terminal / not a closed day)
--   customer?: { name?, phone?, walk_in_label? },          same rules as updateBookingDetails (re-links customer_id when the phone changes)
--   services: [ { booking_id, service_id?, therapist_id?, room_id?, date?, start_time? }       change one row (omitted key = unchanged)
--             | { booking_id, remove: true, reason }                                            remove one row (rule: cancelled with reason, kept in history)
--             | { service_id, date, start_time, therapist_id?, room_id? } ]                     add a row (no booking_id)
-- }
-- A started / done / paid row refuses a service/staff/room/time change (plain reason). Combo or multi-staff rows: COMBO_USE_SINGLE_EDIT / MULTI_STAFF_USE_SINGLE_EDIT.
CREATE OR REPLACE FUNCTION public.visit_update(p_visit_key uuid, p_changes jsonb, p_override_reason text DEFAULT NULL, p_dry_run boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_role     user_role;
  v_rows     jsonb := '[]'::jsonb;
  v_err      jsonb := NULL;
  v_cls      jsonb;
  v_verdict  text;
  v_vid      uuid;
  v_first    public.bookings;
  v_changes  int := 0;
  b          public.bookings;
  nb         public.bookings;
  s          jsonb;
  v_ov       text;
  v_reason   text;
  v_touch    text;
  v_change   boolean;
  v_cust     jsonb := p_changes->'customer';
  v_new      uuid;
  v_nphone   text;
  v_cid      uuid;
  v_org      uuid;
  v_active   int;
  v_multi    boolean;
  v_multi_diff boolean := false;
  v_dir      numeric := 0;
  v_rid      uuid;
  v_set_notes boolean := p_changes ? 'special_requests';
  v_set_ref   boolean := p_changes ? 'referred_by';
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  v_role := public.get_user_role();
  BEGIN
    SELECT * INTO v_first FROM public._visit_rows(p_visit_key) LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking not found.'; END IF;
    SELECT br.org_id, COALESCE(o.multi_service_bookings, false) INTO v_org, v_multi
      FROM public.branches br JOIN public.organizations o ON o.id = br.org_id WHERE br.id = v_first.branch_id;
    v_vid := v_first.visit_id;

    -- 1. changes to existing rows (listed rows only), then removals, then adds
    -- direction of the first listed time change: moving later is processed last-row-first (earlier first when moving earlier), so a row
    -- never lands on its sibling's OLD slot (same staff, org rule OFF) although the final state is fine
    SELECT COALESCE(sign(extract(epoch FROM ((COALESCE(NULLIF(COALESCE(e->>'date', p_changes->>'date'), '')::date, x.date) + COALESCE(NULLIF(e->>'start_time', '')::time, x.start_time))
                                              - (x.date + x.start_time)))), 0) INTO v_dir
      FROM jsonb_array_elements(COALESCE(p_changes->'services', '[]'::jsonb)) e JOIN public.bookings x ON x.id::text = e->>'booking_id'
     WHERE NULLIF(e->>'start_time', '') IS NOT NULL ORDER BY x.start_datetime LIMIT 1;
    v_dir := COALESCE(v_dir, 0);
    FOR b IN SELECT * FROM public._visit_rows(p_visit_key) x ORDER BY CASE WHEN v_dir > 0 THEN -extract(epoch FROM x.start_datetime) ELSE extract(epoch FROM x.start_datetime) END LOOP
      s := (SELECT e FROM jsonb_array_elements(COALESCE(p_changes->'services', '[]'::jsonb)) e WHERE e->>'booking_id' = b.id::text LIMIT 1);
      v_multi_diff := false;
      IF s IS NOT NULL THEN
        -- screen shape: therapist_ids[] (first = primary), a visit-level date, remove_reason
        IF s ? 'therapist_ids' AND jsonb_typeof(s->'therapist_ids') = 'array' THEN
          s := s || jsonb_build_object('therapist_id', s->'therapist_ids'->0);
          v_multi_diff := jsonb_array_length(s->'therapist_ids') > 1
            AND (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(s->'therapist_ids') x)
                IS DISTINCT FROM (SELECT array_agg(bt.therapist_id::text ORDER BY bt.therapist_id::text) FROM public.booking_therapists bt WHERE bt.booking_id = b.id);
        END IF;
        IF p_changes ? 'date' AND NOT (s ? 'date') AND NULLIF(p_changes->>'date', '') IS NOT NULL THEN s := s || jsonb_build_object('date', p_changes->'date'); END IF;
        IF s ? 'remove_reason' AND NOT (s ? 'reason') THEN s := s || jsonb_build_object('reason', s->'remove_reason'); END IF;
      END IF;
      v_touch := public._visit_touched_reason(b);
      v_ov := COALESCE(NULLIF(btrim(COALESCE(s->>'override_reason', p_override_reason, '')), ''), NULL);
      v_change := false; v_reason := NULL; v_verdict := 'keep';
      BEGIN
        IF s IS NOT NULL AND COALESCE((s->>'remove')::boolean, false) THEN
          IF v_touch IS NOT NULL THEN RAISE EXCEPTION 'BOOKING_IMMUTABLE: %', v_touch; END IF;
          IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;
          IF NOT p_dry_run AND NULLIF(btrim(COALESCE(s->>'reason', '')), '') IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED: A reason is required to remove a service.'; END IF;
          SELECT count(*) INTO v_active FROM public.bookings x
           WHERE x.id <> b.id AND ((b.visit_id IS NOT NULL AND x.visit_id = b.visit_id) OR (b.visit_id IS NULL AND false))
             AND x.status::text NOT IN ('Cancelled', 'No Show');
          IF v_active = 0 THEN RAISE EXCEPTION 'LAST_SERVICE: This is the only service. Cancel the whole booking instead.'; END IF;
          UPDATE public.bookings SET status = 'Cancelled', cancellation_reason = NULLIF(btrim(COALESCE(s->>'reason', '')), '') WHERE id = b.id;
          v_verdict := 'change'; v_reason := 'Removed'; v_changes := v_changes + 1;
        ELSE
          -- a row is "changed" only when a listed field actually differs
          IF s IS NOT NULL AND (
               (NULLIF(s->>'service_id', '') IS NOT NULL AND (s->>'service_id')::uuid IS DISTINCT FROM b.service_id)
            OR (s ? 'therapist_id' AND NULLIF(s->>'therapist_id', '')::uuid IS DISTINCT FROM b.therapist_id)
            OR (s ? 'room_id' AND CASE WHEN s->>'room_id' IN ('', 'none') THEN NULL ELSE (s->>'room_id')::uuid END IS DISTINCT FROM b.room_id)
            OR (NULLIF(s->>'date', '') IS NOT NULL AND (s->>'date')::date IS DISTINCT FROM b.date)
            OR (NULLIF(s->>'start_time', '') IS NOT NULL AND (s->>'start_time')::time IS DISTINCT FROM b.start_time)
            OR v_multi_diff) THEN
            IF v_touch IS NOT NULL THEN RAISE EXCEPTION 'BOOKING_IMMUTABLE: %', v_touch; END IF;
            IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;
            IF EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = b.id) THEN
              RAISE EXCEPTION 'COMBO_USE_SINGLE_EDIT: This is a combo booking, edited on its own.'; END IF;
            IF (SELECT count(*) FROM public.booking_therapists bt WHERE bt.booking_id = b.id) > 1 THEN
              RAISE EXCEPTION 'MULTI_STAFF_USE_SINGLE_EDIT: This service has more than one staff member, edited on its own.'; END IF;
            IF NULLIF(s->>'service_id', '') IS NOT NULL AND (s->>'service_id')::uuid IS DISTINCT FROM b.service_id THEN
              PERFORM public._visit_assert_service(b.branch_id, (s->>'service_id')::uuid);
            END IF;
            IF s ? 'therapist_id' AND NULLIF(s->>'therapist_id', '')::uuid IS DISTINCT FROM b.therapist_id THEN
              PERFORM public._visit_assert_staff(b.branch_id, NULLIF(s->>'therapist_id', '')::uuid,
                        (COALESCE(NULLIF(COALESCE(s->>'date', p_changes->>'date'), '')::date, b.date) + COALESCE(NULLIF(s->>'start_time', '')::time, b.start_time)) AT TIME ZONE 'Asia/Kathmandu');
            END IF;
            IF s ? 'room_id' THEN
              v_rid := CASE WHEN COALESCE(s->>'room_id', '') IN ('', 'none') THEN NULL ELSE (s->>'room_id')::uuid END;
              IF v_rid IS NOT NULL AND v_rid IS DISTINCT FROM b.room_id
                 AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = v_rid AND r.branch_id = b.branch_id AND r.is_active) THEN
                RAISE EXCEPTION 'INVALID_ROOM: Selected room is not available at this location.';
              END IF;
            END IF;
            UPDATE public.bookings SET
                   service_id = COALESCE(NULLIF(s->>'service_id', '')::uuid, service_id),
                   therapist_id = CASE WHEN s ? 'therapist_id' THEN NULLIF(s->>'therapist_id', '')::uuid ELSE therapist_id END,
                   room_id = CASE WHEN s ? 'room_id' THEN CASE WHEN s->>'room_id' IN ('', 'none') THEN NULL ELSE (s->>'room_id')::uuid END ELSE room_id END,
                   date = COALESCE(NULLIF(s->>'date', '')::date, date),
                   start_time = COALESCE(NULLIF(s->>'start_time', '')::time, start_time),
                   availability_override_reason = v_ov
             WHERE id = b.id;
            -- a new service carries its own price (offer price; tiered = the assigned staff member's tier); a discount never exceeds it
            IF NULLIF(s->>'service_id', '') IS NOT NULL AND (s->>'service_id')::uuid IS DISTINCT FROM b.service_id THEN
              UPDATE public.bookings bk SET
                     base_amount = CASE WHEN sv.price_type = 'tiered' AND bk.therapist_id IS NOT NULL
                                        THEN COALESCE(public.service_price_for_therapist(sv.id, bk.therapist_id), sv.effective_price_npr)
                                        ELSE sv.effective_price_npr END
                FROM public.services_with_offer_pricing sv WHERE bk.id = b.id AND sv.id = bk.service_id;
              UPDATE public.bookings SET discount_amount = LEAST(discount_amount, base_amount) WHERE id = b.id;
            END IF;
            PERFORM public._visit_sync_junction(b.id);
            UPDATE public.bookings SET availability_override_reason = NULL WHERE id = b.id AND availability_override_reason IS NOT NULL;
            v_change := true; v_verdict := 'change'; v_changes := v_changes + 1;
          END IF;

          -- shared notes / referral: every row that can still change
          IF (v_set_notes OR v_set_ref) AND b.status::text NOT IN ('Completed', 'Cancelled', 'No Show') AND NOT b.is_locked THEN
            UPDATE public.bookings SET
                   special_requests = CASE WHEN v_set_notes THEN NULLIF(btrim(COALESCE(p_changes->>'special_requests', '')), '') ELSE special_requests END,
                   referred_by = CASE WHEN v_set_ref THEN NULLIF(btrim(COALESCE(p_changes->>'referred_by', '')), '') ELSE referred_by END
             WHERE id = b.id AND (special_requests, referred_by) IS DISTINCT FROM (
                   CASE WHEN v_set_notes THEN NULLIF(btrim(COALESCE(p_changes->>'special_requests', '')), '') ELSE special_requests END,
                   CASE WHEN v_set_ref THEN NULLIF(btrim(COALESCE(p_changes->>'referred_by', '')), '') ELSE referred_by END);
            IF FOUND AND NOT v_change THEN v_verdict := 'change'; v_reason := 'Notes updated'; v_changes := v_changes + 1; END IF;
          END IF;

          -- customer: same rules as updateBookingDetails (walk-in without a client only has a label)
          IF v_cust IS NOT NULL AND b.status::text NOT IN ('Completed', 'Cancelled', 'No Show') AND NOT b.is_locked THEN
            IF b.is_walk_in AND b.customer_id IS NULL THEN
              IF v_cust ? 'walk_in_label' THEN
                UPDATE public.bookings SET walk_in_label = NULLIF(btrim(COALESCE(v_cust->>'walk_in_label', '')), ''),
                       customer_name = CASE WHEN NULLIF(btrim(COALESCE(v_cust->>'walk_in_label', '')), '') IS NULL THEN 'Walk-in'
                                            ELSE 'Walk-in · ' || btrim(v_cust->>'walk_in_label') END WHERE id = b.id;
                IF NOT v_change THEN v_verdict := 'change'; v_reason := 'Customer updated'; v_changes := v_changes + 1; END IF;
              END IF;
            ELSE
              v_nphone := NULLIF(btrim(COALESCE(v_cust->>'phone', '')), '');
              IF NULLIF(btrim(COALESCE(v_cust->>'name', '')), '') IS NOT NULL THEN
                UPDATE public.bookings SET customer_name = btrim(v_cust->>'name') WHERE id = b.id;
              END IF;
              IF v_cust ? 'phone' THEN
                UPDATE public.bookings SET customer_phone = v_nphone WHERE id = b.id;
                IF v_nphone IS NOT NULL THEN
                  SELECT f.id INTO v_cid FROM public.find_customer_for_booking(v_org, v_nphone, NULL) f;
                  IF v_cid IS NOT NULL THEN
                    IF NULLIF(btrim(COALESCE(v_cust->>'name', '')), '') IS NOT NULL THEN
                      UPDATE public.customers SET full_name = btrim(v_cust->>'name') WHERE id = v_cid;
                    END IF;
                  ELSE
                    v_cid := public.create_customer_for_booking(v_org, b.branch_id, COALESCE(NULLIF(btrim(COALESCE(v_cust->>'name', '')), ''), b.customer_name), v_nphone, NULL, NULL);
                  END IF;
                  IF v_cid IS NOT NULL THEN UPDATE public.bookings SET customer_id = v_cid WHERE id = b.id; END IF;
                END IF;
              END IF;
              IF NOT v_change AND v_verdict = 'keep' THEN v_verdict := 'change'; v_reason := 'Customer updated'; v_changes := v_changes + 1; END IF;
            END IF;
          END IF;

          IF v_verdict = 'keep' THEN v_reason := COALESCE(v_touch, 'Unchanged'); END IF;
        END IF;
        SELECT * INTO nb FROM public.bookings WHERE id = b.id;
        v_rows := v_rows || public._visit_row_json(nb.id, nb.booking_number, nb.service_name_snapshot, nb.start_time, nb.therapist_name_snapshot, v_verdict, v_reason);
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_verdict := CASE WHEN (v_cls->>'overridable')::boolean AND v_ov IS NULL THEN 'warn' ELSE 'block' END;
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, v_verdict, v_cls->>'message');
        IF v_err IS NULL THEN
          v_err := jsonb_build_object('code', CASE WHEN v_verdict = 'warn' THEN 'NEEDS_OVERRIDE' ELSE v_cls->>'code' END,
                                      'message', v_cls->>'message', 'booking_id', b.id, 'underlying_code', v_cls->>'code');
        END IF;
      END;
    END LOOP;

    -- 2. added services (the rows carry the visit's customer; an ON org's single booking becomes a visit on its first add)
    FOR s IN SELECT e FROM jsonb_array_elements(COALESCE(p_changes->'services', '[]'::jsonb)) e WHERE NULLIF(e->>'booking_id', '') IS NULL AND NOT COALESCE((e->>'remove')::boolean, false) LOOP
      BEGIN
        IF v_vid IS NULL THEN
          IF NOT v_multi THEN RAISE EXCEPTION 'ADD_NOT_ALLOWED: Several services in one booking is not switched on for this business.'; END IF;
          v_vid := gen_random_uuid();
          UPDATE public.bookings SET visit_id = v_vid WHERE id = (SELECT id FROM public._visit_rows(p_visit_key) LIMIT 1) AND visit_id IS NULL;
        END IF;
        v_ov := NULLIF(btrim(COALESCE(s->>'override_reason', p_override_reason, '')), '');
        v_new := public._visit_insert_row(v_first.branch_id,
                   to_jsonb(v_first) || jsonb_build_object('customer_name', v_first.customer_name, 'customer_phone', v_first.customer_phone, 'customer_gender', v_first.customer_gender),
                   s, v_vid, NULL, p_override_reason);
        SELECT * INTO nb FROM public.bookings WHERE id = v_new;
        v_rows := v_rows || public._visit_row_json(nb.id, nb.booking_number, nb.service_name_snapshot, nb.start_time, nb.therapist_name_snapshot, 'change', 'Added');
        v_changes := v_changes + 1;
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_verdict := CASE WHEN (v_cls->>'overridable')::boolean AND v_ov IS NULL THEN 'warn' ELSE 'block' END;
        v_rows := v_rows || public._visit_row_json(NULL, NULL, (SELECT name FROM public.services WHERE id = NULLIF(s->>'service_id', '')::uuid),
                                                   NULLIF(s->>'start_time', '')::time, NULL, v_verdict, v_cls->>'message');
        IF v_err IS NULL THEN
          v_err := jsonb_build_object('code', CASE WHEN v_verdict = 'warn' THEN 'NEEDS_OVERRIDE' ELSE v_cls->>'code' END,
                                      'message', v_cls->>'message', 'underlying_code', v_cls->>'code');
        END IF;
      END;
    END LOOP;

    IF v_err IS NULL AND v_changes = 0 THEN
      v_err := jsonb_build_object('code', 'NOTHING_TO_CHANGE', 'message', 'Nothing was changed.');
    END IF;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_update: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  SELECT COALESCE(jsonb_agg(e ORDER BY e->>'start', e->>'booking_number'), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) e;
  RETURN public._visit_result(v_rows, v_err, p_dry_run);
END $$;

-- ── 3. visit_set_status ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visit_set_status(p_visit_key uuid, p_status text, p_reason text, p_dry_run boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb; v_err jsonb := NULL; v_cls jsonb; v_changed int := 0; v_found boolean := false;
  b public.bookings; v_touch text;
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  IF p_status NOT IN ('Cancelled', 'No Show') THEN
    RETURN public._visit_refuse('INVALID_STATUS', 'A booking can be cancelled or marked as no-show here.', p_dry_run);
  END IF;
  BEGIN
    FOR b IN SELECT * FROM public._visit_rows(p_visit_key) LOOP
      v_found := true;
      v_touch := public._visit_touched_reason(b);
      IF v_touch IS NOT NULL THEN
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'keep', v_touch);
        CONTINUE;
      END IF;
      BEGIN
        IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;
        -- the reason is required on the real call only: a preview (p_dry_run) changes nothing and needs none
        IF NOT p_dry_run AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
          RAISE EXCEPTION 'REASON_REQUIRED: A reason is required when cancelling or marking a booking as no-show.';
        END IF;
        UPDATE public.bookings SET status = p_status::booking_status, cancellation_reason = NULLIF(btrim(COALESCE(p_reason, '')), '') WHERE id = b.id;
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'change', NULL);
        v_changed := v_changed + 1;
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'block', v_cls->>'message');
        IF v_err IS NULL THEN v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message', 'booking_id', b.id); END IF;
      END;
    END LOOP;
    IF NOT v_found THEN v_err := jsonb_build_object('code', 'BOOKING_NOT_FOUND', 'message', 'Booking not found.'); END IF;
    IF v_err IS NULL AND v_changed = 0 THEN
      v_err := jsonb_build_object('code', 'NOTHING_TO_CHANGE', 'message', 'Every service here has already started, finished or been paid, so nothing could be changed.');
    END IF;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_set_status: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  RETURN public._visit_result(v_rows, v_err, p_dry_run);
END $$;

-- ── 4. visit_remove_service ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visit_remove_service(p_booking_id uuid, p_reason text, p_dry_run boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb; v_err jsonb := NULL; v_cls jsonb; b public.bookings; v_touch text; v_active int;
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  BEGIN
    SELECT * INTO b FROM public._visit_rows(p_booking_id) x WHERE x.id = p_booking_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking not found.'; END IF;
    v_touch := public._visit_touched_reason(b);
    IF v_touch IS NOT NULL THEN
      v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'block', v_touch);
      v_err := jsonb_build_object('code', 'BOOKING_IMMUTABLE', 'message', v_touch, 'booking_id', b.id);
    ELSIF b.is_locked THEN
      v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'block', 'This day has been closed. No further modifications allowed.');
      v_err := jsonb_build_object('code', 'DAY_LOCKED', 'message', 'This day has been closed. No further modifications allowed.', 'booking_id', b.id);
    ELSIF NOT p_dry_run AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
      v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'block', 'A reason is required.');
      v_err := jsonb_build_object('code', 'REASON_REQUIRED', 'message', 'A reason is required to remove a service.', 'booking_id', b.id);
    ELSE
      SELECT count(*) INTO v_active FROM public.bookings x
       WHERE x.id <> b.id AND b.visit_id IS NOT NULL AND x.visit_id = b.visit_id AND x.status::text NOT IN ('Cancelled', 'No Show');
      IF v_active = 0 THEN
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'last', 'This is the only service. Cancel the whole booking instead.');
        v_err := jsonb_build_object('code', 'LAST_SERVICE', 'message', 'This is the only service. Cancel the whole booking instead.', 'booking_id', b.id);
      ELSE
        UPDATE public.bookings SET status = 'Cancelled', cancellation_reason = NULLIF(btrim(COALESCE(p_reason, '')), '') WHERE id = b.id;
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'change', NULL);
      END IF;
    END IF;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_remove_service: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  RETURN public._visit_result(v_rows, v_err, p_dry_run);
END $$;

-- ── 5. visit_reschedule ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Moves every untouched row to p_date, the first untouched row starting at p_start_time and the others keeping their offset from it (staff and room kept).
-- Each row goes through reschedule_booking (migration 429): original cancelled with p_reason, a Pending copy created carrying visit_id and a new number,
-- exactly as a single reschedule does today. Started / done / paid rows stay put ('keep').
CREATE OR REPLACE FUNCTION public.visit_reschedule(p_visit_key uuid, p_date date, p_start_time time, p_dry_run boolean DEFAULT false,
                                                   p_override_reason text DEFAULT NULL, p_reason text DEFAULT 'Rescheduled')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb; v_err jsonb := NULL; v_cls jsonb; v_verdict text; v_moved int := 0;
  b public.bookings; v_touch text; v_first timestamptz; v_new_start time; v_delta interval; v_res jsonb; v_ov text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
  v_new_dt timestamptz; v_ids uuid[]; v_id uuid;
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  IF p_date IS NULL OR p_start_time IS NULL THEN
    RETURN public._visit_refuse('INVALID_TIME', 'Pick a date and a start time.', p_dry_run);
  END IF;
  BEGIN
    SELECT min(x.start_datetime) INTO v_first FROM public._visit_rows(p_visit_key) x WHERE public._visit_touched_reason(x) IS NULL;
    IF v_first IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public._visit_rows(p_visit_key)) THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking not found.'; END IF;
      v_err := jsonb_build_object('code', 'NOTHING_TO_CHANGE', 'message', 'Every service here has already started, finished or been paid, so nothing can be moved.');
    END IF;
    -- shift = (new first start) - (old first start), in Nepal local time; moving later is processed last-row-first so a row never lands on its sibling's old slot
    v_new_dt := (p_date + p_start_time) AT TIME ZONE 'Asia/Kathmandu';
    v_delta := v_new_dt - v_first;
    FOR b IN SELECT * FROM public._visit_rows(p_visit_key) x ORDER BY CASE WHEN v_delta > interval '0' THEN -extract(epoch FROM x.start_datetime) ELSE extract(epoch FROM x.start_datetime) END LOOP
      v_touch := public._visit_touched_reason(b);
      IF v_touch IS NOT NULL THEN
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'keep', v_touch);
        CONTINUE;
      END IF;
      v_new_start := ((b.start_datetime + v_delta) AT TIME ZONE 'Asia/Kathmandu')::time;
      BEGIN
        IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;
        IF EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = b.id) THEN
          RAISE EXCEPTION 'COMBO_USE_SINGLE_EDIT: This is a combo booking, moved on its own.'; END IF;
        v_new_start := ((b.start_datetime + v_delta) AT TIME ZONE 'Asia/Kathmandu')::time;
        v_res := public.reschedule_booking(b.id, ((b.start_datetime + v_delta) AT TIME ZONE 'Asia/Kathmandu')::date, v_new_start,
                                           b.therapist_id, b.room_id, COALESCE(p_reason, 'Rescheduled'), v_ov);
        -- booking_id stays the ORIGINAL row (so a preview can be matched to what the screen shows); the replacement is new_booking_id
        v_rows := v_rows || (public._visit_row_json(b.id, v_res->>'booking_number', b.service_name_snapshot, v_new_start, b.therapist_name_snapshot, 'change', NULL)
                             || jsonb_build_object('new_booking_id', (v_res->>'id')::uuid));
        v_moved := v_moved + 1;
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_verdict := CASE WHEN (v_cls->>'overridable')::boolean AND v_ov IS NULL THEN 'warn' ELSE 'block' END;
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, COALESCE(v_new_start, b.start_time), b.therapist_name_snapshot, v_verdict, v_cls->>'message');
        IF v_err IS NULL THEN
          v_err := jsonb_build_object('code', CASE WHEN v_verdict = 'warn' THEN 'NEEDS_OVERRIDE' ELSE v_cls->>'code' END,
                                      'message', v_cls->>'message', 'booking_id', b.id, 'underlying_code', v_cls->>'code');
        END IF;
      END;
    END LOOP;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_reschedule: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  -- rows were appended in processing order; hand them back in time order
  SELECT COALESCE(jsonb_agg(e ORDER BY e->>'start', e->>'booking_number'), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) e;
  RETURN public._visit_result(v_rows, v_err, p_dry_run);
END $$;

-- ── 6. visit_apply_discount ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_lines: [{ booking_id, type: '%' | 'NPR', value }]. value 0 / blank = clear that row's discount. Whole rupees. When every line is the same % (a
-- whole-booking discount) the rows are rounded so they add up to the exact total: any remainder lands on the last row.
-- Rules ported from api.js applyDiscount (single source for multi-service bookings): a reason is required (not when clearing); not on a closed day,
-- a cancelled / no-show or paid row; never below what is already paid; role ceiling; within the role's direct limit the discount is applied (approved),
-- above it (per line OR for the whole booking) it becomes a request to p_requested_to (APPROVER_REQUIRED when none). A 100% approved discount is
-- settled at once with a zero 'No Charge' payment, as today. Payments themselves are never touched otherwise.
CREATE OR REPLACE FUNCTION public.visit_apply_discount(p_visit_key uuid, p_lines jsonb, p_reason text, p_dry_run boolean DEFAULT false, p_requested_to uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_role user_role; v_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb; v_err jsonb := NULL; v_cls jsonb; v_changed int := 0;
  l jsonb; b public.bookings; v_type text; v_val numeric; v_amt numeric; v_pct numeric; v_paid numeric; v_clear boolean;
  v_limit numeric; v_ceiling numeric; v_total_base numeric := 0; v_total_amt numeric := 0; v_total_over boolean; v_over boolean;
  v_n int := COALESCE(jsonb_array_length(p_lines), 0); v_i int := 0; v_same boolean; v_prev_amt numeric := 0; v_whole_total numeric;
  v_status discount_status_enum; v_new_pay text; v_settle boolean; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_amts numeric[] := ARRAY[]::numeric[]; v_bases numeric[] := ARRAY[]::numeric[]; v_ids uuid[] := ARRAY[]::uuid[];
  v_idx int;
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  v_role := public.get_user_role();
  v_limit := public._visit_discount_limit(v_role); v_ceiling := public._visit_discount_ceiling(v_role);
  IF v_n = 0 THEN RETURN public._visit_refuse('NO_LINES', 'Nothing to apply.', p_dry_run); END IF;
  BEGIN
    -- pass 1: amount per line (whole rupees) and the booking-level totals
    FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      SELECT x.* INTO b FROM public._visit_rows(p_visit_key) x WHERE x.id = (l->>'booking_id')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND: A line does not belong to this booking.'; END IF;
      v_type := COALESCE(l->>'type', '%'); v_val := COALESCE(NULLIF(l->>'value', '')::numeric, 0);
      IF v_type NOT IN ('%', 'NPR') THEN RAISE EXCEPTION 'INVALID_DISCOUNT_TYPE: Discount type must be percent or rupees.'; END IF;
      v_ids := v_ids || b.id; v_bases := v_bases || b.base_amount;
      v_amts := v_amts || CASE WHEN v_val <= 0 THEN 0 WHEN v_type = '%' THEN round(b.base_amount * v_val / 100) ELSE round(v_val) END;
    END LOOP;
    SELECT bool_and((e->>'type') = '%' AND (e->>'value') = (p_lines->0->>'value') AND COALESCE(NULLIF(e->>'value', '')::numeric, 0) > 0)
      INTO v_same FROM jsonb_array_elements(p_lines) e;
    IF v_n >= 2 AND COALESCE(v_same, false) THEN
      -- whole-booking %: the total is rounded once, the remainder goes on the last row
      SELECT round(sum(x) * (p_lines->0->>'value')::numeric / 100) INTO v_whole_total FROM unnest(v_bases) x;
      v_amts[v_n] := v_whole_total - (SELECT COALESCE(sum(a), 0) FROM unnest(v_amts[1:v_n - 1]) a);
    END IF;
    SELECT COALESCE(sum(x), 0) INTO v_total_base FROM unnest(v_bases) x;
    SELECT COALESCE(sum(x), 0) INTO v_total_amt FROM unnest(v_amts) x;
    v_total_over := v_total_base > 0 AND (v_total_amt / v_total_base) > v_limit + 1e-9;

    -- pass 2: apply each line
    FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      v_i := v_i + 1;
      SELECT x.* INTO b FROM public._visit_rows(p_visit_key) x WHERE x.id = (l->>'booking_id')::uuid;
      v_amt := v_amts[v_i]; v_clear := v_amt = 0;
      BEGIN
        IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;
        IF b.status::text IN ('Cancelled', 'No Show') THEN RAISE EXCEPTION 'BOOKING_IMMUTABLE: % bookings cannot be modified.', b.status; END IF;
        IF b.payment_status = 'paid' THEN RAISE EXCEPTION 'BOOKING_IMMUTABLE: Cannot modify discount on a paid booking.'; END IF;
        SELECT COALESCE(sum(p.amount), 0) INTO v_paid FROM public.payments p WHERE p.booking_id = b.id;
        IF v_clear THEN
          IF b.discount_amount = 0 AND b.discount_status::text IN ('none') THEN
            v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'keep', 'No discount to remove');
          ELSE
            UPDATE public.bookings SET discount_amount = 0, discount_reason = 'Discount cancelled', member_discount = NULL,
                   discount_status = CASE WHEN discount_status::text = 'pending' THEN 'none'::discount_status_enum ELSE discount_status END,
                   discount_requested_by = CASE WHEN discount_status::text = 'pending' THEN NULL ELSE discount_requested_by END,
                   discount_requested_to = CASE WHEN discount_status::text = 'pending' THEN NULL ELSE discount_requested_to END,
                   payment_status = CASE WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= base_amount THEN 'paid' ELSE 'partial' END
             WHERE id = b.id;
            v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'change', 'Discount removed');
            v_changed := v_changed + 1;
          END IF;
        ELSE
          IF v_amt < 0 OR v_amt > b.base_amount THEN RAISE EXCEPTION 'INVALID_DISCOUNT_VALUE: Discount cannot be negative or exceed the service price.'; END IF;
          IF v_paid > 0 AND (b.base_amount - v_amt) < v_paid THEN
            RAISE EXCEPTION 'DISCOUNT_BELOW_PAID: Discount cannot reduce the total below the amount already paid (NPR %). Maximum discount: % percent.', v_paid, round((b.base_amount - v_paid) / b.base_amount * 100);
          END IF;
          v_pct := v_amt / b.base_amount;
          IF v_pct > v_ceiling + 1e-9 THEN RAISE EXCEPTION 'DISCOUNT_LIMIT_EXCEEDED: Discount cannot exceed % percent.', round(v_ceiling * 100); END IF;
          IF v_reason IS NULL AND NOT p_dry_run THEN RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED: A reason is required when applying a discount.'; END IF;
          v_over := v_pct > v_limit + 1e-9 OR v_total_over;
          IF v_over AND p_requested_to IS NULL THEN RAISE EXCEPTION 'APPROVER_REQUIRED: Select a manager or admin to send this discount request to.'; END IF;
          -- the approver must be one the picker offers (same business, active, admin or a manager of the caller's location, with a PIN)
          IF v_over AND NOT EXISTS (SELECT 1 FROM public.list_discount_approvers() a WHERE a.id = p_requested_to) THEN
            RAISE EXCEPTION 'APPROVER_NOT_VALID: Pick a manager or admin of this business from the list.';
          END IF;
          v_status := CASE WHEN v_over THEN 'pending' ELSE 'approved' END;
          v_new_pay := CASE WHEN v_over THEN b.payment_status
                            WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= b.base_amount - v_amt THEN 'paid' ELSE 'partial' END;
          UPDATE public.bookings SET discount_amount = v_amt, discount_reason = v_reason, discount_status = v_status,
                 discount_approved_by = CASE WHEN v_over THEN NULL ELSE v_uid END,
                 discount_requested_by = CASE WHEN v_over THEN v_uid ELSE NULL END,
                 discount_requested_to = CASE WHEN v_over THEN p_requested_to ELSE NULL END,
                 member_discount = NULL, payment_status = v_new_pay
           WHERE id = b.id;
          -- a 100% approved discount leaves nothing to collect: settle at once, as applyDiscount does
          IF NOT v_over AND (b.base_amount - v_amt) <= 0 AND b.payment_status <> 'paid' THEN
            PERFORM public.record_booking_payment(b.id, '[{"amount":0,"payment_mode":"No Charge"}]'::jsonb, gen_random_uuid(),
                                                  'Auto-settled — 100% discount leaves no balance due');
          END IF;
          v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'change',
                                                    CASE WHEN v_over THEN 'Sent for approval' ELSE 'NPR ' || v_amt::bigint || ' off' END);
          v_changed := v_changed + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'block', v_cls->>'message');
        IF v_err IS NULL THEN v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message', 'booking_id', b.id); END IF;
      END;
    END LOOP;
    IF v_err IS NULL AND v_changed = 0 THEN v_err := jsonb_build_object('code', 'NOTHING_TO_CHANGE', 'message', 'Nothing was changed.'); END IF;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_apply_discount: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  RETURN public._visit_result(v_rows, v_err, p_dry_run, jsonb_build_object('discount_total', v_total_amt, 'base_total', v_total_base));
END $$;

-- ── 7. visit_set_staff ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_lines: [{ booking_id, therapist_id (null = nobody), room_id? ('none' = no room) }]. p_notes (when not null) replaces special_requests on every row of
-- the booking that can still change. Same lifecycle rule as assignTherapist (not terminal, not a closed day); the tier price follows the new staff member
-- through trg_bookings_tier_reprice. A row with extra staff / a combo: MULTI_STAFF_USE_SINGLE_EDIT / COMBO_USE_SINGLE_EDIT.
CREATE OR REPLACE FUNCTION public.visit_set_staff(p_visit_key uuid, p_lines jsonb, p_notes text DEFAULT NULL, p_dry_run boolean DEFAULT false, p_override_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb; v_err jsonb := NULL; v_cls jsonb; v_verdict text; v_changed int := 0; v_ov text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
  b public.bookings; nb public.bookings; l jsonb; v_t uuid; v_room uuid; v_diff boolean; v_notes boolean := p_notes IS NOT NULL;
BEGIN
  IF NOT public._visit_caller_ok() THEN RETURN public._visit_refuse('NOT_ALLOWED', 'Staff, manager or admin sign-in required.', p_dry_run); END IF;
  BEGIN
    FOR b IN SELECT * FROM public._visit_rows(p_visit_key) LOOP
      l := (SELECT e FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) e WHERE e->>'booking_id' = b.id::text LIMIT 1);
      v_diff := false;
      BEGIN
        IF b.status::text IN ('Completed', 'Cancelled', 'No Show') OR b.is_locked THEN
          -- same lifecycle rule as assignTherapist: only an actual change to a closed row is refused
          IF l IS NOT NULL AND ((l ? 'therapist_id' AND NULLIF(l->>'therapist_id', '')::uuid IS DISTINCT FROM b.therapist_id)
                              OR (l ? 'room_id' AND CASE WHEN l->>'room_id' IN ('', 'none') THEN NULL ELSE (l->>'room_id')::uuid END IS DISTINCT FROM b.room_id)) THEN
            IF b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;
            RAISE EXCEPTION 'BOOKING_IMMUTABLE: % bookings cannot be modified.', b.status;
          END IF;
          v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, 'keep', COALESCE(public._visit_touched_reason(b), 'Day closed'));
          CONTINUE;
        END IF;
        IF l IS NOT NULL THEN
          v_t := CASE WHEN l ? 'therapist_id' THEN NULLIF(l->>'therapist_id', '')::uuid ELSE b.therapist_id END;
          v_room := CASE WHEN l ? 'room_id' THEN CASE WHEN l->>'room_id' IN ('', 'none') THEN NULL ELSE (l->>'room_id')::uuid END ELSE b.room_id END;
          v_diff := v_t IS DISTINCT FROM b.therapist_id OR v_room IS DISTINCT FROM b.room_id;
          IF v_diff THEN
            IF EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = b.id) THEN
              RAISE EXCEPTION 'COMBO_USE_SINGLE_EDIT: This is a combo booking, edited on its own.'; END IF;
            IF (SELECT count(*) FROM public.booking_therapists bt WHERE bt.booking_id = b.id) > 1 THEN
              RAISE EXCEPTION 'MULTI_STAFF_USE_SINGLE_EDIT: This service has more than one staff member, edited on its own.'; END IF;
            IF v_room IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = v_room AND r.branch_id = b.branch_id AND r.is_active) THEN
              RAISE EXCEPTION 'INVALID_ROOM: Selected room is not available at this location.'; END IF;
            IF v_t IS DISTINCT FROM b.therapist_id THEN PERFORM public._visit_assert_staff(b.branch_id, v_t, b.start_datetime); END IF;
            UPDATE public.bookings SET therapist_id = v_t, room_id = v_room, availability_override_reason = v_ov,
                   therapist_name_snapshot = CASE WHEN v_t IS NULL THEN NULL ELSE therapist_name_snapshot END,
                   room_name_snapshot = CASE WHEN v_room IS NULL THEN NULL ELSE room_name_snapshot END
             WHERE id = b.id;
            PERFORM public._visit_sync_junction(b.id);
            UPDATE public.bookings SET availability_override_reason = NULL WHERE id = b.id AND availability_override_reason IS NOT NULL;
            v_changed := v_changed + 1;
          END IF;
        END IF;
        IF v_notes THEN
          UPDATE public.bookings SET special_requests = NULLIF(btrim(p_notes), '') WHERE id = b.id AND special_requests IS DISTINCT FROM NULLIF(btrim(p_notes), '');
          IF FOUND AND NOT v_diff THEN v_diff := true; v_changed := v_changed + 1; END IF;
        END IF;
        SELECT * INTO nb FROM public.bookings WHERE id = b.id;
        v_rows := v_rows || public._visit_row_json(nb.id, nb.booking_number, nb.service_name_snapshot, nb.start_time, nb.therapist_name_snapshot,
                                                  CASE WHEN v_diff THEN 'change' ELSE 'keep' END, CASE WHEN v_diff THEN NULL ELSE 'Unchanged' END);
      EXCEPTION WHEN OTHERS THEN
        v_cls := public._visit_classify(SQLSTATE, SQLERRM);
        v_verdict := CASE WHEN (v_cls->>'overridable')::boolean AND v_ov IS NULL THEN 'warn' ELSE 'block' END;
        v_rows := v_rows || public._visit_row_json(b.id, b.booking_number, b.service_name_snapshot, b.start_time, b.therapist_name_snapshot, v_verdict, v_cls->>'message');
        IF v_err IS NULL THEN
          v_err := jsonb_build_object('code', CASE WHEN v_verdict = 'warn' THEN 'NEEDS_OVERRIDE' ELSE v_cls->>'code' END,
                                      'message', v_cls->>'message', 'booking_id', b.id, 'underlying_code', v_cls->>'code');
        END IF;
      END;
    END LOOP;
    IF jsonb_array_length(v_rows) = 0 THEN v_err := jsonb_build_object('code', 'BOOKING_NOT_FOUND', 'message', 'Booking not found.'); END IF;
    IF v_err IS NULL AND v_changed = 0 THEN v_err := jsonb_build_object('code', 'NOTHING_TO_CHANGE', 'message', 'Nothing was changed.'); END IF;
    IF v_err IS NOT NULL OR p_dry_run THEN RAISE EXCEPTION 'visit_set_staff: rolled back' USING ERRCODE = 'VD001'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'VD001' THEN NULL;
    WHEN OTHERS THEN
      v_cls := public._visit_classify(SQLSTATE, SQLERRM);
      v_err := jsonb_build_object('code', v_cls->>'code', 'message', v_cls->>'message');
  END;
  RETURN public._visit_result(v_rows, v_err, p_dry_run);
END $$;

-- grants: signed-in users only (anon never)
REVOKE ALL ON FUNCTION public.visit_create(uuid, jsonb, jsonb, text, boolean), public.visit_update(uuid, jsonb, text, boolean),
  public.visit_set_status(uuid, text, text, boolean), public.visit_remove_service(uuid, text, boolean),
  public.visit_reschedule(uuid, date, time, boolean, text, text), public.visit_apply_discount(uuid, jsonb, text, boolean, uuid),
  public.visit_set_staff(uuid, jsonb, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visit_create(uuid, jsonb, jsonb, text, boolean), public.visit_update(uuid, jsonb, text, boolean),
  public.visit_set_status(uuid, text, text, boolean), public.visit_remove_service(uuid, text, boolean),
  public.visit_reschedule(uuid, date, time, boolean, text, text), public.visit_apply_discount(uuid, jsonb, text, boolean, uuid),
  public.visit_set_staff(uuid, jsonb, text, boolean, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('430', 'visit-functions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
