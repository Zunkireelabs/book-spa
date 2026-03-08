import React, { useState, useEffect, useCallback } from 'react';
import StaffHeader from './components/StaffHeader';
import QuickFilters from './components/QuickFilters';
import BookingsList from './components/BookingsList';
import TherapistAvailability from './components/TherapistAvailability';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { fetchBookings, fetchTherapists, updateBookingStatus, assignTherapist, recordPayment } from '../../services/api';
import { transformBookings, toDbStatus } from '../../services/bookingTransformers';

const BranchStaffDashboard = () => {
  const { profile } = useAuth();
  const { branchId } = useBranch();

  const [filters, setFilters] = useState({
    dateRange: 'today',
    serviceType: 'all',
    status: 'all',
    search: ''
  });

  const [bookings, setBookings] = useState([]);
  const [filteredBookings, setFilteredBookings] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [bookingCounts, setBookingCounts] = useState({
    confirmed: 0,
    pending: 0,
    inProgress: 0,
    completed: 0
  });

  // Compute date filter from dateRange value
  const getDateFilter = useCallback((dateRange) => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];

    switch (dateRange) {
      case 'today':
        return { date: fmt(today) };
      case 'tomorrow': {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return { date: fmt(tomorrow) };
      }
      case 'week':
      case 'month':
        // Fetch all bookings (no date filter) — client-side filtering not needed
        // since we want to show everything in the range
        return {};
      default:
        return { date: fmt(today) };
    }
  }, []);

  // Extracted loadData so it can be called after mutations
  const loadData = useCallback(async (dateRange) => {
    if (!branchId) return;
    setLoading(true);

    const dateFilter = getDateFilter(dateRange || filters.dateRange);
    const [bookingsResult, therapistsResult] = await Promise.all([
      fetchBookings(branchId, dateFilter),
      fetchTherapists(branchId),
    ]);

    if (bookingsResult.data) {
      const transformed = transformBookings(bookingsResult.data);
      setBookings(transformed);
      calculateBookingCounts(transformed);
    }

    if (therapistsResult.data) {
      const mapped = therapistsResult.data.map(t => ({
        id: t.id,
        name: t.name,
        gender: t.gender,
        specialties: t.specialties || [],
        room: null,
        status: 'available',
        currentBooking: null,
      }));
      setTherapists(mapped);
    }

    setLoading(false);
  }, [branchId, filters.dateRange, getDateFilter]);

  // Fetch data on mount and when dateRange filter changes
  useEffect(() => {
    loadData(filters.dateRange);
  }, [branchId, filters.dateRange]);

  // Filter bookings based on current filters
  useEffect(() => {
    let filtered = [...bookings];

    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filtered = filtered.filter(booking =>
        booking.id.toLowerCase().includes(searchTerm) ||
        booking.customerName.toLowerCase().includes(searchTerm) ||
        (booking.customerPhone && booking.customerPhone.includes(searchTerm)) ||
        (booking.customerEmail && booking.customerEmail.toLowerCase().includes(searchTerm))
      );
    }

    if (filters.serviceType !== 'all') {
      const serviceMap = {
        massage: ['Deep Tissue Massage', 'Swedish Massage', 'Sports Massage'],
        facial: ['Facial Treatment', 'Anti-Aging Facial'],
        body: ['Body Wrap', 'Body Scrub'],
        aromatherapy: ['Aromatherapy Massage', 'Aromatherapy'],
        reflexology: ['Reflexology', 'Foot Reflexology']
      };

      if (serviceMap[filters.serviceType]) {
        filtered = filtered.filter(booking =>
          serviceMap[filters.serviceType].some(service =>
            booking.service.includes(service)
          )
        );
      }
    }

    if (filters.status !== 'all') {
      filtered = filtered.filter(booking => booking.status === filters.status);
    }

    filtered.sort((a, b) => a.time.localeCompare(b.time));
    setFilteredBookings(filtered);
  }, [bookings, filters]);

  const calculateBookingCounts = (bookingsList) => {
    const counts = { confirmed: 0, pending: 0, inProgress: 0, completed: 0 };
    bookingsList.forEach(booking => {
      switch (booking.status) {
        case 'confirmed': counts.confirmed++; break;
        case 'pending': counts.pending++; break;
        case 'in-progress': counts.inProgress++; break;
        case 'completed': counts.completed++; break;
        default: break;
      }
    });
    setBookingCounts(counts);
  };

  const showError = (msg) => {
    setActionError(msg);
    setTimeout(() => setActionError(null), 5000);
  };

  const showSuccess = (msg) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
  };

  // Wire to real API: updateBookingStatus
  const handleStatusUpdate = async (bookingId, newStatus) => {
    setActionError(null);
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus });

    if (result.error) {
      showError(result.error.message || 'Failed to update status.');
      return;
    }

    showSuccess(`Status updated to ${newStatus}`);
    await loadData();
  };

  // Wire to real API: assignTherapist
  const handleAssignTherapist = async (bookingId, therapistId, notes) => {
    setActionError(null);
    const result = await assignTherapist({ bookingId, therapistId });

    if (result.error) {
      showError(result.error.message || 'Failed to assign therapist.');
      return;
    }

    showSuccess('Therapist assigned successfully');
    await loadData();
  };

  // Wire to real API: recordPayment
  const handleRecordPayment = async (bookingId, { paymentMode, notes }) => {
    setActionError(null);
    const result = await recordPayment({ bookingId, paymentMode, notes });

    if (result.error) {
      return { error: result.error };
    }

    showSuccess('Payment recorded successfully');
    await loadData();
    return { error: null };
  };

  return (
    <div className="min-h-screen bg-background">
      <StaffHeader />

      {/* Toast notifications */}
      {actionError && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-toast bg-error text-white px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2">
          <span className="font-body font-body-medium text-sm">{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-2 hover:opacity-80 text-white">✕</button>
        </div>
      )}
      {actionSuccess && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-toast bg-success text-white px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2">
          <span className="font-body font-body-medium text-sm">{actionSuccess}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3">
            <QuickFilters
              onFiltersChange={handleFiltersChange}
              bookingCounts={bookingCounts}
            />
          </div>

          <div className="lg:col-span-6">
            {loading ? (
              <div className="bg-surface rounded-spa-lg spa-shadow-resting p-12 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="font-body font-body-normal text-text-secondary">Loading bookings...</p>
              </div>
            ) : (
              <BookingsList
                bookings={filteredBookings}
                therapists={therapists}
                onStatusUpdate={handleStatusUpdate}
                onAssignTherapist={handleAssignTherapist}
                onRecordPayment={handleRecordPayment}
                onRefresh={loadData}
                dateRange={filters.dateRange}
              />
            )}
          </div>

          <div className="lg:col-span-3">
            <TherapistAvailability
              therapists={therapists}
              pendingBookings={bookings.filter(b => b.status === 'pending' && !b.therapist)}
              onAssignTherapist={handleAssignTherapist}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BranchStaffDashboard;
