import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import CustomerBookingFlow from "pages/customer-booking-flow";
import StaffLoginAuthentication from "pages/staff-login-authentication";
import BranchStaffDashboard from "pages/branch-staff-dashboard";
import BookingManagementPortal from "pages/booking-management-portal";
import BookingDetailsAssignmentModal from "pages/booking-details-assignment-modal";
import BranchManagerDashboard from "pages/branch-manager-dashboard";
import NotFound from "pages/NotFound";

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <ScrollToTop />
      <RouterRoutes>
        {/* Public routes */}
        <Route path="/" element={<CustomerBookingFlow />} />
        <Route path="/customer-booking-flow" element={<CustomerBookingFlow />} />
        <Route path="/staff-login-authentication" element={<StaffLoginAuthentication />} />

        {/* Protected routes - staff, manager, admin */}
        <Route path="/branch-staff-dashboard" element={
          <ProtectedRoute allowedRoles={['staff', 'manager', 'admin']}>
            <BranchStaffDashboard />
          </ProtectedRoute>
        } />
        <Route path="/booking-management-portal" element={
          <ProtectedRoute allowedRoles={['staff', 'manager', 'admin']}>
            <BookingManagementPortal />
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
    </BrowserRouter>
  );
};

export default Routes;
