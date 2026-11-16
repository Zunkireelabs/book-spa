import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import BranchPending from '../branch-manager-dashboard/components/Area/BranchPending';
import AreaTabs from '../branch-manager-dashboard/components/Area/AreaTabs';
import { getAreaForView } from '../branch-manager-dashboard/components/Area/areaTabsRegistry';
import AppShell from '../../components/ui/AppShell';
import QuickFilters from './components/QuickFilters';
import BookingsList from './components/BookingsList';
import BookingsViewPanel from '../branch-manager-dashboard/components/BookingsViewPanel';
import StaffBookingForm from './components/StaffBookingForm';
import DashboardHome from '../dashboard-home';
import { hasOwnBookingsToday } from '../../lib/dashboardViews';
import CheckBookingPanel from './components/CheckBookingPanel';
import CollectPaymentPanel from './components/CollectPaymentPanel';
import TherapistAvailability from './components/TherapistAvailability';
import OperationalCalendar from '../branch-manager-dashboard/components/calendar';
import EnrollMemberPanel from '../branch-manager-dashboard/components/Memberships/EnrollMemberPanel';
import NewVoucherPanel from '../branch-manager-dashboard/components/Vouchers/NewVoucherPanel';
import RevenueCards from '../branch-manager-dashboard/components/RevenueCards';
import TipsSummaryCard from '../branch-manager-dashboard/components/TipsSummaryCard';
import TodayInsightsPanel from '../branch-manager-dashboard/components/TodayInsightsPanel';
import ProductsPage from '../branch-manager-dashboard/components/Products/ProductsPage';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { fetchBookings, fetchTherapists, updateBookingStatus, assignTherapist, recordPayment, recordTip, applyDiscount, fetchMyTherapistId } from '../../services/api';
import { transformBookings, toDbStatus, isNoShow } from '../../services/bookingTransformers';
import { supabase } from '../../lib/supabase';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED, PRODUCTS_ENABLED } from '../../lib/featureFlags';
import { getTodayISO, toISO } from '../../utils/periodPresets';

const BranchStaffDashboard = () => {
  const { profile, user } = useAuth();
  const { branchId, branchName, loading: branchLoading } = useBranch();
  // The therapist this login is (therapists.user_id, migration-377), for the "My day" view.
  const [myTherapistId, setMyTherapistId] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchMyTherapistId(profile?.id).then(({ data }) => { if (!cancelled) setMyTherapistId(data); });
    return () => { cancelled = true; };
  }, [profile?.id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = searchParams.get('view') || 'calendar'; // staff land on the calendar; the sidebar's Dashboard link is ?view=dashboard
  const [currentTime, setCurrentTime] = useState(new Date());

  // Recomputes only when the calendar date actually rolls over (via the
  // 60s currentTime tick below), not on every tick — avoids re-fetching
  // RevenueCards/TodayInsightsPanel every minute for no reason.
  const todayDateStr = getTodayISO();
  const todayPeriod = useMemo(
    () => ({ key: 'daily', from: todayDateStr, to: todayDateStr }),
    [todayDateStr]
  );

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

  // Helper to format date as YYYY-MM-DD (Nepal-local, not UTC)
  const formatDate = useCallback((d) => toISO(d), []);

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
    const fmt = (d) => toISO(d);

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
      fetchTherapists(branchId, { date: dateFilter.date }),
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


    const handleRealtimeUpdate = (payload) => {
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
      // No-Show status buttons were removed — a No-Show booking now carries
      // status='cancelled' + cancellationReason='No Show' instead of the old
      // real status='no show', so the "No Show" filter needs isNoShow()
      // rather than a literal equality check to still match anything.
      filtered = filters.status === 'no show'
        ? filtered.filter(isNoShow)
        : filtered.filter(booking => booking.status === filters.status);
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
  const handleStatusUpdate = async (bookingId, newStatus, reason) => {
    setActionError(null);
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus, reason });

    if (result.error) {
      showError(result.error.message || 'Failed to update status.');
      return;
    }

    showSuccess(`Status updated to ${newStatus}`);
    await loadData();
  };

  // Wire to real API: assignTherapist
  const handleAssignTherapist = async (bookingId, therapistIds, notes) => {
    setActionError(null);
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const result = await assignTherapist({ bookingId, therapistIds: ids });

    if (result.error) {
      showError(result.error.message || 'Failed to assign therapist.');
      return;
    }

    showSuccess('Therapist assigned successfully');
    await loadData();
  };

  // Wire to real API: recordPayment
  const handleRecordPayment = async (bookingId, opts) => {
    setActionError(null);
    const { tipSplits, ...paymentOpts } = opts;
    const result = await recordPayment({ bookingId, ...paymentOpts });

    if (result.error) {
      return { error: result.error };
    }

    // Best-effort — tip is logged separately (migration-240) and must never
    // undo or block a payment that already succeeded.
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }

    showSuccess('Payment recorded successfully');
    await loadData();
    return { error: null };
  };

  // Tail-only counterpart to handleRecordPayment, for the atomic
  // recordGroupPayment path (migration-178, BookingActionModal) — the write
  // itself already happened in one transaction covering every booking in
  // the bundle, so this just does the same refresh/toast handleRecordPayment
  // does, once, instead of once per booking.
  const handleGroupPaymentRecorded = () => {
    setActionError(null);
    showSuccess('Payment recorded successfully');
    loadData();
  };

  // Wire to real API: applyDiscount
  const handleApplyDiscount = async (bookingId, { discountType, discountValue, discountReason, requestedTo }) => {
    setActionError(null);
    const result = await applyDiscount({ bookingId, discountType, discountValue, discountReason, requestedTo });
    if (result.error) {
      return { error: result.error };
    }
    showSuccess(result.data?.isPending ? 'Discount request sent for approval' : 'Discount applied successfully');
    await loadData();
    return { data: result.data };
  };

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Re-fetch when the Nepal-local calendar date rolls over while viewing
  // "today" — otherwise the list can sit on yesterday's data indefinitely
  // if no booking mutation/realtime event happens to trigger a refresh.
  // Reuses todayDateStr (declared near the top of the component, also
  // used for todayPeriod) instead of a second getTodayISO() call.
  const lastLoadedDateRef = useRef(todayDateStr);
  useEffect(() => {
    if (filters.dateRange === 'today' && todayDateStr !== lastLoadedDateRef.current) {
      lastLoadedDateRef.current = todayDateStr;
      loadData('today');
    }
  }, [todayDateStr, filters.dateRange, loadData]);

  const userName = profile?.full_name || 'Staff Member';
  const userRole = profile?.role || 'staff';

  // Staff get one tabbed area, Bookings (All bookings, New booking, Check booking, Collect payment, ...).
  // Staff also get the Products area (Products + Categories tabs) when the flag is on.
  const bookingsArea = getAreaForView('bookings');
  const productsArea = PRODUCTS_ENABLED ? getAreaForView('products') : null;
  const areaForView = bookingsArea.tabs.some((t) => t.view === viewMode) ? bookingsArea : (productsArea && productsArea.tabs.some((t) => t.view === viewMode) ? productsArea : null);
  // Bookings, "New membership" and "New voucher" share one tree: the bookings list keeps its key and the panel is the second
  // child, so switching between these tabs doesn't remount the list (which would refetch and flash).
  const withBookingsList = (overlay = null) => (
    <>
      <BookingsViewPanel key="bookings-list" branchId={branchId} />
      {overlay}
    </>
  );
  const renderAreaView = (view) => {
    if (branchLoading) return <BranchPending />; // panels need the resolved branch
    switch (view) {
      case 'bookings': return withBookingsList();
      case 'collect-payment': return <CollectPaymentPanel onSuccess={showSuccess} />;
      case 'new-booking': return <StaffBookingForm onBookingCreated={loadData} />;
      case 'check-booking': return <CheckBookingPanel branchId={branchId} />;
      case 'new-membership':
        return withBookingsList(MEMBERSHIP_ENABLED ? (
          <EnrollMemberPanel
            onClose={() => setSearchParams({ view: 'bookings' })}
            onEnrolled={(id, info) => {
              setSearchParams({ view: 'bookings' });
              showSuccess(info?.message || 'Membership created.');
            }}
          />
        ) : null);
      case 'new-voucher':
        return withBookingsList(VOUCHER_ENABLED ? (
          <NewVoucherPanel
            userRole={userRole}
            onClose={() => setSearchParams({ view: 'bookings' })}
            onIssued={() => {
              setSearchParams({ view: 'bookings' });
              showSuccess('Voucher issued.');
            }}
          />
        ) : null);
      case 'products':
      case 'product-categories': return <ProductsPage view={view} />;
      default: return null;
    }
  };

  return (
    <AppShell
      variant={viewMode === 'calendar' || areaForView ? 'fill' : 'page'}
      header={{
        realtimeStatus,
      }}
      floating={
        <>
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
        </>
      }
    >
      {viewMode === 'dashboard' ? (
        <DashboardHome hasBookingsToday={hasOwnBookingsToday(bookings, myTherapistId)} />
      ) : viewMode === 'calendar' ? (
        <OperationalCalendar branchId={branchId} />
      ) : areaForView ? (
        <AreaTabs area={areaForView} view={viewMode}>{renderAreaView(viewMode)}</AreaTabs>
      ) : (
        <StaffBookingForm onBookingCreated={loadData} />
      )}
    </AppShell>
  );
};

export default BranchStaffDashboard;
