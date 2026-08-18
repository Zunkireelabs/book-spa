-- ============================================================
-- Migration 010: Add org_id to Core Tables
-- Adds organization reference to branches, users, and services
-- Backfills existing data with default organization
-- ============================================================

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

UPDATE branches SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE users SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE services SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

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
