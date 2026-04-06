# CLAUDE.md - Project Intelligence

## Project Overview

**Project**: BookSpa — Nuad Thai Spa Booking Web App
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
# Development
npm run dev

# Build
npm run build

# Deploy
./deploy.sh
```

---

## Project Structure

```
nuad-thai-web-app/
├── src/
│   ├── components/ui/       # Shared UI components
│   ├── contexts/            # Auth context
│   ├── lib/                 # Supabase client
│   ├── pages/               # Route pages
│   ├── services/            # API service layer
│   └── styles/              # Tailwind CSS
├── supabase/                # Migrations and seed data
├── .claude/skills/          # Claude Code skills
└── CLAUDE.md
```

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
