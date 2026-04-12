# Industry-Based Multi-Tenancy Plan

## BookSpa — Multi-Industry SaaS Platform

**Created**: 2026-04-12
**Status**: Draft - Pending Approval
**Feature Branch**: `feature/multi-tenant-onboard`

---

## Executive Summary

### Current State
```
┌─────────────────────────────────────────────┐
│         BookSpa (Spa-Only Platform)         │
├─────────────────────────────────────────────┤
│  Nuad Thai Spa (NTS)                        │
│  ├─ Therapists (individual staff)           │
│  ├─ Rooms (in-house locations)              │
│  ├─ Services (Spa, Salon, Facial, etc.)     │
│  └─ Bookings, Payments, Reports             │
└─────────────────────────────────────────────┘
```

### Target State
```
┌─────────────────────────────────────────────────────────────────┐
│              BookSpa (Multi-Industry Platform)                  │
├─────────────────────────────────────────────────────────────────┤
│  INDUSTRY: Spa                │  INDUSTRY: Cleaning             │
│  ├─ Tenant: Nuad Thai Spa     │  ├─ Tenant: Khems Cleaning      │
│  ├─ Therapists ✓              │  ├─ Crew Members ✓              │
│  ├─ Rooms ✓                   │  ├─ Rooms ✗ (disabled)          │
│  ├─ Gender Selection ✓        │  ├─ Gender Selection ✗          │
│  └─ Categories: Spa, Salon... │  └─ Categories: Residential...  │
├─────────────────────────────────────────────────────────────────┤
│  SHARED: Bookings, Payments, Reports, Customers, RLS           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Problem Statement

1. **Current tenant (Nuad Thai Spa)** uses full spa features: rooms, therapists, gender-based assignment
2. **New tenant (Khems Cleaning)** is a cleaning service company with different needs
3. **BookSpa is hardcoded** for spa terminology and features
4. **Need flexibility** to support multiple industries without forking codebase

---

## Research Findings

### Reference: edgeXcrm Implementation

Investigated `/Users/sadinshrestha/Projects/edgeXcrm` which implements industry-based tenancy:

**Key Patterns:**
- `industries` table with terminology mapping (`entity_type_label`, `entity_type_singular`)
- `tenant.industry_id` links tenant to industry
- Feature visibility driven by data presence (not explicit flags)
- UI components receive industry data as props for dynamic labels
- Default pipeline stages per industry (stored as JSONB templates)

**Files Referenced:**
- `supabase/migrations/012_industry_customization.sql`
- `src/components/dashboard/settings/industry-info-card.tsx`
- `src/components/dashboard/settings/industry-entities-manager.tsx`

---

## Industry Comparison: Spa vs Cleaning

| Concept | Spa Industry | Cleaning Industry |
|---------|--------------|-------------------|
| **Staff Term** | Therapist | Crew Member |
| **Staff Plural** | Therapists | Crew |
| **Location Term** | Room | Job Site |
| **Location Plural** | Rooms | Job Sites |
| **Needs Rooms?** | ✅ Yes (in-house) | ❌ No (customer location) |
| **Staff Gender?** | ✅ Yes (customer preference) | ❌ No |
| **Specialties?** | ✅ Massage, Thai, Facial | ✅ Carpet, Windows, Deep Clean |
| **Service Categories** | Spa, Salon, Facial, Wellness, Waxing, Threading, Hair Color, Hair Treatment, Nail, Packages | Residential, Commercial, Deep Clean, Regular Clean, Post-Construction, Move In/Out, Office |

---

## Architecture Decision

### Option A: Parallel Tables
Create `crews` and `job_sites` tables alongside `therapists` and `rooms`.

**Pros:**
- Clean separation
- No breaking changes to existing data
- Industry-specific schemas

**Cons:**
- More tables to maintain
- Duplicate logic in API/UI
- Complex migrations

### Option B: Feature Flags + Terminology (RECOMMENDED)
Reuse existing tables (`therapists`, `rooms`) with feature flags to show/hide and terminology mapping.

**Pros:**
- Simpler implementation
- Single codebase
- Faster MVP
- 80% code reuse

**Cons:**
- "Therapists" table stores cleaning crew (semantic mismatch)
- May need refactoring later for industry-specific behavior

### Decision: Option B for MVP
Use feature flags and terminology mapping. Create new tables only when fundamentally different behavior is needed.

---

## Implementation Plan

### Phase 1: Database Schema

#### Migration: `migration-015-add-industries.sql`

```sql
-- ============================================================
-- Migration 015: Industry-Based Multi-Tenancy
-- ============================================================

-- Create industries reference table
CREATE TABLE industries (
  id text PRIMARY KEY,  -- 'spa', 'cleaning', 'salon', etc.
  name text NOT NULL,
  description text,

  -- Terminology mapping
  staff_label text DEFAULT 'Therapist',
  staff_label_plural text DEFAULT 'Therapists',
  location_label text DEFAULT 'Room',
  location_label_plural text DEFAULT 'Rooms',
  session_label text DEFAULT 'Session',
  session_label_plural text DEFAULT 'Sessions',

  -- Feature flags
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

-- Enable RLS
ALTER TABLE industries ENABLE ROW LEVEL SECURITY;

-- Everyone can read industries (reference data)
CREATE POLICY "Anyone can read industries"
  ON industries FOR SELECT
  USING (true);

-- Seed initial industries
INSERT INTO industries (id, name, description,
  staff_label, staff_label_plural, location_label, location_label_plural,
  enable_rooms, enable_staff_gender, enable_customer_gender,
  default_categories, icon, color)
VALUES
  (
    'spa',
    'Spa & Wellness',
    'Spa, massage, beauty, and wellness services',
    'Therapist', 'Therapists', 'Room', 'Rooms',
    true, true, true,
    '["Spa", "Salon", "Facial", "Wellness", "Waxing", "Threading", "Hair Color", "Hair Treatment", "Nail", "Packages", "Other"]',
    'sparkles',
    'purple'
  ),
  (
    'cleaning',
    'Cleaning Services',
    'Residential and commercial cleaning services',
    'Crew Member', 'Crew', 'Job Site', 'Job Sites',
    false, false, false,
    '["Residential", "Commercial", "Deep Clean", "Regular Clean", "Post-Construction", "Move In/Out", "Office", "Carpet Cleaning", "Window Cleaning", "Other"]',
    'spray-can',
    'blue'
  ),
  (
    'salon',
    'Hair Salon',
    'Hair styling, coloring, and treatment services',
    'Stylist', 'Stylists', 'Station', 'Stations',
    true, true, true,
    '["Haircut", "Hair Color", "Hair Treatment", "Styling", "Extensions", "Bridal", "Kids", "Other"]',
    'scissors',
    'pink'
  );

-- Add industry_type to organizations
ALTER TABLE organizations
  ADD COLUMN industry_type text REFERENCES industries(id) DEFAULT 'spa';

-- Update existing org (Nuad Thai Spa)
UPDATE organizations
  SET industry_type = 'spa'
  WHERE id = '00000000-0000-0000-0000-000000000001';

-- Add index
CREATE INDEX idx_organizations_industry ON organizations(industry_type);
```

---

### Phase 2: Frontend Context Updates

#### Update: `src/contexts/OrgContext.jsx`

```javascript
// Add industry state
const [industry, setIndustry] = useState(null);

// Fetch industry when org loads
useEffect(() => {
  if (org?.industry_type) {
    const fetchIndustry = async () => {
      const { data } = await supabase
        .from('industries')
        .select('*')
        .eq('id', org.industry_type)
        .single();
      setIndustry(data);
    };
    fetchIndustry();
  }
}, [org?.industry_type]);

// Expose in context value
const value = {
  // Existing
  org, orgId, orgName, orgCode, orgTimezone, orgCurrency, orgSettings,
  loading, error,

  // NEW: Industry data
  industry,
  industryType: org?.industry_type || 'spa',

  // NEW: Terminology helpers
  staffLabel: industry?.staff_label || 'Therapist',
  staffLabelPlural: industry?.staff_label_plural || 'Therapists',
  locationLabel: industry?.location_label || 'Room',
  locationLabelPlural: industry?.location_label_plural || 'Rooms',
  sessionLabel: industry?.session_label || 'Session',
  sessionLabelPlural: industry?.session_label_plural || 'Sessions',

  // NEW: Feature flags
  enableRooms: industry?.enable_rooms !== false,
  enableStaffGender: industry?.enable_staff_gender !== false,
  enableSpecialties: industry?.enable_specialties !== false,
  enableCustomerGender: industry?.enable_customer_gender !== false,
};
```

#### New Hook: `src/hooks/useIndustry.js`

```javascript
import { useOrg } from '../contexts/OrgContext';

export const useIndustry = () => {
  const {
    industry,
    industryType,
    staffLabel,
    staffLabelPlural,
    locationLabel,
    locationLabelPlural,
    sessionLabel,
    sessionLabelPlural,
    enableRooms,
    enableStaffGender,
    enableSpecialties,
    enableCustomerGender,
  } = useOrg();

  return {
    // Raw data
    industry,
    industryType,

    // Terminology
    staffLabel,
    staffLabelPlural,
    locationLabel,
    locationLabelPlural,
    sessionLabel,
    sessionLabelPlural,

    // Feature flags
    enableRooms,
    enableStaffGender,
    enableSpecialties,
    enableCustomerGender,

    // Helper checks
    isSpa: industryType === 'spa',
    isCleaning: industryType === 'cleaning',
    isSalon: industryType === 'salon',
  };
};
```

---

### Phase 3: UI Conditional Rendering

#### Components to Update

| Component | Change Required |
|-----------|-----------------|
| `TherapistManagementPanel.jsx` | Use `staffLabelPlural` for title, hide gender if `!enableStaffGender` |
| `RoomManagementPanel.jsx` | Wrap with `{enableRooms && ...}`, use `locationLabelPlural` |
| `TherapistUtilizationChart.jsx` | Use `staffLabelPlural` in labels |
| `TherapistAssignmentPanel.jsx` | Use `staffLabel` for selection |
| `StaffBookingForm.jsx` | Hide gender field if `!enableCustomerGender` |
| `BookingDetailsModal.jsx` | Hide room field if `!enableRooms` |
| `ServiceSelection.jsx` | Categories loaded from org's industry |

#### Example: RoomManagementPanel

```jsx
// Before
<div>
  <h2>Room Management</h2>
  {/* ... */}
</div>

// After
const { enableRooms, locationLabelPlural } = useIndustry();

{enableRooms && (
  <div>
    <h2>{locationLabelPlural} Management</h2>
    {/* ... */}
  </div>
)}
```

#### Example: TherapistManagementPanel

```jsx
// Before
<div>
  <h2>Therapist Management</h2>
  <GenderSelect />
</div>

// After
const { staffLabelPlural, enableStaffGender } = useIndustry();

<div>
  <h2>{staffLabelPlural} Management</h2>
  {enableStaffGender && <GenderSelect />}
</div>
```

---

### Phase 4: Service Categories per Industry

When onboarding a new tenant, seed `service_categories` based on industry:

```sql
-- In onboarding script
INSERT INTO service_categories (name, org_id, display_order)
SELECT
  category::text,
  NEW_ORG_ID,
  row_number() OVER ()
FROM jsonb_array_elements_text(
  (SELECT default_categories FROM industries WHERE id = 'cleaning')
) AS category;
```

---

### Phase 5: Update Onboarding Script

#### `scripts/onboard-tenant.sql` Changes

```sql
-- Add industry_type parameter
\set industry_type 'cleaning'  -- or 'spa', 'salon'

-- Create org with industry
INSERT INTO organizations (name, code, slug, owner_email, industry_type)
VALUES (:'org_name', :'org_code', :'org_slug', :'owner_email', :'industry_type')
RETURNING id INTO new_org_id;

-- Seed categories from industry defaults
INSERT INTO service_categories (name, org_id, display_order)
SELECT
  category::text,
  new_org_id,
  row_number() OVER ()
FROM jsonb_array_elements_text(
  (SELECT default_categories FROM industries WHERE id = :'industry_type')
) AS category;

-- Skip room setup for cleaning industry
IF :'industry_type' != 'cleaning' THEN
  -- Create rooms...
END IF;
```

---

## Task Breakdown

| # | Task | Skill | Effort | Dependencies |
|---|------|-------|--------|--------------|
| 1 | Create `industries` table migration | `/supabase-db` | 1hr | None |
| 2 | Add `industry_type` to organizations | `/supabase-db` | 30min | Task 1 |
| 3 | Seed Spa, Cleaning, Salon industries | `/supabase-db` | 30min | Task 2 |
| 4 | Update OrgContext with industry data | `/react-frontend` | 1hr | Task 3 |
| 5 | Create `useIndustry()` hook | `/react-frontend` | 30min | Task 4 |
| 6 | Update RoomManagementPanel | `/react-frontend` | 30min | Task 5 |
| 7 | Update TherapistManagementPanel | `/react-frontend` | 30min | Task 5 |
| 8 | Update TherapistUtilizationChart | `/react-frontend` | 30min | Task 5 |
| 9 | Update booking forms (gender fields) | `/react-frontend` | 1hr | Task 5 |
| 10 | Update onboarding script | `/supabase-db` | 30min | Task 3 |
| 11 | Seed categories for Khems Cleaning | `/supabase-db` | 30min | Task 10 |
| 12 | Onboard Khems Cleaning tenant | Manual | 30min | All |
| 13 | Test & verify | Manual | 1hr | Task 12 |

**Total Estimated Effort:** ~8-9 hours

---

## Khems Cleaning Tenant Setup

After implementation:

```sql
-- Organization
INSERT INTO organizations (name, code, slug, owner_email, industry_type)
VALUES ('Khems Cleaning', 'KC', 'khems-cleaning', 'admin@khemscleaning.com', 'cleaning');

-- Branch
INSERT INTO branches (name, org_id, address)
VALUES ('Main Office', NEW_ORG_ID, 'Kathmandu, Nepal');

-- Service categories auto-seeded from cleaning industry

-- Services (examples)
INSERT INTO services (name, duration_minutes, price_npr, category, org_id)
VALUES
  ('Regular Home Cleaning', 120, 3000, 'Residential', NEW_ORG_ID),
  ('Deep Clean', 240, 8000, 'Deep Clean', NEW_ORG_ID),
  ('Office Cleaning', 180, 5000, 'Commercial', NEW_ORG_ID),
  ('Post-Construction Cleanup', 480, 15000, 'Post-Construction', NEW_ORG_ID);

-- Crew members (using therapists table)
INSERT INTO therapists (name, branch_id, specialties, is_active)
VALUES
  ('Team Alpha', NEW_BRANCH_ID, ARRAY['Residential', 'Deep Clean'], true),
  ('Team Beta', NEW_BRANCH_ID, ARRAY['Commercial', 'Office'], true);
```

**What Khems Cleaning will see:**
- ✅ Services with cleaning categories
- ✅ "Crew" management (not "Therapist")
- ✅ Bookings, payments, reports
- ❌ Room management (hidden)
- ❌ Gender selection (hidden)

---

## Future Enhancements

### Near-Term (Next Sprint)

1. **Job Site Tracking** — For cleaning services, optionally track recurring customer locations
2. **Crew Scheduling** — Team-based vs individual scheduling
3. **Industry-Specific Reports** — Different KPIs per industry

### Medium-Term (1-3 Months)

4. **Industry Templates** — Pre-built service packages per industry
5. **Custom Fields per Industry** — Additional fields in bookings (e.g., "property_size" for cleaning)
6. **Industry-Specific Booking Flow** — Different customer portal per industry

### Long-Term (3-6 Months)

7. **New Tables for Complex Industries:**
   - `job_sites` for cleaning (recurring customer locations)
   - `vehicles` for mobile services
   - `equipment` for rental businesses

8. **Industry Marketplace** — Allow creating new industries from admin panel

9. **White-Label per Industry** — Different branding/colors per industry type

10. **Industry-Specific Integrations:**
    - Spa: Online booking widgets, beauty marketplaces
    - Cleaning: Property management systems, Airbnb integration
    - Salon: Instagram booking, Google reservations

---

## Open Questions

1. **Should therapist specialties be industry-specific?**
   - Current: Free-text array
   - Option: Reference table per industry

2. **How to handle booking form for cleaning?**
   - No room selection needed
   - May need "property address" field instead

3. **Should we rename `therapists` table?**
   - Current: Keep as-is, use terminology mapping
   - Future: Consider renaming to `staff` or `service_providers`

4. **Recurring bookings for cleaning?**
   - Cleaning often has weekly/monthly recurring jobs
   - Not implemented in current spa model
   - Future feature consideration

---

## Files to Create/Modify

### New Files
- `supabase/migration-015-add-industries.sql`
- `src/hooks/useIndustry.js`
- `docs/feature/multi-tenant-onboard/INDUSTRY_BASED_TENANCY_PLAN.md` (this file)

### Modified Files
- `src/contexts/OrgContext.jsx`
- `src/pages/branch-manager-dashboard/components/MasterData/TherapistManagementPanel.jsx`
- `src/pages/branch-manager-dashboard/components/MasterData/RoomManagementPanel.jsx`
- `src/pages/branch-manager-dashboard/components/TherapistUtilizationChart.jsx`
- `src/pages/branch-staff-dashboard/components/StaffBookingForm.jsx`
- `src/pages/booking-details-assignment-modal/components/TherapistAssignmentPanel.jsx`
- `scripts/onboard-tenant.sql`

---

## Success Criteria

1. **Nuad Thai Spa** continues to work exactly as before (no regression)
2. **Khems Cleaning** can be onboarded with:
   - No room management visible
   - "Crew" terminology throughout
   - Cleaning service categories
   - Bookings, payments, reports functional
3. **Build passes** with no errors
4. **RLS policies** unchanged (org_id isolation still works)

---

## Rollback Plan

If industry feature causes issues:

```sql
-- Remove industry_type column
ALTER TABLE organizations DROP COLUMN industry_type;

-- Drop industries table
DROP TABLE industries;

-- Revert OrgContext changes
-- (via git revert)
```

---

## Approval Checklist

- [ ] Plan reviewed by stakeholder
- [ ] Database migration approved
- [ ] UI changes approved
- [ ] Khems Cleaning data collected
- [ ] Test plan prepared

---

**Document Version**: 1.0
**Last Updated**: 2026-04-12
**Author**: Project PM (Claude)
**Approved By**: _________________
