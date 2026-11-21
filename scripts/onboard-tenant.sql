-- ============================================================
-- Tenant onboarding (ZNLY-354): one safe, idempotent script for EVERY industry.
-- ============================================================
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--     -v org_name='Sami''s Spa' -v org_code=SAMI -v org_slug=samis-spa -v owner_email=owner@example.com \
--     -v industry_type=spa -v branch_name='Main Branch' -v branch_address='Kathmandu' -v branch_phone='+977-1-0000000' \
--     -f scripts/onboard-tenant.sql
--
-- Required: org_name, org_code, org_slug, industry_type. Optional (defaults in brackets): owner_email [none],
-- timezone [Asia/Kathmandu], currency [NPR], branch_name [Main Branch], branch_address, branch_phone,
-- advance_booking_days [90].
--
-- What it guarantees
--   * industry_type is looked up in the industries table (spa, salon, beauty, cleaning and any added later);
--     the error lists the valid ids. Rooms steps follow industries.enable_rooms (beauty and cleaning have none).
--   * Resolves everything by slug / name / email, never by a hard-coded UUID. Re-running changes nothing that exists:
--     the org, branch, categories and owner login are only created when missing; the safety switches of an EXISTING org
--     are never touched (a re-run only REPORTS a switch that is unsafe).
--   * Safe defaults for every per-org setting of a NEW org:
--       organizations.enforce_staff_availability = true   (the column default is false = leave/off-day/other-branch checks OFF)
--       organizations.marketplace_booking_enabled / marketplace_lookup_enabled / marketplace_contact_sync_enabled = false
--       branches.advance_booking_days = 90                (NULL would mean "book any date, forever")
--       branches.online_booking_capacity left NULL        (no cap until the owner sets one: set it per branch when known)
--       late_grace_minutes 10, open_checkout_hours 4, expect_check_in false (column defaults, reporting only)
--     The therapist double-booking rule (migration 414) is unconditional: no switch turns it off.
--   * Nothing is exposed to the marketplace: it stays OFF until marketplace_go_live() is run, which refuses while the
--     readiness report below lists blockers.
--   * Ends by printing the readiness report (marketplace_readiness_blockers, migration 413).
--
-- Never run on a database you have not meant to change: it INSERTs. Run it on staging first, then on prod.
-- ============================================================

\set ON_ERROR_STOP on
\set QUIET on

-- ---- inputs (defaults for the optional ones) ----
\if :{?org_name}
\else
  \echo 'ERROR: pass -v org_name=... -v org_code=... -v org_slug=... -v industry_type=...'
  \quit 3
\endif
\if :{?org_code}
\else
  \echo 'ERROR: org_code is required'
  \quit 3
\endif
\if :{?org_slug}
\else
  \echo 'ERROR: org_slug is required'
  \quit 3
\endif
\if :{?industry_type}
\else
  \echo 'ERROR: industry_type is required (see: select id from industries)'
  \quit 3
\endif
\if :{?owner_email}
\else
  \set owner_email ''
\endif
\if :{?timezone}
\else
  \set timezone 'Asia/Kathmandu'
\endif
\if :{?currency}
\else
  \set currency 'NPR'
\endif
\if :{?branch_name}
\else
  \set branch_name 'Main Branch'
\endif
\if :{?branch_address}
\else
  \set branch_address ''
\endif
\if :{?branch_phone}
\else
  \set branch_phone ''
\endif
\if :{?advance_booking_days}
\else
  \set advance_booking_days 90
\endif

-- psql does not substitute :'vars' inside $$ bodies, so hand them over as session settings.
SELECT set_config('onboard.org_name', :'org_name', false),
       set_config('onboard.org_code', :'org_code', false),
       set_config('onboard.org_slug', lower(:'org_slug'), false),
       set_config('onboard.industry', :'industry_type', false),
       set_config('onboard.owner_email', lower(:'owner_email'), false),
       set_config('onboard.timezone', :'timezone', false),
       set_config('onboard.currency', :'currency', false),
       set_config('onboard.branch_name', :'branch_name', false),
       set_config('onboard.branch_address', :'branch_address', false),
       set_config('onboard.branch_phone', :'branch_phone', false),
       set_config('onboard.advance_days', :'advance_booking_days', false) \gset _

\set QUIET off
BEGIN;

DO $onboard$
DECLARE
  v_slug     text := current_setting('onboard.org_slug');
  v_industry record;
  v_org      public.organizations%ROWTYPE;
  v_branch   uuid;
  v_new_org  boolean := false;
  v_n        int;
  v_cat      text;
  v_i        int := 0;
  v_auth     uuid;
  v_ids      text;
BEGIN
  -- 1. industry must exist (resolved by id from the industries table)
  SELECT * INTO v_industry FROM public.industries WHERE id = current_setting('onboard.industry');
  IF NOT FOUND THEN
    SELECT string_agg(id, ', ' ORDER BY id) INTO v_ids FROM public.industries;
    RAISE EXCEPTION 'Unknown industry_type "%". Valid: %', current_setting('onboard.industry'), v_ids;
  END IF;

  -- 2. organization: create when missing (by slug), never modify an existing one
  SELECT * INTO v_org FROM public.organizations WHERE slug = v_slug;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.organizations WHERE code = current_setting('onboard.org_code')) THEN
      RAISE EXCEPTION 'org_code "%" is already used by another business', current_setting('onboard.org_code');
    END IF;
    INSERT INTO public.organizations (name, code, slug, owner_email, timezone, currency, industry_type, settings,
                                      enforce_staff_availability, marketplace_booking_enabled,
                                      marketplace_lookup_enabled, marketplace_contact_sync_enabled)
    VALUES (current_setting('onboard.org_name'), current_setting('onboard.org_code'), v_slug,
            NULLIF(current_setting('onboard.owner_email'), ''), current_setting('onboard.timezone'),
            current_setting('onboard.currency'), v_industry.id, '{}'::jsonb,
            true, false, false, false)
    RETURNING * INTO v_org;
    v_new_org := true;
    RAISE NOTICE 'Created organization % (%): industry %', v_org.name, v_org.slug, v_industry.id;
  ELSE
    RAISE NOTICE 'Organization % already exists: left unchanged (industry %)', v_org.slug, v_org.industry_type;
    IF v_org.industry_type IS DISTINCT FROM v_industry.id THEN
      RAISE NOTICE 'WARNING: existing industry is %, you asked for %: not changed', v_org.industry_type, v_industry.id;
    END IF;
  END IF;

  -- 3. first branch: by (org, name)
  SELECT id INTO v_branch FROM public.branches WHERE org_id = v_org.id AND name = current_setting('onboard.branch_name');
  IF v_branch IS NULL THEN
    INSERT INTO public.branches (name, address, phone, org_id, is_active, timezone, advance_booking_days)
    VALUES (current_setting('onboard.branch_name'), NULLIF(current_setting('onboard.branch_address'), ''),
            NULLIF(current_setting('onboard.branch_phone'), ''), v_org.id, true, v_org.timezone,
            current_setting('onboard.advance_days')::int)
    RETURNING id INTO v_branch;
    RAISE NOTICE 'Created branch %', current_setting('onboard.branch_name');
  ELSE
    RAISE NOTICE 'Branch % already exists: left unchanged', current_setting('onboard.branch_name');
  END IF;

  -- 4. service categories + product categories from the industry defaults (only the missing ones)
  FOR v_cat IN SELECT jsonb_array_elements_text(v_industry.default_categories) LOOP
    v_i := v_i + 1;
    INSERT INTO public.service_categories (name, org_id, display_order, is_active)
    VALUES (v_cat, v_org.id, v_i, true) ON CONFLICT (org_id, name) DO NOTHING;
  END LOOP;
  v_i := 0;
  FOR v_cat IN SELECT jsonb_array_elements_text(COALESCE(v_industry.default_product_categories, '[]'::jsonb)) LOOP
    v_i := v_i + 1;
    INSERT INTO public.product_categories (org_id, name, display_order, is_active)
    VALUES (v_org.id, v_cat, v_i, true) ON CONFLICT (org_id, name) DO NOTHING;
  END LOOP;

  -- 5. owner login: only when the owner already signed up in Supabase Auth (resolved by email)
  IF current_setting('onboard.owner_email') <> '' THEN
    SELECT id INTO v_auth FROM auth.users WHERE lower(email) = current_setting('onboard.owner_email') LIMIT 1;
    IF v_auth IS NULL THEN
      RAISE NOTICE 'Owner % has no Supabase Auth account yet: create it, then re-run this script', current_setting('onboard.owner_email');
    ELSIF EXISTS (SELECT 1 FROM public.users WHERE id = v_auth) THEN
      RAISE NOTICE 'Owner login already exists: left unchanged';
    ELSE
      INSERT INTO public.users (id, email, full_name, role, org_id, branch_id, is_active)
      VALUES (v_auth, current_setting('onboard.owner_email'), split_part(current_setting('onboard.owner_email'), '@', 1),
              'admin', v_org.id, v_branch, true);
      RAISE NOTICE 'Created admin login for %', current_setting('onboard.owner_email');
    END IF;
  END IF;

  -- 6. an existing org is never changed, but an unsafe switch is shouted about
  IF NOT v_new_org THEN
    IF NOT v_org.enforce_staff_availability THEN
      RAISE NOTICE 'WARNING: % has enforce_staff_availability OFF (leave, day-off and other-branch checks do not run). Turn it on with set_enforce_staff_availability (migration 357) unless the owner chose this.', v_org.slug;
    END IF;
    IF v_org.marketplace_booking_enabled THEN
      RAISE NOTICE 'NOTE: % is switched ON for marketplace booking', v_org.slug;
    END IF;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS for % (% , rooms: %):', v_org.slug, v_industry.name, v_industry.enable_rooms;
  RAISE NOTICE '  1. Admin login exists (above) or create it in Supabase Auth and re-run.';
  RAISE NOTICE '  2. Set organizations.logo_url / hero_image_url and branches.photo_url (customer page branding).';
  IF v_industry.enable_rooms THEN
    RAISE NOTICE '  3. Add % (rooms) to the branch, then % and services.', v_industry.location_label_plural, v_industry.staff_label_plural;
  ELSE
    RAISE NOTICE '  3. Add % and services (this industry has no rooms).', v_industry.staff_label_plural;
  END IF;
  RAISE NOTICE '  4. Marketplace stays OFF; run marketplace_go_live() only when the readiness report below is empty.';
END
$onboard$;

COMMIT;

-- ---- readiness report (migration 413): empty blockers = ready to go live ----
\pset format aligned
\pset null '-'
SELECT o.slug,
       o.industry_type,
       o.enforce_staff_availability AS availability_rule,
       o.marketplace_booking_enabled AS marketplace_on,
       public.marketplace_readiness_blockers(o.id) AS blockers,
       public.marketplace_status(o.slug) AS status
  FROM public.organizations o
 WHERE o.slug = lower(:'org_slug');
