## Phone: canonical E.164 by country code (2026-08-27)

Problem: phones were normalised to "last 10 digits" everywhere — correct only for
Nepal. Other countries lost/mangled their dial code in `customers.phone` and in
every phone lookup; last-10 collisions merged different people.

Fix — one canonical format, E.164 (`+<cc><national>`, digits only):

- [x] `src/utils/phone.js` — new: `toE164()`, `samePhone()`, `phoneDigits()`,
      `splitE164()`, `formatPhoneDisplay()`. Nepal-default when no `+` and ≤10 digits.
- [x] `services/api.js` — every phone choke point now `toE164()`s:
      `createBooking` (stored value + customer dedup lookup), `findOrCreateCustomer`,
      `updateBookingDetails`, `getCustomerOutstandingBalance` (match via `samePhone`),
      `lookupReferrerByPhone` / `checkExistingCustomerByPhone` (+ optional countryCode arg).
      Removed all `.slice(-10)`.
- [x] `StaffBookingForm.jsx` — existing-customer check uses `toE164`/`samePhone`.
- [x] `CustomerForm.jsx` — passes country code to `checkExistingCustomerByPhone`.
- [x] `BookingConfirmation.jsx` — builds `customerPhone` + referral phone via `toE164`.
- [x] v1 + v2 booking flow `index.jsx` — `phoneCountryCode: '+977'` in initial state.
- [x] `supabase/migration-128-phone-e164.sql` — `normalize_phone_e164()` SQL fn,
      pre-flight merge guard, backfill `customers.phone` + `bookings.customer_phone`,
      BEFORE INSERT/UPDATE triggers on both so all future writes stay canonical.
- [x] `npm run build` passes.
- [x] Migration applied + verified on local stack (4 customers, 8 bookings backfilled;
      trigger round-trip confirmed; India `+91` number preserved, not stripped).

### Prod promotion
migration-128 auto-applies via CI (`migrate` job) on merge to `main`. It is a
**data backfill on prod `customers` + `bookings`** — call it out in the PR. The
pre-flight guard aborts (no partial write) if any org has two customer rows that
would merge; if that fires, dedupe those rows first.
