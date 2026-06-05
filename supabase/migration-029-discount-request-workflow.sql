-- Migration 029: discount request workflow
-- Tracks WHO requested an over-limit discount and WHICH manager/admin it was
-- sent to, so staff can route a request to a specific approver by name.
--
-- Also adds a SECURITY DEFINER function so a staff user (who, under RLS, can
-- only read their own row in `users`) can still list the managers/admins they
-- are allowed to request approval from.

-- 1. New audit columns on bookings -------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS discount_requested_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS discount_requested_to uuid REFERENCES public.users(id);

-- Approver only needs to scan the requests targeted to them while pending.
CREATE INDEX IF NOT EXISTS idx_bookings_discount_requested_to
  ON public.bookings(discount_requested_to)
  WHERE discount_status = 'pending';

-- 2. Approver picker source --------------------------------------------------
-- Returns the active managers (same branch) and admins (same org) the caller
-- may send a discount request to. SECURITY DEFINER bypasses the users-table
-- RLS that otherwise hides other users from staff; only id/name/role/branch
-- are exposed.
CREATE OR REPLACE FUNCTION public.list_discount_approvers()
RETURNS TABLE (id uuid, full_name text, role public.user_role, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.full_name, u.role, u.branch_id
  FROM public.users u
  WHERE u.is_active = true
    AND u.id <> auth.uid()
    AND u.org_id = (SELECT org_id FROM public.users WHERE id = auth.uid())
    AND (
      u.role = 'admin'
      OR (u.role = 'manager'
          AND u.branch_id = (SELECT branch_id FROM public.users WHERE id = auth.uid()))
    )
  ORDER BY u.role DESC, u.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_discount_approvers() TO authenticated;

-- 3. Record migration --------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('029', 'discount-request-workflow')
ON CONFLICT (version) DO NOTHING;
