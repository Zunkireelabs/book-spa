-- ============================================================
-- Demo customer account #2 (staging only)
-- ============================================================
-- Replaces the lost demo.customer@zunkireelabs.com login (password was
-- never recorded anywhere retrievable — Supabase Auth only stores a hash —
-- so it could not be recovered, only reset). This script creates a fresh
-- account instead, fully pre-seeded so the /:orgSlug/account experience has
-- something to show on first login:
--
--   - 1 Confirmed booking   (upcoming)
--   - 1 Pending booking     (upcoming)
--   - 1 Cancelled booking   (past)
--   - 1 active Membership   (Deluxe Club, partially spent balance)
--   - 1 unused Voucher      (full balance, not expired)
--   - 1 credited Referral   (this customer referred a friend who completed
--                            a paid booking; reward already credited)
--
-- Org: resolved by slug 'nuad-thai-spa' (the only real tenant, per
-- CLAUDE.md) — this is staging's copy of that org, not production data.
-- Portable: no hardcoded org/branch/service/room/therapist UUIDs, all
-- resolved by name/slug at run time, so this also works if staging's ids
-- ever get reseeded.
--
-- NOT a tracked migration — this is demo seed data (see CLAUDE.md: seed SQL
-- stays a manual step, never gets an entry in schema_migrations).
--
-- STAGING ONLY. Do not run this against production.
--
-- Idempotent: re-running is a no-op if the email already exists (see guard
-- at the top of the DO block) — delete the account first if you want to
-- reseed from scratch:
--   DELETE FROM auth.users WHERE email = 'demo2.customer@zunkireelabs.com';
--   -- (cascades to auth.identities, customer_accounts, customers via FK,
--   --  and this script's bookings/membership/voucher/referral rows)
--
-- How to run:
--   Supabase Dashboard (staging project snzcckzfmpboeqkktmwy) -> SQL Editor
--   -> paste this file -> Run.
--   Or via CLI:  supabase db execute --project-ref snzcckzfmpboeqkktmwy -f supabase/seed-stage-demo-customer.sql
--
-- Login credentials (after running):
--   URL:      https://dev-app.zennly.io/nuad-thai-spa/login
--   Email:    demo2.customer@zunkireelabs.com
--   Password: ZenlyDemo2026#Reset
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email          text := 'demo2.customer@zunkireelabs.com';
  v_password       text := 'ZenlyDemo2026#Reset';
  v_full_name      text := 'Demo Customer';
  v_phone          text := '+977-9800000099';

  v_org_id         uuid;
  v_branch_id      uuid;

  v_svc1           record;
  v_svc2           record;
  v_svc3           record;
  v_room_id        uuid;
  v_therapist      record;

  v_auth_user_id   uuid := gen_random_uuid();
  v_customer_id    uuid;
  v_account_id     uuid;

  v_friend_customer_id uuid;
  v_friend_booking_id  uuid;

  v_tier           record;
  v_membership_id  uuid;

  v_vtype          record;
  v_seq            int;
  v_voucher_code   text;
  v_voucher_id     uuid;

  v_reward_amount  numeric(12,2);
  v_referral_id    uuid;
  v_staff_user_id  uuid;

  -- Retry pool for room-capacity collisions against pre-existing bookings.
  v_room_ids       uuid[];
  v_times          time[] := ARRAY['08:00','09:00','10:00','11:00','12:00','13:00','14:00',
                                    '15:00','16:00','17:00','18:00','19:00','20:00']::time[];
  v_r              uuid;
  v_t              time;
  v_new_booking_id uuid;
BEGIN
  -- ----------------------------------------------------------
  -- 0. Idempotency guard
  -- ----------------------------------------------------------
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RAISE NOTICE 'Demo customer % already exists — skipping. Delete auth.users row first to reseed.', v_email;
    RETURN;
  END IF;

  -- ----------------------------------------------------------
  -- 1. Resolve org + branch + a few services/room/therapist
  -- ----------------------------------------------------------
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'nuad-thai-spa';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Org "nuad-thai-spa" not found on this database — aborting.';
  END IF;

  -- Must actually have rooms configured (some branches are name-only shells).
  SELECT id INTO v_branch_id FROM public.branches b
    WHERE b.org_id = v_org_id AND EXISTS (SELECT 1 FROM public.rooms r WHERE r.branch_id = b.id)
    ORDER BY name LIMIT 1;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No branch with rooms found for org nuad-thai-spa — aborting.';
  END IF;

  SELECT id, name, duration_minutes, price_npr INTO v_svc1
    FROM public.services WHERE org_id = v_org_id ORDER BY name OFFSET 0 LIMIT 1;
  SELECT id, name, duration_minutes, price_npr INTO v_svc2
    FROM public.services WHERE org_id = v_org_id ORDER BY name OFFSET 1 LIMIT 1;
  SELECT id, name, duration_minutes, price_npr INTO v_svc3
    FROM public.services WHERE org_id = v_org_id ORDER BY name OFFSET 2 LIMIT 1;
  IF v_svc1 IS NULL THEN
    RAISE EXCEPTION 'No services found for org nuad-thai-spa — aborting.';
  END IF;
  -- Fall back to the first service if the branch has fewer than 3.
  v_svc2 := COALESCE(v_svc2, v_svc1);
  v_svc3 := COALESCE(v_svc3, v_svc1);

  SELECT id INTO v_room_id FROM public.rooms WHERE branch_id = v_branch_id ORDER BY name LIMIT 1;
  SELECT id, name INTO v_therapist FROM public.therapists WHERE branch_id = v_branch_id ORDER BY name LIMIT 1;
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'No room found for the resolved branch — aborting.';
  END IF;
  SELECT array_agg(id ORDER BY name) INTO v_room_ids FROM public.rooms WHERE branch_id = v_branch_id;

  -- payments.recorded_by is NOT NULL — attribute the demo payment to any
  -- staff/admin in this org (falls back to NULL-safe skip below if none).
  SELECT id INTO v_staff_user_id FROM public.users WHERE org_id = v_org_id ORDER BY created_at LIMIT 1;

  -- ----------------------------------------------------------
  -- 2. Auth user + identity (pgcrypto-hashed password)
  -- ----------------------------------------------------------
  -- GoTrue scans several of these text columns as non-nullable Go strings —
  -- they must be '' rather than left NULL, or /token (password grant) 500s
  -- with "converting NULL to string is unsupported" even though the schema
  -- itself allows NULL.
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    aud, role, created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    v_auth_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('full_name', v_full_name),
    'authenticated', 'authenticated', now(), now(),
    '', '',
    '', '', '',
    '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_auth_user_id, v_auth_user_id, v_email, 'email',
    jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email),
    now(), now(), now()
  );

  -- ----------------------------------------------------------
  -- 3. CRM customer row + customer_accounts (portal login)
  -- ----------------------------------------------------------
  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email)
  VALUES (v_org_id, v_branch_id, v_full_name, v_phone, v_email)
  RETURNING id INTO v_customer_id;

  INSERT INTO public.customer_accounts (org_id, auth_user_id, email, phone, full_name, customer_id)
  VALUES (v_org_id, v_auth_user_id, v_email, v_phone, v_full_name, v_customer_id)
  RETURNING id INTO v_account_id;

  -- ----------------------------------------------------------
  -- 4. Bookings: Confirmed (upcoming), Pending (upcoming), Cancelled (past)
  -- ----------------------------------------------------------
  -- Room-capacity is enforced live against whatever bookings already exist
  -- on this DB (staging/local both carry real historical data), so a fixed
  -- room+time can collide. Try every (room, time) combination for this
  -- branch until one clears the capacity check.
  <<confirmed_booking>>
  DECLARE
  BEGIN
    FOREACH v_r IN ARRAY v_room_ids LOOP
      FOREACH v_t IN ARRAY v_times LOOP
        BEGIN
          INSERT INTO public.bookings (
            branch_id, room_id, service_id, therapist_id,
            customer_name, customer_email, customer_phone, customer_gender, customer_id, customer_account_id,
            date, start_time, status, payment_status, base_amount, discount_amount,
            service_name_snapshot, service_duration_snapshot, service_price_snapshot,
            therapist_name_snapshot, room_name_snapshot
          ) VALUES (
            v_branch_id, v_r, v_svc1.id, v_therapist.id,
            v_full_name, v_email, v_phone, 'Female', v_customer_id, v_account_id,
            CURRENT_DATE + 3, v_t, 'Confirmed', 'unpaid', v_svc1.price_npr, 0,
            v_svc1.name, v_svc1.duration_minutes, v_svc1.price_npr,
            v_therapist.name, (SELECT name FROM public.rooms WHERE id = v_r)
          );
          EXIT confirmed_booking;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- slot taken, try the next room/time
        END;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION 'Could not find a free room/time slot for the Confirmed demo booking.';
  END confirmed_booking;

  <<pending_booking>>
  DECLARE
  BEGIN
    FOREACH v_r IN ARRAY v_room_ids LOOP
      FOREACH v_t IN ARRAY v_times LOOP
        BEGIN
          INSERT INTO public.bookings (
            branch_id, room_id, service_id, therapist_id,
            customer_name, customer_email, customer_phone, customer_gender, customer_id, customer_account_id,
            date, start_time, status, payment_status, base_amount, discount_amount,
            service_name_snapshot, service_duration_snapshot, service_price_snapshot,
            therapist_name_snapshot, room_name_snapshot
          ) VALUES (
            v_branch_id, v_r, v_svc2.id, v_therapist.id,
            v_full_name, v_email, v_phone, 'Female', v_customer_id, v_account_id,
            CURRENT_DATE + 7, v_t, 'Pending', 'unpaid', v_svc2.price_npr, 0,
            v_svc2.name, v_svc2.duration_minutes, v_svc2.price_npr,
            v_therapist.name, (SELECT name FROM public.rooms WHERE id = v_r)
          );
          EXIT pending_booking;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION 'Could not find a free room/time slot for the Pending demo booking.';
  END pending_booking;

  <<cancelled_booking>>
  DECLARE
  BEGIN
    FOREACH v_r IN ARRAY v_room_ids LOOP
      FOREACH v_t IN ARRAY v_times LOOP
        BEGIN
          INSERT INTO public.bookings (
            branch_id, room_id, service_id, therapist_id,
            customer_name, customer_email, customer_phone, customer_gender, customer_id, customer_account_id,
            date, start_time, status, payment_status, base_amount, discount_amount,
            service_name_snapshot, service_duration_snapshot, service_price_snapshot,
            therapist_name_snapshot, room_name_snapshot
          ) VALUES (
            v_branch_id, v_r, v_svc3.id, v_therapist.id,
            v_full_name, v_email, v_phone, 'Female', v_customer_id, v_account_id,
            CURRENT_DATE - 5, v_t, 'Cancelled', 'unpaid', v_svc3.price_npr, 0,
            v_svc3.name, v_svc3.duration_minutes, v_svc3.price_npr,
            v_therapist.name, (SELECT name FROM public.rooms WHERE id = v_r)
          );
          EXIT cancelled_booking;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION 'Could not find a free room/time slot for the Cancelled demo booking.';
  END cancelled_booking;

  <<completed_booking>>
  DECLARE
  BEGIN
    FOREACH v_r IN ARRAY v_room_ids LOOP
      FOREACH v_t IN ARRAY v_times LOOP
        BEGIN
          INSERT INTO public.bookings (
            branch_id, room_id, service_id, therapist_id,
            customer_name, customer_email, customer_phone, customer_gender, customer_id, customer_account_id,
            date, start_time, status, payment_status, base_amount, discount_amount,
            service_name_snapshot, service_duration_snapshot, service_price_snapshot,
            therapist_name_snapshot, room_name_snapshot
          ) VALUES (
            v_branch_id, v_r, v_svc1.id, v_therapist.id,
            v_full_name, v_email, v_phone, 'Female', v_customer_id, v_account_id,
            CURRENT_DATE - 10, v_t, 'Completed', 'paid', v_svc1.price_npr, 0,
            v_svc1.name, v_svc1.duration_minutes, v_svc1.price_npr,
            v_therapist.name, (SELECT name FROM public.rooms WHERE id = v_r)
          ) RETURNING id INTO v_new_booking_id;
          IF v_staff_user_id IS NOT NULL THEN
            INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
            VALUES (v_new_booking_id, v_svc1.price_npr, 'Cash', v_staff_user_id, 'Demo seed — completed booking');
          END IF;
          EXIT completed_booking;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION 'Could not find a free room/time slot for the Completed demo booking.';
  END completed_booking;

  -- ----------------------------------------------------------
  -- 5. Membership: Deluxe Club, partially spent balance (=> "active")
  -- ----------------------------------------------------------
  SELECT id, advance_amount INTO v_tier
    FROM public.membership_tiers WHERE org_id = v_org_id AND name = 'Deluxe Club';

  IF v_tier IS NULL THEN
    RAISE NOTICE 'Membership tier "Deluxe Club" not found for this org — skipping membership seed (MEMBERSHIP_ENABLED may be off here).';
  ELSE
    INSERT INTO public.memberships (org_id, customer_id, tier_id, notes)
    VALUES (v_org_id, v_customer_id, v_tier.id, 'Demo account — seeded for /account walkthrough')
    RETURNING id INTO v_membership_id;

    -- Deposit crosses the tier threshold -> trigger activates the membership.
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, payment_mode, notes)
    VALUES (v_membership_id, v_org_id, 'deposit', v_tier.advance_amount, 'Cash', 'Initial enrollment deposit (demo seed)');

    -- Partial spend, so the demo shows a real remaining balance, not just a full one.
    INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, payment_mode, notes)
    VALUES (v_membership_id, v_org_id, 'deduction', -(v_tier.advance_amount * 0.3), 'Membership', 'Applied to a past booking (demo seed)');
  END IF;

  -- ----------------------------------------------------------
  -- 6. Voucher: unused, full balance, not expired
  -- ----------------------------------------------------------
  SELECT id, code_prefix, standard_price INTO v_vtype
    FROM public.voucher_types WHERE org_id = v_org_id ORDER BY display_order LIMIT 1;

  IF v_vtype IS NULL THEN
    RAISE NOTICE 'No voucher_types found for this org — skipping voucher seed (VOUCHER_ENABLED may be off here).';
  ELSE
    -- Keyed by code_prefix (not voucher_type_id) — matches issue_voucher()'s
    -- current shared-sequence-per-prefix design (migration-089+).
    INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
    VALUES (v_org_id, v_branch_id, v_vtype.code_prefix, 2)
    ON CONFLICT (branch_id, code_prefix)
      DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
    RETURNING next_number - 1 INTO v_seq;

    v_voucher_code := v_vtype.code_prefix || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.vouchers (
      org_id, branch_id, voucher_type_id, voucher_code, issued_date, expiry_date,
      guest_name, guest_info, actual_price, discount_percent, total_amount_issued,
      remarks, customer_id
    ) VALUES (
      v_org_id, v_branch_id, v_vtype.id, v_voucher_code,
      CURRENT_DATE - 10, CURRENT_DATE + 80,
      v_full_name, v_phone, v_vtype.standard_price, 0, v_vtype.standard_price,
      'Demo seed — unused voucher for /account walkthrough', v_customer_id
    )
    RETURNING id INTO v_voucher_id;

    -- voucher_payments (recorded_by NOT NULL) — full tender, matching issue_voucher()'s
    -- requirement that tenders sum to the voucher total.
    IF v_staff_user_id IS NOT NULL THEN
      INSERT INTO public.voucher_payments (voucher_id, org_id, branch_id, amount, payment_mode, recorded_by, notes)
      VALUES (v_voucher_id, v_org_id, v_branch_id, v_vtype.standard_price, 'Cash', v_staff_user_id, 'Demo seed — voucher purchase');
    END IF;
  END IF;

  -- ----------------------------------------------------------
  -- 7. Referral: this customer referred a friend, reward already credited
  -- ----------------------------------------------------------
  INSERT INTO public.customers (org_id, branch_id, full_name, phone, email)
  VALUES (v_org_id, v_branch_id, 'Referred Friend (Demo)', '+977-9800000098', 'demo2.friend@zunkireelabs.com')
  RETURNING id INTO v_friend_customer_id;

  -- The friend's booking that earned the reward: must be Completed + paid,
  -- referenced 1:1 by customer_referrals.booking_id.
  v_friend_booking_id := NULL;
  <<friend_booking>>
  DECLARE
  BEGIN
    FOREACH v_r IN ARRAY v_room_ids LOOP
      FOREACH v_t IN ARRAY v_times LOOP
        BEGIN
          INSERT INTO public.bookings (
            branch_id, room_id, service_id, therapist_id,
            customer_name, customer_email, customer_phone, customer_gender, customer_id,
            date, start_time, status, payment_status, base_amount, discount_amount,
            service_name_snapshot, service_duration_snapshot, service_price_snapshot,
            therapist_name_snapshot, room_name_snapshot
          ) VALUES (
            v_branch_id, v_r, v_svc1.id, v_therapist.id,
            'Referred Friend (Demo)', 'demo2.friend@zunkireelabs.com', '+977-9800000098', 'Male', v_friend_customer_id,
            CURRENT_DATE - 2, v_t, 'Completed', 'paid', v_svc1.price_npr, 0,
            v_svc1.name, v_svc1.duration_minutes, v_svc1.price_npr,
            v_therapist.name, (SELECT name FROM public.rooms WHERE id = v_r)
          ) RETURNING id INTO v_friend_booking_id;
          EXIT friend_booking;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION 'Could not find a free room/time slot for the referred friend''s booking.';
  END friend_booking;

  IF v_staff_user_id IS NOT NULL THEN
    INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
    VALUES (v_friend_booking_id, v_svc1.price_npr, 'Cash', v_staff_user_id, 'Demo seed — referred friend''s completed booking');
  ELSE
    RAISE NOTICE 'No staff user found for this org — skipping payments row (booking.payment_status is already ''paid'').';
  END IF;

  SELECT COALESCE(referral_reward_amount, 500) INTO v_reward_amount
    FROM public.organizations WHERE id = v_org_id;

  INSERT INTO public.customer_referrals (
    org_id, referring_customer_id, referred_customer_id, booking_id,
    reward_status, reward_amount, reward_type, credited_at, notes
  ) VALUES (
    v_org_id, v_customer_id, v_friend_customer_id, v_friend_booking_id,
    'credited', v_reward_amount, 'wallet', now(),
    'Demo seed — referral reward already credited for /account walkthrough'
  )
  RETURNING id INTO v_referral_id;

  INSERT INTO public.customer_referral_credits (org_id, referral_id, customer_id, amount)
  VALUES (v_org_id, v_referral_id, v_customer_id, v_reward_amount);

  RAISE NOTICE 'Demo customer account seeded: % / % (customer_id=%, account_id=%)',
    v_email, v_password, v_customer_id, v_account_id;
END $$;

COMMIT;
