-- Migration 084: auto-surface a customer's own linked voucher(s) at checkout
-- (additive, REVERSIBLE)
--
-- migration-082 let staff optionally link a voucher to a customer at issuance
-- (vouchers.customer_id). Until now nothing used that link at payment time —
-- the Payment Method "Voucher" option always required staff to manually search
-- by code/guest name (search_vouchers_for_payment), same as for an unlinked
-- gift voucher. That's still needed for vouchers nobody linked to an account,
-- but when the booking's own customer already has a linked voucher with a
-- balance, it should surface automatically — same UX Membership and Referral
-- Wallet already have (fetchMembershipForBooking / fetchReferralRewardForBooking).
--
-- list_vouchers_for_customer(p_customer_id) mirrors search_vouchers_for_payment's
-- shape/security model, just filtered by customer_id instead of a text query.
--
-- Idempotent (CREATE OR REPLACE) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.list_vouchers_for_customer(uuid);

CREATE OR REPLACE FUNCTION public.list_vouchers_for_customer(p_customer_id uuid)
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
    AND v.customer_id = p_customer_id
    AND v.expiry_date >= (now() AT TIME ZONE 'Asia/Kathmandu')::date
    AND (v.total_amount_issued - COALESCE(c.total_claimed, 0)) > 0
  ORDER BY v.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_vouchers_for_customer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_vouchers_for_customer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_vouchers_for_customer(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('084', 'list-vouchers-for-customer')
ON CONFLICT (version) DO NOTHING;
