# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Project**: Zenly — Multi-tenant Booking Web App
**Type**: React 18 + Vite SPA with Supabase backend
**Tech Stack**: React 18, Vite 5, Tailwind CSS 3, Supabase (Postgres, Auth, RLS, Realtime), Framer Motion, Lucide Icons
**Key Libraries**: date-fns (date handling), Recharts (charts), @dnd-kit (drag-and-drop), FullCalendar (calendar views, resource-timeline)

---

## Automatic Skill Routing

**IMPORTANT: This project uses orchestrated development.**

### Default: Route Development Tasks to PM

When the user gives ANY development request, **automatically invoke `/project-pm`**.

#### Trigger Patterns (auto-invoke PM):

- "Build/Create/Implement/Add X"
- "Fix/Update/Change/Refactor X"
- Feature requests or bug fixes
- "Wire up X", "Connect X to Supabase"

#### Exceptions (do NOT auto-invoke):

- Questions: "How does X work?"
- Reading: "Show me X"
- Documentation tasks
- Direct skill invocation (`/skill-name`)
- Session logging (`/session-log`)

---

## Available Skills

| Skill | Domain | When to Use |
|-------|--------|-------------|
| `/project-pm` | **Orchestrator** | All development tasks (routes to specialists) |
| `/creative-director` | **UI/UX Design** | Visual hierarchy, spacing, branding, UX flow, style guide |
| `/react-frontend` | **Frontend** | React components, pages, styling, forms, routing |
| `/api-service` | **API Layer** | Supabase service modules, queries, real-time |
| `/supabase-db` | **Database** | Schema, migrations, RLS, triggers, functions |
| `/booking-domain` | **Business Logic** | Booking workflow, financial rules, scheduling (auto-only) |
| `/deploy-check` | **DevOps** | Pre-deploy build + security validation |
| `/review-code` | **Quality** | Code review and pattern compliance |
| `/session-log` | **Docs** | Session progress logging |
| `/skill-architect` | **Meta** | Create/optimize skills, audit coverage |

---

## Commands

```bash
# Development (runs on port 4028)
npm start

# Build (outputs to build/)
npm run build

# Preview production build
npm run serve

# Deployment: Docker multi-stage build (node:22-alpine → nginx:alpine)
docker build --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... -t bookspa .
```

**No test runner or linter configured.** Testing libraries (`@testing-library/*`) are installed as devDependencies but there is no `test` or `lint` script in package.json. Use `npm run build` as the primary validation gate.

---

## Environment Variables

Two Supabase projects exist — **staging** (default for local dev) and **production**:

| Env | Supabase Project | Domain |
|-----|-----------------|--------|
| Staging | `snzcckzfmpboeqkktmwy` | `dev-zenly.zunkireelabs.com` |
| Production | `pmbvogiphelmpjdalmtv` | `zenly.zunkireelabs.com` |

**These are two completely separate databases — they share no data.** Git branch → database:

| Git branch(es) | Supabase database |
|----------------|-------------------|
| `feature/*`, `stage` | Staging (`snzcckzfmpboeqkktmwy`) |
| `main` (production) | Production (`pmbvogiphelmpjdalmtv`) |

Deploys ship **frontend code only** — they do **NOT** copy rows between the two databases.
Any data created in staging (branches/outlets, rooms, staff, services, logins, exclusions,
etc.) must be **re-created directly in the production database** via SQL or the Supabase
dashboard. Merging `stage → main` will never make staging data appear in production.

**DB promotion process:** see `supabase/PROMOTION.md` for the migration + credential promotion
runbook and the `schema_migrations` "what's pending on prod?" check.

> [!IMPORTANT]
> **CRITICAL — whenever code is promoted to `main` (production), check if the DB needs updating.**
> Any time changes go from `stage → main`, or a feature branch goes directly to `main`, and those
> changes depend on a database change (new/changed table, column, enum, trigger, RLS policy,
> function, migration, or seed/credential data), you MUST:
> 1. **Tell the user explicitly** that production's database needs to be updated — never assume the
>    deploy handles it. Deploys ship **frontend only**; SQL is **never** auto-run, and the MCP
>    reaches **staging only**.
> 2. **Provide a ready-to-paste SQL script** for the user to run in the **production** Supabase SQL
>    editor (project `pmbvogiphelmpjdalmtv`). Make it **idempotent** and **portable** (resolve by
>    name/email, not UUID) per `supabase/PROMOTION.md`.
> 3. **Do not consider the promotion complete** until the production DB script has been handed off
>    (and ideally verified). If a change is frontend-only with no DB impact, say so explicitly.
> 4. **When adding a new migration**, append its version to the manifest in
>    `supabase/PROMOTION.md`'s pending-check query — an out-of-date manifest silently hides pending
>    migrations.
>
> **Past incident (2026-06-13):** Migrations 038–041 shipped to `main` with the frontend but were
> never run on prod. The Transfer Report page surfaced this as a runtime
> `Could not find the table 'public.staff_transfers' in the schema cache` error. The
> `supabase/PROMOTION.md` pending-check manifest was also stale (ended at `027`) so it falsely
> reported prod as up to date. **Schema-touching code is not safe to merge to `main` without
> running each new migration on prod via the dashboard SQL editor AND confirming the manifest is
> current.**

```bash
cp .env.example .env            # defaults to staging
cp .env.example .env.staging    # preserved staging template
# To switch: cp .env.production .env && restart dev server
```

Only `anon` keys belong in env files. **NEVER** put a `service_role` key in any `.env` file — it bypasses RLS. Service keys stay server-side in Edge Functions only.

---

## Project Structure

```
book-spa/
├── src/
│   ├── components/         # Shared components (ErrorBoundary, ProtectedRoute, ScrollToTop)
│   │   └── ui/             # Reusable UI: Button, Input, Select, CustomSelect, FilterBar,
│   │                       #   Modal components, StaffSidebar, CustomerHeader, StatusLegend
│   ├── contexts/           # AuthContext → OrgContext → BranchContext → AIAssistantContext
│   ├── lib/                # supabase.js — Supabase client singleton
│   ├── pages/              # Route pages (see Routing Map below)
│   ├── services/           # API service layer (see Service Layer below)
│   └── styles/             # Tailwind CSS entry
├── supabase/               # Migrations and seed data
├── .claude/skills/         # Claude Code skills
├── Dockerfile              # Multi-stage Docker build (node → nginx)
├── jsconfig.json           # Absolute imports: baseUrl "./src"
└── CLAUDE.md
```

**Absolute imports**: `jsconfig.json` sets `baseUrl: "./src"`, so import as `import X from 'components/X'` (no `./src/` prefix).

---

## Architecture

### Context Provider Hierarchy

```
<AuthProvider>          ← Supabase auth state, login/logout
  <OrgProvider>         ← Organization/tenant data
    <BranchProvider>    ← Active branch selection
      <AIAssistantProvider>  ← AI assistant state
        <Routes />      ← BrowserRouter + route definitions
          <TenantProvider>  ← Wraps customer-facing routes (/:orgSlug/book)
```

### Routing Map

All staff/customer routes are org-scoped: `/:orgSlug/login`, `/:orgSlug/dashboard`, etc. Source of truth is `src/Routes.jsx` — keep this table in sync.

| Path | Component | Access |
|------|-----------|--------|
| `/` | ExternalRedirect → zunkireelabs.com | Public (redirects externally) |
| `/login` | OrgFinder | Public (org slug entry page) |
| `/:orgSlug/login` | StaffLoginAuthentication | Public |
| `/:orgSlug/dashboard` | UnifiedDashboard (role-dispatched view) | staff, manager, admin |
| `/:orgSlug/attendance-calendar` | AttendanceCalendarPage | manager, admin |
| `/:orgSlug/bookings/:bookingId` | BookingDetailsAssignmentModal | staff, manager, admin |
| `/:orgSlug/book` | CustomerBookingFlow (via TenantProvider) | Public |
| `/:orgSlug/manage` | BookingManagementPortal (via TenantProvider) | Public (customer self-service) |
| `/:orgSlug` | CustomerBookingFlow (shortcut) | Public |

**Important:** there is no separate `/staff-dashboard` / `/manager-dashboard` — both roles land on `/:orgSlug/dashboard` and `UnifiedDashboard` renders the right view.

Legacy paths (`/branch-staff-dashboard`, `/branch-manager-dashboard`, `/booking-details/:bookingId`, `/customer-booking-flow`, `/booking-management-portal`) auto-redirect to their org-scoped equivalents. Protected routes use `<ProtectedRoute allowedRoles={[...]}>`.

> [!WARNING]
> **Legacy customer redirects are hardcoded to the `nuad-thai-spa` tenant** —
> `/customer-booking-flow` → `/nuad-thai-spa/book` and `/booking-management-portal` →
> `/nuad-thai-spa/manage` (see `src/Routes.jsx`). This is fine while Nuad Thai Spa is the only
> production tenant, but **when a second org goes live, these two redirects must be replaced**
> (probably with a per-org landing page or a "pick your org" prompt) — otherwise their customers
> will be silently sent to the wrong tenant.

### Data Flow

```
UI Component → services/api.js → supabase client → Supabase DB
                                                      ↓
UI Component ← transformBooking() ← raw DB response ←┘
```

- **Mutations**: API functions in `services/api.js` validate via state machine before writing
- **Reads**: Query results pass through `transformBooking()` to normalize field names (snake_case DB → camelCase UI)
- **Refresh**: After any mutation, call `loadData()` to re-fetch from Supabase

---

## Service Layer Patterns

**All Supabase mutations and queries live in a single `src/services/api.js` (~6k lines).**
`bookingTransformers.js` (snake/camel case + status normalization) and `serviceEnrichment.js`
(static service display metadata) are the only sibling modules. Don't split `api.js` into per-domain
files without an explicit refactor request — the monolith is intentional for now, and the existing
state-machine + discount validation helpers depend on shared module-scope constants.

### State Machine (`services/api.js`)

```
Pending → Confirmed → In-Progress → Completed (terminal)
  ↓          ↓
Cancelled  Cancelled / No Show (terminal)
```

- `VALID_TRANSITIONS` object enforces allowed status changes
- `TERMINAL_STATUSES`: Completed, Cancelled, No Show — immutable once reached
- `validateBookingMutation()` — checks lock + terminal status before any write
- `validateStatusTransition()` — checks state machine before status change

### Discount Limits (by role)

| Role | Max Discount |
|------|-------------|
| staff | 15% (can request up to 50% from a manager/admin) |
| manager | 50% |
| admin | 50% |

Hard ceiling: no role may apply, and no staff request may exceed, **50%** (enforced in
`api.js` `MAX_DISCOUNT_PERCENT` and `BookingActionModal.jsx`).

### PIN Login Flow

PIN login uses a server-side Edge Function (`pin-login`) to avoid exposing the service role key:
```
Frontend → POST /functions/v1/pin-login (email, pin, org_slug)
         ← { email_otp } → supabase.auth.verifyOtp() → session
```

> **Note:** the `pin-login` Edge Function's source is **not tracked in this repo** (there is no
> `supabase/functions/` directory). It's deployed/managed directly in the Supabase dashboard, per
> project. Don't search the repo for it — edit it in the dashboard, and remember it must be
> deployed to **both** the staging and production projects separately.

### Service Enrichment (`services/serviceEnrichment.js`)

- Static UI data (images, benefits, categories) keyed by service name
- Used to enrich DB service records with display metadata for the customer booking flow

### Transformers (`services/bookingTransformers.js`)

- `toDbStatus(uiStatus)` — maps lowercase UI status → Title-Case DB status (e.g., `'in-progress'` → `'In-Progress'`)
- `transformBooking(dbBooking)` — normalizes DB record to UI shape: `booking_number` → `id`, DB `id` → `bookingId`, financial fields to Numbers
- `formatNPR(amount)` — formats as `NPR 1,234` (Indian/Nepali locale)

**Critical**: Always use `booking.bookingId` (UUID) for API calls, never `booking.id` (display number).

---

## Design System Tokens (tailwind.config.js)

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `#2D5A27` | Deep forest green — brand primary |
| `secondary` | `#8B4513` | Warm earth brown |
| `accent` | `#DAA520` | Refined gold |
| `background` | `#FAFAF9` | Page background |
| `surface` | `#FFFFFF` | Card/panel background |
| `border` | `#E1E3E5` | Default borders |
| `success` | `#10B981` | Emerald (distinct from primary) |
| `warning` | `#D97706` | Warm amber |
| `error` | `#DC2626` | Clear red |

### Typography
| Family | Font | Usage |
|--------|------|-------|
| `font-heading` | Inter | Headings |
| `font-body` | Inter | Body text |
| `font-accent` | Playfair Display | Decorative/luxury feel |
| `font-data` | JetBrains Mono | Numbers, tables, monospace |

### Z-Index (semantic tokens — never use raw values)
| Token | Value | Usage |
|-------|-------|-------|
| `z-sticky-filter` | 50 | Sticky filter bars |
| `z-header` | 100 | Main header |
| `z-sidebar` | 200 | Navigation sidebars |
| `z-dropdown` | 300 | Dropdown menus |
| `z-toast` | 900 | Toast notifications |
| `z-modal` | 1000 | Modal dialogs |
| `z-modal-overlay` | 1100 | Modal backdrop |
| `z-notification` | 1200 | Top-level notifications |

### Shadows & Radii
- `shadow-spa-resting` / `shadow-spa-elevated` / `shadow-spa-modal`
- `rounded-spa` (8px) / `rounded-spa-lg` (12px)

---

## Quality Standards

1. `npm run build` must pass without errors
2. Use `booking.bookingId` (UUID) for API calls, not `booking.id`
3. Use `toDbStatus()` helper for status transformations
4. Z-index must use semantic tokens (header/sidebar/modal etc), never raw values
5. Financial fields: base_amount, discount_amount, final_amount
6. After mutations, call `loadData()` to refresh from Supabase
7. Parent components pass `therapists[]` prop to children
8. **Dropdowns must use the app's design-system component, never a native `<select>`.** Every dropdown/select (including inline typeahead/combobox fields) must render through the shared `CustomSelect` (`src/components/ui/CustomSelect.jsx`) so it matches the system UI across browsers and OSes. A raw `<select>` falls back to the OS-native control (different fonts, chrome, and behavior on macOS/Windows/mobile) and is **not allowed**.

---

## Constraints

- Cash-based reconciliation only (WHERE payment_status = 'paid')
- Nepal timezone for all datetime operations
- Supabase RLS required for all tables
- Payment records are immutable (RESTRICT on UPDATE/DELETE)
- Discount enum: none/pending/approved (rejection resets to none)

---

## Deployment & CI/CD

| Workflow | Trigger | Target |
|----------|---------|--------|
| `ci.yml` | PR checks | Lint + build validation |
| `deploy-staging.yml` | Push to `stage` | `dev-zenly.zunkireelabs.com` |
| `deploy.yml` | Push to `main` | `zenly.zunkireelabs.com` (production) |
| `rollback.yml` | Manual | Rollback production |

Deploy process: SSH → `git pull` → `docker compose up -d --build` → health check (2 min timeout).

---

## Git Workflow & Branching Strategy

**CRITICAL: Follow this branching strategy strictly.**

```
feature/* ──► stage ──► main
              │          │
           (testing)  (production)
```

### Rules
1. **Feature branches** → merge to `stage` ONLY (never directly to `main`)
2. **PRs** → always target `stage` branch, not `main`
3. **After testing on stage** → merge `stage` to `main` for production
4. **NEVER** merge feature branches directly to `main`

### PR Commands
```bash
# Create PR targeting stage (CORRECT)
gh pr create --base stage --title "..." --body "..."

# WRONG - never do this for feature branches
gh pr create --base main ...
```

---

## Git Attribution

**IMPORTANT**: For all git operations (commits, PRs, etc.):
- **DO NOT** use "Generated with Claude Code" or any Claude branding
- **DO** attribute to the GitHub account: `@sthasadin`
- PR footers should end with: `Created by @sthasadin`
- Commit co-author line: `Co-Authored-By: sthasadin <sthasadin@users.noreply.github.com>`

---

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

---

## Documentation

- `docs/session-logs/` — Daily session logs
- `docs/session-log.md` — Legacy comprehensive session log
- `docs/claude-project-template/` — Reusable project template
