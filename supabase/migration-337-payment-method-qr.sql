-- Migration 337: per-method payment QR codes + private `payment-qr` storage bucket
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: local only (feat/ui-port-from-clinicmd)
--
-- WHY
--   Spas want to show their static merchant QR (Fonepay / eSewa / Khalti / bank) at checkout. Staff present it to
--   the guest and confirm the money arrived; there is no automatic confirmation (Fonepay API is a later project).
--
-- DESIGN
--   * One row per (org, leaf payment method). `method` is the exact leaf value that a checkout row holds and that is
--     written to payments.payment_mode (e.g. 'eSewa', 'MobileBanking'). organizations.settings.paymentMethods is NOT
--     touched: its writer (updateOrgPaymentMethods) strips unknown keys and a dozen readers assume string sub-methods.
--   * branch_id NULL = org-wide QR. v1 only uses org rows; branch rows are reserved for a later per-branch override.
--   * Two partial unique indexes instead of UNIQUE NULLS NOT DISTINCT (PG15+), so this runs on any PG version.
--   * The QR image lives in a PRIVATE bucket at {org_id}/org/{uuid}.{ext}. The risk with a merchant QR is not secrecy
--     but substitution (diverting the spa's money), so only an admin of the same org can write, and only into their
--     own org's folder. Any authenticated user of the org can read (staff run checkout) via signed URLs.
--   * No "confirmed by QR" trace: the payment row's payment_mode is the record (owner decision 2026-10-19).
--
-- ROLLBACK
--   DROP POLICY "payment-qr org read" / "payment-qr admin insert" / "payment-qr admin update" / "payment-qr admin delete"
--     ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'payment-qr'; DELETE FROM storage.buckets WHERE id = 'payment-qr';
--   DROP TABLE public.payment_method_qr;
--   DELETE FROM public.schema_migrations WHERE version = '337';

BEGIN;

-- ============================================================
-- 1. payment_method_qr
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_method_qr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,       -- NULL = org-wide (the only kind used in v1)
  method text NOT NULL CHECK (length(btrim(method)) BETWEEN 1 AND 40),  -- leaf payment_mode value
  storage_path text NOT NULL,
  updated_by uuid REFERENCES public.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_method_qr_path_in_org CHECK (split_part(storage_path, '/', 1) = org_id::text)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_method_qr_org_method_uidx
  ON public.payment_method_qr (org_id, method) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_method_qr_branch_method_uidx
  ON public.payment_method_qr (org_id, branch_id, method) WHERE branch_id IS NOT NULL;

ALTER TABLE public.payment_method_qr ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pmqr_select ON public.payment_method_qr;
CREATE POLICY pmqr_select ON public.payment_method_qr FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()));

DROP POLICY IF EXISTS pmqr_admin_write ON public.payment_method_qr;
CREATE POLICY pmqr_admin_write ON public.payment_method_qr FOR ALL TO authenticated
  USING (org_id = (SELECT get_user_org_id()) AND (SELECT get_user_role()) = 'admin')
  WITH CHECK (
    org_id = (SELECT get_user_org_id())
    AND (SELECT get_user_role()) = 'admin'
    AND (branch_id IS NULL OR EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = branch_id AND b.org_id = (SELECT get_user_org_id())
    ))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_method_qr TO authenticated;

-- ============================================================
-- 2. Private `payment-qr` bucket + org-scoped policies
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-qr', 'payment-qr', false, 1048576, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "payment-qr org read" ON storage.objects;
CREATE POLICY "payment-qr org read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-qr' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text);

DROP POLICY IF EXISTS "payment-qr admin insert" ON storage.objects;
CREATE POLICY "payment-qr admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-qr' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
              AND (SELECT get_user_role()) = 'admin');

DROP POLICY IF EXISTS "payment-qr admin update" ON storage.objects;
CREATE POLICY "payment-qr admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-qr' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
         AND (SELECT get_user_role()) = 'admin')
  WITH CHECK (bucket_id = 'payment-qr' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
              AND (SELECT get_user_role()) = 'admin');

DROP POLICY IF EXISTS "payment-qr admin delete" ON storage.objects;
CREATE POLICY "payment-qr admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-qr' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
         AND (SELECT get_user_role()) = 'admin');

INSERT INTO public.schema_migrations (version, name)
VALUES ('337', 'payment-method-qr')
ON CONFLICT (version) DO NOTHING;

COMMIT;
