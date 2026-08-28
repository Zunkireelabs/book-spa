import React, { useEffect } from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation, useParams, Navigate } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import { TenantProvider } from "contexts/TenantContext";
import { useAuth } from "contexts/AuthContext";
import CustomerBookingFlowV2 from "pages/customer-booking-flow-v2";
import StaffLoginAuthentication from "pages/login";
import BranchStaffDashboard from "pages/branch-staff-dashboard";
import BookingDetailsAssignmentModal from "pages/booking-details-assignment-modal";
import BranchManagerDashboard from "pages/branch-manager-dashboard";
import AttendanceCalendarPage from "pages/attendance-calendar";
import OrgFinder from "pages/org-finder";
import CustomerLoginAuthentication from "pages/customer-login";
import CustomerSignup from "pages/customer-signup";
import CustomerAccount from "pages/customer-account";
import NotFound from "pages/NotFound";
import { PlatformAuthProvider } from 'contexts/PlatformAuthContext';
import ProtectedPlatformRoute from 'components/ProtectedPlatformRoute';
import PlatformLogin from 'pages/platform/PlatformLogin';
import PlatformDashboard from 'pages/platform/PlatformDashboard';
import PlatformOrgDetail from 'pages/platform/PlatformOrgDetail';
import { PLATFORM_ADMIN_ENABLED } from 'lib/featureFlags';

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
      <div className="w-12 h-12 bg-primary rounded-spa-lg flex items-center justify-center animate-pulse">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          className="text-primary-foreground"
        >
          <path
            d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
            fill="currentColor"
          />
          <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7" />
        </svg>
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

        {/* Legacy customer routes - redirect to default tenant for backwards compatibility */}
        <Route path="/customer-booking-flow" element={<ExternalRedirect to="/nuad-thai-spa/book" />} />
        <Route path="/booking-management-portal" element={<ExternalRedirect to="/nuad-thai-spa/book" />} />

        {/* ==================== CATCH-ALL ==================== */}

        {/* Org slug without explicit path - treat as customer booking (existing behavior) */}
        <Route path="/:orgSlug" element={<TenantWrapper><CustomerBookingFlowV2 /></TenantWrapper>} />

        <Route path="*" element={<NotFound />} />
      </RouterRoutes>
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
