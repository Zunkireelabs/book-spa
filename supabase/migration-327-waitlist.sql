-- migration-327-waitlist.sql
--
-- Waitlist: customers who want a service but could not get the slot they
-- wanted. Staff add them, see them beside the calendar, and book them in when
-- something frees up.
--
-- Modelled on Timely's: an entry carries who, what service, roughly when they
-- want it, and how long they have been waiting. Sorted oldest-first by
-- default, because the point of a queue is that waiting longer gets you
-- served sooner.
--
-- Deliberately NOT a booking with a special status. A waitlist entry has no
-- slot, no therapist, no room and no price, so it would fail every booking
-- invariant — the state machine, conflict checks, payment rules and the
-- immutability trigger all assume a real appointment. Keeping it a separate
-- table means none of those have to learn about a half-booking.

BEGIN;

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,

  -- A known customer where possible, but staff must be able to take a name
  -- over the phone without creating a customer record first — the same
  -- walk-in case bookings already allow.
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name   text NOT NULL,
  customer_phone  text,

  service_id      uuid REFERENCES public.services(id) ON DELETE SET NULL,

  -- What they asked for. All optional: "any time this week" is a real
  -- request, and forcing a date would make staff invent one.
  preferred_date       date,
  preferred_time       time,
  preferred_therapist_id uuid REFERENCES public.therapists(id) ON DELETE SET NULL,
  notes                text,

  status          text NOT NULL DEFAULT 'waiting',

  -- Set when the entry becomes a real booking, so the queue keeps its history
  -- rather than losing why an entry disappeared.
  booking_id      uuid REFERENCES public.bookings(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.waitlist_entries'::regclass
      AND conname = 'waitlist_entries_status_check'
  ) THEN
    ALTER TABLE public.waitlist_entries
      ADD CONSTRAINT waitlist_entries_status_check
      CHECK (status IN ('waiting', 'booked', 'removed'));
  END IF;
END $$;

-- The list is always read as "this branch's queue, oldest first".
CREATE INDEX IF NOT EXISTS waitlist_entries_branch_status_idx
  ON public.waitlist_entries (branch_id, status, created_at);

CREATE INDEX IF NOT EXISTS waitlist_entries_org_idx
  ON public.waitlist_entries (org_id);

COMMENT ON TABLE public.waitlist_entries IS
  'Customers waiting for a slot. Separate from bookings on purpose: an entry '
  'has no slot, therapist, room or price, so it would fail the booking state '
  'machine and conflict checks. See migration-327.';

COMMENT ON COLUMN public.waitlist_entries.status IS
  'waiting | booked | removed. Entries are never hard-deleted — removing sets '
  'status and removed_at, so the queue keeps its history.';

COMMENT ON COLUMN public.waitlist_entries.booking_id IS
  'The booking this entry became, once staff booked them in. Kept so an entry '
  'that leaves the queue still says why.';

-- Keep updated_at honest. update_updated_at() is the repo's existing
-- convention (four tables already use it) — reused rather than defining a
-- second function that would drift from it.
--
-- Unguarded on purpose. An earlier draft wrapped this in an IF EXISTS check
-- against a function name that turned out not to exist, so the trigger was
-- silently never created and updated_at would have stayed frozen at insert
-- time. A missing dependency should fail the migration loudly, not quietly
-- skip the thing the migration exists to do.
DROP TRIGGER IF EXISTS waitlist_entries_set_updated_at ON public.waitlist_entries;
CREATE TRIGGER waitlist_entries_set_updated_at
  BEFORE UPDATE ON public.waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same posture as bookings: staff read their accessible branches, staff write
-- in their own org. Not readable by anon at all — unlike services, a waitlist
-- is internal, and it holds customer names and phone numbers.
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read branch waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can read branch waitlist"
  ON public.waitlist_entries FOR SELECT TO authenticated
  USING (branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]));

DROP POLICY IF EXISTS "Staff can add to branch waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can add to branch waitlist"
  ON public.waitlist_entries FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_user_org_id())
    AND branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
  );

DROP POLICY IF EXISTS "Staff can update branch waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can update branch waitlist"
  ON public.waitlist_entries FOR UPDATE TO authenticated
  USING (branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]))
  WITH CHECK (branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]));

-- No DELETE policy, deliberately. Removing an entry sets status='removed';
-- hard deletion would lose the record of who was waiting and why they left,
-- which is the kind of thing a manager asks about later.

INSERT INTO public.schema_migrations (version, name)
VALUES ('327', 'waitlist')
ON CONFLICT (version) DO NOTHING;

COMMIT;
