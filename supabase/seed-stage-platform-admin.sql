-- supabase/seed-stage-platform-admin.sql
-- Grants platform-admin to an existing auth user, by email. Idempotent.
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'platform@zunkireelabs.com'
ON CONFLICT (user_id) DO NOTHING;
