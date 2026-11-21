-- Migration 407 (ZNLY-327): walk-in bookings.
--
-- A walk-in who gives no details is recorded as a walk-in instead of a fake customer profile: bookings.is_walk_in marks it, and
-- bookings.walk_in_label holds the optional first name staff typed ("Ram"). customer_id and customer_phone were already nullable and
-- bookings are inserted directly (no create-booking RPC), so nothing else has to change on the write side.
-- bookings_safe (the view restricted logins read through, migration-393) gets both columns appended; neither is sensitive beyond what the
-- masked customer_name already shows, and a first-name label is masked with the same helper.
-- Reversible: restore bookings_require_phone() from migration-263 (without the is_walk_in exemption), then DROP the two columns after re-creating bookings_safe without them.

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_walk_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS walk_in_label text NULL;

-- migration-263's trigger demands a phone on every booking; a walk-in has none by design, so it is the one exemption.
CREATE OR REPLACE FUNCTION public.bookings_require_phone()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.skip_phone_check', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_walk_in THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_phone IS NULL OR length(trim(NEW.customer_phone)) = 0 THEN
    RAISE EXCEPTION 'bookings_require_phone: customer_phone is required';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE VIEW public.bookings_safe AS
 SELECT id,
    booking_number,
    branch_id,
    room_id,
    service_id,
    therapist_id,
        CASE
            WHEN caller_hides_details() THEN mask_person_name(customer_name)
            ELSE customer_name
        END AS customer_name,
        CASE
            WHEN caller_hides_details() THEN NULL::text
            ELSE customer_email
        END AS customer_email,
        CASE
            WHEN caller_hides_details() THEN mask_phone_digits(customer_phone)
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
            WHEN caller_hides_prices() THEN NULL::numeric
            ELSE base_amount
        END AS base_amount,
        CASE
            WHEN caller_hides_prices() THEN NULL::numeric
            ELSE discount_amount
        END AS discount_amount,
        CASE
            WHEN caller_hides_prices() THEN NULL::numeric
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
            WHEN caller_hides_prices() THEN NULL::numeric
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
            WHEN caller_hides_prices() THEN NULL::numeric
            ELSE referral_commission_value
        END AS referral_commission_value,
    customer_account_id,
    referral_source,
    referral_source_detail,
    cancellation_reason,
        CASE
            WHEN caller_hides_details() THEN mask_person_name(companion_name)
            ELSE companion_name
        END AS companion_name,
        CASE
            WHEN caller_hides_details() THEN mask_phone_digits(companion_phone)
            ELSE companion_phone
        END AS companion_phone,
    service_category_snapshot,
    gender_preference,
    acknowledged_at,
    acknowledged_by,
        CASE
            WHEN caller_hides_prices() THEN NULL::text
            ELSE member_discount
        END AS member_discount,
    availability_override_reason,
    is_walk_in,
        CASE
            WHEN caller_hides_details() THEN mask_person_name(walk_in_label)
            ELSE walk_in_label
        END AS walk_in_label
   FROM bookings b
  WHERE (id IN ( SELECT caller_visible_booking_ids() AS caller_visible_booking_ids));

INSERT INTO public.schema_migrations (version, name)
VALUES ('407', 'booking-walk-in')
ON CONFLICT (version) DO NOTHING;

COMMIT;
