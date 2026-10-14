-- Migration 280: customer photo gallery + document attachments
-- Additive only. Idempotent: safe to re-run in either database.
-- Applied: stage 2026-10-13 / prod HELD.
--
-- Backs the Photos and Documents tabs on the staff-facing customer detail
-- page (Timely-style restyle). Photos/documents are replace-by-delete-and-
-- reinsert, never edited in place, so no UPDATE policy is needed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  uploaded_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_photos_customer ON public.customer_photos(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_branch ON public.customer_photos(branch_id);

CREATE TABLE IF NOT EXISTS public.customer_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_documents_customer ON public.customer_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_documents_branch ON public.customer_documents(branch_id);

ALTER TABLE public.customer_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read branch customer photos" ON public.customer_photos;
CREATE POLICY "Staff can read branch customer photos"
  ON public.customer_photos FOR SELECT
  TO authenticated
  USING (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS "Manager can insert customer photos" ON public.customer_photos;
CREATE POLICY "Manager can insert customer photos"
  ON public.customer_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Manager can delete customer photos" ON public.customer_photos;
CREATE POLICY "Manager can delete customer photos"
  ON public.customer_photos FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Staff can read branch customer documents" ON public.customer_documents;
CREATE POLICY "Staff can read branch customer documents"
  ON public.customer_documents FOR SELECT
  TO authenticated
  USING (
    branch_id = (SELECT get_user_branch_id())
    OR (SELECT get_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS "Manager can insert customer documents" ON public.customer_documents;
CREATE POLICY "Manager can insert customer documents"
  ON public.customer_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Manager can delete customer documents" ON public.customer_documents;
CREATE POLICY "Manager can delete customer documents"
  ON public.customer_documents FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('manager', 'admin')
    AND (branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin')
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('280', 'customer-photos-documents')
ON CONFLICT (version) DO NOTHING;

COMMIT;
