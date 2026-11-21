-- ZNLY-274: create_customer_for_booking (migration 402). One transaction that ROLLS BACK, so it is safe on any database.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES
  ('27400000-0000-0000-0000-00000000000a', 'ZZ274 Org A', 'ZZ274A', 'zz274-a', '{}'::jsonb),
  ('27400000-0000-0000-0000-00000000000b', 'ZZ274 Org B', 'ZZ274B', 'zz274-b', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES
  ('27400000-0000-0000-0000-0000000000a1', 'ZZ274 A1', '27400000-0000-0000-0000-00000000000a'),
  ('27400000-0000-0000-0000-0000000000b1', 'ZZ274 B1', '27400000-0000-0000-0000-00000000000b');
INSERT INTO customers (id, org_id, branch_id, full_name, phone) VALUES
  ('27400000-0000-0000-0000-0000000c0001', '27400000-0000-0000-0000-00000000000a', '27400000-0000-0000-0000-0000000000a1', 'Existing Name', '+977 9800 274 001');

SET LOCAL ROLE anon;
DO $$
DECLARE
  a uuid := '27400000-0000-0000-0000-00000000000a'; a1 uuid := '27400000-0000-0000-0000-0000000000a1'; b1 uuid := '27400000-0000-0000-0000-0000000000b1';
  new1 uuid; new2 uuid; same uuid; byemail uuid; nm text;
BEGIN
  -- anon creates a brand new customer and gets an id back (the raw insert + select could not)
  new1 := create_customer_for_booking(a, a1, '  New Guest  ', '+9779800274002', 'New.Guest@Example.test', 'Female');
  ASSERT new1 IS NOT NULL, 'N1 new customer must return an id';
  -- same phone typed in another format -> same customer
  new2 := create_customer_for_booking(a, a1, 'Other Typing', '977-9800-274-002', NULL, NULL);
  ASSERT new2 = new1, 'N2 same phone, different format, must return the same id';
  -- same email, different case, no phone -> same customer
  byemail := create_customer_for_booking(a, a1, 'Email Only', NULL, 'new.guest@example.TEST', NULL);
  ASSERT byemail = new1, 'N3 same email must return the same id';
  -- an existing customer is found, never overwritten
  same := create_customer_for_booking(a, a1, 'Hacker Name', '+9779800274001', 'x@example.test', 'Male');
  ASSERT same = '27400000-0000-0000-0000-0000000c0001', 'N4 existing phone must return the existing id';
  -- wrong branch / org refused
  BEGIN PERFORM create_customer_for_booking(a, b1, 'Wrong', '+9779800274003', NULL, NULL); ASSERT false, 'N5 branch of another org must be refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM create_customer_for_booking('27400000-0000-0000-0000-0000000000ff', a1, 'Wrong', '+9779800274004', NULL, NULL); ASSERT false, 'N6 unknown org must be refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM create_customer_for_booking(a, a1, '   ', '+9779800274005', NULL, NULL); ASSERT false, 'N7 blank name must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$
DECLARE nm text; e text; n int;
BEGIN
  SELECT full_name INTO nm FROM customers WHERE id = '27400000-0000-0000-0000-0000000c0001';
  ASSERT nm = 'Existing Name', 'N8 existing customer name must not be overwritten, got ' || nm;
  SELECT full_name, email INTO nm, e FROM customers WHERE org_id = '27400000-0000-0000-0000-00000000000a' AND phone = '+9779800274002';
  ASSERT nm = 'New Guest' AND e = 'new.guest@example.test', 'N9 inputs trimmed / email lower-cased, got ' || nm || ' / ' || e;
  SELECT count(*) INTO n FROM customers WHERE org_id = '27400000-0000-0000-0000-00000000000a';
  ASSERT n = 2, 'N10 exactly two customers in org A, got ' || n;
  RAISE NOTICE 'ZNLY-274 PASSED';
END $$;
ROLLBACK;
