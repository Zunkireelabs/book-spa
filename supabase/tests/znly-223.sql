-- ZNLY-223: anon can price a tiered service for a chosen team member without gaining access to therapists' tier/pin columns.
-- One transaction, rolled back. Prints "223 PASSED".
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  tier uuid := gen_random_uuid(); s uuid := gen_random_uuid(); t_ok uuid := gen_random_uuid(); t_off uuid := gen_random_uuid(); t_other uuid := gen_random_uuid();
  p numeric; denied boolean := false;
BEGIN
  INSERT INTO organizations (id, name, code, slug) VALUES (o1, 'ZZ223 a', 'Z223A', 'zz223-a'), (o2, 'ZZ223 b', 'Z223B', 'zz223-b');
  INSERT INTO branches (id, org_id, name) VALUES (b1, o1, 'ZZ223 a'), (b2, o2, 'ZZ223 b');
  INSERT INTO price_tiers (id, org_id, name) VALUES (tier, o1, 'ZZ223 senior');
  INSERT INTO services (id, org_id, name, duration_minutes, price_npr, price_type) VALUES (s, o1, 'ZZ223 tiered', 60, 1000, 'tiered');
  INSERT INTO service_tier_prices (service_id, price_tier_id, price_npr) VALUES (s, tier, 1800);
  INSERT INTO therapists (id, org_id, branch_id, name, gender, price_tier_id, is_active) VALUES
    (t_ok, o1, b1, 'ZZ223 ok', 'Female', tier, true), (t_off, o1, b1, 'ZZ223 off', 'Female', tier, false), (t_other, o2, b2, 'ZZ223 other', 'Female', tier, true);
  SET LOCAL ROLE anon;
  p := public.service_price_for_therapist(s, t_ok);
  ASSERT p = 1800, 'anon gets the tier price for a chosen team member, got ' || coalesce(p::text, 'null');
  ASSERT public.service_price_for_therapist(s, NULL) = 1000, 'no team member: the service (Unassigned) price';
  ASSERT public.service_price_for_therapist(s, t_off) = 1800, 'deactivated team member keeps the tier price (re-price of an existing booking)';
  ASSERT public.service_price_for_therapist(s, t_other) = 1000, 'team member from another org: no tier price';
  BEGIN PERFORM price_tier_id FROM therapists LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'anon still cannot SELECT therapists.price_tier_id';
  denied := false;
  BEGIN PERFORM pin FROM users LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'anon still cannot SELECT users.pin';
  RESET ROLE;
  RAISE NOTICE 'tier price via definer RPC + no new therapist access: passed';
END $$;
ROLLBACK;
\echo 223 PASSED
