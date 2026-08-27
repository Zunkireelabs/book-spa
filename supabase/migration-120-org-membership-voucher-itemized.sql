-- supabase/migration-120-org-membership-voucher-itemized.sql
-- Itemized paid-only drill-in rows for membership deposits and voucher sales,
-- mirroring platform_get_org_bookings (migration-117) so the Platform Org
-- Detail page can show Paid Bookings / Paid Memberships / Paid Vouchers as
-- three reconcilable lists instead of one mixed-status bookings table.

CREATE OR REPLACE FUNCTION public.platform_get_org_membership_deposits(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'date') DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'date', (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date,
      'branch_name', br.name,
      'customer_name', c.full_name,
      'amount', mt.amount,
      'notes', mt.notes
    ) AS row_obj
    FROM public.membership_transactions mt
    JOIN public.memberships m ON m.id = mt.membership_id
    JOIN public.customers c   ON c.id = m.customer_id
    JOIN public.branches br   ON br.id = c.branch_id
    WHERE mt.org_id = p_org_id
      AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
  ) sub;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.platform_get_org_voucher_sales(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'date') DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'date', v.issued_date,
      'branch_name', br.name,
      'guest_name', v.guest_name,
      'voucher_code', v.voucher_code,
      'amount', v.actual_price
    ) AS row_obj
    FROM public.vouchers v
    JOIN public.branches br ON br.id = v.branch_id
    WHERE v.org_id = p_org_id
      AND v.issued_date BETWEEN p_from AND p_to
  ) sub;
  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_get_org_membership_deposits(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_org_voucher_sales(uuid,date,date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('120', 'org-membership-voucher-itemized') ON CONFLICT (version) DO NOTHING;
