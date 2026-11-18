# The repo cannot rebuild its own database

**Found:** 2026-11-18, while applying `schema.sql` + all 323 migrations to a clean Postgres to
verify `migration-335-public-create-booking.sql` before trusting it.

**Severity:** no impact on running systems. Staging and production already have everything
described here, because it was created by hand at some point. The impact is on *recreating* a
database — disaster recovery, a new environment, a new developer running the documented local
setup, or any attempt to verify a migration before it reaches a live project.

Rebuilding produced **81 errors across 88 files**. Three of the four causes below are genuine
repo gaps; the first is not, and is recorded only because it dominates the error output and
sends you looking in the wrong place.

---

## 1. `rls.sql` must run between schema.sql and the migrations — NOT a repo gap

`supabase/rls.sql` defines `get_user_role()`, `get_user_branch_id()` and
`get_user_branch_ids()`. Twenty-eight migrations call those functions in policy definitions and
fail outright without them, cascading into "relation does not exist" for everything those
migrations would have created. Skipping it accounts for 29 of the original 81 failures.

**This one is already documented and already automated** — `supabase/LOCAL_DEV.md` states the
order, and `scripts/local-db-bootstrap.sh` performs it. It is recorded here only because this
exercise initially applied the files by hand instead of using that script, and the resulting
failure cascade is confusing enough to be worth recognising on sight.

**No fix needed. Use `scripts/local-db-bootstrap.sh`.**

## 2. `service_categories` has no CREATE TABLE anywhere

Referenced by at least six migrations (024, 049, 197, 201, 205, 209, 290, 294) and by
`services_with_offer_pricing`. Created in the live databases by hand; never captured.

The repo already knew. From `migration-194-service-categories-offer-fields.sql`:

> `service_categories` has no tracked CREATE TABLE migration (pre-existing …)

Because it is missing, `services_with_offer_pricing` never gets created, and
`migration-200-campaign-discount-function.sql` fails too — it joins `campaign_categories`, which
*is* tracked (migration-199) but which FKs `service_categories` and so cannot be created either.
One untracked table takes out a chain of six.

**Fix:** `migration-013-backfill-untracked-schema.sql`, written `IF NOT EXISTS` so it is a no-op
against the live databases that already have it. Numbered 013, not appended at the end: the first
migration to reference the table is 184, so creating it last would not help a rebuild at all.
(This was got wrong first time — numbered 336 — and the rebuild caught it.)

## 3. `bookings.client_request_id` has no ALTER TABLE anywhere

Same story, again stated in the repo. From
`migration-223-public-booking-confirmation-rpc.sql`:

> `client_request_id` already exists on the table (added ad hoc, never wired up)

Migration 223 creates an index on the column and an RPC that reads it, but nothing creates the
column. On a rebuilt database, 223 fails and the public booking read-back path does not exist.

**Fix:** same migration, `ADD COLUMN IF NOT EXISTS`.

## 4. Ordering assumptions inside the 190-230 and 320-335 ranges (informational)

Even with the above fixed, some migrations only succeed on a second pass, because a later
migration supplies something an earlier one assumed. Examples hit during this exercise:

- `migration-208` must run before `209`/`290`/`294` — it replaces the two-argument
  `get_active_campaign_discount_percent` with the three-argument org-scoped version those
  three expect.
- `migration-335` reads `price_type` from `services_with_offer_pricing`, which only gains that
  column in `323` + `334`.

These are not broken migrations; they are correct in sequence, and only surface because failures
earlier in the chain left gaps. They are noted so the next person recognises the pattern rather
than assuming a new bug.

---

## Verifying a rebuild

After the fixes, the documented order is:

```
schema.sql → rls.sql → migration-*.sql in numeric order
```

Measured on a disposable Supabase project, dropping and recreating the `public` schema between
runs:

| | failures |
|---|---|
| Applying files by hand, omitting `rls.sql` | **81** |
| With `rls.sql` in sequence (what the bootstrap script already does) | 52 |
| After adding the backfill migration (numbered 336, too late to help) | 29 |
| After renumbering it to 013 | **4** |

The four that remain are not schema gaps and are expected:

- `migration-demospa-seed.sql` — demo data, unnumbered so it sorts before the schema exists
- `migration-002` — a type `schema.sql` already creates
- `migration-014` — a Supabase storage bucket that already exists
- `migration-035` — a one-off historical data merge referencing a temp table

A clean rebuild leaves `services_with_offer_pricing` present and `public_create_booking`
callable. Both were confirmed on 2026-11-18 against a disposable
Supabase project, including a successful booking, a rejected double-book, an idempotency replay
returning the original row, and `compute_therapist_branch_at` resolving correctly either side of
a `staff_transfers` window.

## Not addressed here

Two live defects found in the same session are written up separately in
`2026-11-18-group-booking-and-availability-gaps.md`. Both are changes to existing behaviour
rather than reproducibility gaps, and are deliberately left unfixed.
