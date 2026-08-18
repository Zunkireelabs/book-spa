-- Migration 087: staff-safe membership status (no balance) (additive, REVERSIBLE)
--
-- Staff currently cannot see or use a customer's membership wallet at checkout
-- at all: PaymentModal reads it via fetchMembershipForBooking(), a direct
-- `memberships` table select — and that table's SELECT RLS policy
-- (migration-080) is manager/admin/admin_viewer only. Staff gets an empty
-- result, so the "Membership" payment option never appears. The same gap
-- silently breaks the membership tier pill in the booking-creation customer
-- autocomplete (fetchCustomersLightweight's embedded `memberships` relation
-- is subject to the same RLS).
--
-- record_membership_payment() (migration-046) is deliberately staff-callable
-- — the backend already intends staff to process wallet payments. This
-- migration adds a SECURITY DEFINER function that computes membership status
-- server-side and returns NO balance/deposit columns at all, so staff can see
-- *whether* a membership is usable (and its tier) without ever seeing the
-- NPR balance. Mirrors computeMembershipStatus() in bookingTransformers.js.
--
-- usable = status IN ('active', 'lapsed') — matches MembershipWalletCard's
-- own documented intent (pending: "not yet usable for booking payments";
-- lapsed: "wallet balance is still spendable"), not the admin-side client
-- formula's literal `balance > 0 && status !== 'depleted'`, which doesn't
-- actually exclude pending. Admin's own formula/UI is untouched by this
-- migration — it doesn't call this function.
--
-- Idempotent (CREATE OR REPLACE) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.list_membership_status_for_org(uuid);

CREATE OR REPLACE FUNCTION public.list_membership_status_for_org(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE (
  customer_id        uuid,
  membership_id       uuid,
  membership_number   text,
  tier_name           text,
  status              text,
  usable              boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  WITH ranked AS (
    SELECT
      m.customer_id, m.id, m.membership_number, t.name AS tier_name,
      m.balance, m.total_deposited, m.activation_date, m.expiry_date, t.advance_amount,
      ROW_NUMBER() OVER (PARTITION BY m.customer_id ORDER BY m.created_at DESC) AS rn
    FROM public.memberships m
    JOIN public.membership_tiers t ON t.id = m.tier_id
    WHERE m.org_id = get_user_org_id()
      AND (p_customer_id IS NULL OR m.customer_id = p_customer_id)
  ), computed AS (
    SELECT
      customer_id, id AS membership_id, membership_number, tier_name,
      CASE
        WHEN activation_date IS NULL THEN
          CASE
            WHEN balance <= 0 AND total_deposited > 0 THEN 'depleted'
            WHEN total_deposited >= advance_amount THEN 'active'
            ELSE 'pending'
          END
        WHEN balance <= 0 THEN 'depleted'
        WHEN expiry_date IS NOT NULL AND expiry_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN 'lapsed'
        ELSE 'active'
      END AS status
    FROM ranked
    WHERE rn = 1
  )
  SELECT
    customer_id, membership_id, membership_number, tier_name, status,
    (status IN ('active', 'lapsed')) AS usable
  FROM computed;
$$;

REVOKE ALL ON FUNCTION public.list_membership_status_for_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_membership_status_for_org(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_membership_status_for_org(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('087', 'membership-status-for-staff')
ON CONFLICT (version) DO NOTHING;
