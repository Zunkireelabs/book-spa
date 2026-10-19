-- Migration 286: customer photos/documents move to a private org+branch-scoped bucket; 280's table policies org-scoped
-- Idempotent: safe to re-run in either database. Must follow migration-280 (it alters 280's tables and supersedes its policies).
-- Applied: local only (feat/ui-port-from-clinicmd)
--
-- WHAT WAS WRONG (migration-280)
--   * Files were stored in the PUBLIC service-images bucket at customers/{id}/..., so anyone with the anon key could list and
--     read customers' photos and documents. That bucket also only allows images, so PDF/Word documents could not upload.
--   * Every table policy was "branch_id = my branch OR role = 'admin'" with no org check. The tables have no org_id, so an
--     admin of ANY tenant could read and delete every tenant's customer photo/document rows.
--
-- THE FIX
--   * New uploads go to the private `customer-files` bucket at
--     {org_id}/{branch_id}/customers/{customer_id}/{photos|documents}/{uuid}.{ext}; the row stores that `storage_path` and
--     api.js returns a short-lived signed URL in the same photo_url / file_url field the UI already reads. Legacy rows keep
--     their public URL (photo_url/file_url) and storage_path NULL; one of the two must be set.
--   * Table and storage policies follow the same rule: branch staff read their branch; a branch manager writes their branch;
--     an admin reads/writes any branch of THEIR OWN org. Inserts also pin storage_path to the row's org/branch/customer.
--
-- ROLLBACK
--   DROP POLICY "customer-files read" / "customer-files insert" / "customer-files delete" ON storage.objects;
--   empty the bucket through the Storage API, then DELETE FROM storage.buckets WHERE id = 'customer-files';
--   DROP POLICY "<table> org read" / "<table> org insert" / "<table> org delete" on both tables and re-run 280's six CREATE POLICY;
--   drop customer_photos_has_file / customer_documents_has_file; restore NOT NULL on photo_url / file_url only if no row has a
--   NULL url; drop the storage_path columns; DELETE FROM public.schema_migrations WHERE version = '286'.

BEGIN;

-- ============================================================
-- 1. Rows reference a storage path (new) or a legacy public URL
-- ============================================================

ALTER TABLE public.customer_photos    ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.customer_documents ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.customer_photos    ALTER COLUMN photo_url DROP NOT NULL;
ALTER TABLE public.customer_documents ALTER COLUMN file_url  DROP NOT NULL;
ALTER TABLE public.customer_photos    DROP CONSTRAINT IF EXISTS customer_photos_has_file;
ALTER TABLE public.customer_photos    ADD  CONSTRAINT customer_photos_has_file    CHECK (photo_url IS NOT NULL OR storage_path IS NOT NULL);
ALTER TABLE public.customer_documents DROP CONSTRAINT IF EXISTS customer_documents_has_file;
ALTER TABLE public.customer_documents ADD  CONSTRAINT customer_documents_has_file CHECK (file_url IS NOT NULL OR storage_path IS NOT NULL);

-- ============================================================
-- 2. Table policies: replace 280's ("OR role = 'admin'" let any org's admin through) with org-scoped ones
-- ============================================================

DO $$
DECLARE t text; kind text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_photos', 'customer_documents'] LOOP
    kind := CASE t WHEN 'customer_photos' THEN 'photos' ELSE 'documents' END;
    EXECUTE format('DROP POLICY IF EXISTS "Staff can read branch customer %s" ON public.%I', kind, t);
    EXECUTE format('DROP POLICY IF EXISTS "Manager can insert customer %s" ON public.%I', kind, t);
    EXECUTE format('DROP POLICY IF EXISTS "Manager can delete customer %s" ON public.%I', kind, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s org read" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s org insert" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s org delete" ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY "%1$s org read" ON public.%1$I FOR SELECT TO authenticated USING (
      branch_id = (SELECT get_user_branch_id())
      OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = branch_id AND b.org_id = (SELECT get_user_org_id()))))$p$, t);
    EXECUTE format($p$CREATE POLICY "%1$s org insert" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (
      (SELECT get_user_role()) IN ('manager', 'admin')
      AND (branch_id = (SELECT get_user_branch_id())
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = branch_id AND b.org_id = (SELECT get_user_org_id()))))
      AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.org_id = (SELECT get_user_org_id()))
      AND (storage_path IS NULL OR storage_path LIKE (SELECT get_user_org_id())::text || '/' || branch_id::text || '/customers/' || customer_id::text || '/%2$s/%%'))$p$, t, kind);
    EXECUTE format($p$CREATE POLICY "%1$s org delete" ON public.%1$I FOR DELETE TO authenticated USING (
      (SELECT get_user_role()) IN ('manager', 'admin')
      AND (branch_id = (SELECT get_user_branch_id())
           OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = branch_id AND b.org_id = (SELECT get_user_org_id())))))$p$, t);
  END LOOP;
END $$;

-- ============================================================
-- 3. Private customer-files bucket + policies (folder[1] = org, folder[2] = branch; same rule as the tables)
-- NB: inside the branches subquery the object's path must be written objects.name — a bare `name` would bind to branches.name.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('customer-files', 'customer-files', false, 10485760, ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "customer-files read" ON storage.objects;
CREATE POLICY "customer-files read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'customer-files' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
  AND ((storage.foldername(name))[2] = (SELECT get_user_branch_id())::text
       OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id::text = (storage.foldername(objects.name))[2] AND b.org_id = (SELECT get_user_org_id())))));

DROP POLICY IF EXISTS "customer-files insert" ON storage.objects;
CREATE POLICY "customer-files insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'customer-files' AND (SELECT get_user_role()) IN ('manager', 'admin')
  AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
  AND ((storage.foldername(name))[2] = (SELECT get_user_branch_id())::text
       OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id::text = (storage.foldername(objects.name))[2] AND b.org_id = (SELECT get_user_org_id())))));

DROP POLICY IF EXISTS "customer-files delete" ON storage.objects;
CREATE POLICY "customer-files delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'customer-files' AND (SELECT get_user_role()) IN ('manager', 'admin')
  AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
  AND ((storage.foldername(name))[2] = (SELECT get_user_branch_id())::text
       OR ((SELECT get_user_role()) = 'admin' AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id::text = (storage.foldername(objects.name))[2] AND b.org_id = (SELECT get_user_org_id())))));

INSERT INTO public.schema_migrations (version, name)
VALUES ('286', 'customer-files-private')
ON CONFLICT (version) DO NOTHING;

COMMIT;
