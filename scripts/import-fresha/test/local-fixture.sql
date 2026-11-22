-- LOCAL TEST DB ONLY: an admin login for the importing user + flip the two org flags for the test org (slug samis).
INSERT INTO auth.users (id, aud, role, email) VALUES ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','admin@samis-import.test') ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, email, full_name, role, org_id, branch_id, is_active)
SELECT '11111111-1111-4111-8111-111111111111','admin@samis-import.test','Import Admin','admin',o.id,b.id,true
FROM organizations o JOIN branches b ON b.org_id=o.id WHERE o.slug='samis' ON CONFLICT DO NOTHING;
UPDATE organizations SET allow_staff_overlap = true, require_customer_phone = false WHERE slug='samis';
UPDATE branches SET open_time='09:00', close_time='20:00' WHERE org_id=(SELECT id FROM organizations WHERE slug='samis');
