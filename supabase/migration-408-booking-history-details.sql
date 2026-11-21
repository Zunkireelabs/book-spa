-- Migration 408 (ZNLY-330): booking History records who changed what for Edit details and walk-in Add client.
--
-- log_booking_changes() (migration-002) already logs STATUS_CHANGE, DISCOUNT_CHANGE and PAYMENT_STATUS_CHANGE; those three branches are kept
-- exactly as they were. Two new rows are added, written by the same SECURITY DEFINER trigger with the same changed_by (auth.uid()) and
-- changed_at (table default), so no client gets any new write access:
--   CLIENT_ADDED     customer_id goes NULL -> a value (a walk-in got a client). new_data = { customer_name }.
--   DETAILS_CHANGED  any of customer_name, customer_phone, service_id, date, start_time, special_requests, referred_by changed.
--                    ONE row per update; old_data/new_data hold only the changed fields as readable values (service as service_name from the
--                    snapshot column, time as HH24:MI, date as YYYY-MM-DD). The phone number itself is never copied into audit_logs:
--                    new_data.customer_phone is the marker 'updated'. When the same update also adds a client, the name/phone change is
--                    already told by CLIENT_ADDED and is left out of the details row.
-- Reversible: re-create log_booking_changes() from migration-002 (the three original branches only).

BEGIN;

CREATE OR REPLACE FUNCTION public.log_booking_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  old_d jsonb := '{}'::jsonb;
  new_d jsonb := '{}'::jsonb;
  client_added boolean := (OLD.customer_id IS NULL AND NEW.customer_id IS NOT NULL);
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'STATUS_CHANGE',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      auth.uid()
    );
  END IF;

  IF OLD.discount_amount IS DISTINCT FROM NEW.discount_amount THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'DISCOUNT_CHANGE',
      jsonb_build_object('discount_amount', OLD.discount_amount, 'discount_status', OLD.discount_status),
      jsonb_build_object('discount_amount', NEW.discount_amount, 'discount_status', NEW.discount_status, 'discount_reason', NEW.discount_reason),
      auth.uid()
    );
  END IF;

  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (
      NEW.branch_id, 'bookings', NEW.id, 'PAYMENT_STATUS_CHANGE',
      jsonb_build_object('payment_status', OLD.payment_status),
      jsonb_build_object('payment_status', NEW.payment_status),
      auth.uid()
    );
  END IF;

  IF client_added THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (NEW.branch_id, 'bookings', NEW.id, 'CLIENT_ADDED', '{}'::jsonb, jsonb_build_object('customer_name', NEW.customer_name), auth.uid());
  END IF;

  IF NOT client_added AND OLD.customer_name IS DISTINCT FROM NEW.customer_name THEN
    old_d := old_d || jsonb_build_object('customer_name', OLD.customer_name);
    new_d := new_d || jsonb_build_object('customer_name', NEW.customer_name);
  END IF;
  IF NOT client_added AND OLD.customer_phone IS DISTINCT FROM NEW.customer_phone THEN
    new_d := new_d || jsonb_build_object('customer_phone', 'updated');
  END IF;
  IF OLD.service_id IS DISTINCT FROM NEW.service_id THEN
    old_d := old_d || jsonb_build_object('service_name', OLD.service_name_snapshot);
    new_d := new_d || jsonb_build_object('service_name', NEW.service_name_snapshot);
  END IF;
  IF OLD.date IS DISTINCT FROM NEW.date THEN
    old_d := old_d || jsonb_build_object('date', OLD.date::text);
    new_d := new_d || jsonb_build_object('date', NEW.date::text);
  END IF;
  IF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    old_d := old_d || jsonb_build_object('start_time', to_char(OLD.start_time, 'HH24:MI'));
    new_d := new_d || jsonb_build_object('start_time', to_char(NEW.start_time, 'HH24:MI'));
  END IF;
  IF OLD.special_requests IS DISTINCT FROM NEW.special_requests THEN
    old_d := old_d || jsonb_build_object('special_requests', OLD.special_requests);
    new_d := new_d || jsonb_build_object('special_requests', NEW.special_requests);
  END IF;
  IF OLD.referred_by IS DISTINCT FROM NEW.referred_by THEN
    old_d := old_d || jsonb_build_object('referred_by', OLD.referred_by);
    new_d := new_d || jsonb_build_object('referred_by', NEW.referred_by);
  END IF;
  IF new_d <> '{}'::jsonb THEN
    INSERT INTO audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (NEW.branch_id, 'bookings', NEW.id, 'DETAILS_CHANGED', old_d, new_d, auth.uid());
  END IF;

  RETURN NEW;
END;
$function$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('408', 'booking-history-details')
ON CONFLICT (version) DO NOTHING;

COMMIT;
