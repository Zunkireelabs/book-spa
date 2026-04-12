# BooX Component Patterns

> Reference for how components are structured in this project.

## Page Module Pattern

Every feature is a self-contained module under `src/pages/`:

```
pages/
└── feature-name/
    ├── index.jsx              # Page container
    └── components/
        ├── FeatureHeader.jsx  # Feature-specific header
        ├── FeatureList.jsx    # Main content
        └── FeatureModal.jsx   # Feature-specific modal
```

### Page Container (index.jsx)
The page container owns:
- All state for the feature
- Data fetching (API calls)
- Business logic and handlers
- Layout composition

```jsx
import React, { useState, useEffect } from 'react';
import FeatureHeader from './components/FeatureHeader';
import FeatureList from './components/FeatureList';

const FeaturePage = () => {
  const [data, setData] = useState([]);
  const [filters, setFilters] = useState({ /* defaults */ });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch data from API
    const loadData = async () => {
      setLoading(true);
      try {
        // const result = await api.fetchData(filters);
        // setData(result);
      } catch (error) {
        console.error('Load error:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [filters]);

  const handleAction = (id, payload) => {
    // Handle business logic
  };

  return (
    <div className="min-h-screen bg-background">
      <FeatureHeader />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <FeatureList
          data={data}
          loading={loading}
          onAction={handleAction}
        />
      </div>
    </div>
  );
};

export default FeaturePage;
```

### Child Components
Child components are purely presentational — they receive data and callbacks via props:

```jsx
const FeatureList = ({ data, loading, onAction }) => {
  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-4">
      {data.map(item => (
        <FeatureCard
          key={item.id}
          item={item}
          onAction={() => onAction(item.id)}
        />
      ))}
    </div>
  );
};
```

## Existing Feature Modules

### staff-login-authentication (3 components)
- `LoginForm.jsx` — Supabase auth, password strength, auto-redirect
- `SecurityHeader.jsx` — visual trust element
- `TrustSignals.jsx` — security badges

### branch-staff-dashboard (4 components)
- `StaffHeader.jsx` — uses useAuth(), signOut, branch display
- `QuickFilters.jsx` — dateRange, serviceType, status, search filters
- `BookingsList.jsx` — booking cards with status badges
- `TherapistAvailability.jsx` — therapist status grid

**Layout:** 12-col grid → 3-col filters | 6-col bookings | 3-col therapists

### booking-management-portal (5 components)
- `BookingSearch.jsx` — search by booking number, name, phone
- `BookingCard.jsx` — individual booking display
- `BookingHistory.jsx` — timeline of booking changes
- `CancellationModal.jsx` — cancel with reason
- `RescheduleModal.jsx` — change date/time

### booking-details-assignment-modal (4 components)
- `BookingDetailsPanel.jsx` — full booking info display
- `TherapistAssignmentPanel.jsx` — assign therapist to booking
- `BookingTimelinePanel.jsx` — status change history
- `CustomerCommunicationPanel.jsx` — customer notes

### branch-manager-dashboard (8 components)
- `MetricsCard.jsx` — KPI display card
- `DateRangePicker.jsx` — date range filter
- `RevenueAnalyticsChart.jsx` — Recharts revenue visualization
- `TherapistUtilizationChart.jsx` — utilization bar chart
- `BookingPipelineChart.jsx` — booking funnel
- `StaffPerformanceCard.jsx` — staff metrics
- `RealtimeBookingFeed.jsx` — live booking updates
- `AlertsNotificationPanel.jsx` — system alerts

### customer-booking-flow (7 components)
- `ProgressIndicator.jsx` — step progress bar
- `BranchSelection.jsx` — branch picker
- `ServiceSelection.jsx` — service cards with price/duration
- `DateTimeSelection.jsx` — calendar + time slot picker
- `CustomerForm.jsx` — customer info form (React Hook Form)
- `BookingConfirmation.jsx` — review before submit
- `BookingSuccess.jsx` — success state with booking number

**Pattern:** Multi-step wizard with localStorage persistence

## Reusable UI Components (src/components/ui/)

### Button.jsx
Variants: primary, secondary, success, danger, warning, info, ghost, link, outline, text
Sizes: 2xs, xs, sm, md, lg, xl, 2xl
Shapes: rounded, square, pill, circle
Props: iconName, iconPosition, loading, fullWidth, disabled

### Input.jsx
Types: text (default), checkbox, radio
Uses forwardRef for React Hook Form compatibility

### Select.jsx
Standard select dropdown with consistent styling

### Checkbox.jsx
Styled checkbox with label support

### StaffSidebar.jsx
Side navigation for staff/manager pages — uses useAuth() for user info

### CustomerHeader.jsx
Top navigation for customer-facing pages — BooX branding

### AuthenticationModal.jsx
Login/register modal overlay

### BookingActionModal.jsx
Confirmation modal for booking actions (cancel, reschedule, etc.)
