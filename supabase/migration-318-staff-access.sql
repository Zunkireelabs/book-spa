-- migration-318-staff-access.sql
--
-- Staff access: link a therapist (service-delivering staff) to a users row
-- (login account), and record how that account is allowed to sign in.
--
-- Why this is needed at all: `therapists` and `users` have always been two
-- disjoint tables with no foreign key in either direction. At Nuad Thai Spa
-- that is 63 therapists against 16 login accounts, with zero therapists
-- carrying an email, so nothing can currently tell "this login" and "this
-- staff member" are the same person. Granting access creates that link for
-- the first time.
--
-- Decisions baked in here (agreed with the user, 2026-11-15):
--   * Branch access is ticked manually by the admin. This migration does NOT
--     backfill user_branches from therapists.branch_id — see the note at the
--     bottom for why that is deliberate.
--   * Tiers do not touch this migration; price tiers are 319.

BEGIN;

-- ── 1. The link ──────────────────────────────────────────────────────────────
-- One login account maps to at most one therapist, and vice versa. Nullable on
-- both sides: most therapists have no account (46 service staff at Nuad Thai),
-- and some accounts are genuinely account-only (owners, office admins).
ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- UNIQUE rather than a plain index: two therapist rows pointing at one login
-- would make "who is signed in" ambiguous everywhere downstream. Partial, so
-- the 46 unlinked therapists don't collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS therapists_user_id_uniq
  ON public.therapists (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.therapists.user_id IS
  'Login account for this staff member, or NULL if they cannot sign in. '
  'Created by the Staff access screen; see migration-318.';

-- ── 2. How the account may sign in ───────────────────────────────────────────
--   email — can sign in: email + password, and PIN at a shared terminal
--   none  — cannot sign in; still schedulable on the calendar as staff
--
-- There is deliberately no PIN-only mode. An account is created through
-- signUp, which requires an email and a password, so an email login always
-- exists — a 'pin' value would have promised something the system cannot
-- deliver. PIN is a convenience on top of an email account, not a login
-- method that can stand alone.
--
-- Default 'none' is the safe direction: a row added by any other path is not
-- silently granted a login. Existing rows are backfilled below.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS login_access text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_login_access_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_login_access_check
      CHECK (login_access IN ('email', 'none'));
  END IF;
END $$;

-- Every existing account could already sign in before this column existed, so
-- defaulting them to 'none' would lock out the whole team on deploy. They all
-- have an email and a PIN today, which is exactly 'email'.
UPDATE public.users SET login_access = 'email' WHERE login_access = 'none';

COMMENT ON COLUMN public.users.login_access IS
  'email | none. Governs sign-in only — a staff member with none is still '
  'schedulable on the calendar. No PIN-only mode: signUp always creates an '
  'email+password account, so PIN is a convenience on top of one, never a '
  'standalone login. See migration-318.';

-- ── 3. Whose calendar this account may see ───────────────────────────────────
--   own | own_view | all | all_view   (…_view = read-only)
-- Staff can always see their own calendar; this governs visibility into other
-- people's. 'all' preserves today's behaviour, where no such restriction
-- exists — this migration must not quietly reduce anyone's access.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS calendar_visibility text NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_calendar_visibility_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_calendar_visibility_check
      CHECK (calendar_visibility IN ('own', 'own_view', 'all', 'all_view'));
  END IF;
END $$;

COMMENT ON COLUMN public.users.calendar_visibility IS
  'own | own_view | all | all_view. Visibility into OTHER staff calendars; '
  'everyone always sees their own. Defaults to all to preserve pre-318 '
  'behaviour. See migration-318.';

-- ── 4. Deliberately NOT done here ────────────────────────────────────────────
-- No backfill of user_branches from therapists.branch_id. The user chose
-- manual branch ticking, and a backfill would silently grant access that
-- nobody reviewed. user_branches holds 1 row today; it fills up through the
-- Staff access UI, not through this migration.
--
-- No attempt to auto-link therapists to users by name. Six of Nuad Thai's 16
-- accounts share a name with a therapist, but two of those six match MORE THAN
-- ONE therapist row (Sushila Rai and Trisha Acharya each appear twice, a
-- genuine duplicate-staff problem). Guessing would silently link the wrong
-- person's bookings and payroll. The UI surfaces the ambiguity and an admin
-- picks.

INSERT INTO public.schema_migrations (version, name)
VALUES ('318', 'staff-access')
ON CONFLICT (version) DO NOTHING;

COMMIT;
