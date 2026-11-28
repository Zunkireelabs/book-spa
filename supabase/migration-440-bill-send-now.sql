-- Migration 440 (ZNLY-445): outreach_send_now() — send one just-queued bill email straight away instead of waiting for the 5-minute drain.
-- Same hand-off the cron drain (migration 108) does, for ONE message: queued -> sending, then call the send-message Edge Function.
-- The outbox row stays the record; if this call never lands, the row is still 'sending'/'queued' and the drain retries it.
BEGIN;

CREATE OR REPLACE FUNCTION public.outreach_send_now(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
  v_role text;
  v_cfg private.outreach_function_config;
  v_id uuid;
  v_req bigint;
BEGIN
  SELECT org_id, role INTO v_org, v_role FROM public.users WHERE id = auth.uid();
  IF v_org IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'SEND_NOW_REFUSED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cfg FROM private.outreach_function_config LIMIT 1;
  IF v_cfg IS NULL THEN RETURN false; END IF;   -- not set up: leave it queued for the drain
  UPDATE public.outreach_messages SET status = 'sending', updated_at = now()
   WHERE id = p_message_id AND org_id = v_org AND channel = 'email' AND status = 'queued'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  SELECT net.http_post(
    url     := v_cfg.function_base_url || '/send-message',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_cfg.cron_bearer_token, 'Content-Type', 'application/json'),
    body    := jsonb_build_object('message_id', v_id)
  ) INTO v_req;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.outreach_send_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outreach_send_now(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('440', 'bill-send-now')
ON CONFLICT (version) DO NOTHING;

COMMIT;
