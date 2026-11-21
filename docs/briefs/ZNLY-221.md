# ZNLY-221: beauty (no rooms) can't save a booking: bookings.room_id NOT NULL

Executor: bookx-60. Lead: bookx-eb. Branch `feature/ZNLY-198-ui-integration`. Local DB only.

## Repro (lead, 17 Nov)
`localhost:4028/samis-qc/book` → Lash Extensions → any slot → details → Confirm →
"Something went wrong…"; console `23502 null value in column "room_id"`. createBooking (api.js ~6958–7320)
skips rooms when `industries.enable_rooms = false` and inserts `room_id: null`; the local schema has `room_id NOT NULL`
(schema.sql:99), and no migration drops it. Mig 246 assumed this works (sbal on prod).

## Part 1: map first, no code yet (report in 15 lines or fewer)
1. Every DB object that assumes bookings.room_id is set: triggers (trg_room_capacity_check, trg_booking_snapshots,
   trg_bookings_tier_reprice / mig 382, sync_booking_therapists), RPCs (public availability 361/376, reschedule,
   group booking), views and reports that inner-join rooms.
2. Every frontend place that assumes `booking.roomId`/room name (calendar Room view, booking detail, invoice, reports).
3. Other write paths for a room-less org: desk New booking, walk-in, group booking, reschedule, waitlist Book in,
   reassign. Which ones also send null?
4. Options with risk: (a) migration `DROP NOT NULL` + make each consumer null-safe; (b) auto-assign a hidden
   default station for room-less industries. My lean is (a), because it matches mig 246's intent and the code. Tell me if the map says otherwise.
Claim the next free migration number (check supabase/ on stage and open PRs) in the Plane ticket if (a).

## Part 2: only after my OK
Build the agreed option, plus a qc script check: a room-less beauty org saves desk, online and group bookings; capacity and
conflict checks still hold; Nuad Thai (rooms) unchanged. Build + vitest. Leave it uncommitted for my browser re-check.

## Token rules
No forks or sub-agents. Never read api.js whole (grep + ranged reads). No re-reading after edits. Tail outputs. Report in 15 lines or fewer.
