# Outreach HTML Email Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff pick a pre-built styled HTML layout (or paste their own custom one) for an Outreach email template, and fix the Templates editor's Preview box so it actually renders HTML instead of showing raw tags as text.

**Architecture:** A new `outreach_layouts` table holds reusable HTML wrappers (system built-ins with `org_id IS NULL`, plus per-org custom/pasted ones), each containing a literal `{{content}}` slot. `outreach_templates` gets a nullable `layout_id` FK. The two existing SQL functions that build `outreach_messages` rows (`outreach_scan_winback`, `outreach_enqueue_for_completed`, both in `supabase/migration-108-outreach-cron-scans.sql`) are extended to look up the template's layout, substitute `{{content}}` with the template body, *then* run the existing `{{customer_name}}` substitution on the combined string. This means `outreach_messages.body` is already the final ready-to-send HTML when `send-message`/`_shared/channels.ts` read it — **those files need zero changes.** Client-side, `renderTemplatePreview()` in `api.js` mirrors the same two-step combine, and `TemplateEditorPanel.jsx` renders the result via `dangerouslySetInnerHTML` (sanitized with a new `dompurify` dependency, since the preview is a real browser context unlike the actual email).

**Tech Stack:** React 18, Supabase (Postgres + RLS + SQL functions), Vitest, `dompurify` (new dependency).

**Spec:** `docs/superpowers/specs/2026-09-22-outreach-html-email-layouts-design.md`

## Global Constraints

- Dropdowns must use `CustomSelect` (`src/components/ui/CustomSelect.jsx`), never a native `<select>` — CLAUDE.md quality standard.
- `npm run build` must pass and `npm test` must pass before any task is considered done.
- Migration files are idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + recreate, `CREATE OR REPLACE FUNCTION`, `INSERT ... ON CONFLICT DO NOTHING` for the `schema_migrations` self-record) — matches every existing migration in this repo.
- Do not split `src/services/api.js` into per-domain files — the monolith is intentional (CLAUDE.md).
- Git attribution: commits end with `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`, no Claude branding (CLAUDE.md).
- Before naming the new migration file, run `ls supabase/migration-*.sql | sed -E 's/.*migration-([0-9]+).*/\1/' | sort -n | tail -3` to confirm the next free number — this plan assumes **186** based on 185 being the latest as of writing; if a newer migration has landed since, use the actual next number instead and adjust every reference to "186" in this plan accordingly.

---

### Task 1: Migration — `outreach_layouts` table, RLS, seed built-ins, `layout_id` column

**Files:**
- Create: `supabase/migration-186-outreach-layouts.sql`

**Interfaces:**
- Produces: table `public.outreach_layouts(id uuid, org_id uuid NULL, name text, html text, is_active boolean, created_at timestamptz)`; column `public.outreach_templates.layout_id uuid NULL REFERENCES outreach_layouts(id)`.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply to staging and verify**

Run (uses this repo's standard staging connection string convention — same
host/user/password already used earlier this session for `packages`
migrations):

```bash
psql "postgresql://postgres.snzcckzfmpboeqkktmwy:Zunkireelabs%25123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -f supabase/migration-186-outreach-layouts.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE` x2 (RLS enable is
folded into the `ENABLE ROW LEVEL SECURITY` line), policy creates, three
`INSERT 0 1` (or `INSERT 0 0` on a re-run — idempotent), `ALTER TABLE`
(the `layout_id` column add), `INSERT 0 1` for the migration record. No
errors.

Then verify the three seeded rows and the new column exist:

```bash
psql "postgresql://postgres.snzcckzfmpboeqkktmwy:Zunkireelabs%25123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -c "select name, org_id, html like '%{{content}}%' as has_slot from outreach_layouts order by name;"
psql "postgresql://postgres.snzcckzfmpboeqkktmwy:Zunkireelabs%25123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -c "select column_name from information_schema.columns where table_name='outreach_templates' and column_name='layout_id';"
```

Expected: 3 rows (`Branded Header`, `Promo Banner`, `Simple`), all
`org_id` NULL, all `has_slot` true; `layout_id` column present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-186-outreach-layouts.sql
git commit -m "$(cat <<'EOF'
feat(outreach): add outreach_layouts table + layout_id on templates

Outreach templates send raw unstyled HTML straight to Resend with no
header/footer/branding wrapper anywhere. Adds a reusable layout
concept: system built-ins (org_id NULL, 3 seeded here) plus per-org
custom layouts, each an HTML string with a {{content}} slot.
layout_id on outreach_templates is nullable — no behavior change for
existing templates until one is explicitly picked.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---

### Task 2: Migration — combine layout into the two send-time SQL functions

**Files:**
- Create: `supabase/migration-187-outreach-layout-combine.sql`

**Interfaces:**
- Consumes: `public.outreach_layouts` table + `outreach_templates.layout_id` from Task 1.
- Produces: `outreach_scan_winback()` and `outreach_enqueue_for_completed(uuid)` now combine a template's layout before the existing `{{customer_name}}` substitution. No signature change to either function (same params/return types) — callers (pg_cron jobs, and any code calling `outreach_enqueue_for_completed`) need no changes.

- [ ] **Step 1: Write the migration file**

This `CREATE OR REPLACE`s both functions with their full current bodies
(copied from `supabase/migration-108-outreach-cron-scans.sql`), each with
one targeted change: a layout lookup added, and the body-substitution line
changed to combine-then-replace.

```sql
-- Migration 187: combine outreach_layouts into the two send-time functions
--
-- Extends outreach_scan_winback() and outreach_enqueue_for_completed()
-- (both originally defined in migration-108) so a template's layout_id (if
-- set) wraps the body before the existing {{customer_name}} substitution
-- runs. A template with layout_id NULL falls back to the literal string
-- '{{content}}' as the "wrapper" (a no-op passthrough), so untouched
-- templates behave identically to before this migration.
--
-- CREATE OR REPLACE with the SAME parameter list as migration-108 (no new
-- overload risk here, unlike issue_package in migration-185 — neither
-- function's signature changes, only their bodies).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION public.outreach_scan_winback()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  v_review_org_ids uuid[];
  v_org_id uuid;
BEGIN
  WITH win_back_rules AS (
    SELECT r.id AS rule_id, r.org_id, r.channel, r.template_id, r.send_mode, r.lapsed_days
    FROM public.outreach_rules r
    WHERE r.trigger_type = 'win_back'
      AND r.enabled = true
      AND r.lapsed_days IS NOT NULL
  ),
  last_completed AS (
    SELECT DISTINCT ON (b.customer_id)
      b.id AS booking_id,
      b.customer_id,
      br.org_id,
      b.updated_at AS completed_at
    FROM public.bookings b
    JOIN public.branches br ON br.id = b.branch_id
    JOIN win_back_rules wr ON wr.org_id = br.org_id
    WHERE b.status = 'Completed'
      AND b.customer_id IS NOT NULL
    ORDER BY b.customer_id, b.updated_at DESC
  ),
  candidates AS (
    SELECT
      lc.booking_id,
      lc.customer_id,
      lc.org_id,
      lc.completed_at,
      wr.rule_id,
      wr.channel,
      wr.template_id,
      wr.send_mode
    FROM last_completed lc
    JOIN win_back_rules wr ON wr.org_id = lc.org_id
    WHERE lc.completed_at < now() - (wr.lapsed_days || ' days')::interval
  ),
  eligible AS (
    SELECT
      c.*,
      cu.full_name AS customer_name,
      cu.email     AS customer_email,
      'win_back:' || c.customer_id || ':' || to_char(c.completed_at, 'YYYY-MM-DD') AS dedupe_key
    FROM candidates c
    JOIN public.customers cu ON cu.id = c.customer_id
    WHERE cu.email IS NOT NULL AND btrim(cu.email) <> ''
  ),
  templated AS (
    SELECT
      e.*,
      t.subject   AS template_subject,
      t.body      AS template_body,
      l.html      AS layout_html
    FROM eligible e
    JOIN public.outreach_templates t ON t.id = e.template_id
    LEFT JOIN public.outreach_layouts l ON l.id = t.layout_id
  ),
  inserted AS (
    INSERT INTO public.outreach_messages (
      org_id, rule_id, customer_id, booking_id, channel, to_address,
      subject, body, status, source, dedupe_key
    )
    SELECT
      tp.org_id,
      tp.rule_id,
      tp.customer_id,
      tp.booking_id,
      tp.channel,
      tp.customer_email,
      replace(tp.template_subject, '{{customer_name}}', tp.customer_name),
      replace(
        replace(COALESCE(tp.layout_html, '{{content}}'), '{{content}}', tp.template_body),
        '{{customer_name}}', tp.customer_name
      ),
      CASE WHEN tp.send_mode = 'auto' THEN 'queued' ELSE 'review' END,
      'template',
      tp.dedupe_key
    FROM templated tp
    ON CONFLICT (org_id, dedupe_key) DO NOTHING
    RETURNING org_id, status
  )
  SELECT count(*), array_agg(DISTINCT org_id) FILTER (WHERE status = 'review')
    INTO v_count, v_review_org_ids
  FROM inserted;

  IF v_review_org_ids IS NOT NULL THEN
    FOREACH v_org_id IN ARRAY v_review_org_ids LOOP
      PERFORM public.notify_outreach_review(v_org_id);
    END LOOP;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.outreach_scan_winback() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_scan_winback() FROM anon;
REVOKE ALL ON FUNCTION public.outreach_scan_winback() FROM authenticated;

CREATE OR REPLACE FUNCTION public.outreach_enqueue_for_completed(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking  public.bookings;
  v_rule     public.outreach_rules;
  v_template public.outreach_templates;
  v_layout   public.outreach_layouts;
  v_customer public.customers;
  v_delay_hours integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RETURN;
  END IF;

  IF v_booking.customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_rule
  FROM public.outreach_rules
  WHERE org_id = (SELECT org_id FROM public.branches WHERE id = v_booking.branch_id)
    AND trigger_type = 'review_request'
    AND enabled = true;

  IF v_rule IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_template FROM public.outreach_templates WHERE id = v_rule.template_id;
  IF v_template IS NULL THEN
    RETURN;
  END IF;

  IF v_template.layout_id IS NOT NULL THEN
    SELECT * INTO v_layout FROM public.outreach_layouts WHERE id = v_template.layout_id;
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = v_booking.customer_id;
  IF v_customer IS NULL OR v_customer.email IS NULL OR btrim(v_customer.email) = '' THEN
    RETURN;
  END IF;

  v_delay_hours := COALESCE(v_rule.review_delay_hours, 24);

  INSERT INTO public.outreach_messages (
    org_id, rule_id, customer_id, booking_id, channel, to_address,
    subject, body, status, source, dedupe_key, scheduled_for
  )
  VALUES (
    v_rule.org_id,
    v_rule.id,
    v_customer.id,
    v_booking.id,
    v_rule.channel,
    v_customer.email,
    replace(v_template.subject, '{{customer_name}}', v_customer.full_name),
    replace(
      replace(COALESCE(v_layout.html, '{{content}}'), '{{content}}', v_template.body),
      '{{customer_name}}', v_customer.full_name
    ),
    CASE WHEN v_rule.send_mode = 'auto' THEN 'queued' ELSE 'review' END,
    'template',
    'review_request:' || p_booking_id,
    now() + (v_delay_hours || ' hours')::interval
  )
  ON CONFLICT (org_id, dedupe_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.outreach_enqueue_for_completed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_enqueue_for_completed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.outreach_enqueue_for_completed(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('187', 'outreach-layout-combine')
ON CONFLICT (version) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Apply to staging and verify with a manual SQL exercise**

```bash
psql "postgresql://postgres.snzcckzfmpboeqkktmwy:Zunkireelabs%25123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -f supabase/migration-187-outreach-layout-combine.sql
```

Expected: two `CREATE FUNCTION`, `REVOKE`/`GRANT` lines, `INSERT 0 1`. No errors.

There is no automated test harness for these SQL functions (no pgTAP in
this repo) — verify the combine logic directly with a throwaway query that
exercises the exact same `replace(replace(...))` expression the functions
now use, against a real seeded layout and a fake template body:

```bash
psql "postgresql://postgres.snzcckzfmpboeqkktmwy:Zunkireelabs%25123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -c "
select replace(
  replace(
    (select html from outreach_layouts where org_id is null and name = 'Simple'),
    '{{content}}', '<p>Hi {{customer_name}}, thanks for visiting!</p>'
  ),
  '{{customer_name}}', 'Jane Doe'
) as combined;
"
```

Expected output: the `Simple` layout's wrapper `<div style=...>` with `<p>Hi
Jane Doe, thanks for visiting!</p>` inside it, both instances of
`{{customer_name}}` (there's only one, inside the body — the `Simple`
layout has no chrome text needing substitution) replaced correctly, and no
literal `{{content}}` remaining in the output.

Also confirm a `layout_id IS NULL` template still behaves as a no-op passthrough:

```bash
psql "postgresql://postgres.snzcckzfmpboeqkktmwy:Zunkireelabs%25123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -c "
select replace(replace(COALESCE(NULL, '{{content}}'), '{{content}}', '<p>Hi {{customer_name}}</p>'), '{{customer_name}}', 'Jane Doe') as combined;
"
```

Expected output: exactly `<p>Hi Jane Doe</p>` — no wrapper, matching
today's behavior for a template with no layout picked.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-187-outreach-layout-combine.sql
git commit -m "$(cat <<'EOF'
feat(outreach): combine template layout into send-time SQL functions

Extends outreach_scan_winback() and outreach_enqueue_for_completed()
to look up a template's layout (if any) and substitute {{content}}
with the template body before the existing {{customer_name}}
substitution runs on the combined string. A template with no layout
falls back to a '{{content}}' passthrough, so untouched templates
send identically to before. No changes needed to send-message or
_shared/channels.ts — outreach_messages.body is already the final
HTML by the time they read it.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---

### Task 3: `sanitizeHtml` utility (new `dompurify` dependency)

**Files:**
- Create: `src/utils/sanitizeHtml.js`
- Create: `src/utils/sanitizeHtml.test.js`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Produces: `export function sanitizeHtml(html: string): string` — returns a DOMPurify-sanitized string safe to pass to `dangerouslySetInnerHTML`.

- [ ] **Step 1: Install the dependency**

```bash
npm install dompurify
```

Verify `package.json`'s `dependencies` now has a `"dompurify"` entry.

- [ ] **Step 2: Write the failing test**

```js
// src/utils/sanitizeHtml.test.js
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('strips a script tag entirely', () => {
    const dirty = '<p>Hello</p><script>alert(1)</script>';
    expect(sanitizeHtml(dirty)).toBe('<p>Hello</p>');
  });

  it('strips an inline event-handler attribute', () => {
    const dirty = '<img src="x.png" onerror="alert(1)">';
    expect(sanitizeHtml(dirty)).not.toContain('onerror');
  });

  it('keeps ordinary styled markup intact', () => {
    const clean = '<div style="color:#2D5A27;padding:8px;"><p>Hi {{customer_name}}</p></div>';
    expect(sanitizeHtml(clean)).toContain('Hi {{customer_name}}');
    expect(sanitizeHtml(clean)).toContain('style=');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/utils/sanitizeHtml.test.js`
Expected: FAIL — `sanitizeHtml.js` doesn't exist yet, import error.

- [ ] **Step 4: Write the implementation**

```js
// src/utils/sanitizeHtml.js
import DOMPurify from 'dompurify';

// Used only for rendering HTML *previews* in the admin dashboard (a real
// browser/JS context) — never in the actual outreach send path, which is
// server-side SQL string substitution and never executed as script by an
// email client. See TemplateEditorPanel.jsx's Preview box.
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '', { ADD_ATTR: ['style'] });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/utils/sanitizeHtml.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/sanitizeHtml.js src/utils/sanitizeHtml.test.js
git commit -m "$(cat <<'EOF'
feat(outreach): add sanitizeHtml utility (dompurify)

Needed before the Templates editor's Preview box can render real
HTML via dangerouslySetInnerHTML — the preview runs in the live
admin dashboard, unlike the actual sent email, so a pasted custom
layout containing <script>/onerror= must be neutralized first.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---

### Task 4: `api.js` — layout fetch/create + extend `renderTemplatePreview`

**Files:**
- Modify: `src/services/api.js:11475-11490` (the `renderTemplatePreview` function and the `// ---- Templates ----` section above it)
- Test: `src/services/api.test.js`

**Interfaces:**
- Consumes: `outreach_layouts` table (Task 1).
- Produces:
  - `export async function fetchOutreachLayouts(): Promise<{ data: Array<{id, org_id, name, html, is_active}> | null, error }>`
  - `export async function createOutreachLayout({ orgId, name, html }): Promise<{ data: {id, name, html} | null, error }>`
  - `export function renderTemplatePreview(template, sampleCustomerName = 'Jane Doe', layoutHtml = null): { subject: string, body: string }` — **signature change**: new optional third param. Existing call sites (none pass a third arg today) keep working unchanged.

- [ ] **Step 1: Write the failing test**

```js
// Add to src/services/api.test.js
import { renderTemplatePreview } from './api';

describe('renderTemplatePreview with a layout', () => {
  it('wraps the body in the layout and substitutes {{content}} before {{customer_name}}', () => {
    const template = { subject: 'Hi {{customer_name}}', body: '<p>Welcome back, {{customer_name}}!</p>' };
    const layoutHtml = '<div class="wrapper">{{content}}</div>';
    const result = renderTemplatePreview(template, 'Jane Doe', layoutHtml);
    expect(result.body).toBe('<div class="wrapper"><p>Welcome back, Jane Doe!</p></div>');
    expect(result.subject).toBe('Hi Jane Doe');
  });

  it('falls back to the raw body when no layout is passed (existing behavior)', () => {
    const template = { subject: 'Hi {{customer_name}}', body: '<p>Hi {{customer_name}}</p>' };
    const result = renderTemplatePreview(template, 'Jane Doe');
    expect(result.body).toBe('<p>Hi Jane Doe</p>');
  });

  it('falls back to the raw body when layoutHtml is explicitly null', () => {
    const template = { subject: '', body: 'plain {{customer_name}} text' };
    const result = renderTemplatePreview(template, 'Jane Doe', null);
    expect(result.body).toBe('plain Jane Doe text');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/services/api.test.js -t "renderTemplatePreview with a layout"`
Expected: FAIL — current `renderTemplatePreview` ignores a third argument entirely, so the "wraps the body in the layout" test fails (body comes back unwrapped).

- [ ] **Step 3: Modify `renderTemplatePreview` and add the two new functions**

In `src/services/api.js`, replace the existing `renderTemplatePreview` function (currently ~line 11481):

```js
// OLD — replace this entire function:
export function renderTemplatePreview(template, sampleCustomerName = 'Jane Doe') {
  if (!template) return { subject: '', body: '' };
  const name = sampleCustomerName || 'Jane Doe';
  return {
    subject: (template.subject || '').split('{{customer_name}}').join(name),
    body: (template.body || '').split('{{customer_name}}').join(name),
  };
}
```

with:

```js
// Preview-only, client-side mirror of the server-side combine-then-substitute
// logic in outreach_scan_winback / outreach_enqueue_for_completed
// (migration-187) — not used to generate what actually gets sent, those
// SQL functions render server-side at insert time. layoutHtml is the
// selected layout's html (or null/undefined for "no layout" — a template
// with no layout renders its raw body unwrapped, same as before layouts
// existed).
export function renderTemplatePreview(template, sampleCustomerName = 'Jane Doe', layoutHtml = null) {
  if (!template) return { subject: '', body: '' };
  const name = sampleCustomerName || 'Jane Doe';
  const wrapper = layoutHtml || '{{content}}';
  const combinedBody = wrapper.split('{{content}}').join(template.body || '');
  return {
    subject: (template.subject || '').split('{{customer_name}}').join(name),
    body: combinedBody.split('{{customer_name}}').join(name),
  };
}

// ---- Layouts ------------------------------------------------------------------

export async function fetchOutreachLayouts() {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    const { data, error } = await supabase
      .from('outreach_layouts')
      .select('id, org_id, name, html, is_active')
      .or(`org_id.eq.${profile.org_id},org_id.is.null`)
      .eq('is_active', true)
      .order('org_id', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[API] fetchOutreachLayouts error:', error.message);
    return { data: null, error };
  }
}

export async function createOutreachLayout({ orgId, name, html }) {
  try {
    const { profile, error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!['manager', 'admin'].includes(profile.role)) {
      return { data: null, error: { code: 'UNAUTHORIZED', message: 'Only managers and admins can create outreach layouts.' } };
    }
    if (!orgId) return { data: null, error: { code: 'INVALID_INPUT', message: 'orgId is required.' } };
    if (!name?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Layout name is required.' } };
    if (!html?.trim()) return { data: null, error: { code: 'INVALID_INPUT', message: 'Layout HTML is required.' } };
    if (!html.includes('{{content}}')) {
      return { data: null, error: { code: 'INVALID_INPUT', message: 'Layout HTML must contain a {{content}} slot.' } };
    }

    const { data, error } = await supabase
      .from('outreach_layouts')
      .insert({ org_id: orgId, name: name.trim(), html, is_active: true })
      .select('id, name, html')
      .single();
    if (error) throw error;
    capture('outreach_layout_created', { layout_id: data.id });
    return { data, error: null };
  } catch (error) {
    console.error('[API] createOutreachLayout error:', error.message);
    return { data: null, error };
  }
}
```

Also update `upsertOutreachTemplate` (currently ~line 11407) to pass through
`layout_id` — add one line to the `row` object it builds:

```js
    const row = {
      org_id: profile.org_id,
      branch_id: payload.branchId ?? null,
      key: payload.key.trim(),
      channel: payload.channel,
      subject: payload.subject ?? null,
      body: payload.body,
      layout_id: payload.layoutId ?? null,
      whatsapp_template_name: payload.whatsappTemplateName ?? null,
      whatsapp_template_lang: payload.whatsappTemplateLang ?? null,
      is_active: payload.isActive ?? true,
      updated_at: new Date().toISOString(),
    };
```

And `fetchOutreachTemplates`'s `.select(...)` string (currently ~line 11397)
needs `layout_id` added to the column list:

```js
      .select('id, org_id, branch_id, key, channel, subject, body, layout_id, whatsapp_template_name, whatsapp_template_lang, is_active, created_at, updated_at')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/api.test.js -t "renderTemplatePreview with a layout"`
Expected: PASS, all 3 new tests green.

Run the full suite to confirm nothing else broke: `npm test`
Expected: all test files pass (148+ tests — exact count will have grown by the 4 sanitizeHtml tests from Task 3 plus these 3).

- [ ] **Step 5: Commit**

```bash
git add src/services/api.js src/services/api.test.js
git commit -m "$(cat <<'EOF'
feat(outreach): fetchOutreachLayouts/createOutreachLayout + preview combine

renderTemplatePreview() gains an optional layoutHtml param, mirroring
the same combine-then-substitute logic the send-time SQL functions
now use (migration-187) — a template with no layout renders exactly
as before. fetchOutreachTemplates/upsertOutreachTemplate now
read/write layout_id.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---

### Task 5: `TemplateEditorPanel.jsx` — layout picker, paste-your-own panel, Preview fix

**Files:**
- Modify: `src/pages/branch-manager-dashboard/components/Outreach/TemplateEditorPanel.jsx` (whole file — see exact diffs below)

**Interfaces:**
- Consumes: `fetchOutreachLayouts`, `createOutreachLayout`, updated `renderTemplatePreview(template, name, layoutHtml)` (Task 4); `sanitizeHtml` (Task 3).

- [ ] **Step 1: Update imports and add layout state**

Change the import block (currently lines 1-9):

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { useOrg } from '../../../../contexts/OrgContext';
import { sanitizeHtml } from '../../../../utils/sanitizeHtml';
import {
  fetchOutreachTemplates,
  upsertOutreachTemplate,
  deleteOutreachTemplate,
  fetchOutreachLayouts,
  createOutreachLayout,
  renderTemplatePreview,
} from '../../../../services/api';
```

Change `EMPTY_FORM` (currently line 19) to include `layoutId`:

```jsx
const EMPTY_FORM = { id: null, key: '', channel: 'email', subject: '', body: '', layoutId: null, isActive: true };
```

Add a new constant near `EMPTY_FORM`:

```jsx
const EMPTY_NEW_LAYOUT = { name: '', html: '' };
```

Add `orgId` and new layout-related state right after the existing state
declarations (after `const bodyRef = useRef(null);`, currently line 33):

```jsx
  const { orgId } = useOrg();
  const [layouts, setLayouts] = useState([]);
  const [showNewLayout, setShowNewLayout] = useState(false);
  const [newLayout, setNewLayout] = useState(EMPTY_NEW_LAYOUT);
  const [newLayoutSubmitting, setNewLayoutSubmitting] = useState(false);
  const [newLayoutError, setNewLayoutError] = useState(null);
```

- [ ] **Step 2: Fetch layouts alongside templates**

Replace the `loadData` function (currently lines 35-46) to also load
layouts:

```jsx
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: fetchError }, { data: layoutData }] = await Promise.all([
      fetchOutreachTemplates(),
      fetchOutreachLayouts(),
    ]);
    if (fetchError) {
      setError(fetchError.message || 'Failed to load templates.');
      setLoading(false);
      return;
    }
    setTemplates(data || []);
    setLayouts(layoutData || []);
    setLoading(false);
  }, []);
```

- [ ] **Step 3: Carry `layoutId` through `selectTemplate` and `handleSubmit`**

In `selectTemplate` (currently lines 50-64), add `layoutId` to the object
passed to `setForm`:

```jsx
    setForm({
      id: template.id,
      key: template.key,
      channel: template.channel,
      subject: template.subject || '',
      body: template.body || '',
      layoutId: template.layout_id || null,
      isActive: template.is_active,
    });
```

In `handleSubmit` (currently lines 83-108), add `layoutId` to the
`upsertOutreachTemplate` call:

```jsx
    const { error: saveError } = await upsertOutreachTemplate({
      id: form.id || undefined,
      key: form.key,
      channel: form.channel,
      subject: form.subject || null,
      body: form.body,
      layoutId: form.layoutId || null,
      isActive: form.isActive,
    });
```

- [ ] **Step 4: Add the layout-create handler**

Add this function after `handleDelete` (currently ends at line 120), before
the `preview` line:

```jsx
  const handleCreateLayout = async (e) => {
    e.preventDefault();
    setNewLayoutError(null);
    if (!newLayout.name.trim()) { setNewLayoutError('Layout name is required.'); return; }
    if (!newLayout.html.trim()) { setNewLayoutError('Layout HTML is required.'); return; }
    if (!newLayout.html.includes('{{content}}')) {
      setNewLayoutError('Layout HTML must contain a {{content}} slot.');
      return;
    }

    setNewLayoutSubmitting(true);
    const { data, error: createErr } = await createOutreachLayout({
      orgId,
      name: newLayout.name,
      html: newLayout.html,
    });
    setNewLayoutSubmitting(false);
    if (createErr) { setNewLayoutError(createErr.message || 'Failed to create layout.'); return; }

    setNewLayout(EMPTY_NEW_LAYOUT);
    setShowNewLayout(false);
    const { data: layoutData } = await fetchOutreachLayouts();
    setLayouts(layoutData || []);
    setForm((prev) => ({ ...prev, layoutId: data.id }));
  };
```

- [ ] **Step 5: Update the preview calculation and the layout dropdown's options**

Replace the `preview` line (currently line 122):

```jsx
  const selectedLayout = layouts.find((l) => l.id === form.layoutId);
  const preview = renderTemplatePreview({ subject: form.subject, body: form.body }, 'Jane Doe', selectedLayout?.html || null);
```

Add a `LAYOUT_OPTIONS` computation right below it (grouped built-in/org,
matching the confirmed dropdown design — `CustomSelect` takes a flat
`options` array, so the grouping is expressed via label prefixes since this
component has no existing grouped-dropdown precedent to mirror):

```jsx
  const layoutOptions = [
    { value: '', label: 'No layout (plain body)' },
    ...layouts
      .filter((l) => l.org_id === null)
      .map((l) => ({ value: l.id, label: `Built-in — ${l.name}` })),
    ...layouts
      .filter((l) => l.org_id !== null)
      .map((l) => ({ value: l.id, label: `Your org — ${l.name}` })),
  ];
```

- [ ] **Step 6: Add the Layout dropdown + paste-your-own panel to the form JSX**

Insert this block right after the Channel/Key grid (currently ends at line
220, right before the "Subject (email only)" `<div>` at line 222):

```jsx
          {form.channel === 'email' && (
            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Layout</label>
              <CustomSelect
                value={form.layoutId || ''}
                onChange={(v) => setForm((prev) => ({ ...prev, layoutId: v || null }))}
                options={layoutOptions}
                placeholder="Select layout"
              />
              <div className="mt-2">
                {!showNewLayout ? (
                  <button
                    type="button"
                    onClick={() => setShowNewLayout(true)}
                    className="flex items-center gap-1 text-xs font-body font-body-medium text-primary hover:underline"
                  >
                    <Icon name="Plus" size={12} />
                    <span>Can't find a style you like? Paste your own layout</span>
                  </button>
                ) : (
                  <div className="bg-background border border-border rounded-spa p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-heading font-heading-semibold text-xs text-text-primary">New layout</h4>
                      <button
                        type="button"
                        onClick={() => { setShowNewLayout(false); setNewLayout(EMPTY_NEW_LAYOUT); setNewLayoutError(null); }}
                        className="p-1 rounded-spa hover:bg-surface spa-transition-fast"
                      >
                        <Icon name="X" size={12} className="text-text-secondary" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newLayout.name}
                      onChange={(e) => setNewLayout((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Layout name, e.g. Autumn Promo"
                      className="w-full h-9 px-2.5 text-xs border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    <textarea
                      value={newLayout.html}
                      onChange={(e) => setNewLayout((p) => ({ ...p, html: e.target.value }))}
                      rows={6}
                      placeholder="Paste your HTML here — must include a {{content}} placeholder where the template body goes."
                      className="w-full px-2.5 py-2 text-xs font-data border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
                    />
                    {newLayoutError && (
                      <p className="font-caption text-xs text-error">{newLayoutError}</p>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleCreateLayout}
                        disabled={newLayoutSubmitting}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
                      >
                        {newLayoutSubmitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        <span>Save layout</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 7: Fix the Preview box to render real HTML**

Replace the "Live preview" block (currently lines 299-310):

```jsx
        {/* Live preview */}
        <div className="bg-background rounded-spa-lg border border-border p-4">
          <h4 className="font-body font-body-medium text-xs text-text-secondary mb-2 uppercase tracking-wide">Preview</h4>
          <div className="bg-surface rounded-spa border border-border p-3 space-y-1.5">
            {form.channel === 'email' && preview.subject && (
              <p className="font-body font-body-semibold text-sm text-text-primary">{preview.subject}</p>
            )}
            {preview.body ? (
              <div
                className="text-sm text-text-secondary"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.body) }}
              />
            ) : (
              <p className="font-body text-sm text-text-secondary">Preview will appear here as you type.</p>
            )}
          </div>
        </div>
```

- [ ] **Step 8: Run the build**

Run: `npm run build`
Expected: build succeeds with no errors.

Run: `npm test`
Expected: all tests pass (no test covers this component directly — this
repo has no React component tests, only pure-logic unit tests per
CLAUDE.md's testing section — so this step is a regression check on the
rest of the suite, not new coverage for this file).

- [ ] **Step 9: Manual verification (staging)**

1. Apply migrations 186 and 187 to staging if not already applied (Tasks 1–2).
2. Start the dev server against staging (temporarily move `.env.local`
   aside if it points at a local Supabase instance, per this repo's
   `supabase/LOCAL_DEV.md` — restore it afterward).
3. Log in as a manager/admin, go to Outreach → Templates.
4. Select the existing `win_back` template. Confirm the Preview box now
   renders `<p>Hi Jane Doe...</p>` as an actual paragraph, not literal tags
   — this alone confirms the bug fix works even before touching layouts.
5. Pick "Built-in — Branded Header" from the new Layout dropdown. Confirm
   the Preview now shows the green header bar wrapping the body text.
6. Click "Can't find a style you like? Paste your own layout", type a name
   and a small HTML snippet containing `{{content}}`, save. Confirm it
   appears in the dropdown under "Your org — ..." and gets auto-selected.
7. Save the template with a layout selected. Reload the page, re-select the
   template, confirm the layout choice persisted (comes back from
   `template.layout_id`).
8. Try pasting a layout HTML with NO `{{content}}` — confirm the inline
   validation error appears and the save is blocked.

- [ ] **Step 10: Commit**

```bash
git add src/pages/branch-manager-dashboard/components/Outreach/TemplateEditorPanel.jsx
git commit -m "$(cat <<'EOF'
feat(outreach): layout picker + paste-your-own panel, fix Preview HTML render

TemplateEditorPanel gets a Layout dropdown (built-in styles + any
org-pasted custom ones) and an inline "paste your own layout" panel,
mirroring the package-type quick-add pattern used elsewhere in this
app. Also fixes a real pre-existing bug: the Preview box rendered
body as escaped plain JSX text instead of HTML, so raw <p> tags
showed up literally — now renders via dangerouslySetInnerHTML,
sanitized through the new sanitizeHtml() helper.

Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>
EOF
)"
```

---

## Final Verification (whole plan)

- [ ] `npm run build` passes
- [ ] `npm test` passes (full suite, not just the new files)
- [ ] `scripts/check-migrations.sh origin/stage` reports both migration
      files as `OK` (run from a branch with both commits)
- [ ] Migrations 186 and 187 applied to staging, verified via the SQL
      checks in Tasks 1–2
- [ ] Manual click-through from Task 5 Step 9 completed
- [ ] PR opened against `stage` (per this repo's branching rules — never
      target `main` directly), title following the existing
      `feat(outreach): ...` convention, body listing what changed and the
      manual test steps performed
