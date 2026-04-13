import React, { useEffect } from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import { TenantProvider } from "contexts/TenantContext";
import CustomerBookingFlow from "pages/customer-booking-flow";
import StaffLoginAuthentication from "pages/login";
import BranchStaffDashboard from "pages/branch-staff-dashboard";
import BookingManagementPortal from "pages/booking-management-portal";
import BookingDetailsAssignmentModal from "pages/booking-details-assignment-modal";
import BranchManagerDashboard from "pages/branch-manager-dashboard";
import NotFound from "pages/NotFound";

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

const AppRoutes = () => {
  const location = useLocation();
  return (
      <ErrorBoundary key={location.pathname}>
      <ScrollToTop />
      <RouterRoutes>
        {/* Root redirects to Zunkireelabs product page */}
        <Route path="/" element={<ExternalRedirect to="https://www.zunkireelabs.com/products/ai-booking-engine/" />} />

        {/* Staff authentication */}
        <Route path="/login" element={<StaffLoginAuthentication />} />

        {/* Tenant-specific customer booking routes */}
        <Route path="/:orgSlug" element={<TenantWrapper><CustomerBookingFlow /></TenantWrapper>} />
        <Route path="/:orgSlug/manage" element={<TenantWrapper><BookingManagementPortal /></TenantWrapper>} />

        {/* Legacy routes - redirect to default tenant for backwards compatibility */}
        <Route path="/customer-booking-flow" element={<ExternalRedirect to="/nuad-thai-spa" />} />
        <Route path="/booking-management-portal" element={<ExternalRedirect to="/nuad-thai-spa/manage" />} />

        {/* Protected routes - staff, manager, admin */}
        <Route path="/branch-staff-dashboard" element={
          <ProtectedRoute allowedRoles={['staff', 'manager', 'admin']}>
            <BranchStaffDashboard />
          </ProtectedRoute>
        } />
        <Route path="/booking-details-assignment-modal" element={
          <ProtectedRoute allowedRoles={['staff', 'manager', 'admin']}>
            <BookingDetailsAssignmentModal />
          </ProtectedRoute>
        } />
        <Route path="/booking-details/:bookingId" element={
          <ProtectedRoute allowedRoles={['staff', 'manager', 'admin']}>
            <BookingDetailsAssignmentModal />
          </ProtectedRoute>
        } />

        {/* Protected routes - manager and admin only */}
        <Route path="/branch-manager-dashboard" element={
          <ProtectedRoute allowedRoles={['manager', 'admin']}>
            <BranchManagerDashboard />
          </ProtectedRoute>
        } />

        <Route path="*" element={<NotFound />} />
      </RouterRoutes>
      </ErrorBoundary>
  );
};

const Routes = () => (
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>
);

export default Routes;
