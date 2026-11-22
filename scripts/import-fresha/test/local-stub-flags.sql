-- LOCAL TEST DB ONLY. Stubs what bookx-fb's migrations 424/425 will provide, so the importer can be rehearsed:
--   organizations.allow_staff_overlap, organizations.require_customer_phone (booleans),
--   bookings.allows_overlap stamped BEFORE INSERT from the org flag, exclusion constraint WHERE NOT allows_overlap,
--   customers.phone nullable. Replace with the real migrations when they land; never apply to a real database.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allow_staff_overlap boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS require_customer_phone boolean NOT NULL DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS allows_overlap boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION stub_stamp_allows_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT o.allow_staff_overlap INTO NEW.allows_overlap FROM branches b JOIN organizations o ON o.id = b.org_id WHERE b.id = NEW.branch_id;
  NEW.allows_overlap := COALESCE(NEW.allows_overlap, false);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stub_allows_overlap ON bookings;
CREATE TRIGGER trg_stub_allows_overlap BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION stub_stamp_allows_overlap();
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS excl_therapist_overlap;
ALTER TABLE bookings ADD CONSTRAINT excl_therapist_overlap EXCLUDE USING gist (therapist_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)
  WHERE (therapist_id IS NOT NULL AND status NOT IN ('Cancelled','No Show') AND NOT allows_overlap);
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;
-- require_phone now reads the org flag (the app/migration 425 will define the real behaviour).
CREATE OR REPLACE FUNCTION public.bookings_require_phone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_req boolean;
BEGIN
  IF current_setting('app.skip_phone_check', true) = 'on' OR NEW.is_walk_in THEN RETURN NEW; END IF;
  SELECT o.require_customer_phone INTO v_req FROM branches b JOIN organizations o ON o.id = b.org_id WHERE b.id = NEW.branch_id;
  IF COALESCE(v_req, true) AND (NEW.customer_phone IS NULL OR length(trim(NEW.customer_phone)) = 0) THEN
    RAISE EXCEPTION 'bookings_require_phone: customer_phone is required';
  END IF;
  RETURN NEW;
END $$;
