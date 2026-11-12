import React, { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation, useParams, Navigate } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import BrandMark from "components/ui/BrandMark";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import { TenantProvider } from "contexts/TenantContext";
import { useAuth } from "contexts/AuthContext";
import { PlatformAuthProvider } from 'contexts/PlatformAuthContext';
import ProtectedPlatformRoute from 'components/ProtectedPlatformRoute';
import { PLATFORM_ADMIN_ENABLED } from 'lib/featureFlags';

// Route components are lazy-loaded so a visitor only downloads the page they
// asked for. Before this, all 20 pages were static imports, so Vite emitted a
// single 4.19 MB chunk (986 kB gzipped) and a customer opening /:orgSlug/book
// paid for the manager dashboard, payroll panel, charts and the XLSX exporter
// before anything rendered. See docs/planning/perf-audit-2026-11-12.html.
const CustomerBookingFlowV2 = lazy(() => import("pages/customer-booking-flow-v2"));
const StaffLoginAuthentication = lazy(() => import("pages/login"));
const BranchStaffDashboard = lazy(() => import("pages/branch-staff-dashboard"));
const BookingDetailsAssignmentModal = lazy(() => import("pages/booking-details-assignment-modal"));
const StaffDetailPage = lazy(() => import("pages/staff-detail"));
const LocationDetailPage = lazy(() => import("pages/location-detail"));
const ServiceDetailPage = lazy(() => import("pages/service-detail"));
const CustomerDetailPage = lazy(() => import("pages/customer-detail"));
const CustomerSentMessagesPage = lazy(() => import("pages/customer-sent-messages"));
const BranchManagerDashboard = lazy(() => import("pages/branch-manager-dashboard"));
const AttendanceCalendarPage = lazy(() => import("pages/attendance-calendar"));
const OrgFinder = lazy(() => import("pages/org-finder"));
const CustomerOrgFinder = lazy(() => import("pages/customer-org-finder"));
const CustomerLoginAuthentication = lazy(() => import("pages/customer-login"));
const CustomerSignup = lazy(() => import("pages/customer-signup"));
const CustomerAccount = lazy(() => import("pages/customer-account"));
const NotFound = lazy(() => import("pages/NotFound"));
const PlatformLogin = lazy(() => import("pages/platform/PlatformLogin"));
const PlatformDashboard = lazy(() => import("pages/platform/PlatformDashboard"));
const PlatformOrgDetail = lazy(() => import("pages/platform/PlatformOrgDetail"));

// External redirect component for root URL
const ExternalRedirect = ({ to }) => {
  useEffect(() => {
    window.location.href = to;
  }, [to]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-text-secondary">Redirecting...</p>
      </div>
    </div>
  );
};

// Wrapper component that provides tenant context
const TenantWrapper = ({ children }) => (
  <TenantProvider>
    {children}
  </TenantProvider>
);

// Loading component
const LoadingScreen = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center space-y-4">
      <div className="animate-pulse">
        <BrandMark className="h-12 w-auto" />
      </div>
      <p className="font-body font-body-normal text-sm text-text-secondary">
        Loading...
      </p>
    </div>
  </div>
);

// Legacy dashboard redirect - redirects old URLs to org-scoped URLs
const LegacyDashboardRedirect = () => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  // Not logged in - redirect to org finder
  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  // Get org slug from profile
  const orgSlug = profile?.organizations?.slug;
  if (!orgSlug) {
    // No org slug found - something is wrong, go to org finder
    return <Navigate to="/login" replace />;
  }

  // Redirect to org-scoped dashboard
  return <Navigate to={`/${orgSlug}/dashboard`} replace />;
};

// Unified Dashboard - renders appropriate dashboard based on role
const UnifiedDashboard = () => {
  const { profile } = useAuth();
  const isManagerOrAdmin = ['manager', 'admin', 'admin_viewer'].includes(profile?.role);

  if (isManagerOrAdmin) {
    return <BranchManagerDashboard />;
  }

  return <BranchStaffDashboard />;
};

const AppRoutes = () => {
  const location = useLocation();
  return (
      <ErrorBoundary key={location.pathname}>
      <ScrollToTop />
      <Suspense fallback={<LoadingScreen />}>
      <RouterRoutes>
        {/* Root redirects to Zunkireelabs product page */}
        <Route path="/" element={<ExternalRedirect to="https://www.zunkireelabs.com/products/ai-booking-engine/" />} />

        {/* ==================== ORG-SCOPED STAFF ROUTES ==================== */}

        {/* Org-scoped login */}
        <Route path="/:orgSlug/login" element={
          <TenantWrapper>
            <StaffLoginAuthentication />
          </TenantWrapper>
        } />

        {/* Org-scoped unified dashboard (role determines view) */}
        <Route path="/:orgSlug/dashboard" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['staff', 'manager', 'admin', 'admin_viewer']}>
              <UnifiedDashboard />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* Attendance calendar — dedicated full-page grid view */}
        <Route path="/:orgSlug/attendance-calendar" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['manager', 'admin', 'admin_viewer']}>
              <AttendanceCalendarPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* Org-scoped booking details */}
        <Route path="/:orgSlug/bookings/:bookingId" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['staff', 'manager', 'admin', 'admin_viewer']}>
              <BookingDetailsAssignmentModal />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* Org-scoped staff detail (add/edit) — one page handles both flows,
            :staffId present = edit, absent (/staff/new) = create */}
        <Route path="/:orgSlug/staff/new" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['manager', 'admin']}>
              <StaffDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />
        <Route path="/:orgSlug/staff/:staffId" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['manager', 'admin', 'admin_viewer']}>
              <StaffDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* Org-scoped location detail (add/edit) — same one-page-handles-both-flows
            pattern as staff/service detail above: :branchId present = edit, absent
            (/locations/new) = create. Admin-only (no manager/admin_viewer — Locations
            manages branches org-wide, unlike per-branch staff/service writes). */}
        <Route path="/:orgSlug/locations/new" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['admin']}>
              <LocationDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />
        <Route path="/:orgSlug/locations/:branchId" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['admin']}>
              <LocationDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* Org-scoped service detail (add/edit) — same one-page-handles-both-flows
            pattern as staff detail above: :serviceId present = edit, absent
            (/services/new) = create. */}
        <Route path="/:orgSlug/services/new" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['manager', 'admin']}>
              <ServiceDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />
        <Route path="/:orgSlug/services/:serviceId" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['manager', 'admin']}>
              <ServiceDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* Org-scoped customer detail */}
        <Route path="/:orgSlug/customers/:customerId" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['staff', 'manager', 'admin', 'admin_viewer']}>
              <CustomerDetailPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        <Route path="/:orgSlug/customers/:customerId/messages" element={
          <TenantWrapper>
            <ProtectedRoute allowedRoles={['staff', 'manager', 'admin', 'admin_viewer']}>
              <CustomerSentMessagesPage />
            </ProtectedRoute>
          </TenantWrapper>
        } />

        {/* ==================== PLATFORM ADMIN ROUTES (flag-gated) ==================== */}
        {PLATFORM_ADMIN_ENABLED && (
          <>
            <Route path="/platform/login" element={
              <PlatformAuthProvider><PlatformLogin /></PlatformAuthProvider>
            } />
            <Route path="/platform/dashboard" element={
              <PlatformAuthProvider>
                <ProtectedPlatformRoute><PlatformDashboard /></ProtectedPlatformRoute>
              </PlatformAuthProvider>
            } />
            <Route path="/platform/dashboard/:orgId" element={
              <PlatformAuthProvider>
                <ProtectedPlatformRoute><PlatformOrgDetail /></ProtectedPlatformRoute>
              </PlatformAuthProvider>
            } />
          </>
        )}

        {/* ==================== LEGACY STAFF ROUTES (REDIRECTS) ==================== */}

        {/* Legacy /login - shows org finder for non-logged-in, redirects logged-in users */}
        <Route path="/login" element={<OrgFinder />} />

        {/* Legacy staff dashboard - redirect to org-scoped URL */}
        <Route path="/branch-staff-dashboard" element={<LegacyDashboardRedirect />} />

        {/* Legacy manager dashboard - redirect to org-scoped URL */}
        <Route path="/branch-manager-dashboard" element={<LegacyDashboardRedirect />} />

        {/* Legacy booking details modal (no booking ID) - redirect to dashboard */}
        <Route path="/booking-details-assignment-modal" element={<LegacyDashboardRedirect />} />

        {/* Legacy booking details with ID - redirect to org-scoped URL */}
        <Route path="/booking-details/:bookingId" element={<LegacyBookingRedirect />} />

        {/* ==================== CUSTOMER-FACING ROUTES ==================== */}

        {/* Customer booking flow — v2 (side-by-side service + booking panel) is now the
            live default; v1 (pages/customer-booking-flow) stays in the repo, unrouted, in
            case of a fast rollback. */}
        <Route path="/:orgSlug/book" element={<TenantWrapper><CustomerBookingFlowV2 /></TenantWrapper>} />
        <Route path="/:orgSlug/manage" element={<ManageRedirect />} />

        {/* Customer login / signup / account */}
        <Route path="/:orgSlug/customer-login" element={<TenantWrapper><CustomerLoginAuthentication /></TenantWrapper>} />
        <Route path="/:orgSlug/signup" element={<TenantWrapper><CustomerSignup /></TenantWrapper>} />
        <Route path="/:orgSlug/account" element={<TenantWrapper><CustomerAccount /></TenantWrapper>} />

        {/* Legacy customer routes — predate multi-tenancy, no single default org to
            assume anymore (multiple orgs are live in production). Send to a
            customer-facing org picker instead of a hardcoded tenant. */}
        <Route path="/customer-booking-flow" element={<CustomerOrgFinder />} />
        <Route path="/booking-management-portal" element={<CustomerOrgFinder />} />

        {/* ==================== CATCH-ALL ==================== */}

        {/* Org slug without explicit path - treat as customer booking (existing behavior) */}
        <Route path="/:orgSlug" element={<TenantWrapper><CustomerBookingFlowV2 /></TenantWrapper>} />

        <Route path="*" element={<NotFound />} />
      </RouterRoutes>
      </Suspense>
      </ErrorBoundary>
  );
};

// Booking self-service search moved to staff-only "Check Booking" — send anyone
// still hitting the old public /:orgSlug/manage URL back to the booking flow.
const ManageRedirect = () => {
  const { orgSlug } = useParams();
  return <Navigate to={`/${orgSlug}/book`} replace />;
};

// Legacy booking redirect - redirects old /booking-details/:bookingId to org-scoped URL
const LegacyBookingRedirect = () => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingScreen />;
  }

  // Not logged in - redirect to org finder
  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  // Get org slug from profile
  const orgSlug = profile?.organizations?.slug;
  if (!orgSlug) {
    return <Navigate to="/login" replace />;
  }

  // Extract booking ID from path
  const bookingId = location.pathname.split('/').pop();

  // Redirect to org-scoped booking details
  return <Navigate to={`/${orgSlug}/bookings/${bookingId}`} replace />;
};

const Routes = () => (
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>
);

export default Routes;
