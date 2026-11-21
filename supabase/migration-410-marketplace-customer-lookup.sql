-- Migration 410 (ZNLY-332, ported from zennly-connectors 336): marketplace customer lookup (additive)
--
-- The marketplace already calls this (src/app/api/account/studio-history/route.ts in
-- zennly-marketplace -> POST ${BOOK_SPA_FUNCTIONS_URL}/marketplace-customer-lookup), fails
-- soft on any error, and has been silently getting nothing back since this was designed
-- but never built. This closes that gap.
--
-- Trust model, same shape as public_create_booking (migration-335) and for the same
-- reason: the marketplace is a different Supabase project, so book-spa cannot verify a
-- token it didn't issue. The caller vouches that the email it sends was verified on ITS
-- side (getSessionUser(), checked against its own auth server, never taken from a request
-- body) -- the same trust create_customer_account (migration-064/065) already places in a
-- verified email for its own, lower-stakes "link account to customer" case. This endpoint
-- is read-only, but that does NOT make it safe to expose without the service secret: email
-- is not a secret, so an anon-reachable version would let anyone who knows or guesses a
-- customer's email read their membership balance and visit history. That's exactly the
-- leak class migration-097/098 closed for `bookings`/`customers` directly -- reopening it
-- through a new, richer door would be worse, not better.
--
-- Matching is case-insensitive email (lower(email) = lower(p_identifier_value)), org-scoped.
-- Deliberately NOT find_customer_for_booking (migration-098): that function's `c.email =
-- p_email` is case-sensitive and would silently miss a match create_customer_account's
-- lower()-based comparison -- the standard this endpoint is actually relying on -- would
-- find.
--
-- Shaped as (org_slug, identifier_kind, identifier_value) rather than a bare `email` param:
-- customers has a unique index on (org_id, normalized phone) and none on email (migration-
-- 036) -- phone is the real identity in this business, and phone-based marketplace login
-- is coming. Only 'email' is implemented; any other kind is a clear error now rather than
-- a silent non-match later when phone support lands.
--
-- Org gate: lookup is allowed when organizations.marketplace_lookup_enabled (default false)
-- OR migration-335's marketplace_booking_enabled is on (org active). RULE: a customer must
-- always be able to see the bookings they made -- an org that takes marketplace bookings can
-- never have an empty Appointments page. marketplace_lookup_enabled stays for lookup-only
-- studios that opt into read without taking bookings. If a studio is switched off AFTER a
-- customer booked through the marketplace, that customer still sees those bookings
-- (bookings.booking_source = 'marketplace', migration 412); everyone else is refused.
--
-- Response additions beyond the original 3-field design (bookings/membership/packages):
-- total_visits and referral_earnings are cheap aggregates (a count and a sum, each off an
-- already-indexed column) added for the marketplace's planned cross-studio profile page.
-- Voucher summary is included too (count + remaining balance), same reasoning. All three
-- are additive fields on the response object -- the existing caller in zennly-marketplace
-- only reads found/bookings/membership/packages and ignores unknown keys, so this can't
-- break it.
--
-- Column allow-list lives in this function's own field-by-field jsonb_build_object calls,
-- not assembled by the Edge Function -- the same reasoning as the migration-335 header:
-- the one place a careless later edit can't widen it. Exclusions, unchanged from the
-- original design: customers.notes/tags/client_source/referred_by/is_active, the booking
-- discount-approval chain (discount_status/approved_by/requested_by/requested_to/reason --
-- discount_amount itself is kept, it's the customer's own benefit), created_by/issued_by/
-- performed_by everywhere, org_id/branch_id internal tenancy ids, customer_photos/documents
-- (already staff-only via RLS, not reached around here), and guest_name/guest_info on
-- packages and vouchers (could name a different person than the one asking).
--
-- Payment + staff word (ZNLY-345): each booking carries payment_status and paid_amount (sum of the real
-- payment records, never base/final price), and the response carries the org's own staff word
-- (industries.staff_label / _plural, e.g. Therapist, Stylist, Staff) so the marketplace never hard-codes one.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.marketplace_lookup_customer(text, text, text);
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS marketplace_lookup_enabled;

-- ============================================================
-- 1. Org opt-in flag
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS marketplace_lookup_enabled boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Lookup function
-- ============================================================

CREATE OR REPLACE FUNCTION public.marketplace_lookup_customer(
  p_org_slug text,
  p_identifier_kind text,
  p_identifier_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_org_enabled boolean;
  v_staff_label text;
  v_staff_label_plural text;
  v_customer_id uuid;
  v_bookings jsonb;
  v_membership jsonb;
  v_packages jsonb;
  v_vouchers jsonb;
  v_total_visits bigint;
  v_referral_earnings numeric;
BEGIN
  IF p_identifier_kind IS DISTINCT FROM 'email' THEN
    RAISE EXCEPTION 'unsupported identifier kind: %', p_identifier_kind
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  IF p_identifier_value IS NULL OR btrim(p_identifier_value) = '' THEN
    RAISE EXCEPTION 'identifier value is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT o.id, (o.marketplace_lookup_enabled = true OR o.marketplace_booking_enabled = true),
         COALESCE(i.staff_label, 'Staff'), COALESCE(i.staff_label_plural, 'Staff')
  INTO v_org_id, v_org_enabled, v_staff_label, v_staff_label_plural
  FROM public.organizations o
  LEFT JOIN public.industries i ON i.id = o.industry_type
  WHERE o.slug = p_org_slug
    AND o.is_active = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found or not marketplace-enabled: %', p_org_slug
      USING ERRCODE = 'BSNF1';
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.org_id = v_org_id
    AND lower(c.email) = lower(p_identifier_value)
  LIMIT 1;

  -- Studio switched off after the customer booked: they still see what they booked (booking_source
  -- from migration 412, read at call time so apply order does not matter). Anyone else is refused
  -- exactly as before, including "no such customer", so a disabled org leaks nothing.
  IF NOT v_org_enabled AND (
       v_customer_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.bookings bk
                      WHERE bk.customer_id = v_customer_id AND bk.booking_source = 'marketplace'
                        AND bk.branch_id IN (SELECT id FROM public.branches WHERE org_id = v_org_id))
     ) THEN
    RAISE EXCEPTION 'org not found or not marketplace-enabled: %', p_org_slug
      USING ERRCODE = 'BSNF1';
  END IF;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'staff_label', v_staff_label,
      'staff_label_plural', v_staff_label_plural,
      'bookings', '[]'::jsonb,
      'membership', NULL,
      'packages', '[]'::jsonb,
      'vouchers', '[]'::jsonb,
      'total_visits', 0,
      'referral_earnings', 0
    );
  END IF;

  -- Bookings: this customer's bookings at this org, most recent first.
  SELECT coalesce(jsonb_agg(row_to_json(b) ORDER BY b.date DESC, b.start_time DESC), '[]'::jsonb)
  INTO v_bookings
  FROM (
    SELECT
      bk.booking_number,
      bk.status,
      bk.date,
      bk.start_time,
      bk.end_time,
      bk.service_name_snapshot,
      bk.service_duration_snapshot,
      bk.service_price_snapshot,
      bk.service_category_snapshot,
      bk.room_name_snapshot,
      bk.therapist_name_snapshot,
      bk.final_amount,
      bk.discount_amount,
      bk.special_requests,
      bk.customer_gender,
      bk.payment_status::text AS payment_status,
      -- what was really paid: payment records minus refunds (migration 099), never below 0, never the base/final price
      GREATEST(0,
        (SELECT COALESCE(SUM(pay.amount), 0) FROM public.payments pay WHERE pay.booking_id = bk.id)
        - (SELECT COALESCE(SUM(rf.amount), 0) FROM public.payment_refunds rf WHERE rf.booking_id = bk.id)) AS paid_amount
    FROM public.bookings bk
    WHERE bk.customer_id = v_customer_id
      AND bk.branch_id IN (SELECT id FROM public.branches WHERE org_id = v_org_id)
  ) b;

  -- Total visits: completed bookings only -- "booked" and "visited" aren't the same thing,
  -- and a cross-studio profile tile titled "visits" should count the latter.
  SELECT count(*) INTO v_total_visits
  FROM public.bookings bk
  WHERE bk.customer_id = v_customer_id
    AND bk.status = 'Completed'
    AND bk.branch_id IN (SELECT id FROM public.branches WHERE org_id = v_org_id);

  -- Membership: most recent enrollment, same status computation
  -- list_membership_status_for_org (migration-087) uses, but including balance/dates since
  -- this is the customer reading their OWN record (that function deliberately hides balance
  -- because it's staff-facing).
  SELECT jsonb_build_object(
    'tier_name', t.name,
    'membership_number', m.membership_number,
    'balance', m.balance,
    'total_deposited', m.total_deposited,
    'activation_date', m.activation_date,
    'expiry_date', m.expiry_date,
    'status', CASE
      WHEN m.activation_date IS NULL THEN
        CASE
          WHEN m.balance <= 0 AND m.total_deposited > 0 THEN 'depleted'
          WHEN m.total_deposited >= t.advance_amount THEN 'active'
          ELSE 'pending'
        END
      WHEN m.balance <= 0 THEN 'depleted'
      WHEN m.expiry_date IS NOT NULL AND m.expiry_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN 'lapsed'
      ELSE 'active'
    END
  )
  INTO v_membership
  FROM public.memberships m
  JOIN public.membership_tiers t ON t.id = m.tier_id
  WHERE m.org_id = v_org_id
    AND m.customer_id = v_customer_id
  ORDER BY m.created_at DESC
  LIMIT 1;

  -- Packages: this customer's packages at this org, using the existing package_balances
  -- view for sessions_used/remaining/status.
  SELECT coalesce(jsonb_agg(row_to_json(p) ORDER BY p.issued_date DESC), '[]'::jsonb)
  INTO v_packages
  FROM (
    SELECT
      pk.package_code,
      pt.name AS package_type_name,
      pb.expiry_date,
      pb.sessions_total,
      pb.sessions_used,
      pb.sessions_remaining,
      pb.status,
      pk.issued_date,
      pk.paid_amount
    FROM public.package_balances pb
    JOIN public.packages pk ON pk.id = pb.package_id
    JOIN public.package_types pt ON pt.id = pk.package_type_id
    WHERE pb.org_id = v_org_id
      AND pb.customer_id = v_customer_id
  ) p;

  -- Vouchers: count + remaining balance only (not full redemption history -- a summary
  -- tile, not a ledger). voucher_balances (migration-072) predates vouchers.customer_id
  -- (migration-082) and was never re-created to expose it, so this joins vouchers directly
  -- rather than relying on that view having the column.
  SELECT coalesce(jsonb_agg(row_to_json(v) ORDER BY v.issued_date DESC), '[]'::jsonb)
  INTO v_vouchers
  FROM (
    SELECT
      vo.voucher_code,
      vo.issued_date,
      vo.expiry_date,
      vo.total_amount_issued,
      vo.total_amount_issued - COALESCE(vc.total_claimed, 0) AS remaining_balance
    FROM public.vouchers vo
    LEFT JOIN (
      SELECT voucher_id, SUM(amount_claimed) AS total_claimed
      FROM public.voucher_claims
      GROUP BY voucher_id
    ) vc ON vc.voucher_id = vo.id
    WHERE vo.org_id = v_org_id
      AND vo.customer_id = v_customer_id
  ) v;

  -- Referral earnings: sum of this customer's own referral_credits ledger (migration-067)
  -- at this org -- the reward actually credited, not the pending/not-yet-earned amount.
  SELECT coalesce(SUM(rc.amount), 0) INTO v_referral_earnings
  FROM public.customer_referral_credits rc
  WHERE rc.org_id = v_org_id
    AND rc.customer_id = v_customer_id;

  RETURN jsonb_build_object(
    'found', true,
    'staff_label', v_staff_label,
    'staff_label_plural', v_staff_label_plural,
    'bookings', v_bookings,
    'membership', v_membership,
    'packages', v_packages,
    'vouchers', v_vouchers,
    'total_visits', v_total_visits,
    'referral_earnings', v_referral_earnings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_lookup_customer(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_lookup_customer(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_lookup_customer(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_lookup_customer(text, text, text) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('410', 'marketplace-customer-lookup')
ON CONFLICT (version) DO NOTHING;
