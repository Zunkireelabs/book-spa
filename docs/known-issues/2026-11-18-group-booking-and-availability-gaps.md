# Two latent bugs found while designing the marketplace booking-creation endpoint

Found 2026-11-18 while designing `public_create_booking`/`public_create_group_booking`
(zennly-connectors). Both are live defects in existing, already-shipped behavior — unrelated to
that design and not fixed here, since this branch is staying additive. Recording them so they
aren't lost to a conversation transcript.

## 1. `public_cancel_booking_group`'s 10-minute window can silently cancel nothing while reporting success

`public_cancel_booking_group` (`supabase/migration-252-public-staff-selection.sql:452-493`) is the
compensating rollback `submitGroupBooking` (`src/services/api.js:6501-6666`) calls when a guest's
booking fails partway through a group submission. Its `UPDATE` is scoped to
`created_at > now() - interval '10 minutes'`:

```sql
UPDATE public.bookings
SET status = 'Cancelled', ...
WHERE booking_group_id = p_booking_group_id
  AND status = 'Pending'
  AND created_by IS NULL
  AND created_at > now() - interval '10 minutes';
```

If the rollback is attempted more than 10 minutes after the group's rows were created — plausible
given `submitGroupBooking`'s own retry/backoff loop on the rollback call itself, each attempt
`400 * attempt` ms apart, on top of however long the sequential per-guest creation took before the
failure — this `UPDATE` matches zero rows. It does **not** raise an error; it just returns `0` from
`GET DIAGNOSTICS`. `submitGroupBooking` only checks `rollbackError` from the RPC call, never the
affected-row count, so this reads as a **successful** rollback (`rollbackOk = true`) even though
nothing was actually released. The customer's message says "the rest of your group was released,"
and it wasn't.

**Fix direction (not implemented here):** have the RPC return the row count and have the caller
treat `count = 0` when rows were expected to exist as its own distinguishable outcome, not silent
success.

## 2. `allPeopleFitSlot` (group availability) never enforces gender headcount

`src/pages/provider-profile-flow/utils/groupAvailability.js`'s `allPeopleFitSlot` checks room
capacity and branch online-capacity per candidate slot, but — unlike the solo flow's
`buildOccupancy` (`src/pages/customer-booking-flow/utils/availability.js`), which tracks a
`byGender` map and enforces the service's gender-eligibility headcount — it never checks gender
headcount when fitting a group into a slot. `gender_preference` is passed through to booking
creation but isn't a constraint during group slot-finding.

Practical effect: a group booking can be offered (and may succeed, since the DB's own gender
constraints — if any — would have to catch it at insert time, not before) a slot the solo flow
would have excluded for a gender-restricted service, because the group math simply doesn't model
that dimension.

**Fix direction (not implemented here):** add a per-slot gender-headcount check to
`allPeopleFitSlot`, mirroring `buildOccupancy`'s `byGender` accounting, before claiming a slot for
the group. This is also the reason `public_compute_group_slots` (the new server-side group-slot
RPC being built for the marketplace) must include the gender constraint from the start — the thing
it replaces client-side has this gap, and the replacement should not inherit it.
