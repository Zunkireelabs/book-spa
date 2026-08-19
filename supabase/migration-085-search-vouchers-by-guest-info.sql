-- Migration 085: let voucher search match guest_info too (additive, REVERSIBLE)
--
-- NewVoucherModal's Guest Info field stores either a phone number (when
-- given) or free-text "other info" (when it isn't) in vouchers.guest_info.
-- search_vouchers_for_payment (migration-076) only matched voucher_code and
-- guest_name — a voucher issued with a phone number as guest_info couldn't be
-- found by that phone number at redemption, only by its code. Matching
-- guest_info too makes phone-number vouchers searchable by phone (in
-- addition to code), while free-text guest_info just becomes another
-- searchable note — harmless either way.
--
-- Idempotent (CREATE OR REPLACE) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible: re-run migration-076-voucher-wallet-payment.sql's
-- CREATE OR REPLACE FUNCTION public.search_vouchers_for_payment(...) block to
-- drop the guest_info match.

CREATE OR REPLACE FUNCTION public.search_vouchers_for_payment(p_query text)
RETURNS TABLE (
  voucher_id        uuid,
  voucher_code      text,
  guest_name        text,
  guest_info        text,
  expiry_date       date,
  remaining_balance numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    v.id,
    v.voucher_code,
    v.guest_name,
    v.guest_info,
    v.expiry_date,
    (v.total_amount_issued - COALESCE(c.total_claimed, 0)) AS remaining_balance
  FROM public.vouchers v
  LEFT JOIN (
    SELECT voucher_id, SUM(amount_claimed) AS total_claimed
    FROM public.voucher_claims
    GROUP BY voucher_id
  ) c ON c.voucher_id = v.id
  WHERE v.org_id = get_user_org_id()
    AND v.expiry_date >= (now() AT TIME ZONE 'Asia/Kathmandu')::date
    AND (v.total_amount_issued - COALESCE(c.total_claimed, 0)) > 0
    AND (
      p_query IS NULL OR btrim(p_query) = '' OR
      v.voucher_code ILIKE '%' || p_query || '%' OR
      v.guest_name   ILIKE '%' || p_query || '%' OR
      v.guest_info   ILIKE '%' || p_query || '%'
    )
  ORDER BY v.guest_name
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.search_vouchers_for_payment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_vouchers_for_payment(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_vouchers_for_payment(text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('085', 'search-vouchers-by-guest-info')
ON CONFLICT (version) DO NOTHING;
