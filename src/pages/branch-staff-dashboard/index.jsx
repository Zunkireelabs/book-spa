import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const { profile, signOut } = useAuth();
  const { branchId, branchName } = useBranch();
  const [searchParams] = useSearchParams();

  const viewMode = searchParams.get('view') || 'dashboard';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef(null);

  const [filters, setFilters] = useState({
    dateRange: 'today',
    serviceType: 'all',
    status: 'all',
    search: ''
  });

  // Ref to track current dateRange for real-time callbacks (avoids stale closures)
  const dateRangeRef = useRef(filters.dateRange);

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
  const [newBookingNotification, setNewBookingNotification] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected'

  // Helper to format date as YYYY-MM-DD
  const formatDate = useCallback((d) => d.toISOString().split('T')[0], []);

  // Check if a booking date falls within the current date filter
  const isDateInCurrentFilter = useCallback((bookingDate, dateRange) => {
    const today = new Date();
    const booking = new Date(bookingDate);

    switch (dateRange) {
      case 'today':
        return formatDate(booking) === formatDate(today);
      case 'tomorrow': {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return formatDate(booking) === formatDate(tomorrow);
      }
      case 'week': {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        return booking >= weekStart && booking <= weekEnd;
      }
      case 'month': {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return booking >= monthStart && booking <= monthEnd;
      }
      default:
        return formatDate(booking) === formatDate(today);
    }
  }, [formatDate]);

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

  // Keep ref in sync with current dateRange filter
  useEffect(() => {
    dateRangeRef.current = filters.dateRange;
  }, [filters.dateRange]);

  // Real-time subscription for booking changes
  useEffect(() => {
    if (!branchId) return;

    console.log('[Realtime] Setting up subscription for branch:', branchId);

    const handleRealtimeUpdate = (payload) => {
      console.log('[Realtime] Received event:', payload);
      // Small delay to ensure DB triggers (booking_number generation, end_time calculation) complete
      setTimeout(() => {
        // Use ref to get current dateRange, avoiding stale closure
        loadData(dateRangeRef.current);

        // Show notification for new bookings outside current date filter
        if (payload.eventType === 'INSERT' && payload.new) {
          const newBooking = payload.new;
          const isInView = isDateInCurrentFilter(newBooking.date, dateRangeRef.current);

          if (!isInView && newBooking.date) {
            const bookingDate = new Date(newBooking.date);
            const formattedDate = bookingDate.toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short'
            });
            setNewBookingNotification({
              message: `New booking received for ${formattedDate}`,
              customerName: newBooking.customer_name,
              date: newBooking.date,
              bookingNumber: newBooking.booking_number
            });

            // Auto-dismiss after 8 seconds
            setTimeout(() => setNewBookingNotification(null), 8000);
          }
        }
      }, 150);
    };

    const channel = supabase
      .channel(`bookings-staff-${branchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `branch_id=eq.${branchId}`
      }, handleRealtimeUpdate)
      .subscribe((status, err) => {
        console.log('[Realtime] Subscription status:', status, err || '');
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [branchId, loadData, isDateInCurrentFilter]);

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

  const getOverviewTitle = () => {
    switch (filters.dateRange) {
      case 'today': return "Today's Overview";
      case 'tomorrow': return "Tomorrow's Overview";
      case 'week': return "This Week's Overview";
      case 'month': return "This Month's Overview";
      default: return "Overview";
    }
  };

  // Handle viewing a booking from the new booking notification
  const handleViewNewBooking = (bookingDate) => {
    const today = new Date();
    const booking = new Date(bookingDate);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Determine which filter to set based on booking date
    let newDateRange = 'today';
    if (formatDate(booking) === formatDate(today)) {
      newDateRange = 'today';
    } else if (formatDate(booking) === formatDate(tomorrow)) {
      newDateRange = 'tomorrow';
    } else {
      // For other dates, use week or month view
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      if (booking >= weekStart && booking <= weekEnd) {
        newDateRange = 'week';
      } else {
        newDateRange = 'month';
      }
    }

    setFilters(prev => ({ ...prev, dateRange: newDateRange }));
    setNewBookingNotification(null);
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

  // Close profile dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target)) {
        setShowProfileDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setShowProfileDropdown(false);
    await signOut();
  };

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const userName = profile?.full_name || 'Staff Member';
  const userRole = profile?.role || 'staff';

  return (
    <div className="min-h-screen bg-[#ebebeb]">
      <StaffSidebar
        onCollapseChange={setSidebarCollapsed}
      />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} lg:pb-0 pb-16 transition-all duration-200`}>
        {/* Top Bar - Consistent with Admin */}
        <header className="bg-[#ebebeb] sticky top-0 z-header">
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

              {/* Right: Real-time status + Role badge + Profile */}
              <div className="flex items-center space-x-3 flex-shrink-0">
                {/* Real-time Status Indicator */}
                <div
                  className="hidden sm:flex items-center space-x-1.5 px-2 py-1 rounded-full bg-background border border-border"
                  title={`Real-time: ${realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting' : 'Offline'}`}
                >
                  <span className="relative flex h-2 w-2">
                    {realtimeStatus === 'connected' && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${
                      realtimeStatus === 'connected' ? 'bg-success' :
                      realtimeStatus === 'connecting' ? 'bg-warning' : 'bg-error'
                    }`}></span>
                  </span>
                  <span className="text-xs font-caption font-caption-medium text-text-secondary">
                    {realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting' : 'Offline'}
                  </span>
                </div>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal capitalize bg-accent/10 text-accent">
                  {userRole}
                </span>
                <div className="relative" ref={profileDropdownRef}>
                  <button
                    onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                    className="flex items-center space-x-2 px-2 py-1 rounded-spa hover:bg-black/5 transition-colors"
                  >
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon name="User" size={16} className="text-primary" />
                    </div>
                    <div className="hidden md:flex flex-col text-left">
                      <span className="font-body font-body-medium text-sm text-text-primary leading-tight">
                        {userName}
                      </span>
                      <span className="font-caption font-caption-normal text-xs text-text-secondary capitalize leading-tight">
                        {userRole}
                      </span>
                    </div>
                    <Icon name="ChevronDown" size={14} className={`hidden md:block text-text-secondary transition-transform ${showProfileDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showProfileDropdown && (
                    <div className="absolute right-0 mt-2 w-56 bg-background rounded-spa spa-shadow-elevated z-dropdown border border-border overflow-hidden">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center space-x-2 px-4 py-2.5 text-sm text-error hover:bg-error/5 transition-colors"
                      >
                        <Icon name="LogOut" size={16} />
                        <span className="font-body font-body-medium">Logout</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Toast notifications - Responsive positioning */}
        {actionError && (
          <div className="fixed top-16 sm:top-20 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-toast bg-error text-white px-4 sm:px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2">
            <span className="font-body font-body-medium text-sm flex-1">{actionError}</span>
            <button onClick={() => setActionError(null)} className="ml-2 hover:opacity-80 text-white p-1">
              <Icon name="X" size={16} />
            </button>
          </div>
        )}
        {actionSuccess && (
          <div className="fixed top-16 sm:top-20 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-toast bg-success text-white px-4 sm:px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2">
            <span className="font-body font-body-medium text-sm">{actionSuccess}</span>
          </div>
        )}
        {newBookingNotification && (
          <div className="fixed top-16 sm:top-20 left-4 right-4 sm:left-auto sm:right-6 z-toast bg-primary text-white px-4 sm:px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in sm:max-w-sm">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                <Icon name="CalendarPlus" size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body font-body-medium text-sm">{newBookingNotification.message}</p>
                {newBookingNotification.customerName && (
                  <p className="font-caption text-xs text-white/80 mt-0.5 truncate">
                    {newBookingNotification.customerName}
                    {newBookingNotification.bookingNumber && ` - ${newBookingNotification.bookingNumber}`}
                  </p>
                )}
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0">
                <button
                  onClick={() => handleViewNewBooking(newBookingNotification.date)}
                  className="px-2.5 py-1.5 bg-white/20 hover:bg-white/30 rounded text-xs font-body font-body-medium transition-colors min-h-[32px]"
                >
                  View
                </button>
                <button
                  onClick={() => setNewBookingNotification(null)}
                  className="hover:opacity-80 text-white/80 hover:text-white p-1 min-h-[32px]"
                >
                  <Icon name="X" size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area - Consistent with Admin */}
        <main className={`${viewMode === 'calendar' ? 'px-0 py-0' : 'px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4'} bg-[#f1f1f1] min-h-[calc(100vh-52px)]`} style={{ borderRadius: '16px 0 0 0', borderLeft: '1px solid #e5e7eb', borderTop: '1px solid #e5e7eb' }}>
          {viewMode === 'dashboard' ? (
            <div className="flex flex-col gap-2 sm:gap-3 min-h-[calc(100vh-120px)]">
              {/* Overview Stats */}
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">{getOverviewTitle()}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
                  <div className="text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Confirmed</div>
                  <div className="text-xl sm:text-2xl font-semibold text-emerald-600">{bookingCounts.confirmed}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
                  <div className="text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Pending</div>
                  <div className="text-xl sm:text-2xl font-semibold text-amber-500">{bookingCounts.pending}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
                  <div className="text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">In Progress</div>
                  <div className="text-xl sm:text-2xl font-semibold text-blue-600">{bookingCounts.inProgress}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
                  <div className="text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Completed</div>
                  <div className="text-xl sm:text-2xl font-semibold text-gray-400">{bookingCounts.completed}</div>
                </div>
              </div>

              {/* Inline Filters */}
              <QuickFilters
                onFiltersChange={handleFiltersChange}
                bookingCounts={bookingCounts}
              />

              {/* Main Grid - Responsive: stack on mobile, side-by-side on lg */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-3 flex-1">
                {/* Bookings List - Full width on mobile/tablet, 9 cols on desktop */}
                <div className="lg:col-span-9 order-1">
                  {loading ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-8 sm:p-12 text-center">
                      <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                      <p className="text-sm text-gray-500">Loading bookings...</p>
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

                {/* Therapist Panel - Below bookings on mobile, sidebar on desktop */}
                <div className="lg:col-span-3 order-2">
                  <TherapistAvailability
                    therapists={therapists}
                    pendingBookings={bookings.filter(b => b.status === 'pending' && !b.therapist)}
                    onAssignTherapist={handleAssignTherapist}
                  />
                </div>
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
            <OperationalCalendar branchId={branchId} heightOffset={56} />
          ) : viewMode === 'new-booking' ? (
            <StaffBookingForm onBookingCreated={loadData} />
          ) : (
            <StaffBookingForm onBookingCreated={loadData} />
          )}
        </main>
      </div>
    </div>
  );
};

export default BranchStaffDashboard;
