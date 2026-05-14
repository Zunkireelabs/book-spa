# CLAUDE.md - Project Intelligence

## Project Overview

**Project**: Zenly — Multi-tenant Booking Web App
**Type**: React 18 + Vite SPA with Supabase backend
**Tech Stack**: React, Vite, Tailwind CSS, Supabase (Postgres, Auth, RLS, Realtime), Framer Motion, Lucide Icons

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

---

## Environment Variables

```bash
# Required — copy .env.example to .env.local
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

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
```

### Routing Map

| Path | Component | Access |
|------|-----------|--------|
| `/` | CustomerBookingFlow | Public |
| `/customer-booking-flow` | CustomerBookingFlow | Public |
| `/staff-login-authentication` | StaffLoginAuthentication | Public |
| `/booking-management-portal` | BookingManagementPortal | Public |
| `/branch-staff-dashboard` | BranchStaffDashboard | staff, manager, admin |
| `/booking-details-assignment-modal` | BookingDetailsAssignmentModal | staff, manager, admin |
| `/booking-details/:bookingId` | BookingDetailsAssignmentModal | staff, manager, admin |
| `/branch-manager-dashboard` | BranchManagerDashboard | manager, admin |

Protected routes use `<ProtectedRoute allowedRoles={[...]}>`.

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
| staff | 15% |
| manager | 25% |
| admin | 30% |

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

---

## Constraints

- Cash-based reconciliation only (WHERE payment_status = 'paid')
- Nepal timezone for all datetime operations
- Supabase RLS required for all tables
- Payment records are immutable (RESTRICT on UPDATE/DELETE)
- Discount enum: none/pending/approved (rejection resets to none)

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

## Documentation

- `docs/session-logs/` — Daily session logs
- `docs/session-log.md` — Legacy comprehensive session log
- `docs/claude-project-template/` — Reusable project template
