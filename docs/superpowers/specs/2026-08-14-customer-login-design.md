# Customer Login & Accounts — Design

Date: 2026-08-14
Status: Approved by user, pending implementation plan

## Problem

Customers booking via `/:orgSlug/book` have no account/identity. Every booking is
anonymous (name/phone/email typed fresh each time). The user wants a "Login" button
on the customer header (next to the existing Support button) and a login page, so
customers can create a real account and book with a persisted identity.

## Scope decision

Full Supabase Auth account for customers (not a lightweight OTP session, not just a
shortcut into the existing anonymous manage-portal lookup). Customers become real
`auth.users`, similar to staff — but on a fully separate auth/session track from
staff `AuthContext`.

## Requirements (from brainstorming)

- **Auth method**: email + password (standard `supabase.auth.signUp` /
  `signInWithPassword`). No OTP, no SMS.
- **What login unlocks**: booking history (past + upcoming bookings across all
  branches of the org) + auto-prefill of name/phone/email on new bookings.
- **Existing anonymous bookings**: auto-linked to the new account at signup time by
  matching `bookings.customer_email` — no manual claim step.
- **Existing `/:orgSlug/manage` anonymous lookup**: stays exactly as-is. Login is
  additive; guest booking/managing without an account remains fully supported.
- **Account scope**: org-scoped. One `customer_accounts` row per org per person — no
  cross-org shared login (matches the app's existing org-scoped route/RLS model;
  only one production tenant exists today anyway).

## Data model

New table, deliberately separate from the existing staff-facing `customers` table
(which is a branch-scoped walk-in ledger — one person can have multiple rows across
branches, and is used throughout staff-side code/RLS). Reusing it for login identity
would conflate two different concepts and risk breaking existing staff queries.

```sql
create table customer_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  phone text,
  full_name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create index on customer_accounts (org_id, email);

alter table bookings add column customer_account_id uuid references customer_accounts(id);
create index on bookings (customer_account_id);
```

## Auth flow

### Signup — `/:orgSlug/signup`

1. Form collects name, email, phone, password.
2. `supabase.auth.signUp({ email, password, options: { data: { org_id, full_name, phone } } })`.
3. On success, call a Postgres RPC `create_customer_account(org_id, email, phone, full_name)`
   (security definer, called with the new session) that atomically:
   - Inserts the `customer_accounts` row.
   - Auto-links history: `update bookings set customer_account_id = new.id where branch_id in (select id from branches where org_id = :org_id) and customer_email = :email and customer_account_id is null` (`bookings` has no `org_id` column directly — org scoping goes through `branches.org_id` via `branch_id`).
   Wrapping both in one RPC avoids a partial-success state from two separate client
   round trips.

### Login — `/:orgSlug/customer-login`

- `supabase.auth.signInWithPassword({ email, password })`. Standard Supabase session.
- Route is named `customer-login`, not `login` — `/:orgSlug/login` is already the
  staff login route (`StaffLoginAuthentication`) and must not collide.

## RLS

```sql
alter table customer_accounts enable row level security;

create policy "customer reads own account" on customer_accounts
  for select using (auth_user_id = auth.uid());

create policy "customer updates own account" on customer_accounts
  for update using (auth_user_id = auth.uid());

create policy "customer reads own bookings" on bookings
  for select using (
    customer_account_id in (
      select id from customer_accounts where auth_user_id = auth.uid()
    )
  );
```

No customer INSERT/UPDATE/DELETE policy is added to `bookings` — creation stays on
the existing anonymous-insert path, mutation stays on the existing staff path. Login
only adds read access to a customer's own booking history. All existing staff RLS
policies on `bookings`/`customers` are untouched (additive only).

## Frontend

- **New `CustomerAuthContext`** — separate from the staff `AuthContext`, mounted only
  inside the `TenantProvider` tree (i.e. scoped to the public customer routes). Holds
  customer session, the `customer_accounts` row, and login/signup/logout methods.
- **New routes** (public, org-scoped, under `TenantProvider` like `/book` and
  `/manage`):
  - `/:orgSlug/customer-login` — email+password login form.
  - `/:orgSlug/signup` — name/email/phone/password signup form.
  - `/:orgSlug/account` — protected (redirects to `/customer-login` if no session):
    booking history list + basic profile view/edit.
- **`CustomerHeader.jsx:103-106`** — add a "Login" button immediately after the
  existing Support button. Logged-out: links to `/customer-login`. Logged-in: shows
  customer name, links to `/account`, includes logout.
- **`CustomerBookingFlow`** — when `CustomerAuthContext` has an active session,
  prefill name/email/phone from the `customer_accounts` row (fields remain editable,
  not locked).

## Migration & promotion

One new migration: `customer_accounts` table, `bookings.customer_account_id` column,
indexes, RLS policies, `create_customer_account` RPC.

- Applied to **staging** through the normal dev flow on the `stage` branch.
- Per `CLAUDE.md`: this is a schema-touching change, so production is **not**
  auto-migrated. At `stage → main` promotion time, hand the user an idempotent SQL
  script for the production SQL editor, and append this migration's version to
  `supabase/PROMOTION.md`'s pending-check manifest.
- No backfill risk: purely additive (new nullable column, new table) — no rewrite of
  existing rows.

## Out of scope (explicitly deferred)

- Password reset / forgot-password flow (needed before real launch, but not blocking
  first cut — flag as a follow-up).
- Saved preferences (favorite branch/therapist), profile photo, marketing
  opt-in/notification settings.
- Cross-org shared login / global customer identity.
- OTP or phone-based auth for customers.
- Any change to the existing `/:orgSlug/manage` anonymous lookup flow.
- Merging `customer_accounts` with the staff-facing `customers` table.
