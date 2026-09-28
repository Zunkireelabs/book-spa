-- Migration 233: admin corrections for voucher balances and package sessions,
-- with the same mandatory-reason + audit_logs contract as migration 232.
--
-- Idempotent: CREATE OR REPLACE.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.admin_correct_voucher_balance(uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.admin_void_voucher_claim(uuid, text);
--   DROP FUNCTION IF EXISTS public.admin_correct_package_sessions(uuid, integer, text);
--   DROP FUNCTION IF EXISTS public.admin_void_package_redemption(uuid, text);
--
--
-- Why these cannot be a simple UPDATE
--
-- `voucher_balances` and `package_balances` are VIEWS, not tables. There is no
-- `remaining_balance` or `sessions_remaining` column anywhere to write to:
--
--   remaining_balance  = vouchers.total_amount_issued - SUM(voucher_claims.amount_claimed)
--   sessions_remaining = packages.sessions_total      - COUNT(package_redemptions)
--
-- So a correction has to change one side of that arithmetic. Which side is not
-- a style choice — it depends on what was actually wrong:
--
--   * the issued figure was recorded wrong  -> correct the voucher/package
--   * a claim/redemption never really happened -> void that row
--
-- Both cases are real, so both are provided. Neither is expressible as "set the
-- balance to X" alone, which is why these take the shape they do.
--
-- A third option was rejected: inserting a negative `voucher_claims` row to
-- push the balance back up. `voucher_claims` has CHECK (amount_claimed > 0),
-- and relaxing it would let a negative claim appear anywhere the claim history
-- is read — turning a correction into something that looks like a redemption.
-- The same reasoning rules out a negative `sessions_total`, which is also
-- CHECK-constrained to > 0.
--
--
-- Why voiding is blocked once money is attached
--
-- `voucher_claims.payment_id` and a redemption's `booking_id` mean money or a
-- service actually moved. Deleting such a row silently desyncs the claim from
-- the payment that recorded it, and cash reconciliation reads payments. These
-- functions refuse and say so, mirroring admin_delete_booking()'s behaviour
-- with financial records.

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared guard
-- ---------------------------------------------------------------------------
-- Factored out because four functions need exactly the same three checks, and
-- a divergent copy of an authorization check is how holes appear. Note the
-- IS DISTINCT FROM: get_user_role() is NULL outside an authenticated session,
-- and `NULL <> 'admin'` evaluates to NULL, not true — a plain <> would let a
-- NULL role straight through. (That exact bug was caught in testing 232.)
CREATE OR REPLACE FUNCTION public.assert_admin_correction(p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = 'P0003';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'a reason of at least 10 characters is required' USING ERRCODE = 'P0003';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Vouchers
-- ---------------------------------------------------------------------------
-- The admin types the balance the voucher SHOULD have. This computes the delta
-- and applies it to total_amount_issued, leaving every real claim row intact —
-- claim history is a record of what happened and should not be rewritten to
-- make a total come out right.
CREATE OR REPLACE FUNCTION public.admin_correct_voucher_balance(
  p_voucher_id    uuid,
  p_new_remaining numeric,
  p_reason        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org       uuid := get_user_org_id();
  v_old       jsonb;
  v_new       jsonb;
  v_branch    uuid;
  v_claimed   numeric;
  v_new_total numeric;
BEGIN
  PERFORM assert_admin_correction(p_reason);

  IF p_new_remaining IS NULL OR p_new_remaining < 0 THEN
    RAISE EXCEPTION 'admin_correct_voucher_balance: new remaining balance must be zero or more'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT to_jsonb(v), v.branch_id INTO v_old, v_branch
  FROM public.vouchers v WHERE v.id = p_voucher_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'admin_correct_voucher_balance: voucher % not found', p_voucher_id
      USING ERRCODE = 'P0003';
  END IF;
  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_correct_voucher_balance: voucher is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT COALESCE(SUM(amount_claimed), 0) INTO v_claimed
  FROM public.voucher_claims WHERE voucher_id = p_voucher_id;

  -- remaining = issued - claimed, so issued = desired remaining + claimed.
  v_new_total := p_new_remaining + v_claimed;

  UPDATE public.vouchers SET total_amount_issued = v_new_total WHERE id = p_voucher_id;

  SELECT to_jsonb(v) INTO v_new FROM public.vouchers v WHERE v.id = p_voucher_id;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch, 'vouchers', p_voucher_id, 'ADMIN_CORRECTION', v_old, v_new, auth.uid(), btrim(p_reason));

  RETURN p_voucher_id;
END;
$function$;

-- Remove a claim that never actually happened. Refuses once a payment is
-- attached — see the header.
CREATE OR REPLACE FUNCTION public.admin_void_voucher_claim(
  p_claim_id uuid,
  p_reason   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org    uuid := get_user_org_id();
  v_old    jsonb;
  v_branch uuid;
BEGIN
  PERFORM assert_admin_correction(p_reason);

  SELECT to_jsonb(c), c.branch_claimed_id INTO v_old, v_branch
  FROM public.voucher_claims c WHERE c.id = p_claim_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'admin_void_voucher_claim: claim % not found', p_claim_id
      USING ERRCODE = 'P0003';
  END IF;
  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_void_voucher_claim: claim is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;
  IF (v_old->>'payment_id') IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_HAS_PAYMENT: this claim is linked to a recorded payment and cannot be voided. Correct the voucher balance instead, which leaves the payment intact.'
      USING ERRCODE = 'P0004';
  END IF;

  -- Audit before the delete; afterwards there is nothing left to copy.
  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch, 'voucher_claims', p_claim_id, 'ADMIN_DELETE', v_old, NULL, auth.uid(), btrim(p_reason));

  DELETE FROM public.voucher_claims WHERE id = p_claim_id;

  RETURN p_claim_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Packages
-- ---------------------------------------------------------------------------
-- Packages count sessions, not currency: each package_redemptions row is one
-- session. So the two corrections are "the package was sold with the wrong
-- number of sessions" and "this redemption never happened".
CREATE OR REPLACE FUNCTION public.admin_correct_package_sessions(
  p_package_id        uuid,
  p_new_sessions_total integer,
  p_reason            text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org    uuid := get_user_org_id();
  v_old    jsonb;
  v_new    jsonb;
  v_branch uuid;
  v_used   integer;
BEGIN
  PERFORM assert_admin_correction(p_reason);

  -- packages has CHECK (sessions_total > 0); reject here with a clear message
  -- rather than letting the constraint raise something opaque.
  IF p_new_sessions_total IS NULL OR p_new_sessions_total < 1 THEN
    RAISE EXCEPTION 'admin_correct_package_sessions: sessions_total must be at least 1'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT to_jsonb(p), p.branch_id INTO v_old, v_branch
  FROM public.packages p WHERE p.id = p_package_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'admin_correct_package_sessions: package % not found', p_package_id
      USING ERRCODE = 'P0003';
  END IF;
  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_correct_package_sessions: package is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT count(*) INTO v_used FROM public.package_redemptions WHERE package_id = p_package_id;

  -- Setting the total below what has already been redeemed would make
  -- sessions_remaining negative, which the balances view would then report as
  -- fully redeemed while the arithmetic underneath is nonsense.
  IF p_new_sessions_total < v_used THEN
    RAISE EXCEPTION 'admin_correct_package_sessions: cannot set total to % when % session(s) are already redeemed. Void the incorrect redemption(s) first.',
      p_new_sessions_total, v_used
      USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.packages SET sessions_total = p_new_sessions_total WHERE id = p_package_id;

  SELECT to_jsonb(p) INTO v_new FROM public.packages p WHERE p.id = p_package_id;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch, 'packages', p_package_id, 'ADMIN_CORRECTION', v_old, v_new, auth.uid(), btrim(p_reason));

  RETURN p_package_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_package_redemption(
  p_redemption_id uuid,
  p_reason        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org    uuid := get_user_org_id();
  v_old    jsonb;
  v_branch uuid;
BEGIN
  PERFORM assert_admin_correction(p_reason);

  SELECT to_jsonb(r), r.branch_id INTO v_old, v_branch
  FROM public.package_redemptions r WHERE r.id = p_redemption_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'admin_void_package_redemption: redemption % not found', p_redemption_id
      USING ERRCODE = 'P0003';
  END IF;
  IF (v_old->>'org_id')::uuid IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_void_package_redemption: redemption is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;
  IF (v_old->>'booking_id') IS NOT NULL THEN
    RAISE EXCEPTION 'REDEMPTION_HAS_BOOKING: this redemption is linked to booking %. Correct or delete that booking instead, so the two records stay consistent.',
      (v_old->>'booking_id')
      USING ERRCODE = 'P0004';
  END IF;

  INSERT INTO public.audit_logs
    (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
  VALUES
    (v_branch, 'package_redemptions', p_redemption_id, 'ADMIN_DELETE', v_old, NULL, auth.uid(), btrim(p_reason));

  DELETE FROM public.package_redemptions WHERE id = p_redemption_id;

  RETURN p_redemption_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_admin_correction(text)                          FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_correct_voucher_balance(uuid, numeric, text)     FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_void_voucher_claim(uuid, text)                   FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_correct_package_sessions(uuid, integer, text)    FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_void_package_redemption(uuid, text)              FROM public, anon;

GRANT EXECUTE ON FUNCTION public.admin_correct_voucher_balance(uuid, numeric, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_voucher_claim(uuid, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correct_package_sessions(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_package_redemption(uuid, text)           TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('233', 'admin-voucher-package-corrections')
ON CONFLICT (version) DO NOTHING;

COMMIT;
