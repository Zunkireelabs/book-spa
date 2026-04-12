# Tenant Onboarding Guide

This guide explains how to onboard a new tenant (organization) to BookSpa.

---

## Overview

BookSpa uses organization-level multi-tenancy with **industry-based configuration**. Each tenant has:
- Isolated data (services, bookings, customers)
- Industry-specific features and terminology
- Own branches, staff, and (optionally) rooms
- Separate admin users
- RLS-enforced data isolation at database level

---

## Supported Industries

| Industry | Staff Term | Location Term | Rooms? | Service Categories |
|----------|------------|---------------|--------|-------------------|
| **spa** | Therapist | Room | Yes | Spa, Salon, Facial, Wellness, etc. |
| **cleaning** | Crew Member | Job Site | No | Residential, Commercial, Deep Clean, etc. |
| **salon** | Stylist | Station | Yes | Haircut, Hair Color, Styling, etc. |

---

## Prerequisites

Before onboarding a new tenant:

- [ ] Tenant has signed contract/agreement
- [ ] Tenant data collected using [TENANT_DATA_TEMPLATE.md](./TENANT_DATA_TEMPLATE.md)
- [ ] **Industry type determined** (spa, cleaning, or salon)
- [ ] Unique organization code confirmed (3 letters)
- [ ] Admin user email ready for authentication

---

## Onboarding Process

### Step 1: Collect Tenant Data

Use the [TENANT_DATA_TEMPLATE.md](./TENANT_DATA_TEMPLATE.md) to gather:
- Organization details (name, code, slug, email)
- **Industry type** (spa, cleaning, salon)
- Branch information
- Staff roster (therapists/crew/stylists)
- Room list (if applicable for industry)
- Service catalog
- Admin user details

### Step 2: Run Onboarding Script

1. Open Supabase SQL Editor (Dashboard > SQL Editor)

2. Copy the script from `/scripts/onboard-tenant.sql`

3. Replace configuration values at the top:

   **For Spa Industry:**
   ```sql
   \set org_name 'Serenity Wellness Spa'
   \set org_code 'SWS'
   \set org_slug 'serenity-wellness'
   \set owner_email 'admin@serenitywellness.com'
   \set industry_type 'spa'
   \set timezone 'Asia/Kathmandu'
   \set currency 'NPR'
   \set branch_name 'Main Branch'
   \set branch_address '123 Thamel Street'
   \set branch_phone '+977-1-4123456'
   ```

   **For Cleaning Industry:**
   ```sql
   \set org_name 'Khems Cleaning'
   \set org_code 'KC'
   \set org_slug 'khems-cleaning'
   \set owner_email 'admin@khemscleaning.com'
   \set industry_type 'cleaning'
   \set timezone 'Asia/Kathmandu'
   \set currency 'NPR'
   \set branch_name 'Main Office'
   \set branch_address 'Kathmandu, Nepal'
   \set branch_phone '+977-1-5555555'
   ```

4. Run the script

5. Save the output IDs:
   - `Organization ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - `Branch ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - `Industry: Cleaning Services (cleaning)`

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
     'admin@khemscleaning.com',
     'Admin Name',
     'admin',
     'ORG_ID',                   -- From Step 2
     'BRANCH_ID',                -- From Step 2
     true
   );
   ```

### Step 4: Add Rooms/Locations (Industry-Dependent)

**For Spa/Salon industries only.** Skip for cleaning.

```sql
-- Spa example
INSERT INTO rooms (branch_id, name, is_active)
VALUES
  ('BRANCH_ID', 'VIP Suite 1', true),
  ('BRANCH_ID', 'Treatment Room 1', true);

-- Salon example
INSERT INTO rooms (branch_id, name, is_active)
VALUES
  ('BRANCH_ID', 'Station 1', true),
  ('BRANCH_ID', 'Station 2', true);
```

### Step 5: Add Staff

Uses `therapists` table for all industries (different terminology in UI).

**Spa:**
```sql
INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
VALUES
  ('BRANCH_ID', 'Maya Tamang', 'Female', ARRAY['Massage', 'Thai'], true),
  ('BRANCH_ID', 'Ram Thapa', 'Male', ARRAY['Deep Tissue'], true);
```

**Cleaning:**
```sql
INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
VALUES
  ('BRANCH_ID', 'Team Alpha', 'Male', ARRAY['Residential', 'Deep Clean'], true),
  ('BRANCH_ID', 'Team Beta', 'Female', ARRAY['Commercial', 'Office'], true);
```

**Salon:**
```sql
INSERT INTO therapists (branch_id, name, gender, specialties, is_active)
VALUES
  ('BRANCH_ID', 'Maya Gurung', 'Female', ARRAY['Haircut', 'Color'], true);
```

### Step 6: Add Services

Service categories are auto-seeded from industry defaults. Add services matching those categories.

**Spa:**
```sql
INSERT INTO services (name, duration_minutes, price_npr, category, org_id, is_active)
VALUES
  ('Swedish Massage', 60, 3500, 'Spa', 'ORG_ID', true),
  ('Basic Facial', 45, 2500, 'Facial', 'ORG_ID', true);
```

**Cleaning:**
```sql
INSERT INTO services (name, duration_minutes, price_npr, category, org_id, is_active)
VALUES
  ('Regular Home Cleaning', 120, 3000, 'Residential', 'ORG_ID', true),
  ('Deep Clean', 240, 8000, 'Deep Clean', 'ORG_ID', true),
  ('Office Cleaning', 180, 5000, 'Commercial', 'ORG_ID', true);
```

---

## Post-Onboarding Verification

Run these queries to verify setup:

```sql
-- Check organization with industry
SELECT id, name, code, industry_type, is_active
FROM organizations
WHERE code = 'KC';

-- Check branch
SELECT id, name, org_id, is_active
FROM branches
WHERE org_id = 'ORG_ID';

-- Check service categories (should match industry)
SELECT name, display_order
FROM service_categories
WHERE org_id = 'ORG_ID'
ORDER BY display_order;

-- Count staff
SELECT COUNT(*) as staff_count
FROM therapists t
JOIN branches b ON t.branch_id = b.id
WHERE b.org_id = 'ORG_ID';

-- Check industry config
SELECT id, name, staff_label, enable_rooms
FROM industries
WHERE id = 'cleaning';
```

---

## Admin Login Test

1. Have admin login at the app URL
2. Verify they see only their organization's data:
   - Correct branch name in header
   - **Correct terminology** (e.g., "Crew" instead of "Therapists" for cleaning)
   - **Room panel hidden** (for cleaning industry)
   - Only their services with correct categories
3. Create a test booking
4. Verify booking appears correctly

---

## Troubleshooting

### Admin can't see any data
- Verify `org_id` matches in `users` table
- Check RLS policies are active
- Confirm `branch_id` is set correctly

### Wrong terminology showing
- Verify `industry_type` is set on organization
- Check `industries` table has correct configuration
- Refresh browser to reload OrgContext

### Room panel showing for cleaning
- Verify organization has `industry_type = 'cleaning'`
- Check industry `enable_rooms = false`

### Services not showing
- Verify services have correct `org_id`
- Check `is_active = true`
- Verify category matches industry's default categories

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

| Org Name | Code | Industry | Slug | Status |
|----------|------|----------|------|--------|
| Nuad Thai Spa | NTS | spa | nuad-thai-spa | Active |

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/onboard-tenant.sql` | SQL onboarding script (industry-aware) |
| `docs/feature/multi-tenant-onboard/tenant-onboarding/TENANT_DATA_TEMPLATE.md` | Data collection template |
| `docs/feature/multi-tenant-onboard/tenant-onboarding/README.md` | This guide |
| `docs/feature/multi-tenant-onboard/INDUSTRY_BASED_TENANCY_PLAN.md` | Implementation plan |

---

## Support

For issues during onboarding, check:
1. Supabase logs (Dashboard > Logs)
2. RLS policy advisors (Dashboard > Database > Advisors)
3. Contact: @sthasadin
