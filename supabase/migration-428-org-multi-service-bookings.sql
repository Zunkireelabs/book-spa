-- Migration 428 (ZNLY-402 / ZNLY-423): per-org setting "Several services in one booking" (organizations.multi_service_bookings, default OFF)
--
-- Why: the visit model (bookings.visit_id, migration 427) changes what "same booking" means on the calendar, the Payment / Discount tabs and the
-- Bookings list. It is a per-org switch: OFF (every org today, Nuad Thai included) = everything behaves exactly as before; ON = the visit rules.
--
-- Design:
--   * organizations.multi_service_bookings boolean NOT NULL DEFAULT false (every existing org is false; no data seed).
--   * set_multi_service_bookings(boolean): admin-only SECURITY DEFINER writer (organizations has no UPDATE policy), same pattern as
--     set_allow_staff_overlap (migration 424).
--   * bookings_safe (the masked view restricted logins read, migrations 393 / 407) gets visit_id APPENDED. Same masking, same row filter, same
--     owner and grants: CREATE OR REPLACE VIEW keeps them, and an appended column is the only change it allows. visit_id is a link id
--     and carries no name, phone or amount.
--
-- Idempotent. Reversible (manual): DROP FUNCTION public.set_multi_service_bookings(boolean); ALTER TABLE public.organizations DROP COLUMN multi_service_bookings;
--   re-create bookings_safe without visit_id (DROP VIEW + the migration 407 definition + the grants of migration 393).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS multi_service_bookings boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_multi_service_bookings(p_value boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id uuid := (SELECT get_user_org_id());
  v_new    boolean;
BEGIN
  IF (SELECT get_user_role()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_multi_service_bookings: admin only' USING ERRCODE = '42501';
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_multi_service_bookings: no organization context';
  END IF;
  UPDATE public.organizations SET multi_service_bookings = COALESCE(p_value, false) WHERE id = v_org_id RETURNING multi_service_bookings INTO v_new;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'set_multi_service_bookings: organization % not found', v_org_id;
  END IF;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.set_multi_service_bookings(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_multi_service_bookings(boolean) TO authenticated;

-- bookings_safe: the live definition (migrations 393 / 407) + visit_id appended as the last column.
CREATE OR REPLACE VIEW public.bookings_safe AS
SELECT id,
    booking_number,
    branch_id,
    room_id,
    service_id,
    therapist_id,
        CASE
            WHEN public.caller_hides_details() THEN public.mask_person_name(customer_name)
            ELSE customer_name
        END AS customer_name,
        CASE
            WHEN public.caller_hides_details() THEN NULL::text
            ELSE customer_email
        END AS customer_email,
        CASE
            WHEN public.caller_hides_details() THEN public.mask_phone_digits(customer_phone)
            ELSE customer_phone
        END AS customer_phone,
    customer_gender,
    date,
    start_time,
    end_time,
    start_datetime,
    end_datetime,
    status,
    special_requests,
    referred_by,
    payment_status,
        CASE
            WHEN public.caller_hides_prices() THEN NULL::numeric
            ELSE base_amount
        END AS base_amount,
        CASE
            WHEN public.caller_hides_prices() THEN NULL::numeric
            ELSE discount_amount
        END AS discount_amount,
        CASE
            WHEN public.caller_hides_prices() THEN NULL::numeric
            ELSE final_amount
        END AS final_amount,
    discount_status,
    discount_approved_by,
    discount_requested_by,
    discount_requested_to,
    discount_reason,
    service_name_snapshot,
    service_duration_snapshot,
        CASE
            WHEN public.caller_hides_prices() THEN NULL::numeric
            ELSE service_price_snapshot
        END AS service_price_snapshot,
    therapist_name_snapshot,
    room_name_snapshot,
    is_locked,
    booking_group_id,
    created_by,
    created_at,
    updated_at,
    customer_id,
    client_request_id,
    due_holder_name,
    referral_commission_type,
        CASE
            WHEN public.caller_hides_prices() THEN NULL::numeric
            ELSE referral_commission_value
        END AS referral_commission_value,
    customer_account_id,
    referral_source,
    referral_source_detail,
    cancellation_reason,
        CASE
            WHEN public.caller_hides_details() THEN public.mask_person_name(companion_name)
            ELSE companion_name
        END AS companion_name,
        CASE
            WHEN public.caller_hides_details() THEN public.mask_phone_digits(companion_phone)
            ELSE companion_phone
        END AS companion_phone,
    service_category_snapshot,
    gender_preference,
    acknowledged_at,
    acknowledged_by,
        CASE
            WHEN public.caller_hides_prices() THEN NULL::text
            ELSE member_discount
        END AS member_discount,
    availability_override_reason,
    is_walk_in,
        CASE
            WHEN public.caller_hides_details() THEN public.mask_person_name(walk_in_label)
            ELSE walk_in_label
        END AS walk_in_label,
    visit_id
   FROM public.bookings b
  WHERE (id IN ( SELECT public.caller_visible_booking_ids() AS caller_visible_booking_ids));

INSERT INTO public.schema_migrations (version, name)
VALUES ('428', 'org-multi-service-bookings')
ON CONFLICT (version) DO NOTHING;

COMMIT;
