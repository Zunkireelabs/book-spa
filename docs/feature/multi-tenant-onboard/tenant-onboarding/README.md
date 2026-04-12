# Tenant Onboarding Guide

This guide explains how to onboard a new tenant (organization) to BookSpa.

---

## Overview

BookSpa uses organization-level multi-tenancy. Each tenant has:
- Isolated data (services, bookings, customers)
- Own branches, rooms, and therapists
- Separate admin users
- RLS-enforced data isolation at database level

---

## Prerequisites

Before onboarding a new tenant:

- [ ] Tenant has signed contract/agreement
- [ ] Tenant data collected using [TENANT_DATA_TEMPLATE.md](./TENANT_DATA_TEMPLATE.md)
- [ ] Unique organization code confirmed (3 letters)
- [ ] Admin user email ready for authentication

---

## Onboarding Process

### Step 1: Collect Tenant Data

Use the [TENANT_DATA_TEMPLATE.md](./TENANT_DATA_TEMPLATE.md) to gather:
- Organization details (name, code, slug, email)
- Branch information
- Room list
- Therapist roster
- Service catalog decision (template or custom)
- Admin user details

### Step 2: Run Onboarding Script

1. Open Supabase SQL Editor (Dashboard > SQL Editor)

2. Copy the script from `/scripts/onboard-tenant.sql`

3. Replace configuration values at the top:
   ```sql
   \set org_name 'Serenity Wellness Spa'
   \set org_code 'SWS'
   \set org_slug 'serenity-wellness'
   \set owner_email 'admin@serenitywellness.com'
   \set timezone 'Asia/Kathmandu'
   \set currency 'NPR'
   \set branch_name 'Main Branch'
   \set branch_address '123 Thamel Street'
   \set branch_phone '+977-1-4123456'
   ```

4. Run the script

5. Save the output IDs:
   - `Organization ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - `Branch ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

### Step 3: Create Admin User

1. **Supabase Auth Signup**
   - Go to Supabase Dashboard > Authentication > Users
   - Click "Add User" > "Create New User"
   - Enter admin email and temporary password
   - Copy the generated `User UID`

2. **Insert User Record**
   ```sql
   INSERT INTO users (id, email, full_name, role, org_id, branch_id, is_active)
   VALUES (
     'AUTH_USER_UUID',           -- From Supabase Auth
     'admin@serenitywellness.com',
     'Admin Name',
     'admin',
     'ORG_ID',                   -- From Step 2
     'BRANCH_ID',                -- From Step 2
     true
   );
   ```

### Step 4: Add Rooms

```sql
INSERT INTO rooms (branch_id, name, is_active)
VALUES
  ('BRANCH_ID', 'VIP Suite 1', true),
  ('BRANCH_ID', 'VIP Suite 2', true),
  ('BRANCH_ID', 'Treatment Room 1', true),
  ('BRANCH_ID', 'Treatment Room 2', true);
```

### Step 5: Add Therapists

```sql
INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
VALUES
  ('BRANCH_ID', 'Maya Tamang', 'Female', ARRAY['Massage', 'Thai'], true),
  ('BRANCH_ID', 'Sita Gurung', 'Female', ARRAY['Facial', 'Waxing'], true),
  ('BRANCH_ID', 'Ram Thapa', 'Male', ARRAY['Massage', 'Deep Tissue'], true);
```

### Step 6: Add Services (If Custom)

If not using template services, add custom services:

```sql
INSERT INTO services (name, duration_minutes, price_npr, category, org_id, is_active)
VALUES
  ('Swedish Massage', 60, 3500, 'Spa', 'ORG_ID', true),
  ('Deep Tissue Massage', 90, 5000, 'Spa', 'ORG_ID', true),
  ('Basic Facial', 45, 2500, 'Facial', 'ORG_ID', true);
```

---

## Post-Onboarding Verification

Run these queries to verify setup:

```sql
-- Check organization
SELECT id, name, code, slug, is_active
FROM organizations
WHERE code = 'SWS';

-- Check branch
SELECT id, name, org_id, is_active
FROM branches
WHERE org_id = 'ORG_ID';

-- Count rooms
SELECT COUNT(*) as room_count
FROM rooms r
JOIN branches b ON r.branch_id = b.id
WHERE b.org_id = 'ORG_ID';

-- Count therapists
SELECT COUNT(*) as therapist_count
FROM therapists t
JOIN branches b ON t.branch_id = b.id
WHERE b.org_id = 'ORG_ID';

-- Count services
SELECT COUNT(*) as service_count
FROM services
WHERE org_id = 'ORG_ID';

-- Check admin user
SELECT id, email, role, org_id, branch_id
FROM users
WHERE org_id = 'ORG_ID';
```

---

## Admin Login Test

1. Have admin login at the app URL
2. Verify they see only their organization's data:
   - Correct branch name in header
   - Only their rooms in room list
   - Only their therapists
   - Only their services
3. Create a test booking
4. Verify booking appears correctly

---

## Troubleshooting

### Admin can't see any data
- Verify `org_id` matches in `users` table
- Check RLS policies are active
- Confirm `branch_id` is set correctly

### Services not showing
- Verify services have correct `org_id`
- Check `is_active = true`

### Cross-tenant data visible
- CRITICAL: Check RLS policies
- Verify `get_user_org_id()` function exists
- Check user's `org_id` in users table

---

## Rollback (If Needed)

If onboarding fails and needs rollback:

```sql
-- Delete in reverse order due to foreign keys
DELETE FROM services WHERE org_id = 'ORG_ID';
DELETE FROM service_categories WHERE org_id = 'ORG_ID';
DELETE FROM therapists WHERE branch_id IN (SELECT id FROM branches WHERE org_id = 'ORG_ID');
DELETE FROM rooms WHERE branch_id IN (SELECT id FROM branches WHERE org_id = 'ORG_ID');
DELETE FROM users WHERE org_id = 'ORG_ID';
DELETE FROM branches WHERE org_id = 'ORG_ID';
DELETE FROM organizations WHERE id = 'ORG_ID';
```

---

## Current Tenants

| Org Name | Code | Slug | Status |
|----------|------|------|--------|
| Nuad Thai Spa | NTS | nuad-thai-spa | Active |

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/onboard-tenant.sql` | SQL onboarding script |
| `docs/tenant-onboarding/TENANT_DATA_TEMPLATE.md` | Data collection template |
| `docs/tenant-onboarding/README.md` | This guide |

---

## Support

For issues during onboarding, check:
1. Supabase logs (Dashboard > Logs)
2. RLS policy advisors (Dashboard > Database > Advisors)
3. Contact: @sthasadin
