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

-- RLS Policy: Authenticated users can read organizations (will be tightened in Phase 4)
CREATE POLICY "Authenticated users can read organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

-- Create default organization for existing data
INSERT INTO organizations (id, name, code, slug, owner_email)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Nuad Thai Spa',
  'NTS',
  'nuad-thai-spa',
  'admin@nuadthai.com'
);

-- Add updated_at trigger (reuse existing function)
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
