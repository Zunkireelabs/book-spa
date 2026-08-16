-- ============================================================
-- Migration 065: Link customer_accounts -> customers, grant
-- customers read access to their own membership + transactions.
-- Gated on to_regclass so this no-ops safely on environments (prod)
-- where the membership tables were never created (MEMBERSHIP_ENABLED=false).
-- ============================================================

BEGIN;

ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_customer_id ON customer_accounts (customer_id);

-- Backfill: link existing customer_accounts to a matching customers row by
-- (org, lower(email)) — same trust level as migration-064's anonymous-booking
-- auto-link (exact email match, case-insensitive). customers has no org_id
-- column directly (only branch_id) — join through branches.
UPDATE customer_accounts ca
SET customer_id = c.id
FROM customers c
JOIN branches b ON b.id = c.branch_id
WHERE ca.customer_id IS NULL
  AND b.org_id = ca.org_id
  AND lower(c.email) = lower(ca.email);

-- Extend signup to also resolve+set customer_id, mirroring the existing
-- anonymous-booking auto-link already in this function.
CREATE OR REPLACE FUNCTION create_customer_account(
  p_org_id uuid, p_email text, p_phone text, p_full_name text
)
RETURNS customer_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account customer_accounts;
  v_customer_id uuid;
BEGIN
  SELECT c.id INTO v_customer_id
  FROM customers c
  JOIN branches b ON b.id = c.branch_id
  WHERE b.org_id = p_org_id AND lower(c.email) = lower(p_email)
  LIMIT 1;

  INSERT INTO customer_accounts (org_id, auth_user_id, email, phone, full_name, customer_id)
  VALUES (p_org_id, auth.uid(), p_email, p_phone, p_full_name, v_customer_id)
  RETURNING * INTO v_account;

  UPDATE bookings
  SET customer_account_id = v_account.id
  WHERE branch_id IN (SELECT id FROM branches WHERE org_id = p_org_id)
    AND customer_email = p_email
    AND customer_account_id IS NULL;

  RETURN v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION create_customer_account(uuid, text, text, text) TO authenticated;

-- Customer-facing RLS: only runs where membership tables actually exist.
DO $$
BEGIN
  IF to_regclass('public.memberships') IS NOT NULL THEN
    DROP POLICY IF EXISTS "customer reads own membership" ON public.memberships;
    CREATE POLICY "customer reads own membership" ON public.memberships
      FOR SELECT USING (
        customer_id IN (
          SELECT customer_id FROM public.customer_accounts
          WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
        )
      );
  END IF;

  IF to_regclass('public.membership_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "customer reads own membership transactions" ON public.membership_transactions;
    CREATE POLICY "customer reads own membership transactions" ON public.membership_transactions
      FOR SELECT USING (
        membership_id IN (
          SELECT m.id FROM public.memberships m
          WHERE m.customer_id IN (
            SELECT customer_id FROM public.customer_accounts
            WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
          )
        )
      );
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('065', 'customer-membership-access')
ON CONFLICT (version) DO NOTHING;

COMMIT;
