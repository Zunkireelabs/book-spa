# Brief: ZNLY-198 step 4c: the P1 logic before Thursday (money first)

**From:** lead/QC bookx-eb · **To:** executor bookx-60 · **Date:** 2026-11-16 · **Owner OK:** Sadin (boards B2, B3, B4, B7 approved 16 Nov)
**Logic only.** Restyling is 4d. Work the tickets **in this order, one local commit per ticket**, and tell me after each commit
(3-line report); I QC each one before you start the next. No push, no PR, don't move tickets.

Read first (ranged): the ticket text in Plane, the board named, `docs/USER-JOURNEYS.md` §7 (CP checks).
Canvas: https://claude.ai/artifact/MX1KoaC6ot2uBQWVXgqWs2 (B2.3, B3.1, B4.2, B7 are the logic boards).

## 1. ZNLY-206: checkout pays once (money)
One SECURITY DEFINER function writes a single-booking payment. It locks the booking row (FOR UPDATE), computes what is still
owed in the database, refuses a tender above that (change is given in cash, never stored), and takes an idempotency key per
checkout attempt (a retry returns the first result). Repoint `recordPayment` and every other caller that inserts into
`payments` for one booking; group payments keep their RPCs. Staff lose the direct INSERT policy on `payments` only after every
caller is moved (grep first, list them in the report). The UI disables Pay while the request runs.
**Tests (SQL):** two parallel calls → one payment; same key twice → same payment id; tender over the remainder refused;
split and part-paid ("due") still work. Add them to a `scripts/qc-4c.sh` modelled on `qc-4a.sh`.

## 2. ZNLY-207: the invoice is the whole checkout (B3)
`issue_invoice()` puts every line of the checkout on the invoice: services AND products sold at that checkout. Tips are not
a line. Discounts are a line before tax. Voucher, wallet, package and membership show as "Paid via". A refund on a booking
that already has an invoice shows the warning "An invoice was issued for this booking" (no credit note). An issued invoice
never changes. **Tests:** booking + product → one invoice with both lines and the right VAT in each tax mode (inclusive,
addon, none); tip not on it; second print = same number marked as a copy. (ZNLY-214 may change the tip/product rule after
the accountant answers; keep the rule in one place so it is a one-line change.)

## 3. ZNLY-208: a tiered price follows the team member until paid (B2.3)
The price of a tiered service is recalculated from the delivering team member's tier **whenever the team member or the
slot changes before payment**: assign / reassign, reschedule (our `reschedule_booking`, mig 356, copies `base_amount` today,
that is the bug), drag on the calendar, combo parts (each part priced by its own team member). No tier, or nobody assigned:
the standard price (`services.price_npr`). **Once any payment exists the price is locked**; a later change only through the
admin correction with a reason. A change to someone's tier, or to a service's tier prices, is **not** pushed into existing
bookings: it applies to new bookings and to unpaid ones the next time their team member or slot changes. Discounts apply on
top of the tier price. **Tests:** each path above re-prices; a paid booking never changes; discount stays a discount.

## 4. ZNLY-209: no "spa" wording for non-spa tenants (B6)
Settings group "Spa" → "Business"; "Provider Profile" → "Business Profile"; "your spa" / "this spa" copy → "your business".
Grep the whole `src` for visible "spa"/"Spa" and hard-coded "Therapist" text and fix each with `useIndustry` labels (the
internal ids such as category `'spa'` can stay). Report the list of strings changed.

## 5. ZNLY-210 + ZNLY-216: the lock screen never locks staff out, and the PIN column is not readable (B4.2)
- "Has a PIN" comes from a SECURITY DEFINER function returning a boolean (for the signed-in user, and for admins/managers on
  the Access screen), not from reading `users.pin`. Then **revoke SELECT on `users.pin` from anon and authenticated**
  (check nothing else in the app reads it; the `pin-login` Edge Function uses the service role and is not affected).
- Lock screen menu item (sidebar AND profile menu) is off with the hint "Needs a PIN…" when the person has no PIN.
- Only a real "wrong PIN" answer counts toward the 5 attempts; a network/server error shows "Can't check your PIN right
  now…" and does not count. If the PIN check can't tell the two apart from the response, say so and stop that sub-part.
- Report how PINs are stored (hashed or not) from what the code and migrations show; don't guess.

## 6. B7 rules: Locations
- On every open day closing must be after opening: refused in the form ("Closes before it opens") AND by a database check.
- An inactive location is not offered for online booking (public branch list and public availability functions refuse it)
  or in the New appointment location picker. It stays in Settings → Locations, reports and history; existing appointments
  there stay valid and can be checked out.

## 7. ZNLY-217: admin sees "Pay rates aren't available to your role yet"
Find why an admin can't read rates on the team member panel after the merge; fix it if it is a merge regression; staff must
still not read rates. If it is only local seed data, say so and change nothing.

## 8. ZNLY-215: managers grant Staff only, at their own branches (owner decision 16 Nov)
A manager may give or edit login access only for Staff-role people whose home branch is one the manager manages, and may
only grant the Staff role. Manager, Admin and Admin viewer roles, and access for people at other branches, are admin only.
Enforce it in the database (replace the stage mig 321 rule) and in the UI (`grantableRolesFor`; the Access section is
read-only for people the manager can't edit). **Tests:** manager → Staff at own branch OK; manager → Manager refused;
manager → someone at another branch refused; admin can do all.

## Gates (I re-run each one)
`npm run build`; `npm test` (full, once per ticket at the end); `scripts/qc-4a.sh` stays ALL PASSED; `scripts/qc-4c.sh`
(new) ALL PASSED. Migrations from 380 up, each self-recording. Money tickets also need Nuad Thai-shaped data in the SQL tests.

## Token rules
No forks; never read `api.js` whole (grep + ranged reads); no re-reads after edits; tail outputs; reports of 3 lines per
commit and a **Not verified** list at the end.
