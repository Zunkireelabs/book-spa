-- ============================================================
-- Migration 064: Customer accounts (self-service login)
-- ============================================================

CREATE TABLE customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  phone text,
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE INDEX idx_customer_accounts_org_email ON customer_accounts (org_id, email);

ALTER TABLE bookings ADD COLUMN customer_account_id uuid REFERENCES customer_accounts(id);
CREATE INDEX idx_bookings_customer_account_id ON bookings (customer_account_id);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer reads own account" ON customer_accounts
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "customer updates own account" ON customer_accounts
  FOR UPDATE USING (auth_user_id = auth.uid());

CREATE POLICY "customer reads own bookings" ON bookings
  FOR SELECT USING (
    customer_account_id IN (
      SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  );

-- Atomic signup: create account row + auto-link past anonymous bookings by email match
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
BEGIN
  INSERT INTO customer_accounts (org_id, auth_user_id, email, phone, full_name)
  VALUES (p_org_id, auth.uid(), p_email, p_phone, p_full_name)
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
