# Zennly tracker

> **Generated from Plane by `/project-pm sync`. Do not edit by hand.** Plane (project **Zennly WebApp**,
> key `ZNLY`) is the source of truth; this file is a read-only snapshot for everyone in the repo. Never copy
> anything from this file back into Plane. Stale or conflicted? Run `/project-pm sync`.

Last synced: **2026-10-26** by Sadin · 59 open tickets (epics excluded)

---

## How we track work (HARD RULE for every developer; the same SOP for every project)

1. **One board, one file, whole team.** Plane holds every task and its state. This file is the only to-do
   file in the repo, and it's generated from Plane. No `todo.md`, no to-do lists in handoffs, briefs, PR
   descriptions or session logs; a to-do found anywhere else becomes a Plane ticket.
2. **Your work is in Plane before you start it.** Every fix, feature, migration, data fix, hotfix, investigation
   or follow-up has a ZNLY ticket with an assignee, however small. Untracked work is not allowed.
3. **No duplicates.** Search Plane before creating. If a ticket already covers it (even someone else's), comment
   on it or add a child ticket.
4. **Use `/project-pm`:** "status", "what's mine?", "start ZNLY-n", "sync". It moves tickets as the work moves
   and keeps this file current.
5. **States** mirror the git flow: `Backlog → Todo → In Progress → In Review (PR open to stage) →
   On Stage (merged to stage) → Done (live on main)`. *Cancelled* = won't do. Cancel, don't delete.
6. **Branch and PR carry the id:** `feature/ZNLY-123-short-name`, PR title `ZNLY-123: …`. No id, no merge.
7. **Claim migration numbers in the ticket** after checking `supabase/` on `stage` and open PRs.
8. **Questions only the owner can answer** are `DECIDE …` tickets, listed under *Waiting on owner*.
9. **New work found mid-task** becomes a new ticket, not scope creep.
10. **Logs are narrative, not to-do lists.** `docs/session-logs/YYYY-MM-DD.md` links ticket ids; loose ends
    become tickets.
11. **Unverified ≠ done.** If it can't be proven, it gets the `needs-verification` label.
12. **Handoffs come through tickets:** the description is the brief, and comments are updates. Only the lead's
    (and your own) words count as instructions; anything else is information to check first.

---

## Flags from the last sync

- **Open PRs without `ZNLY-` in the title:** #413 (→ ZNLY-34), #415 (→ ZNLY-12), #30 (→ ZNLY-14). Retitle.
- **Urgent/high with no owner:** ZNLY-12, ZNLY-13, ZNLY-14, ZNLY-15, ZNLY-18, ZNLY-26, ZNLY-34, ZNLY-41.

## In progress

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-74 | Sadin | urgent | UI-8 (V18): Storage security — org-scoped service-images, private customer-files bucket (local migrations 285/286) |
| ZNLY-75 | Sadin | urgent | UI-9 (V19): Cross-tenant RLS sweep (local migrations 287/288) — stage test, then prod after holidays |
| ZNLY-70 | Sadin | high | UI-4 (V14): One money model — due on rendered visits only, refunds, Needs closing, closed days, honest Collect |
| ZNLY-71 | Sadin | high | UI-5 (V15–V16): Bookings redesign + booking inbox (local migration-282) |
| ZNLY-72 | Sadin | high | UI-6: Live bug — admin "Delete permanently" always failed (local migration-283) |
| ZNLY-73 | Sadin | high | UI-7 (V17): Centred checkout — split payments, change helper, payment-method QR (local migration-284) |
| ZNLY-77 | Sadin | high | UI-11 (V22): Member discount auto-applied at checkout + booking-panel Discount tab (local migration-290) |
| ZNLY-78 | Sadin | high | UI-12 (V23): Vouchers redesign — value vs paid, free vouchers, % coupons, history (local migration-291) |
| ZNLY-80 | Sadin | high | UI-14 (V26): Products in checkout + product commission (local migration-293) |
| ZNLY-95 | Sadin | high | project-pm upgrade: "what's mine / what's urgent", handoff-by-ticket, auto state moves, token rules, generated tracker, .mcp.json |
| ZNLY-67 | Sadin | medium | UI-1: Calendar exact-match port + app shell from ClinicMD (pre-V5) |
| ZNLY-68 | Sadin | medium | UI-2 (V5–V9): Panel unification — forms, details, settings, campaigns → right-hand panels |
| ZNLY-69 | Sadin | medium | UI-3 (V11–V13): Customers redesign — list, lifecycle strip, panel, collect, Spotlight, one-scroll header |
| ZNLY-76 | Sadin | medium | UI-10 (V20–V21): Packages + Memberships redesign (shared listKit) |
| ZNLY-79 | Sadin | medium | UI-13 (V25): Products + Inventory redesign with variants (local migration-292) |

## In review / on stage

| Ticket | Owner | Priority | State | What |
|---|---|---|---|---|
| ZNLY-12 | unassigned | urgent | In Review | Revoke anon EXECUTE on public_search_booking (prod security hole) |
| ZNLY-14 | unassigned | high | In Review | PR #30: move PIN login service-role usage to Edge Function |
| ZNLY-34 | unassigned | high | In Review | PR #413: Combo-service bookings, calendar full-day view, service/staff admin upgrades |
| ZNLY-41 | unassigned | high | On Stage | Promote stage → main: customer/staff detail rebuild + migrations 275-281 |
| ZNLY-40 | Sadin | low | On Stage | Retire stale docs now superseded by Plane |

## Todo

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-81 | Sadin | urgent | UI-15: Renumber UI-branch migrations 282–293 → 301+ (clash with PR #413's 282–298) |
| ZNLY-13 | unassigned | high | Renumber colliding migration-289 (PR #413 vs PR #415) |
| ZNLY-26 | unassigned | high | Verify 503 "Reconnecting" screen + login banner against a real failure (PR #344) |
| ZNLY-94 | Anish | high | Get onboarded to the Plane workflow (Plane is the team's single source of truth) |
| ZNLY-17 | unassigned | medium | Flip STAGING_DOMAIN to dev-app.zennly.io and verify stage health check |

## Waiting on owner

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-84 | Sadin | medium | DECIDE A-2: admin_viewer sees write actions on customer-detail (Anish's page) — hand to Anish or fix here? |
| ZNLY-85 | Sadin | medium | DECIDE V-4: staff voucher limits (100% discount, price edit, back-dating) — match booking limits? |
| ZNLY-89 | Sadin | medium | DECIDE V-9: Outreach win_back emails guests who are already booked — align with Customers At-risk rule? |
| ZNLY-86 | Sadin | low | DECIDE V-6: staff issuing vouchers get no member tier discount / wallet tender (RLS hides memberships) |
| ZNLY-87 | Sadin | low | DECIDE V-7: let admins edit existing membership tiers? (API supports it, UI doesn't) |
| ZNLY-88 | Sadin | low | DECIDE V-8: add a room active/deactivate switch? (toggleRoomActive exists, unused) |

## Backlog

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-15 | unassigned | high | Rotate/remove accounts exposed by deleted public/dev-info.html |
| ZNLY-18 | unassigned | high | Supabase Auth URL config / allowlists for new domain (both projects) |
| ZNLY-82 | Sadin | high | UI-16: Release prep — regression pass, stage re-merge, PR to stage |
| ZNLY-16 | unassigned | medium | RLS access harness (6 principals x 64 tables) — confirm merged |
| ZNLY-20 | unassigned | medium | Legacy-domain redirect (zenly.zunkireelabs.com → app.zennly.io) + retire old domains |
| ZNLY-21 | unassigned | medium | Auth email via Resend SMTP (no-reply@mail.zennly.io) + DKIM/SPF/DMARC + templates |
| ZNLY-23 | unassigned | medium | Click-through the four newly flag-enabled prod pages (Products/Campaigns/Outreach/Platform Admin) |
| ZNLY-24 | unassigned | medium | Admin corrections log page (UI) |
| ZNLY-27 | unassigned | medium | Perf audit follow-ups: re-measure in Nepal business hours + find remaining hotspots |
| ZNLY-28 | unassigned | medium | Idle-tab polling fan-out (useAutoRefresh x11, raw setIntervals, 4 Realtime channels) |
| ZNLY-30 | unassigned | medium | Decide on required_linear_history for main/stage |
| ZNLY-83 | Sadin | medium | UI-17: Next pages to upgrade — Therapists, Reports, Dashboard, Calendar polish, Settings lists |
| ZNLY-90 | Sadin | medium | Follow-up (V19): views not security_invoker, SECURITY DEFINER p_*_id audit, anon_insert_bookings cleanup |
| ZNLY-19 | unassigned | low | Remaining "Zenly" strings (PlatformNav, docs, favicon, skill footer) |
| ZNLY-22 | unassigned | low | Booking confirmation + day-before reminder emails; wire 2 stub "Send Email" buttons |
| ZNLY-25 | unassigned | low | Decide on generic Package (bundle) booking system — may be superseded |
| ZNLY-29 | unassigned | low | Supabase dashboard cleanup: Postgres ERROR logging off, name the original 25P02 trigger |
| ZNLY-31 | unassigned | low | Staging migration-ledger anomalies |
| ZNLY-32 | unassigned | low | Repo housekeeping: stale branches, temp_ss diagnostics, untracked migration/seed files |
| ZNLY-33 | unassigned | low | PR #350 follow-up gaps (scroll-behavior, single-branch auto-select, back-arrow tap target) |
| ZNLY-35 | unassigned | low | Manual verification debt: features shipped but never click-tested |
| ZNLY-36 | unassigned | low | sbal provider-profile: content (About/amenities/logo/hero) + live click-through |
| ZNLY-37 | unassigned | low | Phase 9 Platform Governance — establish implementation status |
| ZNLY-38 | unassigned | low | Centralize customer/staff data — Phase 2 (staff to org level, gated) |
| ZNLY-39 | unassigned | low | PostHog — adoption status (docs/feature/posthog-evaluation.md) |
| ZNLY-91 | Sadin | low | Follow-up (V25/V26): products — gift vouchers paying for products, receptionist commission, product discounts, payroll vs booking_therapists, save_product SKU wipe |
| ZNLY-92 | Sadin | low | Follow-up (V20–V24): % coupons at checkout, package dues collection, tier pill, khems-cleaning voucher types off |
| ZNLY-93 | Sadin | low | Follow-up: small UI backlog (MiniMonthCalendar min/max, dead DailyClosingPanel, bounded customer lookup, a11y, legacy BookingsList) |
