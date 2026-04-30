-- Add PIN column to users table for quick login
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pin text;

-- Generate unique 4-digit PINs for existing users
UPDATE public.users
SET pin = LPAD(FLOOR(RANDOM() * 10000)::text, 4, '0')
WHERE pin IS NULL;

-- Create PIN verification function (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION verify_pin(p_email text, p_pin text, p_org_slug text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT u.*, o.slug as org_slug
  INTO v_user
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
  WHERE u.email = p_email AND u.pin = p_pin AND u.is_active = true;

  IF v_user IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid email or PIN');
  END IF;

  IF p_org_slug IS NOT NULL AND v_user.org_slug != p_org_slug THEN
    RETURN json_build_object('valid', false, 'error', 'User does not belong to this organization');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'user_id', v_user.id,
    'email', v_user.email,
    'role', v_user.role,
    'full_name', v_user.full_name
  );
END;
$$;

-- Allow anon to call verify_pin (needed for login page)
GRANT EXECUTE ON FUNCTION verify_pin(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION verify_pin(text, text, text) TO authenticated;
