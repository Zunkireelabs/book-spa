# Zennly tracker

**The one file for open work.** Plane (project **Zennly WebApp**, key `ZNLY`) is the board. This file mirrors it
for anyone working in the repo. Every line carries its `ZNLY-n` id. If this file and Plane disagree, Plane wins:
fix this file.

*Generated from Plane by `/project-pm sync`. Don't hand-edit; change Plane, then re-sync.*

Last synced: **2026-10-27 evening** by bookx-d5 (lead)

---

## How we track work (SOP, same for every project)

1. **One board, one file.** Plane holds every task and its state. `tasks/TRACKER.md` is the only to-do file in
   the repo. No `todo.md`, no to-do lists inside handoffs, briefs or session logs; a to-do found anywhere else
   moves here and to Plane.
2. **No work without a ticket.** Search Plane first; create the ticket if it's missing (parent epic, labels,
   priority, acceptance criteria). Add it to this file in the right section.
3. **States** (they mirror the git flow): `Backlog → Todo → In Progress → In Review (PR open to stage) →
   On Stage (merged to stage) → Done (live on main)`. *Cancelled* = won't do. We cancel, we don't delete.
4. **Move the ticket when the work moves**, and update this file in the same sitting.
5. **Decisions only the owner can make** are tickets titled `DECIDE …`, listed under *Waiting on owner*.
6. **New work found mid-task** becomes a new ticket, not scope creep.
7. **Logs are narrative, not to-do lists.** `docs/session-logs/YYYY-MM-DD.md` says what happened and links the
   ticket ids. Any loose end in a log becomes a ticket.
8. **Unverified ≠ done.** If it can't be proven, it gets the `needs-verification` label.

---

## In progress

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-74 | Sadin | urgent | UI-8 (V18): storage security, org-scoped service-images, private customer-files |
| ZNLY-75 | Sadin | urgent | UI-9 (V19): cross-tenant RLS sweep. Stage test, then prod after the holidays |
| ZNLY-70 | Sadin | high | UI-4 (V14): one money model |
| ZNLY-71 | Sadin | high | UI-5 (V15–V16): Bookings redesign + booking inbox |
| ZNLY-72 | Sadin | high | UI-6: admin "Delete permanently" bug |
| ZNLY-73 | Sadin | high | UI-7 (V17): centred checkout, split payments, QR |
| ZNLY-77 | Sadin | high | UI-11 (V22): member discount at checkout |
| ZNLY-78 | Sadin | high | UI-12 (V23): Vouchers redesign |
| ZNLY-80 | Sadin | high | UI-14 (V26): products in checkout + commission |
| ZNLY-98 | Sadin | high | UI-19 (V27): merge PR #413 branch into the UI branch, renumber to 301+ |
| ZNLY-100 | Sadin | high | UI-21: one staff-availability rule everywhere. V29c2 built; owner fix batch with bookx-15 |
| ZNLY-67 | Sadin | medium | UI-1: calendar port + app shell |
| ZNLY-68 | Sadin | medium | UI-2 (V5–V9): panel unification |
| ZNLY-69 | Sadin | medium | UI-3 (V11–V13): Customers redesign |
| ZNLY-76 | Sadin | medium | UI-10 (V20–V21): Packages + Memberships redesign |
| ZNLY-79 | Sadin | medium | UI-13 (V25): Products + Inventory with variants |
| ZNLY-97 | Sadin | medium | UI-18: Therapists redesign |
| ZNLY-81 | Sadin | urgent | UI-15: renumber UI-branch migrations 282–293 → 301+. Done locally in 847a5c9; ships with the UI-port PR |
| ZNLY-101 | Sadin | medium | UI-22: make staff transfers easy to understand everywhere. Mockup first |
| ZNLY-112 | Sadin | high | Therapists "Overall" fails (uuid "__overall__") + Add with a Branch field + no Overall for one-branch tenants. Built and owner-checked (V31), committed locally; ships with the UI-port PR |
| ZNLY-134 | Sadin | medium | Site icon: big sizes = wordmark on white, small = Playfair "z". Preview temp_ss/mockups/site-icon-v1.html, awaiting owner OK |
| ZNLY-135 | Sadin | high | Notifications: pop-up card + sound, bell category tabs + branch labels, Inbox page, per-user settings. V35a committed (4e762b7). V35b committed (760a7cd). Then V35c new events (+ actor column). Owner findings 29 Oct: bell groups bookings (wants each row), own-action bookings hidden (confirm) |
| ZNLY-123 | Sadin | medium | UI-23: Attendance page redesign, payroll-grade. V34a/a2/b committed (1663683). V34c payroll guard on hold until ZNLY-135 |
| ZNLY-113 | Sadin | high | One home-branch model for temporary transfers. V33a (a8f55f0) + V33b (d99f8e5) + V33c (3019d2d) committed locally, owner-checked. Code done; ships with the UI-port PR |
| ZNLY-118 | Sadin | high | Lent therapist commission can go missing. Fixed in 3019d2d (V33c), owner-verified locally; ships with the UI-port PR |
| ZNLY-119 | Sadin | low | Profile: Branch row in the read view + Transfer/Return now in the header menu. Built in V33b (d99f8e5); ships with the UI-port PR |
| ZNLY-125 | Sadin | medium | Decided: the branch that was home on the booking date pays. Built in V33c-fix3, ships with ZNLY-113 |
| ZNLY-120 | Sadin | low | Pill for a transfer later today ("To Sanepa at 4:20pm"). Built in V33b (d99f8e5); ships with the UI-port PR |
| ZNLY-147 | Sadin | high | Dashboard redesign: job views (Business/Branch/Front desk/My day) × Prep/Live/Close + insights. Mockup v2 approved (9.4). V36a (8b45e05), V36b (fa4b429), V36c Branch view (976821c), V36d Business/Front desk/My day/new-tenant checklist committed (owner-checked); next V36e insights |
| ZNLY-150 | Sadin | high | Login ↔ therapist: link existed (users.therapist_id, mig 324); my day uses it (fa4b429). "Login" field in Therapists panel built in V36d, owner walkthrough done |
| ZNLY-149 | Sadin | high | Front-desk tools (Collect payment etc.) for manager/admin. Built in V36a (8b45e05), owner-checked; ships with the UI-port PR |

## In review / on stage

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-12 | unassigned | urgent | Revoke anon EXECUTE on public_search_booking (In Review, PR #415) |
| ZNLY-14 | unassigned | high | PIN login service-role → Edge Function (In Review, PR #30) |
| ZNLY-34 | unassigned | high | PR #413: combo-service bookings, calendar full-day view (In Review) |
| ZNLY-41 | unassigned | high | Promote stage → main: customer/staff detail + migrations 275–281 (On Stage) |
| ZNLY-95 | Sadin | high | project-pm upgrade: what's mine/urgent, generated tracker, token rules (On Stage) |
| ZNLY-40 | Sadin | low | Retire stale docs superseded by Plane (On Stage) |

## Todo

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-13 | unassigned | high | Renumber colliding migration-289 (PR #413 vs #415) |
| ZNLY-26 | unassigned | high | Verify 503 "Reconnecting" screen + login banner against a real failure |
| ZNLY-94 | Anish | high | Get onboarded to the Plane workflow |
| ZNLY-130 | Sadin | medium | Calendar header shows "From Lazimpat" instead of "Here <window>" for a visiting therapist (split from ZNLY-123) |
| ZNLY-17 | unassigned | medium | Flip STAGING_DOMAIN to dev-app.zennly.io, verify stage health check |

## Waiting on owner

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-140 | Sadin | medium | DECIDE: Inbox hover quick actions (Confirm / Review / Open attendance) |
| ZNLY-84 | Sadin | medium | A-2: admin_viewer sees write actions on customer-detail. Hand to Anish or fix here? |
| ZNLY-85 | Sadin | medium | V-4: staff voucher limits. Match booking limits? |
| ZNLY-89 | Sadin | medium | V-9: win-back emails already-booked guests. Align with At-risk rule? |
| ZNLY-108 | Sadin | low | DECIDE: keep cancelled staff transfers in History (soft-cancel migration)? |
| ZNLY-86 | Sadin | low | V-6: staff issuing vouchers get no member discount / wallet. Intended? |
| ZNLY-87 | Sadin | low | V-7: let admins edit existing membership tiers? |
| ZNLY-88 | Sadin | low | V-8: room active/deactivate switch? |

## Backlog

| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-152 | Sadin | medium | Sidebar "Bookings" badge: count of bookings needing someone (same source as dashboard Needs action) |
| ZNLY-151 | Sadin | medium | Retire the old "New booking" wizard page + old centred Booking Management modal; right-hand panels everywhere |
| ZNLY-148 | Sadin | medium | Dashboard metrics look wrong (Unpaid 173%, utilization 0% while booked, Top performers NPR 0). Needs verification |
| ZNLY-121 | Sadin | high | Customer booking flow shows every date "Full" at Sanepa (local). Must clear before the UI-port PR |
| ZNLY-124 | Sadin | medium | Product-sales drill-down ignores sales at other branches (won't match commission) |
| ZNLY-126 | Sadin | low | Overtime pay for hours outside the usual shift. ONLY if customers ask |
| ZNLY-122 | Sadin | low | Therapists list never refreshes itself (stale transfer/Today states) |
| ZNLY-127 | Sadin | medium | Calendar hides a visitor whose transfer window starts later today (can't pre-book). needs-verification |
| ZNLY-139 | unassigned | low | Real licence-clean dog bark for the "Woof!" notification sound (follow-up to ZNLY-135) |
| ZNLY-137 | Sadin | medium | Fingerprint attendance machine integration (punches → save_attendance, source "device") |
| ZNLY-138 | unassigned | low | Per-person "expect a check-in" override (follow-up to ZNLY-123) |
| ZNLY-133 | unassigned | medium | Weekly timesheet review + approval before payroll (split from ZNLY-123) |
| ZNLY-131 | unassigned | low | Staff self check-in: shared kiosk screen with PIN (split from ZNLY-123) |
| ZNLY-132 | unassigned | low | Location check on check-in (split from ZNLY-123) |
| ZNLY-128 | Sadin | low | Therapist profile menu shows "Back to therapist list" twice |
| ZNLY-129 | Sadin | low | Profile timeline uses the late return record, not the planned end (revert_at) |
| ZNLY-114 | Sadin | low | Overall: transferred therapist's Today hours merge shift rows from both branches (likely fixed by ZNLY-113) |
| ZNLY-115 | Sadin | low | Working hours editor doesn't check against branch opening hours (mockup first) |
| ZNLY-116 | Sadin | medium | Therapist History says "room" for branch transfers (locationLabel used as the branch word) |
| ZNLY-117 | Sadin | low | Transfer banner repeats the time ("until 3:30pm, back at Lazimpat 3:30pm") |
| ZNLY-109 | Sadin | low | Calendar header tooltip mixes 24h and 12h ("Shift started 09:00" next to "12:00pm") |
| ZNLY-110 | Sadin | low | Calendar shading labels cut mid-time: wrap instead of truncate |
| ZNLY-111 | Sadin | low | Calendar grid has no right gutter: last column runs flush to the window edge |
| ZNLY-15 | unassigned | high | Rotate/remove accounts exposed by deleted dev-info.html |
| ZNLY-18 | unassigned | high | Supabase Auth URL config / allowlists for the new domain |
| ZNLY-82 | Sadin | high | UI-16: release prep, regression pass, stage re-merge, PR to stage |
| ZNLY-16 | unassigned | medium | RLS access harness, confirm merged |
| ZNLY-20 | unassigned | medium | Legacy-domain redirect + retire old domains |
| ZNLY-21 | unassigned | medium | Auth email via Resend SMTP + DKIM/SPF/DMARC |
| ZNLY-23 | unassigned | medium | Click-through the four newly flag-enabled prod pages |
| ZNLY-24 | unassigned | medium | Admin corrections log page |
| ZNLY-27 | unassigned | medium | Perf: re-measure in Nepal business hours |
| ZNLY-28 | unassigned | medium | Idle-tab polling fan-out |
| ZNLY-30 | unassigned | medium | Decide on required_linear_history for main/stage |
| ZNLY-83 | Sadin | medium | UI-17: next pages (Reports, Dashboard, Calendar polish, Settings lists) |
| ZNLY-90 | Sadin | medium | V19 security follow-ups |
| ZNLY-96 | Sadin | medium | GitHub → Plane automation + CI check for ZNLY id in PR title |
| ZNLY-102 | unassigned | medium | Falls-outside list: block drag, transfer extend/return, recurring blocks |
| ZNLY-103 | unassigned | medium | One shared modal overlay for every centred popup |
| ZNLY-104 | unassigned | medium | Calendar address-bar date doesn't follow navigation |
| ZNLY-19 | unassigned | low | Remaining "Zenly" strings |
| ZNLY-22 | unassigned | low | Booking confirmation + reminder emails |
| ZNLY-25 | unassigned | low | Decide on generic Package (bundle) booking system |
| ZNLY-29 | unassigned | low | Supabase dashboard cleanup |
| ZNLY-31 | unassigned | low | Staging migration-ledger anomalies |
| ZNLY-32 | unassigned | low | Repo housekeeping |
| ZNLY-33 | unassigned | low | PR #350 follow-up gaps |
| ZNLY-35 | unassigned | low | Manual verification debt |
| ZNLY-36 | unassigned | low | sbal provider-profile content |
| ZNLY-37 | unassigned | low | Phase 9 Platform Governance status |
| ZNLY-38 | unassigned | low | Centralize customer/staff data, phase 2 |
| ZNLY-39 | unassigned | low | PostHog adoption status |
| ZNLY-91 | Sadin | low | V25/V26 products follow-ups |
| ZNLY-92 | Sadin | low | V20–V24 follow-ups |
| ZNLY-93 | Sadin | low | Small UI backlog |
| ZNLY-99 | unassigned | low | UI-20: #413 merge follow-ups (visible-hours chip, W/M shortcuts, ServiceFormPanel) |
| ZNLY-105 | unassigned | low | Calendar: shading under a booking is invisible |
| ZNLY-106 | unassigned | low | Therapist photo shows on the profile but not in the list / peek panel |
| ZNLY-107 | unassigned | low | Break chip: one clear, consistent design (roster, calendar, profile) |

---

## Reference (not tasks)

**Read-only prod query before shipping ZNLY-77 (member discount).** Paste it alone in the prod SQL editor:

```
select o.slug as org, 'service category' as kind, coalesce(s.category,'(none)') as value, count(*)::text as detail
from public.services s join public.organizations o on o.id = s.org_id
group by 1, 2, 3
union all
select o.slug, 'tier: ' || t.name, coalesce(t.discount_rules::text, '{}'), case when t.is_active then 'on sale' else 'off sale' end
from public.membership_tiers t join public.organizations o on o.id = t.org_id
union all
select o.slug, 'active members', t.name, count(*)::text
from public.memberships m join public.membership_tiers t on t.id = m.tier_id join public.organizations o on o.id = m.org_id
where m.expiry_date >= current_date
group by 1, 2, 3
order by 1, 2, 3;
```

**Where the rest lives:** briefs `temp_ss/briefs/` · mockups `temp_ss/mockups/` · screenshots `temp_ss/cal-port/`
(next number 117) · lead resume notes `temp_ss/HANDOFF-lead-resume.md` (session state and rules only, no
to-dos) · DB promotion `supabase/PROMOTION.md` · session logs `docs/session-logs/` · old handoffs
`docs/archive/`.
