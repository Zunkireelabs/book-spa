import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
// Add your imports here
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
        {/* Define your routes here */}
        <Route path="/" element={<CustomerBookingFlow />} />
        <Route path="/customer-booking-flow" element={<CustomerBookingFlow />} />
        <Route path="/staff-login-authentication" element={<StaffLoginAuthentication />} />
        <Route path="/branch-staff-dashboard" element={<BranchStaffDashboard />} />
        <Route path="/booking-management-portal" element={<BookingManagementPortal />} />
        <Route path="/booking-details-assignment-modal" element={<BookingDetailsAssignmentModal />} />
        <Route path="/branch-manager-dashboard" element={<BranchManagerDashboard />} />
        <Route path="*" element={<NotFound />} />
      </RouterRoutes>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;