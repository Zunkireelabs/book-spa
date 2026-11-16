-- ZNLY-218: "Add VAT on top" cannot work end to end, so the database refuses to set it (migration 383). Scratch database only.
-- Part 1 proves the end-to-end problem on a tenant that has addon (set BEFORE the guard, as an existing tenant would have it);
-- Part 2 proves the guard.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE organizations DISABLE TRIGGER trg_org_billing_no_addon;   -- fixture only: an existing tenant that already had addon
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('21800000-0000-0000-0000-00000000000a', 'ZZ218 Org', 'ZZ218A', 'zz218-org',
  '{"billing_enabled": true, "billing_legal_name": "ZZ218 Pvt Ltd", "billing_pan": "123456789", "billing_tax_mode": "addon", "billing_vat_rate": 13}'::jsonb);
ALTER TABLE organizations ENABLE TRIGGER trg_org_billing_no_addon;
INSERT INTO branches (id, name, org_id) VALUES ('21800000-0000-0000-0000-0000000000a1', 'ZZ218 Branch', '21800000-0000-0000-0000-00000000000a');
INSERT INTO rooms (id, branch_id, name, capacity) VALUES ('21800000-0000-0000-0000-0000000e0001', '21800000-0000-0000-0000-0000000000a1', 'ZZ218 Room', 3);
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('21800000-0000-0000-0000-0000000f0001', 'ZZ218 Massage', 60, 1000, '21800000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) VALUES ('21800000-0000-0000-0000-000000000101', 'zz218-admin@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('21800000-0000-0000-0000-000000000101', 'zz218-admin@example.test', 'ZZ218 Admin', 'admin', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-00000000000a', 'email');
INSERT INTO bookings (id, branch_id, room_id, service_id, service_name_snapshot, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
VALUES ('21800000-0000-0000-0000-0000000b0001', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000e0001', '21800000-0000-0000-0000-0000000f0001', 'ZZ218 Massage',
        'ZZ218 b1', '9800000218', current_date + 70, '11:00', '12:00', ((current_date + 70) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date + 70) + time '12:00') AT TIME ZONE 'Asia/Kathmandu',
        1000, 1000, '21800000-0000-0000-0000-000000000101', 'Confirmed');
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"21800000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE b constant uuid := '21800000-0000-0000-0000-0000000b0001'; msg text;
BEGIN
  -- Part 1: pay the booking at checkout, then issue the invoice in addon mode
  BEGIN
    PERFORM record_booking_payment(b, '[{"amount":1130,"payment_mode":"Cash"}]', gen_random_uuid(), NULL);   -- price 1000 + 13% VAT
    ASSERT false, 'E1 checkout must refuse the VAT on top of the price';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE 'OVERPAYMENT:%', 'E1 wrong error: ' || msg;
  END;
  PERFORM record_booking_payment(b, '[{"amount":1000,"payment_mode":"Cash"}]', gen_random_uuid(), NULL);
  BEGIN
    PERFORM issue_invoice(b);
    ASSERT false, 'E2 the invoice must be refused in addon mode';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE '%does not match the amount actually collected%', 'E2 wrong error: ' || msg;
  END;
  RAISE NOTICE 'E1/E2: checkout cannot collect the VAT, so addon invoices are refused (as predicted)';
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE o constant uuid := '21800000-0000-0000-0000-00000000000a'; msg text;
BEGIN
  -- Part 2: the guard. An existing addon tenant: data untouched, other settings still editable
  ASSERT (SELECT settings->>'billing_tax_mode' FROM organizations WHERE id = o) = 'addon', 'G0 existing tenant data untouched';
  UPDATE organizations SET settings = jsonb_set(settings, '{billing_footer_text}', '"thanks"') WHERE id = o;
  ASSERT (SELECT settings->>'billing_footer_text' FROM organizations WHERE id = o) = 'thanks', 'G1 other settings of an addon tenant stay editable';
  -- switching to addon is refused
  UPDATE organizations SET settings = jsonb_set(settings, '{billing_tax_mode}', '"none"') WHERE id = o;
  BEGIN UPDATE organizations SET settings = jsonb_set(settings, '{billing_tax_mode}', '"addon"') WHERE id = o; ASSERT false, 'G2 switch to addon refused';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE 'BILLING_ADDON_UNAVAILABLE:%', 'G2 ' || msg; END;
  -- the settings RPC goes through the same guard
  UPDATE organizations SET settings = jsonb_set(settings, '{billing_tax_mode}', '"inclusive"') WHERE id = o;
  PERFORM set_config('request.jwt.claims', '{"sub":"21800000-0000-0000-0000-000000000101","role":"authenticated"}', true);
  BEGIN PERFORM update_org_profile_settings('billing_tax_mode', '"addon"'::jsonb); ASSERT false, 'G3 settings RPC must refuse addon';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE '%BILLING_ADDON_UNAVAILABLE%', 'G3 ' || msg; END;
  -- enabling billing while addon is set is refused; a new org with addon is refused
  UPDATE organizations SET settings = jsonb_set(jsonb_set(settings, '{billing_enabled}', 'false'), '{billing_tax_mode}', '"none"') WHERE id = o;
  ASSERT (SELECT settings->>'billing_tax_mode' FROM organizations WHERE id = o) = 'none', 'G4 inclusive / none are fine';
  BEGIN INSERT INTO organizations (id, name, code, slug, settings) VALUES ('21800000-0000-0000-0000-00000000000b', 'ZZ218 B', 'ZZ218B', 'zz218-b', '{"billing_tax_mode":"addon"}'::jsonb);
        ASSERT false, 'G5 a new tenant with addon refused';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE 'BILLING_ADDON_UNAVAILABLE:%', 'G5 ' || msg; END;
  RAISE NOTICE 'guard passed';
END $$;
ROLLBACK;
\echo 218 PASSED
