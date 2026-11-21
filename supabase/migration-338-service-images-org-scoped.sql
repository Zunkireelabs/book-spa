-- Migration 338: service-images writes scoped to the uploader's org; no anonymous listing (supersedes migration-014's policies)
-- Idempotent: safe to re-run in either database.
-- Applied: local only (feat/ui-port-from-clinicmd)
--
-- WHAT WAS WRONG
--   migration-014's INSERT/UPDATE/DELETE policies on storage.objects only checked the role (admin/manager), so an admin or
--   manager of ANY tenant could overwrite or delete another tenant's service, staff, product and campaign images. Its
--   public SELECT policy also let the anon key (shipped in the frontend bundle) LIST the whole bucket.
--
-- THE FIX
--   * New uploads go to {org_id}/{services|staff|products|campaigns}/{file} (api.js). Writes require the first folder to be
--     the uploader's own org. Legacy flat objects (services/..., staff/..., ...) can never match an org UUID, so they become
--     write-locked: still served by public URL, never moved (renaming storage.objects.name would orphan the bytes).
--     "Replacing" an image = uploading a new org-prefixed object and repointing the row, which is what the forms do.
--   * No UPDATE policy: every upload is upsert:false and nothing updates objects in place, so in-place overwrite is gone.
--   * The public SELECT policy is dropped. Public URLs (/storage/v1/object/public/service-images/...) are served for a public
--     bucket regardless of storage.objects RLS (verified locally), so the public booking page keeps its images while
--     /object/list returns nothing to anon. Signed-in users keep SELECT on their own org folder only (remove() needs it).
--   * A drift detector warns about any OTHER policy that mentions service-images (e.g. one made in a project's dashboard),
--     which the DROP IF EXISTS statements below would not catch. WARNING, not EXCEPTION, so CI keeps going.
--
-- ROLLBACK
--   DROP POLICY "service-images org read" / "service-images org insert" / "service-images org delete" ON storage.objects;
--   then re-run migration-014's four CREATE POLICY statements.

BEGIN;

DROP POLICY IF EXISTS "Public can view service images" ON storage.objects;
DROP POLICY IF EXISTS "Admin and Manager can upload service images" ON storage.objects;
DROP POLICY IF EXISTS "Admin and Manager can update service images" ON storage.objects;
DROP POLICY IF EXISTS "Admin and Manager can delete service images" ON storage.objects;

DROP POLICY IF EXISTS "service-images org read" ON storage.objects;
CREATE POLICY "service-images org read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'service-images' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text);

DROP POLICY IF EXISTS "service-images org insert" ON storage.objects;
CREATE POLICY "service-images org insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'service-images' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
              AND (SELECT get_user_role()) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "service-images org delete" ON storage.objects;
CREATE POLICY "service-images org delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'service-images' AND (storage.foldername(name))[1] = (SELECT get_user_org_id())::text
         AND (SELECT get_user_role()) IN ('admin', 'manager'));

-- Drift detector: any other policy touching this bucket was not made by a migration and would still apply.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (coalesce(qual, '') LIKE '%service-images%' OR coalesce(with_check, '') LIKE '%service-images%')
      AND policyname NOT IN ('service-images org read', 'service-images org insert', 'service-images org delete')
  LOOP
    RAISE WARNING 'migration-338: unexpected storage.objects policy "%" (%) still applies to service-images; review and drop it if it is not intended', r.policyname, r.cmd;
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('338', 'service-images-org-scoped')
ON CONFLICT (version) DO NOTHING;

COMMIT;
