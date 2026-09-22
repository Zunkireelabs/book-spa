-- Migration 186: outreach HTML email layouts
--
-- Outreach email templates (migration-102) send raw unstyled HTML straight
-- to Resend (see send-message/_shared/channels.ts) — no header, footer,
-- branding, or CSS wrapper anywhere. Adds a reusable "layout" concept: an
-- outreach_layouts row is an HTML string containing a literal {{content}}
-- slot; a template optionally picks one layout_id. At send time (see
-- migration-187, which extends outreach_scan_winback/
-- outreach_enqueue_for_completed) the layout's {{content}} is replaced with
-- the template's body BEFORE the existing {{customer_name}} substitution
-- runs on the combined string — so a layout's own chrome text can also use
-- {{customer_name}}. A template with layout_id NULL keeps sending exactly
-- as it does today (no behavior change for existing templates).
--
-- org_id NULL = a system built-in layout, visible to every org, not
-- editable/deletable via the UI (seeded below, this migration only).
-- org_id set = that org's own custom/pasted layout, visible only to them.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate,
-- INSERT ... WHERE NOT EXISTS for the seeded built-ins (can't use a UNIQUE
-- constraint on name since two different orgs could legitimately both name
-- a custom layout "Simple").

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_layouts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  html       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_layouts_org ON public.outreach_layouts(org_id);

ALTER TABLE public.outreach_layouts ENABLE ROW LEVEL SECURITY;

-- Read: any org member sees their own org's custom layouts AND every system
-- built-in (org_id IS NULL) — mirrors outreach_templates' "any org member
-- reads" posture (migration-102).
DROP POLICY IF EXISTS "Org members read outreach layouts" ON public.outreach_layouts;
CREATE POLICY "Org members read outreach layouts"
  ON public.outreach_layouts FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() OR org_id IS NULL);

-- Write: manager/admin only, and only into their own org — never a system
-- row (org_id IS NULL fails the org_id = get_user_org_id() check on both
-- INSERT's WITH CHECK and UPDATE/DELETE's USING) and never another org's row.
DROP POLICY IF EXISTS "Manager/admin write outreach layouts" ON public.outreach_layouts;
CREATE POLICY "Manager/admin write outreach layouts"
  ON public.outreach_layouts FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin update outreach layouts" ON public.outreach_layouts;
CREATE POLICY "Manager/admin update outreach layouts"
  ON public.outreach_layouts FOR UPDATE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'))
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin delete outreach layouts" ON public.outreach_layouts;
CREATE POLICY "Manager/admin delete outreach layouts"
  ON public.outreach_layouts FOR DELETE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

-- Seed 3 system built-in layouts (org_id NULL). Each must contain the
-- literal token {{content}} exactly once. Guarded by WHERE NOT EXISTS
-- (name match among org_id IS NULL rows) so re-running this file is a no-op.
INSERT INTO public.outreach_layouts (org_id, name, html)
SELECT NULL, 'Simple',
$html$<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  {{content}}
</div>$html$
WHERE NOT EXISTS (
  SELECT 1 FROM public.outreach_layouts WHERE org_id IS NULL AND name = 'Simple'
);

INSERT INTO public.outreach_layouts (org_id, name, html)
SELECT NULL, 'Branded Header',
$html$<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937;border:1px solid #E1E3E5;border-radius:8px;overflow:hidden;">
  <div style="background:#2D5A27;padding:20px 24px;">
    <span style="color:#ffffff;font-size:18px;font-weight:600;">Nuad Thai Spa</span>
  </div>
  <div style="padding:24px;">
    {{content}}
  </div>
  <div style="background:#FAFAF9;padding:16px 24px;font-size:12px;color:#6b7280;">
    You're receiving this because you're a valued customer.
  </div>
</div>$html$
WHERE NOT EXISTS (
  SELECT 1 FROM public.outreach_layouts WHERE org_id IS NULL AND name = 'Branded Header'
);

INSERT INTO public.outreach_layouts (org_id, name, html)
SELECT NULL, 'Promo Banner',
$html$<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937;border:1px solid #E1E3E5;border-radius:8px;overflow:hidden;">
  <div style="background:#DAA520;padding:32px 24px;text-align:center;">
    <span style="color:#ffffff;font-size:22px;font-weight:700;">Special Offer</span>
  </div>
  <div style="padding:24px;">
    {{content}}
    <div style="text-align:center;margin-top:20px;">
      <a href="#" style="display:inline-block;background:#2D5A27;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book Now</a>
    </div>
  </div>
</div>$html$
WHERE NOT EXISTS (
  SELECT 1 FROM public.outreach_layouts WHERE org_id IS NULL AND name = 'Promo Banner'
);

ALTER TABLE public.outreach_templates
  ADD COLUMN IF NOT EXISTS layout_id uuid REFERENCES public.outreach_layouts(id);

INSERT INTO public.schema_migrations (version, name)
VALUES ('186', 'outreach-layouts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
