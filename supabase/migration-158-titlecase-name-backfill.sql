-- One-time backfill: normalize existing person-name columns to Title Case so they
-- match the toTitleCase() normalization now applied at write time in src/services/api.js
-- (createBooking, updateBookingDetails, setDueHolder, createTherapist, updateTherapist,
-- findOrCreateCustomer, issueVoucher, claimVoucher, issuePackage). Without this backfill,
-- exact-match lookups against historical rows (fetchRelatedUnpaidBookings's
-- customer_name eq-match, getOutstandingByStaff's due_holder_name grouping,
-- fetchDueHolderNames's dedup) would keep treating differently-cased spellings of the
-- same name (e.g. "sunita" vs "Sunita") as distinct.
--
-- Collapse-whitespace-then-initcap mirrors the JS helper closely enough for this
-- app's plain first/last names; only rows that actually change are touched.
--
-- bookings.trg_enforce_booking_immutability RAISEs DAY_LOCKED on *any* UPDATE
-- once is_locked = true (see schema.sql's enforce_booking_immutability()) — the
-- same rule setDueHolder() already respects at the app layer. A cosmetic
-- casing backfill isn't worth overriding that, so both bookings UPDATEs below
-- skip locked rows; their name casing is left as originally recorded.

UPDATE public.customers
SET full_name = initcap(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
WHERE full_name IS NOT NULL
  AND full_name IS DISTINCT FROM initcap(regexp_replace(btrim(full_name), '\s+', ' ', 'g'));

UPDATE public.bookings
SET customer_name = initcap(regexp_replace(btrim(customer_name), '\s+', ' ', 'g'))
WHERE customer_name IS NOT NULL
  AND is_locked IS NOT TRUE
  AND customer_name IS DISTINCT FROM initcap(regexp_replace(btrim(customer_name), '\s+', ' ', 'g'));

UPDATE public.bookings
SET due_holder_name = initcap(regexp_replace(btrim(due_holder_name), '\s+', ' ', 'g'))
WHERE due_holder_name IS NOT NULL
  AND is_locked IS NOT TRUE
  AND due_holder_name IS DISTINCT FROM initcap(regexp_replace(btrim(due_holder_name), '\s+', ' ', 'g'));

UPDATE public.therapists
SET name = initcap(regexp_replace(btrim(name), '\s+', ' ', 'g'))
WHERE name IS NOT NULL
  AND name IS DISTINCT FROM initcap(regexp_replace(btrim(name), '\s+', ' ', 'g'));

UPDATE public.vouchers
SET guest_name = initcap(regexp_replace(btrim(guest_name), '\s+', ' ', 'g'))
WHERE guest_name IS NOT NULL
  AND guest_name IS DISTINCT FROM initcap(regexp_replace(btrim(guest_name), '\s+', ' ', 'g'));

UPDATE public.voucher_claims
SET guest_name_used_by = initcap(regexp_replace(btrim(guest_name_used_by), '\s+', ' ', 'g'))
WHERE guest_name_used_by IS NOT NULL
  AND guest_name_used_by IS DISTINCT FROM initcap(regexp_replace(btrim(guest_name_used_by), '\s+', ' ', 'g'));

UPDATE public.packages
SET guest_name = initcap(regexp_replace(btrim(guest_name), '\s+', ' ', 'g'))
WHERE guest_name IS NOT NULL
  AND guest_name IS DISTINCT FROM initcap(regexp_replace(btrim(guest_name), '\s+', ' ', 'g'));

UPDATE public.package_redemptions
SET guest_name_used_by = initcap(regexp_replace(btrim(guest_name_used_by), '\s+', ' ', 'g'))
WHERE guest_name_used_by IS NOT NULL
  AND guest_name_used_by IS DISTINCT FROM initcap(regexp_replace(btrim(guest_name_used_by), '\s+', ' ', 'g'));

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('158', 'titlecase-name-backfill')
ON CONFLICT (version) DO NOTHING;
