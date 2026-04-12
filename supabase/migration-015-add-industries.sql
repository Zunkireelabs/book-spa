-- ============================================================
-- Migration 015: Industry-Based Multi-Tenancy
-- Adds support for multiple industries (Spa, Cleaning, Salon)
-- ============================================================

-- ============================================================
-- STEP 1: Create industries reference table
-- ============================================================

CREATE TABLE industries (
  id text PRIMARY KEY,  -- 'spa', 'cleaning', 'salon', etc.
  name text NOT NULL,
  description text,

  -- Terminology mapping (for UI labels)
  staff_label text DEFAULT 'Therapist',
  staff_label_plural text DEFAULT 'Therapists',
  location_label text DEFAULT 'Room',
  location_label_plural text DEFAULT 'Rooms',
  session_label text DEFAULT 'Session',
  session_label_plural text DEFAULT 'Sessions',

  -- Feature flags (what's enabled for this industry)
  enable_rooms boolean DEFAULT true,
  enable_staff_gender boolean DEFAULT true,
  enable_specialties boolean DEFAULT true,
  enable_customer_gender boolean DEFAULT true,

  -- Default service categories for this industry
  default_categories jsonb DEFAULT '[]',

  -- UI customization
  icon text,  -- Lucide icon name
  color text, -- Tailwind color class

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- STEP 2: Enable RLS (reference data, readable by all)
-- ============================================================

ALTER TABLE industries ENABLE ROW LEVEL SECURITY;

-- Anyone can read industries (public reference data)
CREATE POLICY "Anyone can read industries"
  ON industries FOR SELECT
  USING (true);

-- ============================================================
-- STEP 3: Seed initial industries
-- ============================================================

INSERT INTO industries (
  id, name, description,
  staff_label, staff_label_plural,
  location_label, location_label_plural,
  session_label, session_label_plural,
  enable_rooms, enable_staff_gender, enable_specialties, enable_customer_gender,
  default_categories,
  icon, color
)
VALUES
  -- Spa & Wellness (current model)
  (
    'spa',
    'Spa & Wellness',
    'Spa, massage, beauty, and wellness services',
    'Therapist', 'Therapists',
    'Room', 'Rooms',
    'Session', 'Sessions',
    true, true, true, true,
    '["Spa", "Salon", "Facial", "Wellness", "Waxing", "Threading", "Hair Color", "Hair Treatment", "Nail", "Packages", "Other"]'::jsonb,
    'sparkles', 'purple'
  ),

  -- Cleaning Services (Khems Cleaning model)
  (
    'cleaning',
    'Cleaning Services',
    'Residential and commercial cleaning services',
    'Crew Member', 'Crew',
    'Job Site', 'Job Sites',
    'Job', 'Jobs',
    false, false, true, false,
    '["Residential", "Commercial", "Deep Clean", "Regular Clean", "Post-Construction", "Move In/Out", "Office", "Carpet Cleaning", "Window Cleaning", "Other"]'::jsonb,
    'spray-can', 'blue'
  ),

  -- Hair Salon (future option)
  (
    'salon',
    'Hair Salon',
    'Hair styling, coloring, and treatment services',
    'Stylist', 'Stylists',
    'Station', 'Stations',
    'Appointment', 'Appointments',
    true, true, true, true,
    '["Haircut", "Hair Color", "Hair Treatment", "Styling", "Extensions", "Bridal", "Kids", "Beard & Shave", "Other"]'::jsonb,
    'scissors', 'pink'
  );

-- ============================================================
-- STEP 4: Add industry_type to organizations
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN industry_type text REFERENCES industries(id) DEFAULT 'spa';

-- ============================================================
-- STEP 5: Update existing organization (Nuad Thai Spa)
-- ============================================================

UPDATE organizations
  SET industry_type = 'spa'
  WHERE id = '00000000-0000-0000-0000-000000000001';

-- ============================================================
-- STEP 6: Add index for industry queries
-- ============================================================

CREATE INDEX idx_organizations_industry ON organizations(industry_type);

-- ============================================================
-- STEP 7: Add updated_at trigger for industries
-- ============================================================

CREATE TRIGGER trg_industries_updated_at
  BEFORE UPDATE ON industries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================================

-- Check industries were created:
-- SELECT id, name, staff_label, enable_rooms FROM industries;

-- Check org has industry_type:
-- SELECT id, name, industry_type FROM organizations;
