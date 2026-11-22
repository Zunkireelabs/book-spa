-- LOCAL scratch DBs only. Nuad-sized SYNTHETIC rows (made up, no real data) for the lock-time test: one spa org (slug synth-spa) with
-- 8 therapists, 20 services, 3,000 customers, 9,828 bookings and ~9,000 payments. Triggers are skipped with session_replication_role (scratch only).
SET session_replication_role = replica;
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_br uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations (id, name, code, slug, industry_type) VALUES (v_org, 'Synthetic Spa', 'SYN', 'synth-spa', 'spa');
  INSERT INTO branches (id, name, org_id, open_time, close_time) VALUES (v_br, 'Main', v_org, '09:00', '20:00');
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_admin, 'authenticated', 'authenticated', 'admin@synth.test');
  INSERT INTO public.users (id, email, full_name, role, org_id, branch_id, is_active) VALUES (v_admin, 'admin@synth.test', 'Synth Admin', 'admin', v_org, v_br, true);
  INSERT INTO therapists (branch_id, name, gender, org_id, is_active, is_service_staff) SELECT v_br, 'Therapist ' || g, 'Female', v_org, true, true FROM generate_series(1, 8) g;
  INSERT INTO services (name, duration_minutes, price_npr, org_id, category) SELECT 'Service ' || g, 60, 1000 + g * 100, v_org, 'Cat' FROM generate_series(1, 20) g;
  INSERT INTO customers (branch_id, org_id, full_name, phone) SELECT v_br, v_org, 'Customer ' || g, '+9779' || lpad(g::text, 9, '0') FROM generate_series(1, 3000) g;
  -- 9,828 bookings: therapist = n mod 8, one 60-minute slot each, spread over the previous 400 days, never overlapping per therapist
  INSERT INTO bookings (branch_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, status, payment_status,
                        base_amount, discount_amount, final_amount, service_name_snapshot, service_duration_snapshot, service_price_snapshot, customer_id, created_by)
  SELECT v_br, (SELECT id FROM services WHERE org_id = v_org ORDER BY name LIMIT 1 OFFSET (n % 20)), (SELECT id FROM therapists WHERE org_id = v_org ORDER BY name LIMIT 1 OFFSET (n % 8)),
         'Customer ' || (n % 3000 + 1), '+9779' || lpad((n % 3000 + 1)::text, 9, '0'), d, t, t + interval '60 minutes', (d + t) AT TIME ZONE 'Asia/Kathmandu', (d + t + interval '60 minutes') AT TIME ZONE 'Asia/Kathmandu',
         'Completed', 'paid', 1000, 0, 1000, 'Service', 60, 1000, (SELECT id FROM customers WHERE org_id = v_org ORDER BY full_name LIMIT 1 OFFSET (n % 3000)), v_admin
  FROM (SELECT n, (current_date - 3 - (n / 24) % 400) AS d, (time '09:00' + ((n % 24) / 8) * interval '60 minutes' + ((n / 8) % 3) * interval '0 minutes') AS t FROM generate_series(1, 9828) n) s;
  INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) SELECT id, 1000, CASE WHEN random() < .6 THEN 'Cash' ELSE 'Visa' END, v_admin FROM bookings WHERE branch_id = v_br LIMIT 9000;
END $$;
SET session_replication_role = DEFAULT;
