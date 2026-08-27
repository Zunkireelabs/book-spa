import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import QuickFilters from '../../branch-staff-dashboard/components/QuickFilters';
import BookingsList from '../../branch-staff-dashboard/components/BookingsList';
import TherapistAvailability from '../../branch-staff-dashboard/components/TherapistAvailability';
import { fetchBookings, fetchTherapists, updateBookingStatus, assignTherapist, recordPayment, applyDiscount } from '../../../services/api';
import { transformBookings, toDbStatus } from '../../../services/bookingTransformers';

const BookingsViewPanel = ({ branchId }) => {
  const { profile } = useAuth();
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
  const [actionToast, setActionToast] = useState(null);
  const [bookingCounts, setBookingCounts] = useState({
    confirmed: 0, pending: 0, inProgress: 0, completed: 0
  });

  const getDateFilter = useCallback((dateRange) => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
    switch (dateRange) {
      case 'today': return { date: fmt(today) };
      case 'tomorrow': {
        const t = new Date(today);
        t.setDate(t.getDate() + 1);
        return { date: fmt(t) };
      }
      case 'week':
      case 'month':
        return {};
      default:
        return { date: fmt(today) };
    }
  }, []);

  const loadData = useCallback(async (dateRange) => {
    if (!branchId) return;
    setLoading(true);

    const dateFilter = getDateFilter(dateRange || filters.dateRange);
    const [bookingsResult, therapistsResult] = await Promise.all([
      fetchBookings(branchId, dateFilter),
      fetchTherapists(branchId, { date: dateFilter.date }),
    ]);

    if (bookingsResult.data) {
      const transformed = transformBookings(bookingsResult.data);
      setBookings(transformed);
      calculateCounts(transformed);
    }

    if (therapistsResult.data) {
      setTherapists(therapistsResult.data.map(t => ({
        id: t.id,
        name: t.name,
        gender: t.gender,
        specialties: t.specialties || [],
        room: null,
        status: 'available',
        currentBooking: null,
      })));
    }

    setLoading(false);
  }, [branchId, filters.dateRange, getDateFilter]);

  useEffect(() => { loadData(filters.dateRange); }, [branchId, filters.dateRange]);

  useEffect(() => {
    let filtered = [...bookings];

    if (filters.search) {
      const term = filters.search.toLowerCase();
      filtered = filtered.filter(b =>
        b.id.toLowerCase().includes(term) ||
        b.customerName.toLowerCase().includes(term) ||
        (b.customerPhone && b.customerPhone.includes(term)) ||
        (b.customerEmail && b.customerEmail.toLowerCase().includes(term))
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
        filtered = filtered.filter(b =>
          serviceMap[filters.serviceType].some(s => b.service.includes(s))
        );
      }
    }

    if (filters.status !== 'all') {
      filtered = filtered.filter(b => b.status === filters.status);
    }

    filtered.sort((a, b) => a.time.localeCompare(b.time));
    setFilteredBookings(filtered);
  }, [bookings, filters]);

  const calculateCounts = (list) => {
    const counts = { confirmed: 0, pending: 0, inProgress: 0, completed: 0 };
    list.forEach(b => {
      if (b.status === 'confirmed') counts.confirmed++;
      else if (b.status === 'pending') counts.pending++;
      else if (b.status === 'in-progress') counts.inProgress++;
      else if (b.status === 'completed') counts.completed++;
    });
    setBookingCounts(counts);
  };

  const showToast = (msg, type = 'success') => {
    setActionToast({ msg, type });
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleStatusUpdate = async (bookingId, newStatus, reason) => {
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus, reason });
    if (result.error) { showToast(result.error.message || 'Failed to update status.', 'error'); return; }
    showToast(`Status updated to ${newStatus}`);
    await loadData();
  };

  const handleAssignTherapist = async (bookingId, therapistId) => {
    const result = await assignTherapist({ bookingId, therapistId });
    if (result.error) { showToast(result.error.message || 'Failed to assign therapist.', 'error'); return; }
    showToast('Therapist assigned successfully');
    await loadData();
  };

  const handleRecordPayment = async (bookingId, opts) => {
    const result = await recordPayment({ bookingId, ...opts });
    if (result.error) return { error: result.error };
    showToast('Payment recorded successfully');
    await loadData();
    return { error: null };
  };

  const handleApplyDiscount = async (bookingId, { discountType, discountValue, discountReason, requestedTo }) => {
    const result = await applyDiscount({ bookingId, discountType, discountValue, discountReason, requestedTo });
    if (result.error) return { error: result.error };
    showToast(result.data?.isPending ? 'Discount request sent for approval' : 'Discount applied successfully');
    await loadData();
    return { data: result.data };
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

  return (
    <div className="relative">
      {/* Toast */}
      {actionToast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-lg shadow-lg animate-fade-in flex items-center gap-2 ${
          actionToast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
        }`}>
          <span className="text-sm font-medium">{actionToast.msg}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 min-h-[calc(100vh-120px)]">
        {/* Overview Stats */}
        <h2 className="text-lg font-semibold text-gray-900">{getOverviewTitle()}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500 mb-1">Confirmed</div>
            <div className="text-2xl font-semibold text-emerald-600">{bookingCounts.confirmed}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500 mb-1">Pending</div>
            <div className="text-2xl font-semibold text-amber-500">{bookingCounts.pending}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500 mb-1">In Progress</div>
            <div className="text-2xl font-semibold text-blue-600">{bookingCounts.inProgress}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500 mb-1">Completed</div>
            <div className="text-2xl font-semibold text-gray-400">{bookingCounts.completed}</div>
          </div>
        </div>

        {/* Inline Filters */}
        <QuickFilters
          onFiltersChange={setFilters}
          bookingCounts={bookingCounts}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1">
          <div className="lg:col-span-9">
            {loading ? (
              <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
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
                onRefresh={loadData}
                dateRange={filters.dateRange}
                userRole={profile?.role || 'staff'}
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

export default BookingsViewPanel;
