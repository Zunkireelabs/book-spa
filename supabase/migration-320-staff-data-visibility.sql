-- migration-320-staff-data-visibility.sql
--
-- Two admin-controlled restrictions on what a signed-in staff member can see:
-- customer contact details, and money. Set from Setup → Staff access.
--
-- The requirement, in the user's words: "if we gave login access to service
-- [staff] and we dont want to show customer information, service price and
-- other staff's bookings then that should be maintain from here."
--
-- Three restrictions in total. The third — only seeing your own bookings —
-- is users.calendar_visibility, added in 318. That column was written but
-- never enforced; the enforcement lands with this migration's application
-- code, which is why they ship together.
--
-- These are NOT the same thing as the existing "Hide client names and prices"
-- calendar toggle. That is a personal display preference in localStorage, the
-- server still sends every name and amount, and the staff member can switch
-- it off. These are restrictions an admin sets and the staff member cannot
-- undo, enforced by not sending the data.
--
-- Both default TRUE: every existing account can see everything today, and a
-- migration must not silently take access away from a working team.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_view_customer_details boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.can_view_customer_details IS
  'When false, customer phone/email/notes are withheld server-side from this '
  'account — bookings still show the customer NAME, since a booking is '
  'unusable without knowing who it is for. See migration-320.';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_view_prices boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.can_view_prices IS
  'When false, all money is withheld server-side from this account: booking '
  'amounts, payment screens, revenue reports, payroll. Hiding prices on the '
  'calendar alone would be pointless while the Daily Report still shows the '
  'day''s takings. See migration-320.';

-- ── Why no RLS policy here ───────────────────────────────────────────────────
-- These are column-level restrictions, and Postgres RLS filters ROWS, not
-- columns. A staff member with prices hidden must still read their own
-- bookings — just without the amounts — so a row policy is the wrong tool.
--
-- Enforcement is therefore in the API layer: the affected reads omit the
-- columns from .select() rather than fetching and blanking them, so the data
-- never reaches the browser and devtools cannot recover it.
--
-- That leaves a gap worth naming: a staff member who hand-crafts a PostgREST
-- request can still select bookings.final_amount, because row-level RLS
-- permits the row. Closing that properly needs either column privileges
-- (GRANT SELECT (cols) to a per-permission role) or views, both of which are
-- a larger change than this slice. Documented rather than hidden: this stops
-- the UI from showing money to staff who should not see it, and does not yet
-- stop a determined staff member with developer tools.

INSERT INTO public.schema_migrations (version, name)
VALUES ('320', 'staff-data-visibility')
ON CONFLICT (version) DO NOTHING;

COMMIT;
