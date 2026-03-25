import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import StaffSidebar from '../../components/ui/StaffSidebar';
import Icon from '../../components/AppIcon';
import QuickFilters from './components/QuickFilters';
import BookingsList from './components/BookingsList';
import BookingLookupPanel from './components/BookingLookupPanel';
import StaffBookingForm from './components/StaffBookingForm';
import TherapistAvailability from './components/TherapistAvailability';
import OperationalCalendar from '../branch-manager-dashboard/components/calendar';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { fetchBookings, fetchTherapists, updateBookingStatus, assignTherapist, recordPayment, applyDiscount } from '../../services/api';
import { transformBookings, toDbStatus } from '../../services/bookingTransformers';
import { supabase } from '../../lib/supabase';

const BranchStaffDashboard = () => {
  const { profile } = useAuth();
  const { branchId, branchName } = useBranch();
  const [searchParams] = useSearchParams();

  const viewMode = searchParams.get('view') || 'dashboard';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

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
      case 'week': {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        return { dateFrom: fmt(weekStart), dateTo: fmt(weekEnd) };
      }
      case 'month': {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { dateFrom: fmt(monthStart), dateTo: fmt(monthEnd) };
      }
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

    const transformed = bookingsResult.data ? transformBookings(bookingsResult.data) : [];
    if (bookingsResult.data) {
      setBookings(transformed);
      calculateBookingCounts(transformed);
    }

    if (therapistsResult.data) {
      const mapped = therapistsResult.data.map(t => {
        // Check if therapist has an in-progress booking right now
        const activeBooking = transformed.find(b =>
          b.therapistId === t.id &&
          b.status === 'in-progress'
        );
        const upcomingBooking = transformed.find(b =>
          b.therapistId === t.id &&
          ['confirmed', 'pending'].includes(b.status)
        );
        return {
          id: t.id,
          name: t.name,
          gender: t.gender,
          specialties: t.specialties || [],
          room: null,
          status: activeBooking ? 'busy' : upcomingBooking ? 'upcoming' : 'available',
          currentBooking: activeBooking ? activeBooking.service : null,
        };
      });
      setTherapists(mapped);
    }

    setLoading(false);
  }, [branchId, filters.dateRange, getDateFilter]);

  // Fetch data on mount and when dateRange filter changes
  useEffect(() => {
    loadData(filters.dateRange);
  }, [loadData, filters.dateRange]);

  // Real-time subscription for booking changes
  useEffect(() => {
    if (!branchId) return;
    const channel = supabase
      .channel(`bookings-staff-${branchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `branch_id=eq.${branchId}`
      }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [branchId, loadData]);

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

  // Wire to real API: applyDiscount
  const handleApplyDiscount = async (bookingId, { discountType, discountValue, discountReason }) => {
    setActionError(null);
    const result = await applyDiscount({ bookingId, discountType, discountValue, discountReason });
    if (result.error) {
      return { error: result.error };
    }
    showSuccess('Discount applied successfully');
    await loadData();
    return { error: null };
  };

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const userName = profile?.full_name || 'Staff Member';
  const userRole = profile?.role || 'staff';

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar
        onCollapseChange={setSidebarCollapsed}
      />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'} lg:pb-0 pb-16 spa-transition-slow`}>
        {/* Compact Top Bar */}
        <header className="bg-surface border-b border-border sticky top-0 z-header">
          <div className="px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center justify-between">
              {/* Left: Branch + date/time */}
              <div className="flex items-center space-x-3 min-w-0">
                <div className="flex items-center space-x-2">
                  <Icon name="MapPin" size={14} className="text-primary" />
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {branchName || 'Main Branch'}
                  </span>
                </div>
                <div className="hidden sm:block h-5 w-px bg-border"></div>
                <p className="hidden sm:block font-caption font-caption-normal text-xs text-text-secondary">
                  {currentTime.toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short'
                  })} {'\u00B7'} {currentTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>

              {/* Right: Role badge + Profile */}
              <div className="flex items-center space-x-3 flex-shrink-0">
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal capitalize bg-accent/10 text-accent">
                  {userRole}
                </span>
                <div className="flex items-center space-x-2 px-2 py-1 rounded-spa">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <Icon name="User" size={16} className="text-primary" />
                  </div>
                  <div className="hidden md:flex flex-col">
                    <span className="font-body font-body-medium text-sm text-text-primary leading-tight">
                      {userName}
                    </span>
                    <span className="font-caption font-caption-normal text-xs text-text-secondary capitalize leading-tight">
                      {userRole}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

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

        <div className="px-4 sm:px-6 lg:px-8 py-6">
          {viewMode === 'dashboard' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
              <div className="md:col-span-1 lg:col-span-3">
                <QuickFilters
                  onFiltersChange={handleFiltersChange}
                  bookingCounts={bookingCounts}
                />
              </div>

              <div className="md:col-span-1 lg:col-span-6">
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
                    onApplyDiscount={handleApplyDiscount}
                    userRole={profile?.role || 'staff'}
                    onRefresh={loadData}
                    dateRange={filters.dateRange}
                  />
                )}
              </div>

              <div className="md:col-span-2 lg:col-span-3">
                <TherapistAvailability
                  therapists={therapists}
                  pendingBookings={bookings.filter(b => b.status === 'pending' && !b.therapist)}
                  onAssignTherapist={handleAssignTherapist}
                />
              </div>
            </div>
          ) : viewMode === 'bookings' ? (
            <BookingLookupPanel
              therapists={therapists}
              onStatusUpdate={handleStatusUpdate}
              onAssignTherapist={handleAssignTherapist}
              onRecordPayment={handleRecordPayment}
              onApplyDiscount={handleApplyDiscount}
              userRole={profile?.role || 'staff'}
              onRefresh={loadData}
            />
          ) : viewMode === 'calendar' ? (
            <OperationalCalendar branchId={branchId} heightOffset={112} />
          ) : viewMode === 'new-booking' ? (
            <StaffBookingForm onBookingCreated={loadData} />
          ) : (
            <StaffBookingForm onBookingCreated={loadData} />
          )}
        </div>
      </div>
    </div>
  );
};

export default BranchStaffDashboard;
