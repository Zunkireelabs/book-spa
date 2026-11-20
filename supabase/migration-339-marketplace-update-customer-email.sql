-- Migration 339: propagate a marketplace email change onto this org's customer record (additive)
--
-- The gap: a customer changes their email on the marketplace and the studio's staff dashboard
-- still shows the old one, so staff email an address the customer no longer reads. book-spa has
-- three contact-update paths already -- staff edit (migration-173/222), the customer's own
-- book-spa login (migration-176) and the email-repair tool (migration-180) -- and NONE is
-- reachable from the marketplace. The two marketplace-facing functions that exist (335 create,
-- 336 lookup) only read or create.
--
-- EMAIL ONLY, deliberately. Phone is NOT propagated and must not be added here until SMS
-- verification exists on the marketplace side, for two independent reasons:
--   1. The marketplace's phone is self-asserted -- profiles.phone is set by a plain form PATCH
--      with no verification (profiles.phone_verified_at is always NULL today). Writing it into
--      the number staff actually dial would make anyone's typing into operational truth.
--   2. Phone is the IDENTITY here. customers has a unique index on (org_id, normalized phone)
--      (migration-036) and none on email. Changing a phone either collides with another client
--      at this org (23505) or silently repoints which customer row that person's future bookings
--      attach to -- which is how two people's visit histories merge. Email has no such index, so
--      this update cannot collide with anything.
--
-- Trust model: identical to migration-335/336. The marketplace is a different Supabase project,
-- so book-spa cannot verify a token it didn't issue; the caller vouches that BOTH addresses were
-- verified on its side. That vouching is stronger here than for the lookup: the new address is
-- only sent after the customer entered a code sent to it AND a code sent to the old one
-- ("Secure email change" is ON for the marketplace project), so this is not a self-asserted value.
--
-- Matching is on the OLD email, case-insensitively, exactly as migration-336 matches -- so the
-- two agree by construction about which customer row a marketplace account corresponds to. A
-- miss is NOT an error: a customer who has never booked at this org simply has no row here, and
-- the marketplace fans this out across every connected org without knowing which ones know them.
--
-- Org opt-in: organizations.marketplace_contact_sync_enabled, default false. Deliberately a THIRD
-- flag rather than reusing marketplace_lookup_enabled (read) or marketplace_booking_enabled
-- (create). Migration-336's header establishes that read and write are different risk profiles;
-- MUTATING AN EXISTING CLIENT RECORD is a third and higher one. An org may well want marketplace
-- bookings and lookups without letting the marketplace rewrite its client list.
--
-- Scope: public.customers.email ONLY. Explicitly does NOT touch customer_accounts.email -- that
-- is book-spa's own login identity, a different account from the marketplace one, and
-- migration-176's guard trigger rejects any write to it outside sync_customer_email anyway.
--
-- Audit: writes a row to marketplace_contact_sync_log. The owner's decision was "update quietly,
-- keep a record" -- no staff notification, but an unexpected address change must be traceable
-- later rather than appearing from nowhere.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.marketplace_update_customer_email(text, text, text);
--   DROP TABLE IF EXISTS public.marketplace_contact_sync_log;
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS marketplace_contact_sync_enabled;

-- ============================================================
-- 1. Org opt-in flag
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS marketplace_contact_sync_enabled boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Audit log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.marketplace_contact_sync_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id),
  customer_id uuid REFERENCES public.customers(id),
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  matched     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_contact_sync_log_org_created_idx
  ON public.marketplace_contact_sync_log (org_id, created_at DESC);

-- Staff-readable, never writable from the app: rows come only from the SECURITY DEFINER function
-- below, which bypasses this.
ALTER TABLE public.marketplace_contact_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read their org's contact sync log" ON public.marketplace_contact_sync_log;
CREATE POLICY "Staff can read their org's contact sync log"
  ON public.marketplace_contact_sync_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM public.users u WHERE u.id = auth.uid()));

-- ============================================================
-- 3. Update function
-- ============================================================

CREATE OR REPLACE FUNCTION public.marketplace_update_customer_email(
  p_org_slug  text,
  p_old_email text,
  p_new_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id      uuid;
  v_customer_id uuid;
  v_old_stored  text;
BEGIN
  IF p_old_email IS NULL OR btrim(p_old_email) = ''
     OR p_new_email IS NULL OR btrim(p_new_email) = '' THEN
    RAISE EXCEPTION 'both old and new email are required'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  IF lower(btrim(p_old_email)) = lower(btrim(p_new_email)) THEN
    RAISE EXCEPTION 'old and new email are the same'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = p_org_slug
    AND is_active = true
    AND marketplace_contact_sync_enabled = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found or not contact-sync-enabled: %', p_org_slug
      USING ERRCODE = 'BSNF1';
  END IF;

  -- Match on the OLD address, same case-insensitive rule migration-336 uses.
  SELECT c.id, c.email INTO v_customer_id, v_old_stored
  FROM public.customers c
  WHERE c.org_id = v_org_id
    AND lower(c.email) = lower(btrim(p_old_email))
  LIMIT 1;

  -- No row here is the NORMAL case, not an error: the marketplace fans this out to every
  -- connected org without knowing which ones this customer has actually visited.
  IF v_customer_id IS NULL THEN
    INSERT INTO public.marketplace_contact_sync_log (org_id, customer_id, field, old_value, new_value, matched)
    VALUES (v_org_id, NULL, 'email', lower(btrim(p_old_email)), lower(btrim(p_new_email)), false);
    RETURN jsonb_build_object('matched', false, 'updated', false);
  END IF;

  UPDATE public.customers
  SET email = lower(btrim(p_new_email))
  WHERE id = v_customer_id;

  INSERT INTO public.marketplace_contact_sync_log (org_id, customer_id, field, old_value, new_value, matched)
  VALUES (v_org_id, v_customer_id, 'email', v_old_stored, lower(btrim(p_new_email)), true);

  RETURN jsonb_build_object('matched', true, 'updated', true);
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_update_customer_email(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_update_customer_email(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_update_customer_email(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_update_customer_email(text, text, text) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('339', 'marketplace-update-customer-email')
ON CONFLICT (version) DO NOTHING;
