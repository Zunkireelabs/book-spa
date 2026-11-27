-- Regression test for migration 432 (therapist_home_on tie-break). Everything runs inside BEGIN ... ROLLBACK: no data persists.
-- Usage (staging or local; never prod):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/test-home-on-tiebreak.sql
-- Expected: every row PASS and the script ends cleanly. On the unfixed (migration 362) function it prints FAIL rows and then
-- aborts with "home-on tiebreak: N check(s) failed". Needs migration 432 applied first.
-- Unfixed (migration 362) function on staging: 3 of 9 checks FAIL — "legacy_fwd now returns to A", "legacy_rev before the pair is A",
-- "future_tie now is A (earliest entry)" — then the script aborts with "home-on tiebreak: 3 check(s) failed". With 432: 9 of 9 PASS.
--
-- Seeds one org, three branches (A, B, C) and five therapists, all currently based at the branch noted:
--   t_legacy_fwd  at A: legacy send A->B then return B->A, same date, NULL start_time, revert_at NULL (send entered first, inserted first)
--   t_legacy_rev  at A: same pair, but the RETURN row is inserted first (physical order must not matter; transferred_at does)
--   t_perm        at B: one genuine permanent move A->B 10 days ago
--   t_future      at A: one scheduled permanent move A->C in +10 days
--   t_future_tie  at A: two same-instant scheduled rows, A->B entered first and B->C entered second (ASC tie-break)
BEGIN;

CREATE TEMP TABLE _r (name text, expected uuid, actual uuid) ON COMMIT DROP;
CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;

DO $$
DECLARE
  org uuid; a uuid; b uuid; c uuid; t uuid;
  d date := (now() AT TIME ZONE 'Asia/Kathmandu')::date - 30;   -- legacy pair date
  base timestamptz := now() - interval '30 days';
  f date := (now() AT TIME ZONE 'Asia/Kathmandu')::date + 10;   -- scheduled date
BEGIN
  INSERT INTO public.organizations (name, code, slug) VALUES ('HomeOn Test Org', 'HOT', 'home-on-test-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id INTO org;
  INSERT INTO public.branches (name, org_id) VALUES ('HO-A', org) RETURNING id INTO a;
  INSERT INTO public.branches (name, org_id) VALUES ('HO-B', org) RETURNING id INTO b;
  INSERT INTO public.branches (name, org_id) VALUES ('HO-C', org) RETURNING id INTO c;
  INSERT INTO _ids VALUES ('a', a), ('b', b), ('c', c);

  -- t_legacy_fwd: send entered first (08:00 UTC), return second (12:00 UTC), both inserted in that order
  INSERT INTO public.therapists (branch_id, name, gender, org_id) VALUES (a, 'ho_legacy_fwd', 'Female', org) RETURNING id INTO t;
  INSERT INTO _ids VALUES ('legacy_fwd', t);
  INSERT INTO public.staff_transfers (therapist_id, org_id, from_branch_id, to_branch_id, effective_date, transferred_at, applied, is_permanent, is_return_leg)
    VALUES (t, org, a, b, d, base + interval '8 hours', true, false, false),
           (t, org, b, a, d, base + interval '12 hours', true, false, false);

  -- t_legacy_rev: same pair but the return row is physically inserted first
  INSERT INTO public.therapists (branch_id, name, gender, org_id) VALUES (a, 'ho_legacy_rev', 'Female', org) RETURNING id INTO t;
  INSERT INTO _ids VALUES ('legacy_rev', t);
  INSERT INTO public.staff_transfers (therapist_id, org_id, from_branch_id, to_branch_id, effective_date, transferred_at, applied, is_permanent, is_return_leg)
    VALUES (t, org, b, a, d, base + interval '12 hours', true, false, false),
           (t, org, a, b, d, base + interval '8 hours', true, false, false);

  -- t_perm: genuine permanent move A->B, 10 days ago
  INSERT INTO public.therapists (branch_id, name, gender, org_id) VALUES (b, 'ho_perm', 'Female', org) RETURNING id INTO t;
  INSERT INTO _ids VALUES ('perm', t);
  INSERT INTO public.staff_transfers (therapist_id, org_id, from_branch_id, to_branch_id, effective_date, transferred_at, applied, is_permanent)
    VALUES (t, org, a, b, (now() AT TIME ZONE 'Asia/Kathmandu')::date - 10, now() - interval '10 days', true, true);

  -- t_future: one scheduled permanent move A->C
  INSERT INTO public.therapists (branch_id, name, gender, org_id) VALUES (a, 'ho_future', 'Female', org) RETURNING id INTO t;
  INSERT INTO _ids VALUES ('future', t);
  INSERT INTO public.staff_transfers (therapist_id, org_id, from_branch_id, to_branch_id, effective_date, transferred_at, applied, is_permanent)
    VALUES (t, org, a, c, f, now(), true, true);

  -- t_future_tie: two same-instant scheduled rows; the physically-first row is the LATER entry, so an unordered pick is wrong
  INSERT INTO public.therapists (branch_id, name, gender, org_id) VALUES (a, 'ho_future_tie', 'Female', org) RETURNING id INTO t;
  INSERT INTO _ids VALUES ('future_tie', t);
  INSERT INTO public.staff_transfers (therapist_id, org_id, from_branch_id, to_branch_id, effective_date, transferred_at, applied, is_permanent)
    VALUES (t, org, b, c, f, now() - interval '1 hour', true, true),
           (t, org, a, b, f, now() - interval '2 hours', true, true);
END $$;

INSERT INTO _r
SELECT x.name, x.expected, public.therapist_home_on((SELECT id FROM _ids WHERE k = x.who), x.at)
FROM (
  SELECT 'legacy_fwd now returns to A' name, 'legacy_fwd' who, now() at, (SELECT id FROM _ids WHERE k='a') expected
  UNION ALL SELECT 'legacy_rev now returns to A',            'legacy_rev', now(),                    (SELECT id FROM _ids WHERE k='a')
  UNION ALL SELECT 'legacy_fwd before the pair is A',        'legacy_fwd', now() - interval '60 days', (SELECT id FROM _ids WHERE k='a')
  UNION ALL SELECT 'legacy_rev before the pair is A',        'legacy_rev', now() - interval '60 days', (SELECT id FROM _ids WHERE k='a')
  UNION ALL SELECT 'perm now is B (destination)',            'perm',       now(),                    (SELECT id FROM _ids WHERE k='b')
  UNION ALL SELECT 'perm 20 days ago is A (origin)',         'perm',       now() - interval '20 days', (SELECT id FROM _ids WHERE k='a')
  UNION ALL SELECT 'future now is A (not yet moved)',        'future',     now(),                    (SELECT id FROM _ids WHERE k='a')
  UNION ALL SELECT 'future after the date is C',             'future',     now() + interval '11 days', (SELECT id FROM _ids WHERE k='c')
  UNION ALL SELECT 'future_tie now is A (earliest entry)',   'future_tie', now(),                    (SELECT id FROM _ids WHERE k='a')
) x;

SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS result, name FROM _r ORDER BY 1 DESC, 2;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _r WHERE expected IS DISTINCT FROM actual;
  IF n > 0 THEN RAISE EXCEPTION 'home-on tiebreak: % check(s) failed', n; END IF;
END $$;

ROLLBACK;
