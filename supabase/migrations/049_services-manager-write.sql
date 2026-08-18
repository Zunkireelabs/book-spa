-- Migration 049: open services INSERT/UPDATE/DELETE RLS to manager + admin (additive, REVERSIBLE)
--
-- Until now, the public.services table's write policies were admin-only. The Setup → Services
-- panel was correspondingly gated to admin in the sidebar and in src/services/api.js. This
-- migration relaxes the DB policies to also allow role = 'manager' so that branch managers
-- can update service pricing / details, create new services, and delete unused services.
--
-- Tenant scope unchanged: every policy still requires org_id = get_user_org_id(), so a
-- manager can only affect their own org's services. Services remain org-global (no
-- branch_id) — any manager update affects every branch in the org. Frontend `api.js` still
-- runs the same per-org tenant filters and the same booking-existence checks before delete.
--
-- service_categories needs NO DB change — its INSERT/UPDATE/DELETE policies on staging are
-- already permissive (USING true / WITH CHECK true). The admin-only gate for categories
-- previously lived only in src/services/api.js, which is being relaxed in the same PR.
--
-- Idempotent (DROP IF EXISTS + CREATE) and portable (no hardcoded UUIDs).
--
-- Reversible: re-run migration-005-admin-write-policies.sql (INSERT/UPDATE) and the
-- services portion of migration-008-staff-service-delete-policies.sql (DELETE) — or drop
-- the new policies and recreate the org-scoped admin-only versions:
--   DROP POLICY IF EXISTS "Manager and admin can create org services" ON public.services;
--   DROP POLICY IF EXISTS "Manager and admin can update org services" ON public.services;
--   DROP POLICY IF EXISTS "Manager and admin can delete org services" ON public.services;
--   CREATE POLICY "Admin can create org services" ON public.services FOR INSERT TO authenticated
--     WITH CHECK (get_user_role() = 'admin' AND org_id = get_user_org_id());
--   ...

-- 1. Drop both the legacy admin-only policies (from migration-005/008) AND the current
--    org-scoped admin-only policies that supersede them. IF EXISTS so it's safe on every env.
DROP POLICY IF EXISTS "Admin can create services"     ON public.services;
DROP POLICY IF EXISTS "Admin can update services"     ON public.services;
DROP POLICY IF EXISTS "Admin can delete services"     ON public.services;
DROP POLICY IF EXISTS "Admin can create org services" ON public.services;
DROP POLICY IF EXISTS "Admin can update org services" ON public.services;
DROP POLICY IF EXISTS "Admin can delete org services" ON public.services;

-- 2. Re-create as manager + admin, keeping the org scope.
CREATE POLICY "Manager and admin can create org services"
  ON public.services FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

CREATE POLICY "Manager and admin can update org services"
  ON public.services FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

CREATE POLICY "Manager and admin can delete org services"
  ON public.services FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

-- 3. Record migration
INSERT INTO public.schema_migrations (version, name)
VALUES ('049', 'services-manager-write')
ON CONFLICT (version) DO NOTHING;
