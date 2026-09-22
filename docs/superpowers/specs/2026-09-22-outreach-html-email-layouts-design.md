# Outreach HTML email layouts — design

## Context

Outreach email templates (`outreach_templates`, migration-102) store `body` as raw HTML
text with `{{customer_name}}`-style placeholders — plain string substitution server-side,
no rendering engine, no styling infrastructure. Two problems, confirmed against the actual
code:

1. **The Templates editor's Preview box is broken.** `TemplateEditorPanel.jsx` renders
   `{preview.body}` as plain JSX text (React-escapes it) — so raw tags like `<p>Hi Jane
   Doe...` show up literally in the preview instead of rendering as HTML. Zero
   `dangerouslySetInnerHTML` anywhere in the file today.
2. **There's no styling at all in the actual send path.** The `send-message` Edge Function
   (`supabase/functions/send-message/index.ts`) reads a template's already-interpolated
   `body` from `outreach_messages` and passes it straight to Resend as the email's `html`
   field, verbatim (`_shared/channels.ts`'s `ResendEmailProvider.send()`). Whatever staff
   type in the raw textarea is exactly what lands in the customer's inbox — no header,
   footer, branding, or CSS wrapper of any kind. This is the only outbound-email surface in
   the whole codebase; there is no existing layout/theme system anywhere else to reuse.

User's ask: let staff pick from **pre-built styled layouts**, and also **paste their own
custom HTML layout** — both stored as reusable, selectable wrappers around a template's
existing body content, not a one-off style baked into each template.

## Schema (new migration, next available number — confirm via `ls supabase/migration-*.sql`
before naming the file; 185 is the latest as of this doc)

```sql
CREATE TABLE public.outreach_layouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  html       text NOT NULL,   -- must contain a literal {{content}} slot
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outreach_layouts_org ON public.outreach_layouts(org_id);
```

- `org_id IS NULL` — a **system built-in layout**, visible to every org, not editable/
  deletable via the UI (seeded once, in this same migration, as plain `INSERT`s).
- `org_id` set — that org's own **custom/pasted layout**, visible only to them.
- Ship 3 seeded built-ins in the migration: **Simple** (near-passthrough — just a
  max-width centering wrapper, no color), **Branded Header** (a colored header bar using
  this app's `primary`/`secondary` palette + a plain footer), **Promo Banner** (a banner
  image slot at the top + a styled CTA-button convention in the body area). Each is a
  literal HTML string containing `{{content}}` exactly once, matching the schema's
  requirement.

**RLS**: mirrors `outreach_templates`' existing posture (find and copy its exact policy
set from migration-102 — SELECT for manager/admin scoped to `org_id = get_user_org_id()
OR org_id IS NULL` so built-ins are visible everywhere, INSERT/UPDATE/DELETE restricted to
`org_id = get_user_org_id()` and role manager/admin so an org can never write a system row
or another org's custom layout).

`outreach_templates` gets one new nullable column:

```sql
ALTER TABLE public.outreach_templates
  ADD COLUMN IF NOT EXISTS layout_id uuid REFERENCES public.outreach_layouts(id);
```

Nullable and defaulted to nothing — every existing template (e.g. `win_back`) keeps
sending exactly as it does today until someone explicitly picks a layout for it. Fully
backward compatible, no backfill needed.

## Combining layout + body

**Send time** (server, `supabase/migration-108-outreach-cron-scans.sql`): both functions
that build `outreach_messages` rows (`outreach_scan_winback`,
`outreach_enqueue_for_completed`) currently do (paraphrased from the real lines, e.g.
~116-117 and ~268-269):

```sql
replace(tp.template_subject, '{{customer_name}}', tp.customer_name),
replace(tp.template_body, '{{customer_name}}', tp.customer_name),
```

Extend the query each function selects from to `LEFT JOIN public.outreach_layouts ol ON
ol.id = tp.layout_id`, and change the body line to combine before substituting:

```sql
replace(
  replace(COALESCE(ol.html, '{{content}}'), '{{content}}', tp.template_body),
  '{{customer_name}}', tp.customer_name
),
```

A template with `layout_id IS NULL` falls back to the literal `'{{content}}'` wrapper (a
no-op passthrough), so untouched templates behave identically to today. This also means a
layout's own chrome text (e.g. a header saying "Hi {{customer_name}}") gets substituted
too, since the customer-name replace runs on the already-combined string.

**Critically: no changes needed to `send-message`/`channels.ts`.** By the time the Edge
Function reads `outreach_messages.body`, it's already the final, fully-combined,
fully-substituted HTML — exactly the same shape it reads today, just richer content. This
keeps the blast radius of this feature entirely inside the DB layer plus the editor UI.

**Preview time** (client, mirrors the exact same two-step combine-then-substitute logic in
JS so the preview can never drift from what actually sends): extend
`renderTemplatePreview()` in `src/services/api.js` (currently ~line 11481) to accept the
selected layout's `html` and do the same `.replace('{{content}}', body)` then
`.replace('{{customer_name}}', sampleName)` before returning.

## UI (`src/pages/branch-manager-dashboard/components/Outreach/TemplateEditorPanel.jsx`)

- New **Layout** `CustomSelect` between Channel and Subject. Options grouped "Built-in" /
  "Your org" (built-ins = `org_id IS NULL` rows, sorted first; org rows after), fetched via
  a new `fetchOutreachLayouts()` in `api.js` (mirrors `fetchOutreachTemplates()`'s shape:
  auth check, `.select(...)`, ordered).
- Below the dropdown: an inline expandable "Can't find a style you like? Paste your own
  layout" panel — same interaction pattern as this session's package-type quick-add
  (`NewPackageModal.jsx`'s "Add new package type" expander): a Name input + an HTML
  textarea (placeholder text explicitly calling out that `{{content}}` must appear
  somewhere in the pasted HTML), client-side validated (name required, HTML required,
  `{{content}}` presence required — mirror the exact inline-error pattern already used for
  the package-type quick-add), Save button calling a new `createOutreachLayout({ orgId,
  name, html })` in `api.js` which inserts one org-scoped row and auto-selects it in the
  dropdown (same "select the thing you just created" UX as `loadTypes({ selectId })` from
  the packages work). Gated to manager/admin — matches `TemplateEditorPanel`'s existing
  access level (the Templates tab itself is already manager+admin, confirmed via
  `OutreachPanel.jsx`'s `TABS`/`visibleTabs` — only `Settings` is `adminOnly: true`).
- **Preview box fix** (independent bug, fix regardless of whether a layout is picked):
  replace the current plain-JSX-text rendering (`<p>{preview.body}</p>`, no
  `dangerouslySetInnerHTML` anywhere in the file today) with a `dangerouslySetInnerHTML`
  render of the combined, sanitized HTML.
- **Sanitization**: add `dompurify` as a new dependency (not currently in `package.json`)
  — the preview renders in the live admin dashboard (a real browser/JS context), unlike
  the actual sent email (email clients don't execute `<script>`/`onerror=` from HTML
  email), so a pasted custom layout containing something malicious must be neutralized
  before `dangerouslySetInnerHTML` in the preview specifically. A small
  `sanitizeHtml(html)` helper wrapping `DOMPurify.sanitize()`, used only in the preview
  render path — the actual send path is untouched (server-side, no sanitization needed
  there since it's never executed as script).

## Out of scope

- No visual/WYSIWYG HTML layout builder — pasting raw HTML is the only way to add a custom
  layout, per the user's explicit ask ("paste option to build their own style layouts").
- No editing/deleting of system built-in layouts via the UI — they're fixed, seeded once in
  the migration. An org can still create its own custom layout with a similar look if they
  want to deviate.
- No per-layout preview-thumbnail/visual picker beyond the dropdown's grouped text list —
  the existing text-only Preview box (now actually rendering HTML) is sufficient to see
  what a layout looks like once selected.
- WhatsApp templates (the other outreach channel) are untouched — layouts are an
  email-only concept (`channel === 'email'`), matching how Subject is already
  conditionally shown only for email in the existing form.
