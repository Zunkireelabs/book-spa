-- Migration 249: service↔staff eligibility allow-list (additive, REVERSIBLE)
--
-- therapists.specialties (text[]) is pure display today, never enforced at assignment. Real
-- need: two same-role staff can differ in which services they're actually qualified for (e.g.
-- Pregnancy Massage). This adds an explicit allow-list join table instead of parsing
-- specialties text:
--
--   - No rows for a service = unrestricted (every is_service_staff therapist in the branch
--     stays eligible — today's behavior, unchanged default for every existing org).
--   - >=1 row for a service = eligibility narrows to exactly those therapist IDs.
--
-- Strictly additive/opt-in: nuad-thai and every other existing org sees zero behavior change
-- until an admin explicitly adds rows via the new Eligible Staff picker on a service.
--
-- No org_id column here (mirrors other service-scoped join tables) — RLS joins through
-- services.org_id, same org-scoping pattern as migration-049's services write policies.
--
-- Reversible: DROP TABLE IF EXISTS public.service_therapists;

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_therapists (
  service_id   uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  therapist_id uuid NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (service_id, therapist_id)
);

CREATE INDEX IF NOT EXISTS idx_service_therapists_therapist ON public.service_therapists(therapist_id);

ALTER TABLE public.service_therapists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read org service_therapists" ON public.service_therapists;
CREATE POLICY "Authenticated users can read org service_therapists"
  ON public.service_therapists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_therapists.service_id
        AND s.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Manager and admin can manage org service_therapists" ON public.service_therapists;
CREATE POLICY "Manager and admin can manage org service_therapists"
  ON public.service_therapists FOR ALL
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_therapists.service_id
        AND s.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_therapists.service_id
        AND s.org_id = get_user_org_id()
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('249', 'service-staff-eligibility')
ON CONFLICT (version) DO NOTHING;

COMMIT;
