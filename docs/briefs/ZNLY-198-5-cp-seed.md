# ZNLY-198 step 5.0: seed local test orgs for the CP1–CP8 runs

Executor: bookx-60. Lead/QC: bookx-eb. Branch `feature/ZNLY-198-ui-integration`, HEAD 0be6539. **Local DB only**
(127.0.0.1:56422). Never touch staging or prod.

## Goal
Two orgs on the local DB, so the lead can run every check in docs/USER-JOURNEYS.md §7 in the browser on both:
- **Nuad Thai smoke org** (`nuad-thai-spa`, exists): keep all its data. Add the missing logins.
- **Sami's-style beauty org** (new): a small but complete tenant.

## Deliverable
One idempotent script `scripts/seed-qc-local.sql` (re-runnable, resolves by slug/email, never hard-coded UUIDs, refuses
to run unless the DB is local, e.g. checks for `nuad-thai-spa` + a `*.test` admin). The QC harness (ZNLY-196) reuses it later.
Put the generated passwords and PINs in `temp_ss/local-qc-logins.txt` (append; that file is local-only). Commit the
script + this brief as one commit `ZNLY-198 5.0: local QC seed for CP runs` **after the lead's OK** (leave uncommitted).

## Beauty org (`samis-qc`)
- `industry_type = 'beauty'`, NPR, Asia/Kathmandu; labels "Team member" / "Appointment" (wherever the app keeps
  industry labels; use the same mechanism a real onboarding would, not a UI-only hack).
- 1 branch with opening hours and a booking-settings row (online booking on, staff selection **off**).
- Rooms/stations only if beauty needs them (follow useIndustry).
- Services: 1 fixed price (e.g. Brow threading), 1 **tiered** (e.g. Lash extensions, 2 tiers), 1 with an add-on if the
  model supports it.
- 2 team members on different tiers, both on the roster this week and next.
- Billing (VAT invoice) **on** for this org, so CP4's invoice check has a case. Nuad Thai stays as it is.
- Logins: `admin@samis.test` (admin), `manager@samis.test` (manager), `staff@samis.test` (staff, **restricted** access:
  own bookings only, names/prices masked where the access model allows, **with a PIN**), `nopin@samis.test` (staff, no PIN),
  `viewer@samis.test` (viewer role, if the role exists; if not, say so).
- A few bookings: today (one per state: Confirmed, In-Progress, Completed paid, one part-paid), one tomorrow, one waitlist entry.
- One membership tier, one voucher, one package defined (not sold; CP4 sells them in the browser).

## Nuad Thai smoke org (add only)
- `manager@smoke.test` (manager), `viewer@smoke.test` (viewer if it exists), a PIN on `staff@smoke.test`, and make one
  staff login restricted (reuse `off@smoke.test` if that's what it's for; tell me which).
- Billing stays off. Don't change existing rows.

## Done means
- Script runs twice cleanly; every login can sign in by password (and PIN where set) at `localhost:4028/<slug>/login`.
- No "spa"/"therapist" text in the seeded beauty data.
- Build OK. Don't run full vitest (no code change expected). If the seed needs a code or schema change, **stop and tell me**.

## Report (10 lines or fewer)
Script path, orgs + logins table (role, PIN yes/no, restricted yes/no), anything you couldn't seed and why, Not verified list.

## Token rules
No forks or sub-agents. Never read api.js or other big files whole (grep + ranged reads). Don't re-read files after
editing. Tail build output. Few screenshots, DOM checks for text. Decide small things alone.
