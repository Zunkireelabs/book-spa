# Zennly WebApp tracker

> **Generated from Plane by `/project-pm sync`. Do not edit by hand.** Plane (project **Zennly WebApp**, key `ZNLY`) is the source of truth.

Last synced: **2026-11-21** by Project Manager · 279 open tickets (epics excluded: ZNLY-1, ZNLY-2, ZNLY-3, ZNLY-4, ZNLY-5, ZNLY-6, ZNLY-7, ZNLY-8, ZNLY-9, ZNLY-10, ZNLY-11, ZNLY-83)

---

## Flags from the last sync
- **Open PRs without `ZNLY-` in the title:** #425, #415, #30 (4 open PRs).
- **Urgent/high with no owner:** ZNLY-258, ZNLY-256, ZNLY-220, ZNLY-218, ZNLY-216, ZNLY-213, ZNLY-210, ZNLY-209, ZNLY-208, ZNLY-207, ZNLY-206, ZNLY-199, ZNLY-197, ZNLY-196, ZNLY-183, ZNLY-179, ZNLY-26, ZNLY-18, ZNLY-15, ZNLY-14, ZNLY-13, ZNLY-12.

## In progress
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-282 | Sadin | urgent | "Own calendar (view only)" logins can read every colleague's bookings: the own-bookings RLS (migration 322) only checks 'own' |
| ZNLY-287 | Sadin | urgent | QC: Bookings (phone) — page is wider than the screen, left side cut off |
| ZNLY-294 | Sadin | urgent | QC: All inputs (phone) — page zooms in when you tap a text box, search or time field |
| ZNLY-66 | Sadin | high | UI/UX Upgrade (feat/ui-port-from-clinicmd) |
| ZNLY-159 | Sadin | high | Reports redesign: 17 reports in 5 groups, Start here row, headline vs last period, ✦ flags |
| ZNLY-182 | Anish | high | Online combo-service bookings never split into per-component booking_combo_items |
| ZNLY-186 | Anish | high | Per-branch service scope — standalone port to stage/main (prod) |
| ZNLY-187 | Anish | high | StaffBookingForm doesn't pass branch to fetchServices — branch-scoped/excluded services leak into staff New Booking |
| ZNLY-190 | Anish | high | Customer-facing branch picker shows stale hours, ignores per-day Weekly Opening Hours |
| ZNLY-191 | Anish | high | Customer "Log" tab errors on production — audit_logs missing FKs to users/branches |
| ZNLY-195 | Sadin | high | Fresha audit + Zennly gap map (feature list, UX, flows, logic, outreach/automation) |
| ZNLY-265 | Sadin | high | Mobile QC: every screen responsive and polished at phone width (start: checkout dialog overlaps when keyboard opens) |
| ZNLY-267 | Sadin | high | Calendar Settings: "Show whole hours of a day" fails with "update_org_profile_settings: unknown setting key calendar_show_full_day" |
| ZNLY-268 | Sadin | high | No broken saves or raw errors: guard every app→DB call/setting key, plain-language error messages, Calendar Settings double title |
| ZNLY-269 | Sadin | high | Booking panel: customer in the header with View profile + add date of birth inline (Fresha-style) |
| ZNLY-272 | Sadin | high | Dashboard shows a false "0 of 0 done · Nothing left open ✓ · Tomorrow 0 bookings" for ~3s while loading |
| ZNLY-274 | Sadin | high | Online bookings by NEW customers never create or link a customer record (no profile, no history, no DOB, missed by campaigns) |
| ZNLY-275 | Sadin | high | A booking for a later day can be Started, Completed or marked No-show today (its money lands in today's takings and Day close) |
| ZNLY-277 | Sadin | high | Closed-day Payment Breakdown: uneven row spacing (tall method rows, cramped totals and section headings) |
| ZNLY-278 | Sadin | high | "Own bookings only" login: calendar shows every colleague's column empty, so busy colleagues look free |
| ZNLY-279 | Sadin | high | Calendar team filter: all staff are showing but every checkbox is unticked ("All positions", "Clear all" with nothing to clear) |
| ZNLY-280 | Sadin | high | Payment Breakdown: no repeated numbers on a closed day, highlight the cash figure that matters, "of which" lines under the methods, whole-rupee money everywhere |
| ZNLY-285 | Sadin | high | Phone: booking opens as a half-height sheet over the calendar (not full screen), so the calendar, incl. ZNLY-281 same-client outlines, stays visible |
| ZNLY-286 | Sadin | high | Booking panel Staff tab: the org's own staff word everywhere (beauty shows "Therapist") and no cramped inner scroll boxes for the staff/room lists |
| ZNLY-288 | Sadin | high | QC: Dashboard Live floor (phone) — pinned names column lets bookings and the now-line show through, rows uneven |
| ZNLY-289 | Sadin | high | QC: Phone shell bottom — grey band behind the nav on some screens, last content cropped or hidden under the nav |
| ZNLY-290 | Sadin | high | QC: Notification panel (phone) — scrolling inside it scrolls the page behind |
| ZNLY-291 | Sadin | high | QC: Notification settings (phone) — Sound row squeezes its description into a one-word column |
| ZNLY-292 | Sadin | high | QC: Bookings sort/filters (phone) — Sort opens a plain list behind the nav; should use the Calendar-views bottom sheet pattern |
| ZNLY-295 | Sadin | high | QC: Settings (phone) — only the first page (Services) is reachable, and profile-menu Settings opens a different page |
| ZNLY-296 | Sadin | high | QC: Notification panel (phone) — bottom line ("2 of 2 unread shown · Open Inbox") cut off behind the browser bar |
| ZNLY-297 | Sadin | high | QC: Bookings list (phone) — rows cramped: status chip touches the next row, "Late · 4h 48m" wraps |
| ZNLY-298 | Sadin | high | QC: Phone nav — current page not highlighted; More never lights up for pages inside it |
| ZNLY-299 | Sadin | high | QC: Calendar day view (phone) — ~4.5 squeezed staff columns and tiny chips ("1:15", "Dee…"), hard to read; should be 3 readable columns like Fresha |
| ZNLY-300 | Sadin | high | QC: Staff picker — New booking and the booking panel use two different lists, and "Assigned" means opposite things; one shared Staff picker everywhere |
| ZNLY-301 | Sadin | high | QC: Two different New booking forms — Bookings tab opens a 4-step wizard with no staff choice; Calendar/Dashboard open the panel; one New booking everywhere |
| ZNLY-304 | Sadin | high | QC: New booking — a blocked save shows its reason far down the form while Create booking stays green, so tapping it seems to do nothing |
| ZNLY-305 | Sadin | high | QC: Toasts (phone) — bottom messages sit behind the floating bottom nav |
| ZNLY-306 | Sadin | high | QC: Services settings (phone) — the services table squeezes each service name onto about 5 lines |
| ZNLY-308 | Sadin | high | Edit service: category shows "Select…" when the service's category isn't in the business's category list (saving may wipe it) |
| ZNLY-318 | Sadin | high | One staff control everywhere: a closed staff row that opens the list (dropdown on desktop, sheet on phone) in New booking Individual, the booking panel Staff tab and Assign |
| ZNLY-320 | Sadin | high | One service control everywhere: a closed service row that opens the list (dropdown on desktop/tablet, sheet on phone), with clean rows, category headers and "Most booked" |
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
| ZNLY-255 | Sadin | medium | Safe dependency upgrades (router 6.x, vite 5.x, supabase-js, posthog, dompurify, postcss) before stage PR |
| ZNLY-260 | — | medium | Four in-shell high-fidelity mockup redraws (team member panel, service pricing, checkout invoice dialog, calendar + waitlist) |
| ZNLY-271 | Sadin | medium | Calendar card icons: one calm icon set (payment tag, note vs customer alert, first visit, online, package session, group) + Icons legend with on/off |
| ZNLY-273 | Sadin | medium | Bookings "Needs you now" says "Everything's on track" while finished bookings are still unpaid |
| ZNLY-276 | Sadin | medium | Dashboard strip "50 of 54 done (1 no-show)" reads as 4 left when 3 are open |
| ZNLY-281 | Sadin | medium | Calendar: hover/open a booking lights up every booking of the same client on screen (Fresha-style), no link lines |
| ZNLY-293 | Sadin | medium | QC: Bookings list (phone) — row chevron is cut off when the action button is "Confirm" (wider than "Start") |
| ZNLY-303 | Sadin | medium | Staff picker in Group mode: per-guest pick with the shared StaffPicker (follow-up to ZNLY-300) |
| ZNLY-307 | Sadin | medium | QC: Booking settings — the "Advance booking window" heading is oversized compared with the other settings headings |
| ZNLY-309 | Sadin | medium | One width for every booking side panel: New booking (420px today) and Assign list (fixed 560) use the booking panel's width rule |
| ZNLY-310 | Sadin | medium | Consistency: three remaining single-staff pickers still use a plain dropdown instead of the shared StaffPicker / StaffPickRow |
| ZNLY-312 | Sadin | medium | Consistency: booking Staff tab opened from Bookings or Inbox shows no Free / Busy / Off (only the calendar day view passes that day's bookings) |
| ZNLY-317 | Sadin | medium | Phone staff list sheet: empty title bar with only an ✕ above the "Staff for …" header (mockup has the header right under the grab handle) |
| ZNLY-319 | Sadin | medium | QC: New booking → Group (phone): the guest card heading "Person 2" wraps onto two lines, squeezed by the "optional · blank uses the contact's details" hint |

## In review / on stage
| Ticket | Owner | Priority | State | What |
|---|---|---|---|---|
| ZNLY-12 | — | urgent | In Review | Revoke anon EXECUTE on public_search_booking (prod security hole) |
| ZNLY-74 | Sadin | urgent | In Review | UI-8 (V18): Storage security — org-scoped service-images, private customer-files bucket (local migrations 285/286) |
| ZNLY-75 | Sadin | urgent | In Review | UI-9 (V19): Cross-tenant RLS sweep (local migrations 287/288) — stage test, then prod after holidays |
| ZNLY-81 | Sadin | urgent | In Review | UI-15: Renumber UI-branch migrations 282–293 → 301+ (clash with PR #413's 282–298) |
| ZNLY-153 | Anish | urgent | In Review | Group booking review fixes: therapist PII leak, wrong guest roster, availability math, discard dialog |
| ZNLY-198 | Sadin | urgent | On Stage | UI integration: merge our UI port onto stage (incl. Anish's PR #462), renumber our migrations to 335+ |
| ZNLY-204 | Sadin | urgent | QC Accepted | P0: UI-branch migrations 354/361 overwrite stage's public availability RPCs (group booking, PII fix, online capacity, full-capacity blocks, gender reserve) |
| ZNLY-205 | Sadin | urgent | QC Accepted | P0: two login↔staff links after integration (stage therapists.user_id vs our users.therapist_id): pick one source of truth |
| ZNLY-221 | Sadin | urgent | QC Accepted | Beauty (no rooms): can a booking be saved when bookings.room_id is NOT NULL? |
| ZNLY-223 | Sadin | urgent | QC Accepted | Online booking of a tiered service with a chosen team member fails: anon permission denied for table therapists |
| ZNLY-224 | Sadin | urgent | QC Accepted | Closed dates don't block online booking for room-less tenants (beauty): anon can't read manual_blocks |
| ZNLY-228 | Sadin | urgent | QC Accepted | Checkout crashes ("Something went wrong") when typing an amount into a split-payment row |
| ZNLY-232 | Sadin | urgent | QC Accepted | Day close: dashboard "Cash expected" and "Taken today" leave out product sales and contradict the Daily Reconciliation |
| ZNLY-233 | Sadin | urgent | QC Accepted | Checkout from dashboard / Collect / reports silently drops products: receipt says paid, but no product sale, stock or commission is saved |
| ZNLY-234 | Sadin | urgent | QC Accepted | Day close traps money and unfinished bookings: balances can't be collected after close, unfinished bookings get frozen, card payments are filed as Fonepay |
| ZNLY-235 | Sadin | urgent | QC Accepted | Restricted staff access not enforced: names, phones and prices show on most screens and through the API (customers, payments) |
| ZNLY-261 | Sadin | urgent | On Stage | Stage deploy blocked: 4 RLS policies call helpers unwrapped (attendance_changes, attendance_punches, insight_feedback x2) — migration 400 |
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
| ZNLY-199 | — | high | On Stage | Staff access, tiered pricing, waitlist and VAT invoices (Anish, PR #462) |
| ZNLY-206 | — | high | QC Accepted | Checkout pays once: single-booking payment through one locked, idempotent DB function (no double collect) |
| ZNLY-207 | — | high | QC Accepted | VAT invoice = the whole checkout (services + products), not just the booking |
| ZNLY-208 | — | high | QC Accepted | Tiered price follows the team member until payment, on every path (assign, reschedule, drag, combo) |
| ZNLY-209 | — | high | QC Accepted | No "spa" wording for non-spa tenants: Settings group "Spa" → "Business"; "your spa" / "this spa" copy from the industry |
| ZNLY-210 | — | high | QC Accepted | PIN lock screen (stage 863820d): review and acceptance checks; must never lock staff out |
| ZNLY-216 | — | high | QC Accepted | Security check: is users.pin stored hashed, and why can anon and authenticated select that column? |
| ZNLY-218 | — | high | QC Accepted | Billing "Add VAT on top" mode: does checkout charge the VAT? If not, invoices can never be issued in that mode |
| ZNLY-220 | — | high | QC Accepted | Schema drift: login_with_pin() exists in production but has no migration in the repo (created by hand); capture it, then hash PINs |
| ZNLY-222 | Sadin | high | QC Accepted | Online booking offers only 10:00–18:00, ignoring each branch's opening hours |
| ZNLY-225 | Sadin | high | QC Accepted | Booking links still open the old centred Booking Management modal instead of the right-side panel |
| ZNLY-226 | Sadin | high | QC Accepted | Setup checklist asks no-rooms industries (beauty, cleaning) to "Add your rooms" and never hides |
| ZNLY-231 | Sadin | high | QC Accepted | Checkout shows a raw server error when the booking was already paid elsewhere (double-pay refusal) |
| ZNLY-236 | Sadin | high | QC Accepted | Staff can't check in from My day: "You don't have access to change this" (punch_in refuses non-managers) |
| ZNLY-239 | Sadin | high | QC Accepted | CP7 wording and label sweep: beauty org still sees spa/therapist words, raw labels and wrong hints |
| ZNLY-241 | Sadin | high | QC Accepted | Create service saves the row, then fails "set_service_therapists: branch <NULL>" (new org before reload; likely also "All locations"); a retry duplicates |
| ZNLY-244 | Sadin | high | QC Accepted | Transfer form: timed transfer preview calls computeRevertPreview, which is never imported (ReferenceError) |
| ZNLY-248 | Sadin | high | QC Accepted | Payment mode spelling: Business Health report (mig 371) and other readers match 'Cash' exactly, so 'cash' payments count as "other" |
| ZNLY-250 | Sadin | high | QC Accepted | Customer detail page numbers use old rules: Amount owing counts upcoming/cancelled bookings; Last Visit can be a future booking (disagrees with Customers list + panel) |
| ZNLY-263 | Sadin | high | In Review | Login pages redesign (/login org finder and /:org/login): split layout, our current stack |
| ZNLY-302 | Sadin | high | QC Accepted | QC: Calendar (phone + desktop) — the grid pans diagonally; should lock to one direction per swipe (sideways OR up/down), like Fresha and Google Calendar |
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
| ZNLY-194 | Sadin | medium | On Stage | project-pm: use scripted Plane access (plane-tracker.py) for tracker sync; add path rule + INSTALL.md setup |
| ZNLY-212 | — | medium | QC Accepted | Unit test reportPeriod "this month runs from the 1st" fails (expected 2026-10-01, got 2026-11-01): test depends on the real clock |
| ZNLY-215 | Sadin | medium | QC Accepted | Managers may only grant the Staff role, and only at their own branches; Manager/Admin roles are admin-only (owner decision 16 Nov) |
| ZNLY-217 | — | medium | QC Accepted | Team member panel: admin sees "Pay rates aren't available to your role yet" (Pay section, local, after the 4a merge) |
| ZNLY-227 | Sadin | medium | QC Accepted | Cancelled + refunded booking shows "Unpaid" in the panel Payment tab |
| ZNLY-230 | Sadin | medium | QC Accepted | Customer detail page: redesign to the new Zennly design (tabs, payment labels, layout) |
| ZNLY-237 | — | medium | QC Accepted | My day shows a No-show booking as "Late" (Bookings list says "No show") |
| ZNLY-249 | Sadin | medium | QC Accepted | Calendar transfer shading label shows the wrong end time ("At QC Second Studio 10:00am–12:00pm" for a 2-day transfer) |
| ZNLY-251 | Sadin | medium | QC Accepted | Prod spa industry plural label is "All Staffs": sidebar, list headers and search show "All Staffs" / "Search all staffs..." |
| ZNLY-262 | Sadin | medium | On Stage | Blocked login (login off) shows a raw hook error; show "Your login is turned off, contact your admin" |
| ZNLY-40 | Sadin | low | On Stage | Retire stale docs now superseded by Plane |
| ZNLY-119 | Sadin | low | In Review | Profile: Transfer is hidden behind Profile → Edit; add it to the header ⋯ menu and show Branch in the read view |
| ZNLY-120 | Sadin | low | In Review | Therapists list shows nothing for a transfer scheduled later today (e.g. "To Sanepa at 4:20 pm") |
| ZNLY-243 | Sadin | low | QC Accepted | Calendar settings "Calendar interval" uses a native <select> (breaks CLAUDE.md rule 8) |

## Todo
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-13 | — | high | Renumber colliding migration-289 (PR #413 vs PR #415) |
| ZNLY-26 | — | high | Verify 503 "Reconnecting" screen + login banner against a real failure (PR #344) |
| ZNLY-135 | Sadin | high | Notification pop-ups + sound for new bookings and things that need attention (discuss first) |
| ZNLY-179 | — | high | Attendance judged against branch hours, not the therapist's roster (late/early, scheduled, assumed hours) |
| ZNLY-183 | — | high | Attendance numbers ignore the branch "Expect check-in" switch: unmarked rostered days are "counted present" on the Attendance page but "not marked" in reports |
| ZNLY-197 | — | high | Remove zenly.zunkireelabs.com from prod Traefik router rule in docker-compose.yml |
| ZNLY-245 | Sadin | high | Sami's onboarding: import the Fresha export (staff, customers, services, products) into production, rehearsed and reconciled |
| ZNLY-284 | Sadin | high | Interim: Staff › Access stops offering "(view only)" calendar options until ZNLY-283 enforces them; existing view-only logins get an honest note |
| ZNLY-17 | — | medium | Flip STAGING_DOMAIN to dev-app.zennly.io and verify stage health check |
| ZNLY-130 | Sadin | medium | Calendar header shows "From Lazimpat" instead of "Here <window>" for a visiting therapist |
| ZNLY-180 | — | medium | Attendance worked time rounded to 0.1 h before display (1 h 32 min shows as 1 h 30 min) |

## Waiting on owner
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-213 | — | high | DECIDE: enable the Supabase Auth "Custom Access Token" hook (auth_hook_block_login_off) on staging and production so "login off" is enforced on the server |
| ZNLY-214 | Sadin | high | DECIDE: confirm with the accountant how VAT treats tips and product sales on a Nepal tax invoice (before 19 Nov) |
| ZNLY-252 | Sadin | high | DECIDE: 747 old completed Nuad bookings with no payment (NPR 2,855,386.81, May-Nov) will appear as money to collect after release. Settle, cut off, or leave? |
| ZNLY-311 | Sadin | high | DECIDE: Design system sit-down: final mockups of every component and spacing (like Zone POS), so every screen is built from the same parts |
| ZNLY-30 | — | medium | Decide on required_linear_history for main/stage |
| ZNLY-84 | Sadin | medium | DECIDE A-2: admin_viewer sees write actions on customer-detail (Anish's page) — hand to Anish or fix here? |
| ZNLY-85 | Sadin | medium | DECIDE V-4: staff voucher limits (100% discount, price edit, back-dating) — match booking limits? |
| ZNLY-89 | Sadin | medium | DECIDE V-9: Outreach win_back emails guests who are already booked — align with Customers At-risk rule? |
| ZNLY-125 | Sadin | medium | DECIDE: who pays bookings done before a PERMANENT transfer in the same month? |
| ZNLY-257 | — | medium | DECIDE: should Nuad refuse double-booking a staff member (enforce_staff_availability is false)? |
| ZNLY-25 | — | low | Decide on generic Package (bundle) booking system — may be superseded |
| ZNLY-86 | Sadin | low | DECIDE V-6: staff issuing vouchers get no member tier discount / wallet tender (RLS hides memberships) |
| ZNLY-87 | Sadin | low | DECIDE V-7: let admins edit existing membership tiers? (API supports it, UI doesn't) |
| ZNLY-88 | Sadin | low | DECIDE V-8: add a room active/deactivate switch? (toggleRoomActive exists, unused) |
| ZNLY-108 | Sadin | low | DECIDE: keep cancelled staff transfers in History (soft cancel)? |

## Backlog
| Ticket | Owner | Priority | What |
|---|---|---|---|
| ZNLY-203 | Sadin | urgent | Client data still in public git history of book-spa: make the repo private and/or purge history |
| ZNLY-219 | Sadin | urgent | P0 security (production today): PINs stored as plain text and verify_pin() callable by anyone, so a 4-digit PIN can be guessed; check the pin-login Edge Function before shipping mig 384 |
| ZNLY-15 | — | high | Rotate/remove accounts exposed by deleted public/dev-info.html |
| ZNLY-18 | — | high | Supabase Auth URL config / allowlists for new domain (both projects) |
| ZNLY-82 | Sadin | high | UI-16: Release prep — regression pass, stage re-merge, PR to stage |
| ZNLY-121 | Sadin | high | Customer booking flow shows every date "Full" at Sanepa (local, after migrations 324–327) |
| ZNLY-196 | — | high | Port the Zone POS QC harness into the Zennly repo (critical-path screens, one shared test tenant), owned by the lead/QC session |
| ZNLY-256 | — | high | Waitlist insert blocked by RLS for org-level admins (branch_id NULL, no user_branches row) |
| ZNLY-258 | — | high | Cash expected in drawer subtracts card refunds (payment_refunds has no refund method) |
| ZNLY-266 | Sadin | high | Confirm booking fails silently when the room is at capacity (HTTP 500 ROOM_AT_CAPACITY, no message shown) |
| ZNLY-270 | Sadin | high | Padding & Processing time is saved on the service but every booking ignores it (setting promises staff are freed; they aren't) |
| ZNLY-283 | Sadin | high | "View only" calendar access (own_view / all_view) is not enforced: those logins can still create, edit, start and collect |
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
| ZNLY-162 | Sadin | medium | Dashboard: branch revenue ignores refunds while the pulse total subtracts them (mig 368, was 334 before ZNLY-198 renumber) |
| ZNLY-163 | Sadin | medium | Money owed: "Remind" needs a payment-due message (no outreach trigger exists) |
| ZNLY-166 | Sadin | medium | v36-dashboard.sql fails with ROOM_AT_CAPACITY while the ZZToday Lazimpat seed is loaded (test not seed-proof) |
| ZNLY-167 | Sadin | medium | Dashboard "revenue" counts advance payments on not-yet-completed bookings; align with Reports "Sales (earned)" or relabel "Takings" |
| ZNLY-200 | — | medium | Fresh local DB bootstrap fails: rls.sql references therapist_working_hours before mig 275; bookings.client_request_id has no creating migration |
| ZNLY-211 | — | medium | Move access and money rules into the DB: terminal statuses (Cancelled / No Show), discount role limits, notifications search filter |
| ZNLY-238 | — | medium | PLAN: integrate Zennly Marketplace (customer-facing booking) with the Zennly business app |
| ZNLY-240 | — | medium | Platform admin: create a new org from the UI, then manage its access and billing (onboard-tenant.sql has no 'beauty') |
| ZNLY-242 | — | medium | New org first run: dashboard with 0 locations misbehaves, and location open/close defaults (09–21) disagree with per-day hours |
| ZNLY-246 | — | medium | Insight: flag tiered services missing tier prices, and team members with no price tier |
| ZNLY-259 | — | medium | Harden PIN login: PINs are compared as plain text and have no server-side attempt limit |
| ZNLY-313 | Sadin | medium | Staff picker Best fit: prefer the customer's last staff member when free (follow-up from ZNLY-303) |
| ZNLY-314 | Sadin | medium | Staff picker: "Change the time" link when the wanted person is busy (follow-up from ZNLY-303) |
| ZNLY-315 | Sadin | medium | Own-bookings-only logins: Staff list can't show who is busy (RLS hides colleagues' bookings); needs a busy-times-only source |
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
| ZNLY-201 | — | low | scripts/check-migrations.sh fails on macOS bash 3.2 (uses mapfile) |
| ZNLY-202 | — | low | Evaluate Meta Astryx design system (React 19 upgrade, one-screen pilot, go/no-go) |
| ZNLY-229 | — | low | Booking link panel opens over a blank page: keep the page you came from visible behind it |
| ZNLY-247 | — | low | Staff row menu offers "Transfer to branch…" when the business has only one location (the picker then says "No results found") |
| ZNLY-253 | Sadin | low | Insight: flag a paid amount that doesn't match the price after discount (voucher NTL327 paid 8,400 for a 20%-off 6,720 voucher) |
| ZNLY-254 | Sadin | low | Insight: flag a paid amount that doesn't match the price after discount (voucher NTL327 paid 8,400 for a 20%-off 6,720 voucher) |
| ZNLY-264 | Sadin | low | Evaluate Astryx design system (Meta, beta): React 18 to 19 upgrade + StyleX vs our Tailwind stack. After go-live |
| ZNLY-316 | — | low | Tech debt: AssignFlow's useDayContext duplicates the new useDayAvailability hook; use one |
| ZNLY-321 | Sadin | low | Idea: "Booked last time" in the service list for a returning customer (where the customer is known before the service) |
