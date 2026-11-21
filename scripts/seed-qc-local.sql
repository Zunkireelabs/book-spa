-- ============================================================
-- Local QC seed for the CP1–CP8 runs (ZNLY-198 step 5.0)
-- LOCAL DB ONLY (127.0.0.1:56422). Idempotent: resolves by slug/email, no hard-coded UUIDs.
-- Run:  psql postgresql://postgres:postgres@127.0.0.1:56422/postgres -v ON_ERROR_STOP=1 -f scripts/seed-qc-local.sql
-- Logins: password qc-local-2026 for every NEW login. PINs below. See temp_ss/local-qc-logins.txt.
-- ============================================================
DO $seed$
DECLARE
  v_pw   constant text := 'qc-local-2026';
  v_org  uuid; v_nuad uuid; v_br uuid; v_nuad_br uuid;
  v_t1 uuid; v_t2 uuid; v_tier_sr uuid; v_tier_jr uuid;
  v_s_fixed uuid; v_s_tier uuid; v_s_addon uuid;
  v_admin uuid; v_cust uuid; v_today date := (now() at time zone 'Asia/Kathmandu')::date;
  r record; d int;
BEGIN
  -- ---------- safety: local DB only ----------
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'nuad-thai-spa')
     OR NOT EXISTS (SELECT 1 FROM users WHERE email LIKE '%@smoke.test' AND role = 'admin') THEN
    RAISE EXCEPTION 'seed-qc-local.sql refuses to run: not the local QC database (needs nuad-thai-spa + a *.test admin; run only against 127.0.0.1:56422)';
  END IF;

  -- ---------- helper: create/refresh a login ----------
  CREATE TEMP TABLE IF NOT EXISTS _qc_login (email text PRIMARY KEY, id uuid) ON COMMIT DROP;
  TRUNCATE _qc_login;

  SELECT id INTO v_nuad FROM organizations WHERE slug = 'nuad-thai-spa';
  SELECT id INTO v_nuad_br FROM branches WHERE org_id = v_nuad ORDER BY created_at LIMIT 1;

  -- ---------- beauty org ----------
  INSERT INTO organizations (name, code, slug, owner_email, industry_type, timezone, currency, settings)
  VALUES ('Sami''s QC Beauty', 'SQC', 'samis-qc', 'admin@samis.test', 'beauty', 'Asia/Kathmandu', 'NPR', '{}')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_org FROM organizations WHERE slug = 'samis-qc';
  UPDATE organizations SET settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object(
      'show_staff_selection', false, 'enable_online_booking', true,
      'billing_enabled', true, 'billing_tax_mode', 'inclusive', 'billing_vat_rate', 13,
      'billing_legal_name', 'Sami''s QC Beauty Pvt. Ltd.', 'billing_pan', '123456789',
      'billing_invoice_prefix', 'SQC', 'billing_address', 'Lazimpat, Kathmandu',
      'billing_phone', '+977-1-5550101', 'billing_email', 'billing@samis.test')
  WHERE id = v_org;

  IF NOT EXISTS (SELECT 1 FROM branches WHERE org_id = v_org) THEN
    INSERT INTO branches (name, address, phone, org_id, open_time, close_time)
    VALUES ('Lazimpat Studio', 'Lazimpat, Kathmandu', '+977-1-5550101', v_org, '09:00', '19:00');
  END IF;
  SELECT id INTO v_br FROM branches WHERE org_id = v_org ORDER BY created_at LIMIT 1;

  FOR d IN 0..6 LOOP
    IF NOT EXISTS (SELECT 1 FROM branch_working_hours WHERE branch_id = v_br AND day_of_week = d) THEN
      INSERT INTO branch_working_hours (branch_id, day_of_week, start_time, end_time, is_day_off)
      VALUES (v_br, d, '09:00', '19:00', false);
    END IF;
  END LOOP;

  -- Beauty has NO rooms/stations (enable_rooms=false); bookings use room_id NULL (mig 388, ZNLY-221).
  -- Clean-up for DBs seeded before 388, which had a hidden "Station 1": detach its bookings, then drop it.
  UPDATE bookings SET room_id = NULL WHERE room_id IN (SELECT id FROM rooms WHERE branch_id = v_br);
  DELETE FROM rooms WHERE branch_id = v_br;

  -- price tiers + services
  INSERT INTO price_tiers (org_id, name, sort_order)
  SELECT v_org, n, o FROM (VALUES ('Senior',1),('Junior',2)) x(n,o)
  WHERE NOT EXISTS (SELECT 1 FROM price_tiers WHERE org_id = v_org AND name = x.n);
  SELECT id INTO v_tier_sr FROM price_tiers WHERE org_id = v_org AND name = 'Senior';
  SELECT id INTO v_tier_jr FROM price_tiers WHERE org_id = v_org AND name = 'Junior';

  INSERT INTO services (org_id, name, duration_minutes, price_npr, category, price_type, requires_therapist)
  SELECT v_org, n, dur, p, 'Eyebrows', pt, true
  FROM (VALUES ('Brow Threading',20,500,'fixed'),('Lash Extensions',90,3000,'tiered')) x(n,dur,p,pt)
  WHERE NOT EXISTS (SELECT 1 FROM services WHERE org_id = v_org AND name = x.n);
  INSERT INTO services (org_id, name, duration_minutes, price_npr, category, price_type, requires_therapist, is_addon)
  SELECT v_org, 'Brow Tint', 10, 300, 'Eyebrows', 'fixed', true, true
  WHERE NOT EXISTS (SELECT 1 FROM services WHERE org_id = v_org AND name = 'Brow Tint');
  SELECT id INTO v_s_fixed FROM services WHERE org_id = v_org AND name = 'Brow Threading';
  SELECT id INTO v_s_tier  FROM services WHERE org_id = v_org AND name = 'Lash Extensions';
  SELECT id INTO v_s_addon FROM services WHERE org_id = v_org AND name = 'Brow Tint';

  INSERT INTO service_tier_prices (service_id, price_tier_id, price_npr)
  SELECT v_s_tier, t, p FROM (VALUES (v_tier_sr, 3500), (v_tier_jr, 2500)) x(t,p)
  WHERE NOT EXISTS (SELECT 1 FROM service_tier_prices WHERE service_id = v_s_tier AND price_tier_id = x.t);
  INSERT INTO service_addons (service_id, addon_service_id, display_order)
  SELECT v_s_fixed, v_s_addon, 0
  WHERE NOT EXISTS (SELECT 1 FROM service_addons WHERE service_id = v_s_fixed AND addon_service_id = v_s_addon);

  -- team members (table is still called therapists)
  INSERT INTO therapists (org_id, branch_id, name, gender, price_tier_id, position)
  SELECT v_org, v_br, n, g, t, 'Beautician'
  FROM (VALUES ('Sami Rai','Female',v_tier_sr),('Tara Gurung','Female',v_tier_jr)) x(n,g,t)
  WHERE NOT EXISTS (SELECT 1 FROM therapists WHERE branch_id = v_br AND name = x.n);
  SELECT id INTO v_t1 FROM therapists WHERE branch_id = v_br AND name = 'Sami Rai';
  SELECT id INTO v_t2 FROM therapists WHERE branch_id = v_br AND name = 'Tara Gurung';
  -- weekly pattern covers this week and next
  FOR r IN SELECT unnest(ARRAY[v_t1, v_t2]) tid LOOP
    FOR d IN 0..6 LOOP
      IF NOT EXISTS (SELECT 1 FROM therapist_working_hours WHERE therapist_id = r.tid AND day_of_week = d) THEN
        INSERT INTO therapist_working_hours (therapist_id, branch_id, day_of_week, start_time, end_time, is_day_off)
        VALUES (r.tid, v_br, d, '09:00', '19:00', d = 6);
      END IF;
    END LOOP;
  END LOOP;

  -- ---------- logins (new orgs' users + extra smoke users) ----------
  -- (email, full_name, role, org, branch, pin, calendar_visibility, can_view_customer_details, can_view_prices)
  FOR r IN SELECT * FROM (VALUES
    ('admin@samis.test',   'Sami Admin',      'admin',        v_org,  v_br,      NULL,   'all', true,  true),
    ('manager@samis.test', 'Maya Manager',    'manager',      v_org,  v_br,      NULL,   'all', true,  true),
    ('staff@samis.test',   'Restricted Staff','staff',        v_org,  v_br,      '4821', 'own', false, false),
    ('nopin@samis.test',   'No-PIN Staff',    'staff',        v_org,  v_br,      NULL,   'all', true,  true),
    ('viewer@samis.test',  'Viewer',          'admin_viewer', v_org,  v_br,      NULL,   'all', true,  true),
    ('manager@smoke.test', 'Smoke Manager',   'manager',      v_nuad, v_nuad_br, NULL,   'all', true,  true),
    ('viewer@smoke.test',  'Smoke Viewer',    'admin_viewer', v_nuad, v_nuad_br, NULL,   'all', true,  true),
    ('restricted@smoke.test','Smoke Restricted','staff',      v_nuad, v_nuad_br, '7305', 'own', false, false)
  ) x(email, name, role, org, br, pin, cv, cd, cp) LOOP
    SELECT id INTO v_admin FROM auth.users WHERE email = r.email;
    IF v_admin IS NULL THEN
      v_admin := gen_random_uuid();
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token)
      VALUES ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', r.email,
        crypt(v_pw, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
      INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (v_admin::text, v_admin, jsonb_build_object('sub', v_admin::text, 'email', r.email), 'email', now(), now(), now());
    END IF;
    INSERT INTO users (id, email, full_name, role, org_id, branch_id, pin, calendar_visibility, can_view_customer_details, can_view_prices)
    VALUES (v_admin, r.email, r.name, r.role::user_role, r.org, r.br, r.pin, r.cv, r.cd, r.cp)
    ON CONFLICT (id) DO UPDATE SET pin = EXCLUDED.pin, role = EXCLUDED.role, calendar_visibility = EXCLUDED.calendar_visibility,
      can_view_customer_details = EXCLUDED.can_view_customer_details, can_view_prices = EXCLUDED.can_view_prices, is_active = true;
    INSERT INTO _qc_login VALUES (r.email, v_admin);
  END LOOP;

  -- a PIN on the existing smoke staff login (the one requested change to an existing row)
  UPDATE users SET pin = '2468' WHERE email = 'staff@smoke.test' AND pin IS DISTINCT FROM '2468';

  -- link the restricted/no-pin staff to the 2 team members so "own bookings" has data
  UPDATE therapists SET user_id = (SELECT id FROM _qc_login WHERE email = 'staff@samis.test') WHERE id = v_t1 AND user_id IS NULL;
  UPDATE therapists SET user_id = (SELECT id FROM _qc_login WHERE email = 'nopin@samis.test') WHERE id = v_t2 AND user_id IS NULL;
  SELECT id INTO v_admin FROM _qc_login WHERE email = 'admin@samis.test';

  -- ---------- membership / voucher / package definitions (not sold) ----------
  INSERT INTO membership_tiers (org_id, name, advance_amount, validity_days, code_prefix)
  SELECT v_org, 'Glow Member', 10000, 365, 'GLW'
  WHERE NOT EXISTS (SELECT 1 FROM membership_tiers WHERE org_id = v_org AND name = 'Glow Member');
  INSERT INTO voucher_types (org_id, name, code_prefix, standard_price, is_wallet)
  SELECT v_org, 'Gift Voucher 2000', 'GV', 2000, false
  WHERE NOT EXISTS (SELECT 1 FROM voucher_types WHERE org_id = v_org AND name = 'Gift Voucher 2000');
  INSERT INTO package_types (org_id, service_id, name, default_sessions, standard_price, validity_days)
  SELECT v_org, v_s_fixed, 'Brow Threading x5', 5, 2000, 180
  WHERE NOT EXISTS (SELECT 1 FROM package_types WHERE org_id = v_org AND name = 'Brow Threading x5');

  -- ---------- bookings (only if the org has none) ----------
  IF NOT EXISTS (SELECT 1 FROM bookings WHERE branch_id = v_br) THEN
    INSERT INTO customers (org_id, branch_id, full_name, phone) VALUES (v_org, v_br, 'Anita Karki', '9800000001') RETURNING id INTO v_cust;
    FOR r IN SELECT * FROM (VALUES
      (0, '09:30'::time, 'Anita Karki',  v_s_fixed, 'Confirmed',   500,  'unpaid', 0,    v_t1),
      (0, '11:00'::time, 'Bina Shrestha',v_s_fixed, 'In-Progress', 500,  'unpaid', 0,    v_t2),
      (0, '12:30'::time, 'Chhori Lama',  v_s_fixed, 'Completed',   500,  'paid',   500,  v_t1),
      (0, '14:00'::time, 'Dolma Sherpa', v_s_tier,  'Confirmed',   3500, 'partial',1000, v_t1),
      (1, '10:00'::time, 'Eka Tamang',   v_s_tier,  'Confirmed',   2500, 'unpaid', 0,    v_t2)
    ) x(dayoff, st, cname, sid, stat, amt, pstat, paid, tid) LOOP
      WITH b AS (
        INSERT INTO bookings (branch_id, room_id, service_id, therapist_id, customer_name, customer_phone, customer_id, date,
          start_time, end_time, start_datetime, end_datetime, status, payment_status, base_amount, final_amount,
          service_name_snapshot, therapist_name_snapshot, created_by)
        SELECT v_br, NULL, r.sid, r.tid, r.cname, '98000000' || lpad((random()*99)::int::text,2,'0'), CASE WHEN r.cname='Anita Karki' THEN v_cust END,
          v_today + r.dayoff, r.st, r.st + (s.duration_minutes || ' minutes')::interval,
          ((v_today + r.dayoff + r.st) at time zone 'Asia/Kathmandu'),
          ((v_today + r.dayoff + r.st + (s.duration_minutes || ' minutes')::interval) at time zone 'Asia/Kathmandu'),
          r.stat::booking_status, r.pstat, r.amt, r.amt, s.name,
          (SELECT name FROM therapists WHERE id = r.tid), v_admin
        FROM services s WHERE s.id = r.sid
        RETURNING id)
      INSERT INTO payments (booking_id, amount, payment_mode, recorded_by)
      SELECT b.id, r.paid, 'Cash', v_admin FROM b WHERE r.paid > 0;
    END LOOP;
  END IF;

  -- one waitlist entry
  IF NOT EXISTS (SELECT 1 FROM waitlist_entries WHERE org_id = v_org) THEN
    INSERT INTO waitlist_entries (org_id, branch_id, customer_name, customer_phone, service_id, preferred_date, notes)
    VALUES (v_org, v_br, 'Fiona Magar', '9800000099', v_s_fixed, v_today + 1, 'QC waitlist entry');
  END IF;

  RAISE NOTICE 'seed-qc-local: done (org %, branch %)', v_org, v_br;
END
$seed$;
