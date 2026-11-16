-- Migration 314: group-booking stuck-rollback staff alert
--
-- submitGroupBooking (api.js) creates each person's booking row independently
-- and best-effort cancels the whole group via public_cancel_booking_group if
-- one person's booking fails mid-loop. If that cancel ALSO fails, the group is
-- left in a partial state with no automatic recovery -- the customer is told
-- to contact the branch, but nothing actually alerts the branch. This RPC lets
-- the (anonymous) customer-booking client flag that failure so branch staff
-- see it as an in-app notification instead of relying on the customer to call
-- in. Called from an anon session, so it must be SECURITY DEFINER and must not
-- trust any input beyond validating the branch is real.

CREATE OR REPLACE FUNCTION public.public_report_booking_group_failure(
  p_branch_id uuid,
  p_booking_group_id text,
  p_people_count integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_branch_name text;
  v_notified integer := 0;
  v_recipient record;
BEGIN
  SELECT org_id, name INTO v_org_id, v_branch_name
  FROM public.branches
  WHERE id = p_branch_id AND is_active = true;

  IF v_org_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Branch-specific manager/admins, plus org-wide ones (branch_id IS NULL) --
  -- same reach as who can already see this branch's bookings in staff tools.
  FOR v_recipient IN
    SELECT id FROM public.users
    WHERE org_id = v_org_id
      AND role IN ('manager', 'admin')
      AND (branch_id = p_branch_id OR branch_id IS NULL)
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, booking_id)
    VALUES (
      v_recipient.id,
      'booking_group_stuck',
      'Group booking needs attention',
      format(
        '%s: a %s-person group booking could not be fully booked or released. Check the calendar and release any held slots manually.',
        COALESCE(v_branch_name, 'Branch'),
        GREATEST(p_people_count, 1)
      ),
      NULL
    );
    v_notified := v_notified + 1;
  END LOOP;

  RETURN v_notified;
END;
$$;

REVOKE ALL ON FUNCTION public.public_report_booking_group_failure(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_report_booking_group_failure(uuid, text, integer) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('314', 'group-booking-failure-alert')
ON CONFLICT (version) DO NOTHING;
