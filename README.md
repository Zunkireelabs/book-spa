# Zenly — Multi-tenant Booking Web App

Zenly is a multi-tenant spa/booking management SPA (currently running Nuad Thai Spa). Staff,
managers, and admins manage bookings, therapists, rooms, services, payments, and discounts across
multiple branches; customers book through an org-scoped public flow.

> **`CLAUDE.md` is the authoritative source of truth** for architecture, conventions, the two
> Supabase databases, the git/deploy flow, and the DB promotion process. Read it before making
> changes. This README is a short orientation only.

## Tech stack

- **React 18 + Vite 5** SPA (JSX, not TypeScript)
- **Tailwind CSS 3** with a custom design-token theme (`tailwind.config.js`)
- **Supabase** — Postgres, Auth, Row-Level Security, Realtime (two separate projects: staging &
  production)
- **React Router v6** (Context API for state — no Redux), **Framer Motion**, **date-fns**,
  **Recharts**, **@dnd-kit**, **FullCalendar**

## Getting started

```bash
npm install
cp .env.example .env   # defaults to the staging Supabase project
npm start              # dev server on http://localhost:4028
```

Only Supabase `anon` keys belong in `.env`. Never put a `service_role` key in any env file.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Vite dev server (port 4028) |
| `npm run build` | Production build → `build/` |
| `npm run serve` | Preview the production build |

There is **no test or lint runner** configured — `npm run build` is the primary validation gate.

## Project layout

```
src/
├── components/   # Shared + ui/ reusable components
├── contexts/     # Auth → Org → Branch → AIAssistant (+ Tenant for customer routes)
├── lib/          # supabase.js client singleton
├── pages/        # Route pages (org-scoped: /:orgSlug/...)
├── services/     # api.js (state machine + mutations), transformers, enrichment
└── styles/       # Tailwind entry
supabase/         # schema.sql, rls.sql, migration-NNN-*.sql, seeds, PROMOTION.md
```

## Database & deployment

There are **two completely separate Supabase databases** (staging and production) that share no
data. Deploys ship **frontend code only** — schema/seed/credential changes must be applied to each
database by hand. See **`CLAUDE.md`** and **`supabase/PROMOTION.md`** for the migration tracking
(`schema_migrations`) and promotion runbook.

Git flow: `feature/*` → `stage` → `main`. `stage` deploys to staging, `main` to production.
