-- Migration 415 (ZNLY-352): bring prod's and the migrations' table shapes to ONE intended shape.
--
-- Prod's tables were built by hand and differ from what migrations 001-413 produce. A DB built from the migrations
-- allows NULL where prod refuses it (and the reverse for two defaults), so a writer that passes on one shape can fail on
-- the other. Every writer in migrations 318-413 and src/ was audited per column; this file makes both shapes identical:
--
--   audit_logs.changed_at, record_id           NOT NULL. Every writer supplies both (353/361 guard with WHERE p_booking_id IS NOT NULL).
--   bookings.service_name/duration/price_snapshot  NOT NULL. Every writer (api.js createBooking, 356, 382, 409) fills all three.
--   customers.phone, created_at, is_active     NOT NULL; UNIQUE (branch_id, phone). The only NULL-phone writer was
--                                              create_customer_for_booking (402) when a visitor gave no phone; it now
--                                              creates NO profile in that case (returns NULL, same as a walk-in, 407)
--                                              instead of failing with a raw "null value in column phone" error.
--   therapist_attendance.created_at            NOT NULL.
--   therapist_attendance.status                DEFAULT 'Present' on both shapes (prod had no default).
--   therapist_attendance.marked_by             NULLABLE on both shapes: NULL means "marked by the system" (service_role,
--                                              cron, the QC harness); every user-driven writer still stamps auth.uid().
--
-- Safety: a NOT NULL / UNIQUE is applied only if the data already satisfies it (prod already does, so it is a no-op there);
-- otherwise a NOTICE says it was skipped. Nothing is backfilled and no row, amount or total is changed.
-- Idempotent and self-recording. Reversible: ALTER COLUMN ... DROP NOT NULL / DROP DEFAULT, and restore the 402 function body.

BEGIN;

-- 1. NOT NULL where every writer already supplies a value (skipped, with a notice, if rows with NULL exist).
DO $$
DECLARE
  r record;
  v_nulls bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('audit_logs','changed_at'), ('audit_logs','record_id'),
    ('bookings','service_name_snapshot'), ('bookings','service_duration_snapshot'), ('bookings','service_price_snapshot'),
    ('customers','phone'), ('customers','created_at'), ('customers','is_active'),
    ('therapist_attendance','created_at')
  ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col AND is_nullable = 'YES') THEN
      CONTINUE;  -- missing or already NOT NULL
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', r.tbl, r.col) INTO v_nulls;
    IF v_nulls = 0 THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', r.tbl, r.col);
    ELSE
      RAISE NOTICE 'migration 415: % rows have NULL %.% - NOT NULL skipped, fix the data first', v_nulls, r.tbl, r.col;
    END IF;
  END LOOP;
END $$;

-- 2. Attendance: status defaults to Present everywhere; marked_by is nullable (NULL = system).
ALTER TABLE public.therapist_attendance ALTER COLUMN status SET DEFAULT 'Present';
ALTER TABLE public.therapist_attendance ALTER COLUMN marked_by DROP NOT NULL;

-- 3. One customer per (branch, phone), as prod already enforces (only if no duplicates exist yet).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customers'::regclass AND conname = 'customers_branch_phone_unique') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.customers GROUP BY branch_id, phone HAVING count(*) > 1) THEN
    RAISE NOTICE 'migration 415: duplicate (branch_id, phone) customers exist - unique constraint skipped, merge them first';
  ELSE
    ALTER TABLE public.customers ADD CONSTRAINT customers_branch_phone_unique UNIQUE (branch_id, phone);
  END IF;
END $$;

-- 3b. bookings.client_request_id + its UNIQUE partial index exist on prod but no migration created them (223, 393, 409 need
-- them). Prod's definition: uuid, nullable, UNIQUE btree (client_request_id) WHERE client_request_id IS NOT NULL.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS client_request_id uuid;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
              WHERE c.relname = 'idx_bookings_client_request_id' AND c.relnamespace = 'public'::regnamespace AND NOT i.indisunique) THEN
    IF EXISTS (SELECT 1 FROM public.bookings WHERE client_request_id IS NOT NULL GROUP BY client_request_id HAVING count(*) > 1) THEN
      RAISE NOTICE 'migration 415: duplicate client_request_id values - index left non-unique, fix them first';
    ELSE
      DROP INDEX public.idx_bookings_client_request_id;
    END IF;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_client_request_id
  ON public.bookings (client_request_id) WHERE client_request_id IS NOT NULL;

-- 3c. Booking audit triggers: BOTH exist everywhere. They write different rows (not the same change twice):
--   trg_audit_bookings       -> fn_insert_audit_log : one full-row 'UPDATE' row (old/new JSON), shown in Governance > Audit
--   trg_audit_booking_changes-> log_booking_changes : typed history events (STATUS_CHANGE, DISCOUNT_CHANGE, DETAILS_CHANGED...), shown in Booking History (408)
-- Prod only had the first, a migrations-built DB only the second. Each is added where missing.
-- fn_insert_audit_log exists on prod only (no migration defined it); defined here verbatim from prod so every shape has it.
CREATE OR REPLACE FUNCTION public.fn_insert_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
BEGIN
  -- Extract branch_id from record (works for any table with that column)
  v_branch_id := (to_jsonb(NEW) ->> 'branch_id')::uuid;

  -- For payments, derive branch_id from parent booking
  IF v_branch_id IS NULL AND TG_TABLE_NAME = 'payments' THEN
    SELECT b.branch_id INTO v_branch_id
    FROM bookings b
    WHERE b.id = NEW.booking_id;
  END IF;

  INSERT INTO audit_logs (
    branch_id,
    table_name,
    record_id,
    action_type,
    old_data,
    new_data,
    changed_by,
    changed_at
  ) VALUES (
    v_branch_id,
    TG_TABLE_NAME,
    NEW.id,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid(),
    now()
  );

  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.log_booking_changes()') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'trg_audit_booking_changes') THEN
    CREATE TRIGGER trg_audit_booking_changes AFTER UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.log_booking_changes();
  END IF;
  IF to_regprocedure('public.fn_insert_audit_log()') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'trg_audit_bookings') THEN
    CREATE TRIGGER trg_audit_bookings AFTER UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();
  END IF;
END $$;

-- 4. create_customer_for_booking (402): identical, except that with no phone it no longer inserts a phone-less profile.
CREATE OR REPLACE FUNCTION public.create_customer_for_booking(
  p_org_id    uuid,
  p_branch_id uuid,
  p_full_name text,
  p_phone     text DEFAULT NULL,
  p_email     text DEFAULT NULL,
  p_gender    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name   text := left(btrim(coalesce(p_full_name, '')), 120);
  v_phone  text := left(NULLIF(btrim(coalesce(p_phone, '')), ''), 32);
  v_email  text := left(lower(NULLIF(btrim(coalesce(p_email, '')), '')), 254);
  v_gender text := left(NULLIF(btrim(coalesce(p_gender, '')), ''), 20);
  v_nphone text := NULLIF(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  v_id     uuid;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'customer name is required' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'organization and branch are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b JOIN public.organizations o ON o.id = b.org_id
    WHERE b.id = p_branch_id AND b.org_id = p_org_id AND o.is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'branch does not belong to an active organization' USING ERRCODE = '42501';
  END IF;

  -- Existing customer: phone first (same normalization as customers_org_nphone_uniq), then email.
  IF v_nphone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.customers c
    WHERE c.org_id = p_org_id AND NULLIF(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') = v_nphone
    LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.customers c
    WHERE c.org_id = p_org_id AND lower(c.email) = v_email
    LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- A customer profile needs a phone (customers.phone is NOT NULL). With none given, and no existing profile found by
  -- email, create nothing: the booking proceeds without a customer link, the same as a walk-in (migration 407).
  IF v_phone IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, gender)
    VALUES (p_org_id, p_branch_id, v_name, v_phone, v_email, v_gender)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- lost a race against customers_org_nphone_uniq: return the winner
    SELECT c.id INTO v_id FROM public.customers c
    WHERE c.org_id = p_org_id AND NULLIF(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') = v_nphone
    LIMIT 1;
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_for_booking(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_for_booking(uuid, uuid, text, text, text, text) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('415', 'prod-shape')
ON CONFLICT (version) DO NOTHING;

COMMIT;
