-- Migration 438 (ZNLY-410 step 2, Part B): bill_send_state() — can this org send a bill by email, and what happened to the last one?
-- Staff can send (outreach_send_manual) but cannot read outreach_provider_config / outreach_messages (RLS), so this one narrow
-- SECURITY DEFINER read answers for every role: caller's org only, no message bodies. Bill emails carry the bill number in their
-- dedupe key ('bill:<BK-…>:<uuid>'), so a visit bill sent from any of its rows shows the same state.
BEGIN;

CREATE OR REPLACE FUNCTION public.bill_send_state(p_bill_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
  v_role text;
  v_prefix text := 'bill:' || COALESCE(p_bill_number, '') || ':';
  v_last jsonb;
BEGIN
  SELECT org_id, role INTO v_org, v_role FROM public.users WHERE id = auth.uid();
  IF v_org IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'BILL_SEND_REFUSED' USING ERRCODE = '42501';
  END IF;
  IF p_bill_number IS NOT NULL THEN
    SELECT jsonb_build_object('status', m.status, 'to_address', m.to_address, 'created_at', m.created_at) INTO v_last
    FROM public.outreach_messages m
    WHERE m.org_id = v_org AND m.channel = 'email' AND left(m.dedupe_key, length(v_prefix)) = v_prefix
    ORDER BY m.created_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'email_ready', EXISTS (SELECT 1 FROM public.outreach_provider_config c WHERE c.org_id = v_org AND c.channel = 'email'),
    'last', v_last);
END;
$$;

REVOKE ALL ON FUNCTION public.bill_send_state(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_send_state(text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('438', 'bill-send-state')
ON CONFLICT (version) DO NOTHING;

COMMIT;
