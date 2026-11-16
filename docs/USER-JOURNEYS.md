# Zennly user journeys

**Status:** draft v1, 2026-11-16, for owner approval (ZNLY-198 gate). Written by the lead session (bookx-eb).
**Scope:** the whole product, for **every tenant and every industry**. The 19 Nov release goes to all production
tenants at once. Every journey is checked for two reference tenants:

| Reference tenant | Industry | State | Labels ({staff} / {session}) |
|---|---|---|---|
| **Nuad Thai** | spa | Existing: live data, history, memberships, vouchers, packages, several branches | Therapist / Session |
| **Sami's Brows and Lashes** (Panipokhari) | beauty | New: empty, one branch | Team member / Appointment |

**Evidence:** **code-read** from `feature/ZNLY-198-ui-integration` ("ours"), `origin/stage` and `origin/main`, as of
2026-11-16. Nothing here was run. Rules marked ✅ are enforced where stated in code; they are still unproven until
the QC harness and the Quality Engineer run them (Wed). Screen names refer to `docs/SITEMAP.md`.

**Where a rule is enforced** (strongest first):

| Layer | Meaning | Trust |
|---|---|---|
| **DB** | Postgres trigger, constraint, RLS policy, or a SECURITY DEFINER RPC that is the only write path | Holds even if the screen has a bug, a request is hand-crafted, or two devices act at once |
| **API** | `src/services/api.js` checks before writing (read-then-write) | Holds for our screens only; a direct PostgREST call or two simultaneous clicks can get past it |
| **UI** | Only the screen prevents it | Weakest. Not acceptable for money or access rules |

Replaces `docs/user-stories/` (Feb 2026, stale statuses) and the open items of `docs/internal-audit/` (Mar 2026).
What was still true there has been carried in below; the rest is obsolete.

---

## 1. Client journeys

### J-C1. Book online (CP2: must keep working)
Owner decision 2026-11-16: client booking moves to the **zennly.io marketplace** (Anish). Until it connects, the app's
booking page stays live for existing tenants' clients, **unchanged and not redesigned**, and must not break on 19 Nov.

1. Opens `/:orgSlug` → B1 picks a {location} when there is more than one. *Rule:* only active branches with working hours are shown (`branch_working_hours`).
2. B2 browses services. *Rules:* price shown by price type: fixed price; "Free"; tiered shows a range from `service_price_range()`; `calendar_only` and `no_default` are not shown to clients **[stage, DB: `public_get_bookable_services`]**. Per-branch service scope (ZNLY-186) limits services to that branch **[main, DB mig 313]**.
3. B3 picks a {staff} or "any". *Rule:* only bookable staff; when the tenant hides staff selection no names or photos leak **[DB: `public_get_bookable_therapists`, PII fix mig 306]**. ⚠ **ZNLY-204 (P0)**: our mig 361 adds a 3-argument overload next to stage's 4-argument one (4th has a default), so the app's normal call becomes ambiguous and the {staff} step fails for **every** tenant until reconciled.
4. B4 picks a slot. *Rules:* past slots are not offered (availability readers take `now`, ours mig 361; a staff booking *in the past* is allowed at insert, so walk-ins can be recorded afterwards); within branch hours and the online window; respects room capacity incl. manual blocks at **full** capacity (stage mig 299), online booking capacity (mig 138/301), roster and leave, closed dates, gender-preference reserve (stage mig 307), and no midnight crossing (mig 179) **[DB: `public_check_branch_bookings_range` + triggers]**. ⚠ **ZNLY-204**: our 354/361 may drop the stage rules.
5. B5 enters details. *Rules:* phone required and normalised to E.164 **[DB: `trg_bookings_require_phone`, `bookings_normalize_phone`]**; customer de-duplicated by phone within the org **[DB: mig 036/133 guard]**; email optional.
6. Confirms → booking created as **Pending** with a booking number **[DB: `trg_booking_number`, race fix mig 025]**, a price snapshot (`trg_booking_snapshots`), online-capacity check (`trg_online_capacity_check`) and room / {staff} conflict checks (`trg_room_capacity_check`, `trg_therapist_guards_check`). The double-submit guard uses `client_request_id` **[API + RPC 223]**; the column has no creating migration (ZNLY-200).
7. B6 sees the reference. Staff get an in-app notification (`trg_notify_new_online_booking`) and an Inbox item; outreach may email the client if rules are on.

**Pass for both tenants:** Nuad Thai's existing services and prices are unchanged (`price_type` defaults to `fixed`, no backfill); Sami's sees "Team member" / "Appointment" everywhere, never "Therapist" / "Spa".

### J-C2. Group booking (CP2) [main ⚠: missing from our branch]
1. From B2 the client chooses to book for several people, picks services per person and confirms once.
2. *Rules:* one shared slot per group (`booking_group_id`, mig 030); availability must fit every person; the {staff} roster is read without leaking PII when staff selection is off (mig 305/306).
3. **Must be carried into the integration** (sitemap G-1) and checked end to end.

### J-C3. Client account
1. Signs up / logs in (`/signup`, `/customer-login`). *Rule:* email change needs an OTP (`EmailChangeOtpStep`), and `guard_customer_account_email` protects it **[DB]**.
2. `/account`: upcoming / past bookings, membership balance, packages (sessions left), vouchers, referrals (prod flag off). *Rules:* a client reads only their own rows **[DB: RLS mig 064/065/175/181–183]**; profile self-edit only on allowed fields (mig 176).

---

## 2. Staff and front-desk journeys

### J-S1. Sign in (CP1)
1. `/login` → finds the business → `/:orgSlug/login`.
2. Email + password, or PIN via the `pin-login` Edge Function (PIN never checked in the browser; service key stays server-side). *Rule:* role and org come from `users`; every table is org-scoped by RLS **[DB]**.
3. **[stage]** After idle time the PIN **lock screen** covers the app; unlock with PIN (`pinAuth.js`). ⚠ Sitemap G-3: no ticket and no acceptance checks yet. Risk: a staff member with no PIN set gets locked out mid-shift.
4. **[stage]** `users.login_access`: existing accounts are backfilled to `email` (mig 318), so nobody loses access. New users created outside Staff access default to `none`. ⚠ **The sign-in path doesn't read `login_access` at all**, so "login off" blocks nothing today. ZNLY-205 makes it real: login off blocks both password and PIN sign-in, and the user is never deleted.

### J-S2. Walk-in / phone booking (CP3)
1. Calendar → click a slot, or Bookings → New booking. *Rules:* the same DB conflict, capacity and guard triggers as J-C1.6; booking outside a {staff}'s availability needs manager/admin plus a reason **[DB: `OVERRIDE_NOT_ALLOWED`, ours mig 353/356]**, and only where the tenant turned the switch on (`enforce_staff_availability`, default **off** → existing tenants unchanged).
2. Tiered service: the price is the assigned {staff}'s tier, else the Unassigned rate (`services.price_npr`) **[stage, API: `tieredBaseAmountFor` in `createBooking`]**.
3. Combo service: one booking with component items, each priced and checked (`trg_0_d_combo_item_availability_check`, `trg_booking_combo_item_*`) **[DB]**.

### J-S3. Check a booking
Bookings → Check booking: search by phone, name or number. *Rule:* search input is sanitised before PostgREST `or()` filters **[API]**. ⚠ The notifications search (`api.js` ≈ line 3980) builds `or()` from raw input (gap G-9).

### J-S4. Move a booking through its day (CP3)
State machine: Pending → Confirmed → In-Progress → Completed; Pending/Confirmed → Cancelled; Confirmed → No Show.
| Rule | Layer |
|---|---|
| Allowed transitions only | **API** (`VALID_TRANSITIONS`, `validateStatusTransition`). Not in DB: a Cancelled or No Show booking can be re-opened by a direct write (gap G-10) |
| Completed is frozen (status, base amount, {staff}); discount frozen once paid | **DB** (`trg_enforce_booking_immutability`) |
| A closed day is frozen | **DB** (`is_locked` → `DAY_LOCKED`) |
| In-Progress / Completed needs a {staff} | **DB** (`trg_enforce_therapist_required`) |
| Cancelling a paid booking records the refund owed | **DB** (`trg_handle_booking_cancellation_refund`, mig 099) |
| No Show / Cancelled free the room | **DB** (room capacity counts exclude them, mig 130) |
| Every change is audited | **DB** (`trg_audit_booking_changes`) |

### J-S5. Checkout and money (CP4)
1. Open the booking → Checkout. Tenders: cash / card / QR / custom methods (mig 052, 337), split across methods, the remainder left as a **due** owned by a named person (mig 042).
2. Discounts: staff up to **50% direct (temporary, since 2026-08-31)**, manager/admin up to 100%; above a limit → request → approve or reject (mig 029). **API only** for the role limits (gap G-11).
3. Member discount **[ours, DB RPC mig 343: who may change it, branch-scoped, `NOTHING_TO_DISCOUNT` when already covered]**.
4. Prepaid: voucher / wallet / membership / package session / referral wallet, each through its own SECURITY DEFINER RPC with balance and race checks **[DB: `record_voucher_wallet_payment(_pooled)`, `record_membership_payment`, `redeem_package_session`, `record_referral_wallet_payment`, `claim_voucher`; race fixes mig 091/096/140]**.
5. Products at checkout **[ours, mig 346: stock, commission, `product_sales.booking_id`]**.
6. Single-booking cash/card payment → `recordPayment` checks "already paid" and "remaining" **in the API**, then **inserts directly into `payments`** (RLS "Staff can record payments"). ⚠ **Gap G-12 (P1):** two devices or a double click can both pass the check and over-collect. Group payments use RPCs (`record_group_payment*`) and are safer.
7. Payments are immutable after insert (RLS has no UPDATE/DELETE path); corrections only through admin RPCs with a reason (`admin_correct_payment_amount`, `admin_correct_payment_mode`, mig 283/347) **[DB]**.
8. **[stage]** VAT invoice: only when billing is enabled and legal name, PAN and tax mode are set (fails closed); VAT extracted, not added; snapshot rows are insert-only via `issue_invoice()` **[DB mig 328–334]**. ⚠ **Gap G-13 (P1):** `issue_invoice` reads the booking and its combo items, **not** `product_sales`. After the merge a checkout with products would issue a VAT invoice without the product lines.

### J-S6. Reschedule, reassign, transfer (CP3)
1. Drag on the calendar, or edit date / time / {staff}. *Rules:* the same conflict and guard triggers; reschedule of a **paid** booking is refused (`BOOKING_PAID`, ours mig 356) **[DB]**.
2. Tiered price must follow the new {staff}. `assignTherapist` re-prices **[stage, API]**. ⚠ **Gap G-14 (P1):** our `reschedule_booking` RPC (mig 356) copies `base_amount` from the original booking, so rescheduling a tiered booking to a different-tier {staff} keeps the old price. Every path that changes the {staff} must re-price: assign, reschedule, drag and drop, combo item edit.
3. Staff transfer between branches (temporary / permanent, scheduled, return, revert, auto-revert with booking guard; mig 038–041, 145–167, ours 359) **[DB RPCs]**. Home-branch model (ZNLY-113) and lent-commission fix (ZNLY-118) are on our branch only.

### J-S7. Waitlist → booking [stage]
1. Calendar → waitlist panel → add an entry (client, wanted service / time; no slot, {staff}, room or price).
2. Convert to a booking → normal J-S2 rules apply at conversion; the entry keeps `booking_id`. Entries are never hard-deleted, only marked removed **[DB mig 327]**.

### J-S8. A {staff}'s own day (CP6)
1. Dashboard → **My day**: own bookings, own commission and tips.
2. Restricted account ("own bookings only"): calendar and lists show only bookings they are on **[stage, DB: RESTRICTIVE RLS mig 322 on `therapists.user_id`]**; customer names / numbers masked and prices shown as ••• when the account lacks those flags (mig 320, `dataMasking`) **[API + DB]**.
3. ⚠ **ZNLY-205 (P0):** My day reads **`users.therapist_id`** (ours, mig 358) while RLS reads **`therapists.user_id`** (stage, mig 318). They can disagree. Lead's decision: one source of truth, `therapists.user_id` (the team member is the person; a login is an optional permission on them, as in Fresha). Proposed UI, owner to confirm: an **Access** section on the team member's profile (login on/off, email / password / PIN, role, calendar own or all, client details, prices) replaces both Settings → Staff access and our "Login" field.

---

## 3. Owner and manager journeys

### J-O1. Run the day (CP5)
Dashboard: Business (all branches) / Branch / Front desk, in Prep → Live → Close phases, with insight cards.
*Rules:* every money figure has one definition (ZNLY-70 "one money model"); no number readable two ways.
Open items: ZNLY-155 (tomorrow's working count), ZNLY-162 (branch revenue vs pulse refunds).

### J-O2. Close the day and chase money owed (CP5)
Day close sheet (cash basis: `payment_status = 'paid'`), payment-method breakdown, Money owed (unpaid and part-paid, by responsible person). Closing locks the day **[DB: `is_locked`, `trg_enforce_attendance_day_lock`]**.

### J-O3. Approve discounts
Inbox / booking → approve or reject a request; rejection resets to `none`; big discounts notify the owner (`trg_notify_big_discount_fyi`) **[DB]**. Role limits are API-only (G-11).

### J-O4. Corrections and refunds
Admin-only payment amount / mode correction with a reason (≥10 characters) **[DB RPC]**; package session and voucher balance corrections (`admin_correct_*`); product sale refund (mig 192); booking refund on cancel (J-S4). Every correction is audited.

### J-O5. Set up a business (CP7). Sami's is the test of this journey; every future tenant follows it
1. Platform creates the org and first admin (`scripts/onboard-tenant.sql`); industry sets the labels (`staffLabel`, `sessionLabel`, `locationLabel`, `productLabel`, `enableRooms`).
2. Admin: provider profile, branches (**Locations [main ⚠]**), branch hours, closed dates, booking settings (online window and capacity), payment methods.
3. Services and categories, price types, **price tiers [stage]**, per-branch scope [main ⚠], eligible {staff}.
4. {staff}s, roster, positions; **staff access [stage]**: logins, PIN, visibility.
5. Optional: memberships, vouchers, packages, products, outreach, **billing / VAT [stage]**.
6. Setup checklist on the dashboard tracks progress.
*Pass:* a new beauty tenant completes 1–6 without SQL beyond step 1, and no screen says "spa" (sitemap G-2).

### J-O6. People: transfers, attendance, payroll
Transfers as J-S6.3. Attendance: punches append-only, reasons required, derived fields guarded, off-range checks, day lock (`trg_attendance_*`) **[DB]**; leave types and paid caps (mig 151/152). Payroll runs and items immutable once final (`trg_enforce_payroll_*_immutability`) **[DB]**.

### J-O7. Sell prepaid and products
New membership / voucher / package from Bookings tabs or the Sales area: `issue_voucher`, `issue_package`, enroll / renew / extend membership RPCs with payment-mode rules **[DB]**. Free vouchers are stored with value vs paid separately (prod data issue: 104/175 free vouchers stored worth 0, ZNLY-78/V23). Product stock syncs per branch (`trg_product_branch_stock_sync_product`) **[DB]**.

---

## 4. Platform admin journeys

### J-P1. Onboard a tenant
SQL script + per-tenant seed (prod data, not a migration) + handoff per `supabase/PROMOTION.md`. No client data in git (ZNLY-203).

### J-P2. Collect commission
Platform dashboard → org detail → collect-commission wizard; rate changes any time, backdated sole-rate rows, blended rates (mig 114–127, 144) **[DB RPCs, platform_admins only]**.

---

## 5. Existing tenants and the production migrations (CP8)

Production already runs migrations up to **317** (checked on `origin/main`). On 19 Nov CI applies **every pending
migration in one go**: 318–334 (Anish, stage), 335–375 (ours), plus the reconciling migrations from ZNLY-204/205,
gated by the `production-db` reviewer. Every tenant gets them at once. Note for ZNLY-204: stage's availability
functions (299–307) are **live on production today**, so our 354/361 would overwrite live behaviour, not stage-only code.

| Check | Status (code-read) |
|---|---|
| Anish's defaults leave existing tenants as they are | ✅ `price_type` = `fixed` (no backfill); `can_view_customer_details` / `can_view_prices` = true; `calendar_visibility` = `all`; existing `login_access` backfilled to `email`; billing off; waitlist empty |
| Our defaults leave existing tenants as they are | ✅ `enforce_staff_availability` default false; attendance redesign keeps the legacy raw data (`legacy_raw`); acknowledged backfill treats non-Pending bookings as seen |
| No two migrations redefine the same function with different rules | ❌ **ZNLY-204**: `public_get_bookable_therapists`, `public_check_branch_bookings_range` |
| One model per concept | ❌ **ZNLY-205**: login ↔ {staff} link |
| Backfills that touch existing rows are idempotent and reversible | To check per migration in the PR review: 335, 343, 345 (industry product defaults), 358 (users ↔ therapist by name: superseded by ZNLY-205), 359 (transfer flip), 364 (attendance), 365 (notifications) |
| Live features survive the UI merge | ❌ until proven: group booking, Locations, per-branch service scope (sitemap G-1) |
| A full replay on a copy of prod-shaped data passes | Not done. A local replay on seed data passed (ZNLY-198); it can't catch ZNLY-204, because overloads don't error at create time |

**Rule for the promotion:** before `stage → main`, restore a **recent prod backup into a scratch project**, apply 300–37x
there, and run the CP8 checks against Nuad Thai's real shape. Seed data alone is not enough.

---

## 6. Gap register

Sitemap gaps G-1 to G-5 are in `docs/SITEMAP.md` §9. New ones from the journeys:

| Id | Gap | Sev | Ticket |
|---|---|---|---|
| G-6 | Our availability migrations overwrite stage's public availability RPCs | **P0** | ZNLY-204 |
| G-7 | Two login ↔ {staff} link columns | **P0** | ZNLY-205 |
| G-8 | Client data in the public repo's history | **P0** (privacy) | ZNLY-203 |
| G-9 | Notifications search builds a PostgREST `or()` filter from raw input | P2 | ZNLY-211 |
| G-10 | Cancelled / No Show are terminal only in the API, not the DB | P2 | ZNLY-211 |
| G-11 | Discount role limits are API-only | P2 | ZNLY-211 |
| G-12 | Single-booking `recordPayment`: read-then-insert with no row lock, so a double submit can over-collect | **P1** | ZNLY-206 |
| G-13 | VAT invoice ignores product sales at checkout (combined effect of our products and Anish's invoices) | **P1** | ZNLY-207 |
| G-14 | Reschedule doesn't re-price tiered bookings | **P1** | ZNLY-208 |
| G-15 | Fresh local DB can't bootstrap; `bookings.client_request_id` has no migration | P2 | ZNLY-200 |
| G-16 | `login_access` = `none` for users created outside Staff access (cosmetic today, confusing in the panel) | P3 | folded into ZNLY-205 |

P0 and P1 on the critical path block Thursday unless the owner overrides in writing.

## 7. Acceptance checks for the critical-path tickets

Each runs for **Nuad Thai** (existing data) and **Sami's** (new, empty) unless noted. Pass = the expected result in
the UI **and** in the database row.

| CP | Check |
|---|---|
| CP1 | Admin, manager, staff and viewer sign in by password; staff by PIN; the lock screen unlocks with PIN; a user without a PIN is not locked out; no Nuad Thai account lost access after the migrations |
| CP2 | (Booking page unchanged; must keep working until the marketplace connects.) Client books one service (fixed price) and one tiered service (shows the range; charged the delivering {staff}'s tier); group booking for 2 people; past slots and closed dates not offered; a full room or online capacity refuses the slot; staff selection off → no names leak; the booking appears in the Inbox |
| CP3 | Walk-in, check booking, confirm → start → complete; cancel a paid booking records the refund; no-show frees the room; reschedule and reassign keep conflicts out and re-price tiered; waitlist entry converts to a booking |
| CP4 | Sell a membership, a voucher and a package at the desk (balances right, payment mode recorded); cash, card and split payment; due left to a named person; double click or two devices → collected once (G-12); staff discount ≤ 50% direct, above that refused or requested; member discount; voucher, wallet, package and membership redemption with balances right afterwards; product at checkout lowers stock; payment correction needs admin plus a reason; VAT invoice (billing on) totals match, VAT extracted, products included (G-13) |
| CP5 | Dashboard numbers equal the sum of the rows they summarise; Money owed lists every part-paid booking once; day close locks the day |
| CP6 | Restricted {staff} sees only own bookings in calendar, lists and My day (same set: ZNLY-205); masked names / prices when not allowed |
| CP7 | Sami's set up from scratch on a fresh org: profile, location, hours, services with price types and tiers, team members with access, roster, booking settings, all through the UI; no "spa" or "therapist" text anywhere |
| CP8 | After applying all migrations to a prod-shaped copy: Nuad Thai bookings, payments, dues, memberships, vouchers, packages, transfers and attendance unchanged and displayed correctly; prices unchanged; one overload per public RPC; no user lost access; attendance punches and leave still record after the attendance redesign (mig 364), and last month's payroll recomputes to the same totals; outreach rules that were sending still send (booking confirmations and reminders to clients) |

## Not verified

- Every ✅ and ❌ above is from reading code and migrations; none was executed.
- ZNLY-204: stage's 4th parameter is `p_for_group_booking boolean DEFAULT false` (checked), so after our mig 361 the app's 3-argument call matches two functions and Postgres refuses it as "not unique". That's reasoning from Postgres overload rules; it hasn't been reproduced yet.
- G-12 assumes no UI-level double-submit guard; the payment modal wasn't read.
- G-13 assumes product sales are meant to appear on the tax invoice. Owner or accountant to confirm the rule.
- The `pin-login` Edge Function and the lock screen's unlock logic weren't read.
- Calls from stage-only functions into tables or columns our migrations changed weren't traced.
- Backfills in section 5 were listed, not reviewed line by line.
