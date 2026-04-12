# Multi-Tenancy Implementation Plan

## BooX - Organization-Level Multi-Tenancy

**Created**: 2026-04-06
**Status**: Draft - Pending Approval
**Risk Level**: HIGH (Schema + RLS changes)

---

## Executive Summary

### Current State: Single-Tenant, Multi-Branch
```
┌─────────────────────────────────────────────┐
│         BooX (Single Tenant)             │
├─────────────────────────────────────────────┤
│  Lazimpat  │  Branch B  │  Branch C  │ ...  │
├─────────────────────────────────────────────┤
│        GLOBAL: Services (shared)            │
└─────────────────────────────────────────────┘
```

### Target State: Multi-Tenant, Multi-Branch
```
┌─────────────────────────────────────────────┐
│  Organization A      │  Organization B      │
│  (Nuad Thai Spa)     │  (Serenity Wellness) │
│  ├─ Branch 1         │  ├─ Branch 1         │
│  ├─ Branch 2         │  ├─ Branch 2         │
│  └─ Services (own)   │  └─ Services (own)   │
└─────────────────────────────────────────────┘
       COMPLETE ISOLATION (RLS enforced)
```

---

## Pre-Implementation Audit Summary

### Tables Inventory (13 total)

| Table | Has branch_id | Needs org_id | Records | Risk |
|-------|---------------|--------------|---------|------|
| organizations | N/A (new) | IS org table | 0 | NEW |
| branches | No | YES | 1 | HIGH |
| rooms | Yes | Via branch | 8 | LOW |
| services | **NO** | **YES** | 9 | **HIGH** |
| therapists | Yes | Via branch | 6 | LOW |
| users | Yes (nullable) | YES | 3 | HIGH |
| bookings | Yes | Via branch | 35 | MEDIUM |
| payments | No (via FK) | Via booking | 6 | LOW |
| customers | Yes | Via branch | 8 | LOW |
| attendance | Yes | Via branch | 0 | LOW |
| therapist_attendance | Yes | Via branch | 0 | LOW |
| daily_reports | Yes | Via branch | 0 | LOW |
| audit_logs | Yes (nullable) | Via branch | 125 | LOW |

### RLS Policies Summary (46 total)

| Category | Count | Status |
|----------|-------|--------|
| Well-isolated (branch-scoped) | 32 | Ready |
| Global (intentional) | 6 | Need org_id |
| Security gaps (anon access) | 8 | Need review |

### API Functions Summary (51 total)

| Category | Count | Status |
|----------|-------|--------|
| Branch-scoped reads | 20 | Ready |
| Branch-scoped writes | 12 | Ready |
| Missing branch validation | 8 | Need fix |
| Global (services) | 6 | Need org_id |
| Admin-only | 5 | Need org scope |

---

## Implementation Phases

### Phase 0: Backup & Safety (Before ANY changes)

```bash
# 1. Create full database backup
pg_dump $DATABASE_URL > backup_pre_multitenancy_$(date +%Y%m%d).sql

# 2. Export current data
supabase db dump > schema_backup.sql

# 3. Git tag current state
git tag -a v1.0-pre-multitenancy -m "Last stable state before multi-tenancy"
git push origin v1.0-pre-multitenancy
```

**Rollback Strategy**: Restore from backup if any phase fails critically.

---

### Phase 1: Create Organizations Table

**Risk**: LOW (additive only)
**Estimated Effort**: 1 migration

#### Migration: `migration-009-create-organizations.sql`

```sql
-- ============================================================
-- Migration 009: Create Organizations Table (Multi-Tenancy Foundation)
-- ============================================================

-- Create organizations table
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,  -- 3-letter code for booking numbers (e.g., NTS)
  slug text UNIQUE NOT NULL,  -- URL-friendly identifier
  owner_email text,
  timezone text DEFAULT 'Asia/Kathmandu',
  currency text DEFAULT 'NPR',
  is_active boolean DEFAULT true,
  settings jsonb DEFAULT '{}',  -- org-specific config (discount limits, etc.)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add indexes
CREATE INDEX idx_organizations_code ON organizations(code);
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_active ON organizations(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Phase 1: Admin-only access)
CREATE POLICY "Authenticated users can read own organization"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);  -- Will be tightened in Phase 3

-- Create default organization for existing data
INSERT INTO organizations (id, name, code, slug, owner_email)
VALUES (
  'org00000-0000-0000-0000-000000000001',
  'Nuad Thai Spa',
  'NTS',
  'nuad-thai-spa',
  'admin@nuadthai.com'
);

-- Add updated_at trigger
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### Verification Checklist
- [ ] Organizations table created
- [ ] Default organization inserted
- [ ] RLS enabled
- [ ] Indexes created
- [ ] `npm run build` passes

---

### Phase 2: Add org_id to Core Tables

**Risk**: MEDIUM (schema changes, backfill required)
**Estimated Effort**: 1 migration + backfill

#### Migration: `migration-010-add-org-id-to-tables.sql`

```sql
-- ============================================================
-- Migration 010: Add org_id to Core Tables
-- IMPORTANT: Run during maintenance window
-- ============================================================

-- Default org ID for backfill
DO $$
DECLARE default_org_id uuid := 'org00000-0000-0000-0000-000000000001';
BEGIN

-- ============================================================
-- STEP 1: Add org_id columns (nullable first for safe migration)
-- ============================================================

-- Branches (root reference for org)
ALTER TABLE branches
  ADD COLUMN org_id uuid REFERENCES organizations(id);

-- Users (direct org membership)
ALTER TABLE users
  ADD COLUMN org_id uuid REFERENCES organizations(id);

-- Services (currently global, now org-scoped)
ALTER TABLE services
  ADD COLUMN org_id uuid REFERENCES organizations(id);

-- ============================================================
-- STEP 2: Backfill existing data with default org
-- ============================================================

UPDATE branches SET org_id = default_org_id WHERE org_id IS NULL;
UPDATE users SET org_id = default_org_id WHERE org_id IS NULL;
UPDATE services SET org_id = default_org_id WHERE org_id IS NULL;

-- ============================================================
-- STEP 3: Make org_id NOT NULL after backfill
-- ============================================================

ALTER TABLE branches ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE services ALTER COLUMN org_id SET NOT NULL;

-- ============================================================
-- STEP 4: Add indexes for org_id queries
-- ============================================================

CREATE INDEX idx_branches_org ON branches(org_id);
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_services_org ON services(org_id);

-- Composite indexes for common queries
CREATE INDEX idx_branches_org_active ON branches(org_id, is_active) WHERE is_active = true;
CREATE INDEX idx_services_org_active ON services(org_id, is_active) WHERE is_active = true;

END $$;
```

#### Data Integrity Checks

```sql
-- Run AFTER migration to verify
SELECT 'branches' as table_name, COUNT(*) as total, COUNT(org_id) as with_org_id FROM branches
UNION ALL
SELECT 'users', COUNT(*), COUNT(org_id) FROM users
UNION ALL
SELECT 'services', COUNT(*), COUNT(org_id) FROM services;

-- Expected: total = with_org_id for all tables
```

#### Verification Checklist
- [ ] org_id added to branches, users, services
- [ ] All existing records backfilled
- [ ] NOT NULL constraint applied
- [ ] Indexes created
- [ ] No orphaned records
- [ ] `npm run build` passes

---

### Phase 3: Create RLS Helper Function

**Risk**: MEDIUM (affects all RLS policies)
**Estimated Effort**: 1 migration

#### Migration: `migration-011-org-rls-helper.sql`

```sql
-- ============================================================
-- Migration 011: Organization RLS Helper Function
-- ============================================================

-- Get current user's organization ID
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM users WHERE id = auth.uid();
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_user_org_id() TO authenticated;

-- Verify function works (run manually)
-- SELECT get_user_org_id();
```

#### Verification Checklist
- [ ] Function created
- [ ] SECURITY DEFINER set
- [ ] search_path hardened
- [ ] Execute granted to authenticated
- [ ] Function returns correct org_id for test users

---

### Phase 4: Update RLS Policies (CRITICAL)

**Risk**: HIGH (security implications)
**Estimated Effort**: 1 migration, extensive testing

#### Migration: `migration-012-org-rls-policies.sql`

```sql
-- ============================================================
-- Migration 012: Organization-Level RLS Policies
-- CRITICAL: Test thoroughly before deploying to production
-- ============================================================

-- ============================================================
-- ORGANIZATIONS: Users can only see their own org
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read own organization" ON organizations;

CREATE POLICY "Users can read own organization"
  ON organizations FOR SELECT
  TO authenticated
  USING (id = get_user_org_id());

-- Super-admin policy (for future platform admin role)
-- CREATE POLICY "Super admin can read all organizations"
--   ON organizations FOR SELECT
--   TO authenticated
--   USING (get_user_role() = 'super_admin');

-- ============================================================
-- BRANCHES: Add org_id check
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read branches" ON branches;
DROP POLICY IF EXISTS "Anonymous users can read branches" ON branches;

CREATE POLICY "Users can read own org branches"
  ON branches FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

CREATE POLICY "Anonymous can read active branches for booking"
  ON branches FOR SELECT
  TO anon
  USING (is_active = true);  -- Consider adding org filter via URL param

-- ============================================================
-- SERVICES: Add org_id check (previously global)
-- ============================================================

DROP POLICY IF EXISTS "Anyone can read services" ON services;
DROP POLICY IF EXISTS "Anonymous users can read services" ON services;
DROP POLICY IF EXISTS "Admin can create services" ON services;
DROP POLICY IF EXISTS "Admin can update services" ON services;
DROP POLICY IF EXISTS "Admin can delete services" ON services;

CREATE POLICY "Users can read own org services"
  ON services FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

CREATE POLICY "Anonymous can read active services"
  ON services FOR SELECT
  TO anon
  USING (is_active = true);  -- Consider adding org filter

CREATE POLICY "Admin can create org services"
  ON services FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
    AND org_id = get_user_org_id()
  );

CREATE POLICY "Admin can update org services"
  ON services FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id())
  WITH CHECK (get_user_role() = 'admin' AND org_id = get_user_org_id());

CREATE POLICY "Admin can delete org services"
  ON services FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id());

-- ============================================================
-- USERS: Add org_id check
-- ============================================================

DROP POLICY IF EXISTS "Users can read own profile" ON users;
DROP POLICY IF EXISTS "Managers can read branch users" ON users;

CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can read own org users"
  ON users FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND (
      get_user_role() IN ('manager', 'admin')
      OR id = auth.uid()
    )
  );

-- ============================================================
-- ROOMS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read rooms" ON rooms;
DROP POLICY IF EXISTS "Anonymous users can read rooms" ON rooms;
DROP POLICY IF EXISTS "Manager and admin can create rooms" ON rooms;
DROP POLICY IF EXISTS "Manager and admin can update rooms" ON rooms;
DROP POLICY IF EXISTS "Manager and admin can delete rooms" ON rooms;

CREATE POLICY "Users can read own org rooms"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = rooms.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Anonymous can read active rooms"
  ON rooms FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Manager can create org rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can update org rooms"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = rooms.branch_id
      AND b.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can delete org rooms"
  ON rooms FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = rooms.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- THERAPISTS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read therapists" ON therapists;
DROP POLICY IF EXISTS "Anonymous users can read therapists" ON therapists;
DROP POLICY IF EXISTS "Manager and admin can create therapists" ON therapists;
DROP POLICY IF EXISTS "Manager and admin can update therapists" ON therapists;
DROP POLICY IF EXISTS "Manager and admin can delete therapists" ON therapists;

CREATE POLICY "Users can read own org therapists"
  ON therapists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapists.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Anonymous can read active therapists"
  ON therapists FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Manager can create org therapists"
  ON therapists FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can update org therapists"
  ON therapists FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapists.branch_id
      AND b.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Manager can delete org therapists"
  ON therapists FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapists.branch_id
      AND b.org_id = get_user_org_id()
    )
  );

-- ============================================================
-- BOOKINGS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch bookings" ON bookings;
DROP POLICY IF EXISTS "Staff can create branch bookings" ON bookings;
DROP POLICY IF EXISTS "Staff can update branch bookings" ON bookings;

CREATE POLICY "Staff can read own org bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = bookings.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can create own org bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can update own org bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = bookings.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- Keep anonymous policies for public booking (consider restricting)
-- These remain unchanged but may need org context via URL/session

-- ============================================================
-- CUSTOMERS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch customers" ON customers;
DROP POLICY IF EXISTS "Staff can create customers" ON customers;
DROP POLICY IF EXISTS "Staff can update branch customers" ON customers;

CREATE POLICY "Staff can read own org customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = customers.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can create own org customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Staff can update own org customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = customers.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- ============================================================
-- PAYMENTS: Inherits org check via booking->branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch payments" ON payments;
DROP POLICY IF EXISTS "Staff can record payments" ON payments;

CREATE POLICY "Staff can read own org payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings bk
      JOIN branches b ON b.id = bk.branch_id
      WHERE bk.id = payments.booking_id
      AND b.org_id = get_user_org_id()
      AND (bk.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

CREATE POLICY "Staff can record own org payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings bk
      JOIN branches b ON b.id = bk.branch_id
      WHERE bk.id = booking_id
      AND b.org_id = get_user_org_id()
      AND (bk.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

-- ============================================================
-- DAILY_REPORTS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Manager can read branch daily reports" ON daily_reports;
DROP POLICY IF EXISTS "Manager can close day" ON daily_reports;

CREATE POLICY "Manager can read own org daily reports"
  ON daily_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = daily_reports.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Manager can close own org day"
  ON daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- ============================================================
-- ATTENDANCE: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Users can read own attendance" ON attendance;
DROP POLICY IF EXISTS "Managers can read branch attendance" ON attendance;
DROP POLICY IF EXISTS "Users can check in" ON attendance;
DROP POLICY IF EXISTS "Users can check out" ON attendance;

CREATE POLICY "Users can read own attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Manager can read own org attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Users can check in own org"
  ON attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
  );

CREATE POLICY "Users can check out"
  ON attendance FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- THERAPIST_ATTENDANCE: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Staff can read branch therapist attendance" ON therapist_attendance;
DROP POLICY IF EXISTS "Manager can manage therapist attendance" ON therapist_attendance;
DROP POLICY IF EXISTS "Manager can update therapist attendance" ON therapist_attendance;

CREATE POLICY "Staff can read own org therapist attendance"
  ON therapist_attendance FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapist_attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Manager can create own org therapist attendance"
  ON therapist_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "Manager can update own org therapist attendance"
  ON therapist_attendance FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = therapist_attendance.branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND EXISTS (
      SELECT 1 FROM branches b
      WHERE b.id = branch_id
      AND b.org_id = get_user_org_id()
    )
    AND (
      branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- ============================================================
-- AUDIT_LOGS: Add org check via branch
-- ============================================================

DROP POLICY IF EXISTS "Manager can read branch audit logs" ON audit_logs;

CREATE POLICY "Manager can read own org audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND (
      branch_id IS NULL  -- System-level logs
      OR EXISTS (
        SELECT 1 FROM branches b
        WHERE b.id = audit_logs.branch_id
        AND b.org_id = get_user_org_id()
      )
    )
    AND (
      branch_id IS NULL
      OR branch_id = get_user_branch_id()
      OR get_user_role() = 'admin'
    )
  );

-- System insert policy remains unchanged (SECURITY DEFINER triggers)
```

#### RLS Testing Checklist

```sql
-- Test queries (run as different users)

-- 1. As staff user (org A, branch 1):
SET LOCAL role TO 'authenticated';
SET LOCAL request.jwt.claims TO '{"sub": "staff-user-id"}';
SELECT * FROM bookings;  -- Should only see org A, branch 1 bookings

-- 2. As manager user (org A, branch 1):
SET LOCAL request.jwt.claims TO '{"sub": "manager-user-id"}';
SELECT * FROM bookings;  -- Should see org A, branch 1 bookings

-- 3. As admin user (org A):
SET LOCAL request.jwt.claims TO '{"sub": "admin-user-id"}';
SELECT * FROM bookings;  -- Should see ALL org A bookings

-- 4. As user from org B (should see NOTHING from org A):
SET LOCAL request.jwt.claims TO '{"sub": "org-b-user-id"}';
SELECT * FROM bookings;  -- Should be empty
```

#### Verification Checklist
- [ ] All 46 policies updated
- [ ] Org isolation working for all tables
- [ ] Branch isolation still working within org
- [ ] Anonymous access appropriately restricted
- [ ] Admin can see all branches within their org
- [ ] Cross-org access blocked
- [ ] `npm run build` passes

---

### Phase 5: Update API Layer

**Risk**: MEDIUM
**Estimated Effort**: 2-3 days

#### Changes Required

##### 1. Add OrgContext.jsx

```jsx
// src/contexts/OrgContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const OrgContext = createContext(null);

export const OrgProvider = ({ children }) => {
  const { profile } = useAuth();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.org_id) {
      // Fetch org details
      fetchOrgDetails(profile.org_id);
    }
  }, [profile?.org_id]);

  const fetchOrgDetails = async (orgId) => {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();
    setOrg(data);
    setLoading(false);
  };

  return (
    <OrgContext.Provider value={{ org, orgId: profile?.org_id, loading }}>
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => useContext(OrgContext);
```

##### 2. Update api.js Functions

Add org_id validation to these functions:

| Function | Change Required |
|----------|-----------------|
| `fetchServices()` | Add `.eq('org_id', orgId)` filter |
| `fetchServicesForManagement()` | Add org_id check |
| `createService()` | Include org_id in insert |
| `updateServicePricing()` | Validate org ownership |
| `toggleServiceActive()` | Validate org ownership |
| `deleteService()` | Validate org ownership |
| `fetchAllBranches()` | Add `.eq('org_id', orgId)` filter |
| `recordPayment()` | Add org validation via booking |
| `updateBookingStatus()` | Add org validation |
| `assignTherapist()` | Add org validation |
| `applyDiscount()` | Add org validation |
| `approveDiscount()` | Add org validation |
| `rejectDiscount()` | Add org validation |
| `rescheduleBooking()` | Add org validation |
| `markAttendance()` | Add org validation |

##### 3. Update BranchContext.jsx

```jsx
// Update fetchAllBranches call to include org filter
const loadBranches = async () => {
  const result = await fetchAllBranches({ orgId: profile.org_id });
  // ...
};
```

#### Verification Checklist
- [ ] OrgContext created and integrated
- [ ] All service functions org-scoped
- [ ] fetchAllBranches org-filtered
- [ ] Booking mutations org-validated
- [ ] `npm run build` passes
- [ ] Manual testing of all CRUD operations

---

### Phase 6: Update UI Components

**Risk**: LOW
**Estimated Effort**: 1-2 days

#### Changes Required

1. **Wrap App with OrgProvider**
2. **Display org name in header** (optional)
3. **Service management scoped to org**
4. **Error handling for org mismatches**

---

### Phase 7: Data Migration (Production)

**Risk**: HIGH
**Estimated Effort**: 1 migration + verification

#### Pre-Migration Checklist
- [ ] Full database backup
- [ ] Maintenance window scheduled
- [ ] Rollback plan documented
- [ ] All stakeholders notified

#### Migration Script

```sql
-- Production data migration
-- Run during maintenance window

BEGIN;

-- Verify default org exists
SELECT id, name FROM organizations WHERE id = 'org00000-0000-0000-0000-000000000001';

-- Count records before
SELECT 'branches' as t, count(*) FROM branches
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'services', count(*) FROM services;

-- Run migration (if not already done)
-- ... (same as Phase 2 migration)

-- Count records after
SELECT 'branches' as t, count(*) as total, count(org_id) as with_org FROM branches
UNION ALL SELECT 'users', count(*), count(org_id) FROM users
UNION ALL SELECT 'services', count(*), count(org_id) FROM services;

-- Verify all records have org_id
SELECT 'FAILED' WHERE EXISTS (
  SELECT 1 FROM branches WHERE org_id IS NULL
  UNION SELECT 1 FROM users WHERE org_id IS NULL
  UNION SELECT 1 FROM services WHERE org_id IS NULL
);

COMMIT;
```

---

## Rollback Procedures

### Phase 1-3 Rollback (Schema only)
```sql
DROP TABLE IF EXISTS organizations CASCADE;
ALTER TABLE branches DROP COLUMN IF EXISTS org_id;
ALTER TABLE users DROP COLUMN IF EXISTS org_id;
ALTER TABLE services DROP COLUMN IF EXISTS org_id;
DROP FUNCTION IF EXISTS get_user_org_id();
```

### Phase 4 Rollback (RLS policies)
```sql
-- Restore from backup RLS file
-- OR manually recreate original policies
```

### Full Rollback
```bash
# Restore from pre-migration backup
psql $DATABASE_URL < backup_pre_multitenancy_YYYYMMDD.sql
```

---

## Testing Requirements

### Unit Tests
- [ ] `get_user_org_id()` returns correct org
- [ ] RLS blocks cross-org access
- [ ] API functions respect org boundaries

### Integration Tests
- [ ] Create booking in org A, verify org B cannot see it
- [ ] Create service in org A, verify org B cannot use it
- [ ] Admin in org A cannot see org B branches

### Security Tests
- [ ] Attempt SQL injection in org_id parameter
- [ ] Attempt to bypass RLS with direct API calls
- [ ] Verify anonymous access is appropriately limited

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 0: Backup | 1 hour | None |
| Phase 1: Organizations table | 2 hours | Phase 0 |
| Phase 2: Add org_id columns | 4 hours | Phase 1 |
| Phase 3: RLS helper function | 1 hour | Phase 2 |
| Phase 4: Update RLS policies | 8 hours | Phase 3 |
| Phase 5: Update API layer | 16 hours | Phase 4 |
| Phase 6: Update UI | 8 hours | Phase 5 |
| Phase 7: Production migration | 4 hours | Phase 6 |
| **Total** | **~44 hours** | |

---

## Success Criteria

1. **Data Isolation**: Users from Org A cannot see any data from Org B
2. **Backward Compatibility**: Existing single-org functionality unchanged
3. **Performance**: No significant query performance degradation
4. **Security**: RLS policies enforced at database level
5. **Build**: `npm run build` passes with no errors

---

## Approval

- [ ] Technical Lead Approval
- [ ] Security Review
- [ ] Product Owner Approval
- [ ] Backup Verified
- [ ] Rollback Plan Tested

---

**Document Version**: 1.0
**Last Updated**: 2026-04-06
**Author**: Project PM (Claude)
