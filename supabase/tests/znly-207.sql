-- ZNLY-207: the invoice is the whole checkout (issue_invoice v6, migration 381). Scratch database only (scripts/qc-4c.sh).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('20700000-0000-0000-0000-00000000000a', 'ZZ207 Org', 'ZZ207A', 'zz207-org',
  '{"billing_enabled": true, "billing_legal_name": "ZZ207 Pvt Ltd", "billing_pan": "123456789", "billing_tax_mode": "inclusive", "billing_vat_rate": 13}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('20700000-0000-0000-0000-0000000000a1', 'ZZ207 Branch', '20700000-0000-0000-0000-00000000000a');
INSERT INTO rooms (id, branch_id, name, capacity) VALUES ('20700000-0000-0000-0000-0000000e0001', '20700000-0000-0000-0000-0000000000a1', 'ZZ207 Room', 5);
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('20700000-0000-0000-0000-0000000f0001', 'ZZ207 Massage', 60, 1000, '20700000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) VALUES ('20700000-0000-0000-0000-000000000101', 'zz207-admin@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('20700000-0000-0000-0000-000000000101', 'zz207-admin@example.test', 'ZZ207 Admin', 'admin', '20700000-0000-0000-0000-0000000000a1', '20700000-0000-0000-0000-00000000000a', 'email');
INSERT INTO products (id, name, org_id, price_npr) VALUES ('20700000-0000-0000-0000-0000000d0001', 'ZZ207 Oil', '20700000-0000-0000-0000-00000000000a', 565);
-- four paid bookings: 1 inclusive + product + refunded product + tip, 2 none with a discount, 3 addon, 4 for the copy / immutability checks
INSERT INTO bookings (id, branch_id, room_id, service_id, service_name_snapshot, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
SELECT ('20700000-0000-0000-0000-0000000b000' || n)::uuid, '20700000-0000-0000-0000-0000000000a1', '20700000-0000-0000-0000-0000000e0001', '20700000-0000-0000-0000-0000000f0001', 'ZZ207 Massage',
       'ZZ207 b' || n, '9800000207', current_date - 10 + n, '11:00', '12:00',
       ((current_date - 10 + n) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date - 10 + n) + time '12:00') AT TIME ZONE 'Asia/Kathmandu',
       1000, 1000, '20700000-0000-0000-0000-000000000101', 'Confirmed'::booking_status
FROM generate_series(1, 4) n;
UPDATE bookings SET discount_amount = 100, discount_status = 'approved', discount_approved_by = '20700000-0000-0000-0000-000000000101' WHERE id = '20700000-0000-0000-0000-0000000b0002';  -- final 900
-- product sales made AT the checkout (booking_id set) and how each was paid
INSERT INTO product_sales (id, org_id, branch_id, product_id, product_name, quantity, unit_price_npr, total_amount, payment_mode, sold_by, booking_id) VALUES
  ('20700000-0000-0000-0000-0000000c0001', '20700000-0000-0000-0000-00000000000a', '20700000-0000-0000-0000-0000000000a1', '20700000-0000-0000-0000-0000000d0001', 'ZZ207 Oil', 1, 565, 565, 'Membership', '20700000-0000-0000-0000-000000000101', '20700000-0000-0000-0000-0000000b0001'),
  ('20700000-0000-0000-0000-0000000c0002', '20700000-0000-0000-0000-00000000000a', '20700000-0000-0000-0000-0000000000a1', '20700000-0000-0000-0000-0000000d0001', 'ZZ207 Oil', 1, 300, 300, 'Cash', '20700000-0000-0000-0000-000000000101', '20700000-0000-0000-0000-0000000b0001'),
  ('20700000-0000-0000-0000-0000000c0003', '20700000-0000-0000-0000-00000000000a', '20700000-0000-0000-0000-0000000000a1', '20700000-0000-0000-0000-0000000d0001', 'ZZ207 Oil', 2, 50, 100, 'Cash', '20700000-0000-0000-0000-000000000101', '20700000-0000-0000-0000-0000000b0002'),
  ('20700000-0000-0000-0000-0000000c0004', '20700000-0000-0000-0000-00000000000a', '20700000-0000-0000-0000-0000000000a1', '20700000-0000-0000-0000-0000000d0001', 'ZZ207 Oil', 1, 500, 500, 'Cash', '20700000-0000-0000-0000-000000000101', '20700000-0000-0000-0000-0000000b0003');
UPDATE product_sales SET refunded_at = now(), refunded_by = '20700000-0000-0000-0000-000000000101', refund_reason = 'ZZ207' WHERE id = '20700000-0000-0000-0000-0000000c0002';  -- refunded: must not be a line
INSERT INTO product_sale_payments (sale_id, org_id, payment_mode, amount) SELECT id, org_id, payment_mode, total_amount FROM product_sales WHERE product_id = '20700000-0000-0000-0000-0000000d0001';
-- booking payments (owner insert: this fixture is not the checkout path)
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) VALUES
  ('20700000-0000-0000-0000-0000000b0001', 1000, 'Cash', '20700000-0000-0000-0000-000000000101'),
  ('20700000-0000-0000-0000-0000000b0002', 900,  'Cash', '20700000-0000-0000-0000-000000000101'),
  ('20700000-0000-0000-0000-0000000b0003', 1195, 'Cash', '20700000-0000-0000-0000-000000000101'),   -- addon: 1000 + 500 products = 1500, +13% = 1695 = 1195 + 500 paid on the product
  ('20700000-0000-0000-0000-0000000b0004', 600,  'VoucherWallet', '20700000-0000-0000-0000-000000000101'),
  ('20700000-0000-0000-0000-0000000b0004', 400,  'SessionPackage', '20700000-0000-0000-0000-000000000101');
INSERT INTO booking_tips (booking_id, amount, recorded_by) VALUES ('20700000-0000-0000-0000-0000000b0001', 150, '20700000-0000-0000-0000-000000000101');
COMMIT;

CREATE FUNCTION pg_temp.set_mode(m text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  ALTER TABLE organizations DISABLE TRIGGER trg_org_billing_no_addon;   -- ZNLY-218 refuses addon: the VAT maths of issue_invoice is still tested
  UPDATE organizations SET settings = jsonb_set(settings, '{billing_tax_mode}', to_jsonb(m)) WHERE id = '20700000-0000-0000-0000-00000000000a';
  ALTER TABLE organizations ENABLE TRIGGER trg_org_billing_no_addon;
  EXECUTE 'SET LOCAL ROLE authenticated';
END $f$;
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"20700000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  o constant uuid := '20700000-0000-0000-0000-00000000000a';
  i invoices; i2 invoices; labels text; n int;
BEGIN
  ASSERT (SELECT payment_status FROM bookings WHERE id = '20700000-0000-0000-0000-0000000b0001') = 'paid', 'S0 fixture booking 1 is paid';

  -- inclusive: booking 1000 + product 565 (the refunded 300 is not on it, the 150 tip is not on it)
  i := issue_invoice('20700000-0000-0000-0000-0000000b0001');
  ASSERT jsonb_array_length(i.line_items) = 2, 'I1 one service line + one product line, got ' || jsonb_array_length(i.line_items);
  ASSERT i.line_items->1->>'description' = 'ZZ207 Oil' AND (i.line_items->1->>'amount')::numeric = 565, 'I1 product line';
  ASSERT i.subtotal = 1565 AND i.discount_amount = 0 AND i.total_amount = 1565, 'I1 totals (tip must not be in them)';
  ASSERT i.vat_amount = 180.04 AND i.taxable_amount = 1384.96, 'I1 inclusive VAT on 1565: ' || i.vat_amount || ' / ' || i.taxable_amount;
  ASSERT i.payment_mode = 'Cash, Membership', 'I1 paid via: ' || i.payment_mode;
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i.line_items) l WHERE l->>'description' ILIKE '%tip%'), 'I1 tip is not a line';

  -- none, with a discount: lines 1000 + 100 products, discount 100 before tax, no VAT
  PERFORM pg_temp.set_mode('none');
  i := issue_invoice('20700000-0000-0000-0000-0000000b0002');
  ASSERT i.subtotal = 1100 AND i.discount_amount = 100 AND i.taxable_amount = 1000 AND i.vat_amount = 0 AND i.total_amount = 1000, 'N1 none: ' || i.subtotal || '/' || i.discount_amount || '/' || i.taxable_amount || '/' || i.total_amount;
  ASSERT i.line_items->1->>'description' = 'ZZ207 Oil × 2', 'N1 quantity on the product line: ' || (i.line_items->1->>'description');

  -- addon: VAT added on top of services + products
  PERFORM pg_temp.set_mode('addon');
  i := issue_invoice('20700000-0000-0000-0000-0000000b0003');
  ASSERT i.taxable_amount = 1500 AND i.vat_amount = 195 AND i.total_amount = 1695, 'A1 addon: ' || i.taxable_amount || '/' || i.vat_amount || '/' || i.total_amount;

  -- Paid via names voucher + package in plain words
  PERFORM pg_temp.set_mode('inclusive');
  i := issue_invoice('20700000-0000-0000-0000-0000000b0004');
  ASSERT i.payment_mode = 'Package, Voucher', 'P1 paid via: ' || i.payment_mode;

  -- second call = the same invoice; second print = COPY
  i2 := issue_invoice('20700000-0000-0000-0000-0000000b0004');
  ASSERT i2.id = i.id AND i2.invoice_number = i.invoice_number, 'C1 same invoice, same number';
  SELECT copy_label INTO labels FROM record_invoice_print(i.id, 'a4'); ASSERT labels = 'ORIGINAL', 'C2 first print is ORIGINAL, got ' || labels;
  SELECT copy_label INTO labels FROM record_invoice_print(i.id, 'a4'); ASSERT labels = 'COPY', 'C3 second print is COPY, got ' || labels;
  SELECT count(*) INTO n FROM invoices WHERE booking_id = '20700000-0000-0000-0000-0000000b0004'; ASSERT n = 1, 'C4 one invoice per booking';
  RAISE NOTICE 'I/N/A/P/C passed';
END $$;
ROLLBACK;

-- an issued invoice never changes (the rollback above discarded them: issue one for real, then try to change it)
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"20700000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT invoice_number FROM issue_invoice('20700000-0000-0000-0000-0000000b0004') \gset
RESET ROLE;
DO $$
BEGIN
  BEGIN UPDATE invoices SET total_amount = 1 WHERE booking_id = '20700000-0000-0000-0000-0000000b0004'; ASSERT false, 'M1 UPDATE must be refused';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN DELETE FROM invoices WHERE booking_id = '20700000-0000-0000-0000-0000000b0004'; ASSERT false, 'M2 DELETE must be refused';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  RAISE NOTICE 'M passed (immutable)';
END $$;
ROLLBACK;
\echo 207 PASSED
