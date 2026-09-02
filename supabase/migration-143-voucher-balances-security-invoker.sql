-- Migration 143: close voucher_balances RLS bypass
--
-- voucher_balances (migration-072) was created without `security_invoker`, so
-- Postgres evaluates the underlying vouchers/voucher_claims RLS policies
-- using the VIEW OWNER's privileges instead of the querying role's. Since
-- the owner effectively bypasses RLS, any role with SELECT on the view --
-- including anon -- reads every org's voucher balances. Confirmed live on
-- production: ~155 voucher rows readable by anon across all orgs.
--
-- Fix: `security_invoker = true` makes the view defer to the querying
-- role's own RLS instead of the owner's -- the same clause migration-141
-- already applies to package_balances. No data change, no application code
-- change; vouchers/voucher_claims' existing RLS policies (manager/admin/
-- admin_viewer only, org-scoped) now apply correctly through the view too.
--
-- Idempotent: CREATE OR REPLACE VIEW.
--
-- Reversible (manual, NOT recommended -- restores the bypass):
--   CREATE OR REPLACE VIEW public.voucher_balances AS <body below, minus the WITH clause>;

CREATE OR REPLACE VIEW public.voucher_balances WITH (security_invoker = true) AS
SELECT
  v.id                    AS voucher_id,
  v.org_id,
  v.branch_id,
  v.voucher_code,
  v.guest_name,
  v.guest_info,
  v.total_amount_issued,
  COALESCE(c.total_claimed, 0)                              AS total_claimed,
  v.total_amount_issued - COALESCE(c.total_claimed, 0)       AS remaining_balance,
  CASE
    WHEN COALESCE(c.total_claimed, 0) = 0 THEN 'unused'
    WHEN v.total_amount_issued - COALESCE(c.total_claimed, 0) <= 0 THEN 'fully_redeemed'
    ELSE 'partially_used'
  END                                                        AS status,
  c.last_claim_date
FROM public.vouchers v
LEFT JOIN (
  SELECT voucher_id,
         SUM(amount_claimed) AS total_claimed,
         MAX(redeemed_date)  AS last_claim_date
  FROM public.voucher_claims
  GROUP BY voucher_id
) c ON c.voucher_id = v.id;

-- ============================================================
-- RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('143', 'voucher-balances-security-invoker')
ON CONFLICT (version) DO NOTHING;
