# Zennly tracker

> **Generated from Plane by `/project-pm sync`. Do not edit by hand.** Plane (project **Zennly WebApp**,
> key `ZNLY`) is the source of truth; this file is a read-only snapshot for everyone in the repo. Never copy
> anything from this file back into Plane. Stale or conflicted? Run `/project-pm sync`.

Last synced: **2026-11-15** by Project Manager · 152 open tickets (epics excluded: ZNLY-1, ZNLY-2, ZNLY-3, ZNLY-4, ZNLY-5, ZNLY-6, ZNLY-7, ZNLY-8, ZNLY-9, ZNLY-10, ZNLY-11, ZNLY-83)

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
- **Open PRs without `ZNLY-` in the title:** #425, #415, #30 (3 open PRs).
- **Urgent/high with no owner:** ZNLY-183, ZNLY-179, ZNLY-26, ZNLY-18, ZNLY-15, ZNLY-14, ZNLY-13, ZNLY-12.

## In progress
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-66 | Sadin | high | UI/UX Upgrade (feat/ui-port-from-clinicmd) |
| ZNLY-159 | Sadin | high | Reports redesign: 17 reports in 5 groups, Start here row, headline vs last period, ✦ flags |
| ZNLY-182 | Anish | high | Online combo-service bookings never split into per-component booking_combo_items |
| ZNLY-186 | Anish | high | Per-branch service scope — standalone port to stage/main (prod) |
| ZNLY-187 | Anish | high | StaffBookingForm doesn't pass branch to fetchServices — branch-scoped/excluded services leak into staff New Booking |
| ZNLY-190 | Anish | high | Customer-facing branch picker shows stale hours, ignores per-day Weekly Opening Hours |
| ZNLY-191 | Anish | high | Customer "Log" tab errors on production — audit_logs missing FKs to users/branches |
| ZNLY-136 | Anish | medium | Group booking (Fresha-style): book multiple people, one shared slot, one checkout |
| ZNLY-172 | Sadin | medium | Therapist inner page: redesign the Customers, Services and Attendance tabs (after ZNLY-170) |
| ZNLY-175 | Sadin | medium | Therapist inner page: outcomes bar total counts upcoming bookings that sit in no bucket |
| ZNLY-176 | Anish | medium | Locations page under Setup — list, add, edit branch (incl. per-day opening hours) |
| ZNLY-178 | Anish | medium | Per-org toggle: enable/disable group booking for online customer bookings |
| ZNLY-184 | Anish | medium | Group booking: blank guest name should fall back to lead's name, not "Guest N" |
| ZNLY-185 | Anish | medium | Per-branch service scope — restrict a service to specific branches at creation |
| ZNLY-188 | Anish | medium | Group booking: collect per-guest First/Last Name, Email, Phone, Gender (fixes shared-customer-record overwrite) |
| ZNLY-189 | Anish | medium | Group booking: retry rollback + alert staff when a group booking gets stuck |
| ZNLY-192 | Anish | medium | Wire 11 hardcoded "Therapist" labels to the dynamic staffLabel system |
| ZNLY-194 | Sadin | medium | project-pm: use scripted Plane access (plane-tracker.py) for tracker sync; add path rule + INSTALL.md setup |

## In review / on stage
| Ticket | Owner | Priority | State | What |
|---|---|---|---|---|
| ZNLY-12 | — | urgent | In Review | Revoke anon EXECUTE on public_search_booking (prod security hole) |
| ZNLY-74 | Sadin | urgent | In Review | UI-8 (V18): Storage security — org-scoped service-images, private customer-files bucket (local migrations 285/286) |
| ZNLY-75 | Sadin | urgent | In Review | UI-9 (V19): Cross-tenant RLS sweep (local migrations 287/288) — stage test, then prod after holidays |
| ZNLY-81 | Sadin | urgent | In Review | UI-15: Renumber UI-branch migrations 282–293 → 301+ (clash with PR #413's 282–298) |
| ZNLY-153 | Anish | urgent | In Review | Group booking review fixes: therapist PII leak, wrong guest roster, availability math, discard dialog |
| ZNLY-14 | — | high | In Review | PR #30: move PIN login service-role usage to Edge Function |
| ZNLY-34 | Anish | high | In Review | PR #413: Combo-service bookings, calendar full-day view, service/staff admin upgrades |
| ZNLY-41 | Anish | high | On Stage | Promote stage → main: customer/staff detail rebuild + migrations 275-281 |
| ZNLY-70 | Sadin | high | In Review | UI-4 (V14): One money model — due on rendered visits only, refunds, Needs closing, closed days, honest Collect |
| ZNLY-71 | Sadin | high | In Review | UI-5 (V15–V16): Bookings redesign + booking inbox (local migration-282) |
| ZNLY-72 | Sadin | high | In Review | UI-6: Live bug — admin "Delete permanently" always failed (local migration-283) |
| ZNLY-73 | Sadin | high | In Review | UI-7 (V17): Centred checkout — split payments, change helper, payment-method QR (local migration-284) |
| ZNLY-77 | Sadin | high | In Review | UI-11 (V22): Member discount auto-applied at checkout + booking-panel Discount tab (local migration-290) |
| ZNLY-78 | Sadin | high | In Review | UI-12 (V23): Vouchers redesign — value vs paid, free vouchers, % coupons, history (local migration-291) |
| ZNLY-80 | Sadin | high | In Review | UI-14 (V26): Products in checkout + product commission (local migration-293) |
| ZNLY-95 | Sadin | high | On Stage | project-pm upgrade: "what's mine / what's urgent", handoff-by-ticket, auto state moves, token rules, generated tracker, .mcp.json |
| ZNLY-98 | Sadin | high | In Review | UI-19 (V27): Merge Anish's PR #413 branch into the UI branch, adapt his features to the new UI, renumber our migrations to 301+ |
| ZNLY-100 | Sadin | high | In Review | UI-21: One staff-availability rule: hours, breaks, roster date changes (with breaks), leave and blocks enforced in every booking path |
| ZNLY-112 | Sadin | high | In Review | Therapists page "Overall" fails: invalid uuid "__overall__" (prod lists all therapists with a Branch column) |
| ZNLY-113 | Sadin | high | In Review | One home-branch model for temporary transfers: who sees, edits and pays a lent therapist |
| ZNLY-118 | Sadin | high | In Review | Commission of a lent therapist can go missing: earnings/payroll use the therapist's branch at run time |
| ZNLY-147 | Sadin | high | In Review | Dashboard redesign: role-based "what needs me now" home (admin / manager / staff) |
| ZNLY-149 | Sadin | high | In Review | Admin/manager can't reach front-desk tools (Collect payment is staff-only in ⌘K and the staff page) |
| ZNLY-150 | Sadin | high | In Review | Link a login to its therapist record (no user → therapist link today; "my bookings" matched by name) |
| ZNLY-155 | Sadin | high | In Review | Dashboard Tomorrow "therapists working" overcounts (45 vs 17 at Lazimpat) |
| ZNLY-156 | Sadin | high | In Review | Dashboard: one "needs someone" rule (Business 15 vs Branch 38 at Lazimpat) |
| ZNLY-168 | Anish | high | In Review | Gender-preference online booking can pass with zero eligible/free therapists |
| ZNLY-171 | Sadin | high | In Review | Therapist inner page: "Busy while clocked in" divides the whole month's service time by only the marked attendance days (shows 57%, real ~9%) |
| ZNLY-67 | Sadin | medium | In Review | UI-1: Calendar exact-match port + app shell from ClinicMD (pre-V5) |
| ZNLY-68 | Sadin | medium | In Review | UI-2 (V5–V9): Panel unification — forms, details, settings, campaigns → right-hand panels |
| ZNLY-69 | Sadin | medium | In Review | UI-3 (V11–V13): Customers redesign — list, lifecycle strip, panel, collect, Spotlight, one-scroll header |
| ZNLY-76 | Sadin | medium | In Review | UI-10 (V20–V21): Packages + Memberships redesign (shared listKit) |
| ZNLY-79 | Sadin | medium | In Review | UI-13 (V25): Products + Inventory redesign with variants (local migration-292) |
| ZNLY-97 | Sadin | medium | In Review | UI-18: Therapists redesign |
| ZNLY-101 | Sadin | medium | In Review | UI-22: Make staff transfers easy to understand everywhere (window, where, when back) |
| ZNLY-123 | Sadin | medium | In Review | UI-23: Attendance page redesign (modern, easy daily marking, new design style) |
| ZNLY-134 | Sadin | medium | In Review | Update the site icon (favicon + app icons) to the new Zennly logo |
| ZNLY-140 | — | medium | In Review | Inbox hover quick actions (Confirm booking / Review discount / Open attendance) |
| ZNLY-169 | Sadin | medium | In Review | Therapist detail view (Full breakdown) uses the old revenue rule (payments taken), not Sales (earned) |
| ZNLY-170 | Sadin | medium | In Review | Therapist inner page (TherapistDetailView Overview) UI redesign: rated 6/10, mockup first |
| ZNLY-40 | Sadin | low | On Stage | Retire stale docs now superseded by Plane |
| ZNLY-119 | Sadin | low | In Review | Profile: Transfer is hidden behind Profile → Edit; add it to the header ⋯ menu and show Branch in the read view |
| ZNLY-120 | Sadin | low | In Review | Therapists list shows nothing for a transfer scheduled later today (e.g. "To Sanepa at 4:20 pm") |

## Todo
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-13 | — | high | Renumber colliding migration-289 (PR #413 vs PR #415) |
| ZNLY-26 | — | high | Verify 503 "Reconnecting" screen + login banner against a real failure (PR #344) |
| ZNLY-135 | Sadin | high | Notification pop-ups + sound for new bookings and things that need attention (discuss first) |
| ZNLY-179 | — | high | Attendance judged against branch hours, not the therapist's roster (late/early, scheduled, assumed hours) |
| ZNLY-183 | — | high | Attendance numbers ignore the branch "Expect check-in" switch: unmarked rostered days are "counted present" on the Attendance page but "not marked" in reports |
| ZNLY-17 | — | medium | Flip STAGING_DOMAIN to dev-app.zennly.io and verify stage health check |
| ZNLY-130 | Sadin | medium | Calendar header shows "From Lazimpat" instead of "Here <window>" for a visiting therapist |
| ZNLY-180 | — | medium | Attendance worked time rounded to 0.1 h before display (1 h 32 min shows as 1 h 30 min) |

## Waiting on owner
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-30 | — | medium | Decide on required_linear_history for main/stage |
| ZNLY-84 | Sadin | medium | DECIDE A-2: admin_viewer sees write actions on customer-detail (Anish's page) — hand to Anish or fix here? |
| ZNLY-85 | Sadin | medium | DECIDE V-4: staff voucher limits (100% discount, price edit, back-dating) — match booking limits? |
| ZNLY-89 | Sadin | medium | DECIDE V-9: Outreach win_back emails guests who are already booked — align with Customers At-risk rule? |
| ZNLY-125 | Sadin | medium | DECIDE: who pays bookings done before a PERMANENT transfer in the same month? |
| ZNLY-25 | — | low | Decide on generic Package (bundle) booking system — may be superseded |
| ZNLY-86 | Sadin | low | DECIDE V-6: staff issuing vouchers get no member tier discount / wallet tender (RLS hides memberships) |
| ZNLY-87 | Sadin | low | DECIDE V-7: let admins edit existing membership tiers? (API supports it, UI doesn't) |
| ZNLY-88 | Sadin | low | DECIDE V-8: add a room active/deactivate switch? (toggleRoomActive exists, unused) |
| ZNLY-108 | Sadin | low | DECIDE: keep cancelled staff transfers in History (soft cancel)? |

## Backlog
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-15 | — | high | Rotate/remove accounts exposed by deleted public/dev-info.html |
| ZNLY-18 | — | high | Supabase Auth URL config / allowlists for new domain (both projects) |
| ZNLY-82 | Sadin | high | UI-16: Release prep — regression pass, stage re-merge, PR to stage |
| ZNLY-121 | Sadin | high | Customer booking flow shows every date "Full" at Sanepa (local, after migrations 324–327) |
| ZNLY-16 | — | medium | RLS access harness (6 principals x 64 tables) — confirm merged |
| ZNLY-20 | — | medium | Legacy-domain redirect (zenly.zunkireelabs.com → app.zennly.io) + retire old domains |
| ZNLY-21 | — | medium | Auth email via Resend SMTP (no-reply@mail.zennly.io) + DKIM/SPF/DMARC + templates |
| ZNLY-23 | — | medium | Click-through the four newly flag-enabled prod pages (Products/Campaigns/Outreach/Platform Admin) |
| ZNLY-24 | — | medium | Admin corrections log page (UI) |
| ZNLY-27 | — | medium | Perf audit follow-ups: re-measure in Nepal business hours + find remaining hotspots |
| ZNLY-28 | — | medium | Idle-tab polling fan-out (useAutoRefresh x11, raw setIntervals, 4 Realtime channels) |
| ZNLY-90 | Sadin | medium | Follow-up (V19): views not security_invoker, SECURITY DEFINER p_*_id audit, anon_insert_bookings cleanup |
| ZNLY-96 | Sadin | medium | GitHub → Plane automation: move tickets on PR open/merge + CI check for ZNLY id in PR title |
| ZNLY-102 | — | medium | Availability "falls outside" list: cover the remaining paths (block drag, transfer extend/return, recurring blocks) |
| ZNLY-103 | — | medium | One shared modal overlay: every centred popup covers the whole screen (portal), no copy-pasted overlay CSS |
| ZNLY-104 | — | medium | Calendar: the address bar date doesn't follow day navigation (reload jumps back) |
| ZNLY-116 | Sadin | medium | Therapist History says "room" for branch transfers (locationLabel used as the branch word) |
| ZNLY-124 | Sadin | medium | Product-sales drill-down (fetchTherapistProductSales) ignores sales at other branches, so it won't match commission |
| ZNLY-127 | Sadin | medium | Calendar hides a visiting therapist whose transfer window starts later today |
| ZNLY-133 | — | medium | Weekly timesheet review and approval before payroll |
| ZNLY-137 | Sadin | medium | Fingerprint attendance machine integration (check-ins from a biometric device) |
| ZNLY-144 | — | medium | Discount management settings: per-role limits set by the business, enforced in the DB |
| ZNLY-146 | — | medium | Insight component + sparkle rule + audit (AI-ready insights) |
| ZNLY-148 | — | medium | Dashboard metrics look wrong: Unpaid "173% of recent bookings", utilization 0% while booked, Top performers NPR 0 with score 20 |
| ZNLY-151 | — | medium | Retire the old "New booking" full-page wizard (Bookings tab) in favour of the right-hand create-booking panel everywhere |
| ZNLY-152 | — | medium | Sidebar "Bookings" badge: count of bookings that need someone (late, unassigned, unconfirmed), like the Inbox badge |
| ZNLY-157 | Sadin | medium | Dashboard needs rule: count upcoming Pending bookings waiting >2h as "unconfirmed" |
| ZNLY-158 | Sadin | medium | Dashboard RPCs slow past 5 branches (get_dashboard 325 ms, insights 345 ms at 6) |
| ZNLY-160 | Sadin | medium | Customer source never recorded (bookings.referral_source 0/188, customers.client_source 0/90 locally) |
| ZNLY-161 | Sadin | medium | Working hours set for only 18 of 69 therapists (therapist_working_hours) |
| ZNLY-162 | Sadin | medium | Dashboard: branch revenue ignores refunds while the pulse total subtracts them (mig 334) |
| ZNLY-163 | Sadin | medium | Money owed: "Remind" needs a payment-due message (no outreach trigger exists) |
| ZNLY-166 | Sadin | medium | v36-dashboard.sql fails with ROOM_AT_CAPACITY while the ZZToday Lazimpat seed is loaded (test not seed-proof) |
| ZNLY-167 | Sadin | medium | Dashboard "revenue" counts advance payments on not-yet-completed bookings; align with Reports "Sales (earned)" or relabel "Takings" |
| ZNLY-19 | — | low | Remaining "Zenly" strings (PlatformNav, docs, favicon, skill footer) |
| ZNLY-22 | — | low | Booking confirmation + day-before reminder emails; wire 2 stub "Send Email" buttons |
| ZNLY-29 | — | low | Supabase dashboard cleanup: Postgres ERROR logging off, name the original 25P02 trigger |
| ZNLY-31 | — | low | Staging migration-ledger anomalies |
| ZNLY-32 | — | low | Repo housekeeping: stale branches, temp_ss diagnostics, untracked migration/seed files |
| ZNLY-33 | — | low | PR #350 follow-up gaps (scroll-behavior, single-branch auto-select, back-arrow tap target) |
| ZNLY-35 | — | low | Manual verification debt: features shipped but never click-tested |
| ZNLY-36 | — | low | sbal provider-profile: content (About/amenities/logo/hero) + live click-through |
| ZNLY-37 | — | low | Phase 9 Platform Governance — establish implementation status |
| ZNLY-38 | — | low | Centralize customer/staff data — Phase 2 (staff to org level, gated) |
| ZNLY-39 | — | low | PostHog — adoption status (docs/feature/posthog-evaluation.md) |
| ZNLY-91 | Sadin | low | Follow-up (V25/V26): products — gift vouchers paying for products, receptionist commission, product discounts, payroll vs booking_therapists, save_product SKU wipe |
| ZNLY-92 | Sadin | low | Follow-up (V20–V24): % coupons at checkout, package dues collection, tier pill, khems-cleaning voucher types off |
| ZNLY-93 | Sadin | low | Follow-up: small UI backlog (MiniMonthCalendar min/max, dead DailyClosingPanel, bounded customer lookup, a11y, legacy BookingsList) |
| ZNLY-99 | — | low | UI-20: Follow-ups from the #413 merge (calendar visible-hours chip, W/M shortcuts, remove unused ServiceFormPanel) |
| ZNLY-105 | — | low | Calendar: shading under a booking (block, break) is invisible |
| ZNLY-106 | — | low | Therapist photo shows on the profile but not in the Therapists list or the peek panel (initials instead) |
| ZNLY-107 | — | low | Break chip: one clear, consistent design for breaks (roster cell, calendar label, profile) |
| ZNLY-109 | Sadin | low | Calendar header tooltip mixes 24h and 12h ("Shift started 09:00" next to "12:00pm") |
| ZNLY-110 | Sadin | low | Calendar shading labels cut mid-time ("At Sanepa 12:00pm…", "Lunch 1:00pm–2:0…"): wrap instead of truncate |
| ZNLY-111 | Sadin | low | Calendar grid has no right gutter: last column runs flush to the window edge |
| ZNLY-114 | Sadin | low | Therapists Overall: Today hours for a temporarily transferred therapist merge shift rows from both branches |
| ZNLY-115 | Sadin | low | Therapist working hours editor doesn't check hours against the branch's opening hours |
| ZNLY-117 | Sadin | low | Transfer banner repeats the time: "At Sanepa until 3:30pm, back at Lazimpat 3:30pm" |
| ZNLY-122 | Sadin | low | Therapists list never refreshes itself: transfer and "Today" states go stale until reload |
| ZNLY-126 | Sadin | low | Overtime pay for hours worked outside the usual shift (only if customers ask) |
| ZNLY-128 | Sadin | low | Therapist profile menu shows "Back to therapist list" twice |
| ZNLY-129 | Sadin | low | Profile timeline uses the late return record instead of the planned transfer end |
| ZNLY-131 | — | low | Self check-in for staff: shared kiosk screen with a PIN |
| ZNLY-132 | — | low | Location check on check-in (must be at the branch) |
| ZNLY-138 | — | low | Per-person "expect a check-in" override (e.g. therapists on fingerprint, reception not) |
| ZNLY-139 | — | low | Real dog-bark recording for the "Woof!" notification sound (licence-clean) |
| ZNLY-141 | — | low | Notify staff when a guest cancels/reschedules online (blocked: needs guest-facing self-service) |
| ZNLY-145 | — | low | Inbox "Needs action" filter (Pending online bookings + open attendance gaps) |
| ZNLY-164 | Sadin | low | Explain local owed drop: Lazimpat 12,550 / 6 bookings (29 Oct) → 9,750 / 5 (30 Oct) |
| ZNLY-165 | Sadin | low | Local DB: 5 leftover "ZZDemo" therapists (created 26 Oct) with bookings; clean up or add to a cleanup script |
| ZNLY-177 | Sadin | low | getReportRange('month') ignores the date passed in (uses the real clock), so its vitest fails outside October |
| ZNLY-181 | — | low | Attendance calendar exists twice (/attendance-calendar page + Reports › Attendance › Calendar), read-only, Absent shown red |
| ZNLY-193 | — | low | Show daily hours utilization per therapist |
