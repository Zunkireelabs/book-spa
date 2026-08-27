-- Migration 107: outreach_ai_config + outreach_ai_consume()
--
-- One row per org holding the AI feature toggle and a monthly token budget.
-- outreach_ai_consume() is a SECURITY DEFINER atomic check-and-increment:
-- it resets the period (tokens_used_this_period -> 0, period_started_at ->
-- now()) if more than 30 days have elapsed since period_started_at, then
-- checks whether p_tokens fits inside the remaining budget, incrementing and
-- returning true if so, or returning false (without incrementing) if not.
--
-- Not called by anything in Phase 1 — AI drafting is Phase 3 — but the
-- table + function ship now so Phase 3 doesn't need a new migration just to
-- add token-budget enforcement. Nothing wires this up yet.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate,
-- CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_ai_config (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  ai_enabled               boolean     NOT NULL DEFAULT false,
  chatbot_enabled          boolean     NOT NULL DEFAULT false,
  monthly_token_budget     integer     NOT NULL DEFAULT 0,
  tokens_used_this_period  integer     NOT NULL DEFAULT 0,
  period_started_at        timestamptz NOT NULL DEFAULT now(),
  model                    text        NOT NULL DEFAULT 'claude-sonnet-5',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- RLS: manager/admin only, read + write.
ALTER TABLE public.outreach_ai_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manager/admin read outreach ai config" ON public.outreach_ai_config;
CREATE POLICY "Manager/admin read outreach ai config"
  ON public.outreach_ai_config FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin insert outreach ai config" ON public.outreach_ai_config;
CREATE POLICY "Manager/admin insert outreach ai config"
  ON public.outreach_ai_config FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin update outreach ai config" ON public.outreach_ai_config;
CREATE POLICY "Manager/admin update outreach ai config"
  ON public.outreach_ai_config FOR UPDATE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'))
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin delete outreach ai config" ON public.outreach_ai_config;
CREATE POLICY "Manager/admin delete outreach ai config"
  ON public.outreach_ai_config FOR DELETE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

-- ---- outreach_ai_consume(): atomic check-and-increment token budget ----

CREATE OR REPLACE FUNCTION public.outreach_ai_consume(
  p_org_id uuid,
  p_tokens integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.outreach_ai_config;
  v_allowed boolean := false;
BEGIN
  IF p_tokens IS NULL OR p_tokens < 0 THEN
    RAISE EXCEPTION 'outreach_ai_consume: p_tokens must be a non-negative integer';
  END IF;

  SELECT * INTO v_row
  FROM public.outreach_ai_config
  WHERE org_id = p_org_id
  FOR UPDATE;

  IF v_row IS NULL THEN
    RETURN false;
  END IF;

  -- Reset the rolling 30-day period if it has elapsed.
  IF now() - v_row.period_started_at > interval '30 days' THEN
    UPDATE public.outreach_ai_config
       SET tokens_used_this_period = 0,
           period_started_at = now()
     WHERE org_id = p_org_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.tokens_used_this_period + p_tokens <= v_row.monthly_token_budget THEN
    UPDATE public.outreach_ai_config
       SET tokens_used_this_period = tokens_used_this_period + p_tokens,
           updated_at = now()
     WHERE org_id = p_org_id;
    v_allowed := true;
  END IF;

  RETURN v_allowed;
END;
$$;

-- Not called by anything in Phase 1 and not client-facing: this will be
-- invoked from Edge Functions (service-role context) in Phase 3, not
-- directly from authenticated client sessions (it takes an arbitrary
-- p_org_id with no caller-org check, so granting it to `authenticated` today
-- would let any logged-in user spend another org's AI token budget). Revoke
-- from anon/authenticated; Phase 3 grants explicitly to whatever role needs
-- it once the caller is known.
REVOKE ALL ON FUNCTION public.outreach_ai_consume(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_ai_consume(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.outreach_ai_consume(uuid, integer) FROM authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('107', 'outreach-ai-config')
ON CONFLICT (version) DO NOTHING;

COMMIT;
