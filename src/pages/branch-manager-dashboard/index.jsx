import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import StaffSidebar from '../../components/ui/StaffSidebar';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import BranchSwitcher from '../../components/ui/BranchSwitcher';
import { fetchBookings, fetchTherapists, updateBookingStatus } from '../../services/api';
import { transformBookings, toDbStatus } from '../../services/bookingTransformers';
import { supabase } from '../../lib/supabase';

// Import all components
import MetricsCard from './components/MetricsCard';
import TherapistUtilizationChart from './components/TherapistUtilizationChart';
import BookingPipelineChart from './components/BookingPipelineChart';
import RealtimeBookingFeed from './components/RealtimeBookingFeed';
import DateRangePicker from './components/DateRangePicker';
import RevenueAnalyticsChart from './components/RevenueAnalyticsChart';
import AlertsNotificationPanel from './components/AlertsNotificationPanel';
import DailyOperationalReportPanel from './components/DailyOperationalReportPanel';
import OperationalCalendar from './components/calendar';
import RoomManagementPanel from './components/MasterData/RoomManagementPanel';
import TherapistManagementPanel from './components/MasterData/TherapistManagementPanel';
import ServiceManagementPanel from './components/MasterData/ServiceManagementPanel';
import AuditPanel from './components/Governance/AuditPanel';
import CustomersPanel from './components/CRM/CustomersPanel';
import BookingsViewPanel from './components/BookingsViewPanel';
import RevenueCards from './components/RevenueCards';
import UtilizationPanel from './components/UtilizationPanel';
import RiskIndicatorsPanel from './components/RiskIndicatorsPanel';
import AttendancePanel from './components/Operations/AttendancePanel';
import TherapistPerformancePanel from './components/Performance/TherapistPerformancePanel';
import TopPerformersCard from './components/Performance/TopPerformersCard';
import StatusLegend from '../../components/ui/StatusLegend';
import PendingDiscountsPanel from './components/PendingDiscountsPanel';

const BranchManagerDashboard = () => {
  const { profile } = useAuth();
  const { branchId, branchName } = useBranch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [currentTime, setCurrentTime] = useState(new Date());
  const viewMode = searchParams.get('view') || 'dashboard';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newBookingNotification, setNewBookingNotification] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected'

  const managerData = {
    name: profile?.full_name || 'Manager',
    role: profile?.role === 'admin' ? 'Admin' : 'Branch Manager',
    branch: branchName || profile?.branches?.name || 'Main Branch',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150'
  };

  // Load live data
  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const result = await fetchBookings(branchId, { date: today });
    if (result.data) {
      setBookings(transformBookings(result.data));
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Real-time subscription for booking changes
  useEffect(() => {
    if (!branchId) return;

    const handleRealtimeUpdate = (payload) => {
      // Small delay to ensure DB triggers (booking_number generation, end_time calculation) complete
      setTimeout(() => {
        loadData();

        // Show notification for new bookings not for today
        if (payload.eventType === 'INSERT' && payload.new) {
          const newBooking = payload.new;
          const today = new Date().toISOString().split('T')[0];
          const isToday = newBooking.date === today;

          if (!isToday && newBooking.date) {
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
      .channel(`bookings-manager-${branchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `branch_id=eq.${branchId}`
      }, handleRealtimeUpdate)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [branchId, loadData]);

  // Compute live metrics from real bookings
  const totalBookings = bookings.length;
  const paidBookings = bookings.filter(b => b.paymentStatus === 'paid');
  const dailyRevenue = paidBookings.reduce((sum, b) => sum + b.finalAmount, 0);
  const cancelledCount = bookings.filter(b => b.status === 'cancelled').length;
  const cancellationRate = totalBookings > 0 ? ((cancelledCount / totalBookings) * 100).toFixed(1) : '0.0';
  const unpaidCount = bookings.filter(b => b.paymentStatus === 'unpaid' && ['confirmed', 'completed'].includes(b.status)).length;

  const metricsData = [
    {
      title: "Today's Bookings",
      value: String(totalBookings),
      change: '',
      changeType: 'neutral',
      icon: 'Calendar',
      currency: false
    },
    {
      title: 'Daily Revenue',
      value: dailyRevenue.toLocaleString('en-IN'),
      change: '',
      changeType: 'neutral',
      icon: 'IndianRupee',
      currency: true
    },
    {
      title: 'Cancellation Rate',
      value: `${cancellationRate}%`,
      change: '',
      changeType: 'neutral',
      icon: 'XCircle',
      currency: false
    },
    {
      title: 'Unpaid Bookings',
      value: String(unpaidCount),
      change: '',
      changeType: unpaidCount > 0 ? 'negative' : 'positive',
      icon: 'AlertCircle',
      currency: false
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const handleDateRangeChange = (dateRange) => {
    // Date range filter — handled by individual panels
  };

  const handleExport = (format) => {
    // Export handled by DailyOperationalReportPanel
  };

  // Handle viewing a booking from the new booking notification
  const handleViewNewBooking = () => {
    setNewBookingNotification(null);
    navigate('?view=bookings');
  };

  const handleQuickStatusUpdate = async (bookingId, newStatus) => {
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus });
    if (!result.error) {
      await loadData();
    }
  };

  const renderDashboardView = () => (
    <div className="space-y-6">
      {/* Revenue Intelligence Cards */}
      <RevenueCards branchId={branchId} />

      {/* Utilization & Capacity Intelligence */}
      <UtilizationPanel branchId={branchId} />

      {/* Risk Indicators */}
      <RiskIndicatorsPanel branchId={branchId} />

      {/* Pending Discount Approvals */}
      <PendingDiscountsPanel branchId={branchId} />

      {/* Key Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {loading ? (
          <div className="col-span-4 text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body font-body-normal text-text-secondary">Loading metrics...</p>
          </div>
        ) : (
          metricsData.map((metric, index) => (
            <MetricsCard
              key={index}
              title={metric.title}
              value={metric.value}
              change={metric.change}
              changeType={metric.changeType}
              icon={metric.icon}
              currency={metric.currency}
            />
          ))
        )}
      </div>

      {/* Status Legend */}
      <div className="bg-surface border border-border rounded-spa px-4 py-2.5">
        <StatusLegend showPayment />
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TherapistUtilizationChart branchId={branchId} />
        <BookingPipelineChart branchId={branchId} />
        <TopPerformersCard branchId={branchId} />
        <RealtimeBookingFeed
          bookings={bookings}
          branchId={branchId}
          onQuickStatusUpdate={handleQuickStatusUpdate}
        />
      </div>

      {/* Analytics and Controls Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DateRangePicker
          onDateRangeChange={handleDateRangeChange}
          onExport={handleExport}
        />
        <div className="lg:col-span-2">
          <RevenueAnalyticsChart branchId={branchId} />
        </div>
      </div>

      <AlertsNotificationPanel />
    </div>
  );

  const renderCalendarView = () => (
    <OperationalCalendar branchId={branchId} />
  );

  const renderReportsView = () => (
    <DailyOperationalReportPanel branchId={branchId} />
  );

  const renderInfrastructureView = () => (
    <div className="space-y-8">
      <RoomManagementPanel branchId={branchId} />
      <TherapistManagementPanel branchId={branchId} />
      {profile?.role === 'admin' && <ServiceManagementPanel />}
    </div>
  );

  return (
    <>
      <Helmet>
        <title>Branch Manager Dashboard - BookSpa</title>
        <meta name="description" content="Comprehensive branch management dashboard for BookSpa managers with analytics, staff oversight, and operational controls." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <StaffSidebar
          userRole="manager"
          userName={managerData.name}
          branchName={managerData.branch}
          onCollapseChange={setSidebarCollapsed}
        />

        <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'} lg:pb-0 pb-16 spa-transition-slow`}>
          {/* Header */}
          <header className="bg-[#FAFAFA] sticky top-0 z-header">
            <div className="px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between">
                {/* Left: Branch name + date/time */}
                <div className="flex items-center space-x-3 min-w-0">
                  <BranchSwitcher />
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

                {/* Right: Real-time status + Role badge + New Booking + Profile */}
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

                  <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal capitalize ${
                    profile?.role === 'admin'
                      ? 'bg-pink-100 text-pink-700'
                      : 'bg-accent/10 text-accent'
                  }`}>
                    {profile?.role === 'admin' ? 'Admin' : managerData.role}
                  </span>

                  <Button
                    variant="primary"
                    size="sm"
                    iconName="Plus"
                    onClick={() => navigate('/customer-booking-flow')}
                  >
                    <span className="hidden sm:inline">New Booking</span>
                  </Button>

                  <div className="flex items-center space-x-2 px-2 py-1 rounded-spa hover:bg-background spa-transition-fast cursor-pointer">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-primary/10 flex-shrink-0">
                      <img
                        src={managerData.avatar}
                        alt={managerData.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = '/assets/images/no_image.png';
                        }}
                      />
                    </div>
                    <div className="hidden md:flex flex-col">
                      <span className="font-body font-body-medium text-sm text-text-primary leading-tight">
                        {managerData.name}
                      </span>
                      <span className="font-caption font-caption-normal text-xs text-text-secondary capitalize leading-tight">
                        {profile?.role || 'manager'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Closed Day Banner */}
          {viewMode === 'dashboard' && !loading && bookings.length > 0 && bookings.some(b => b.isLocked) && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 lg:px-8 py-2">
              <div className="flex items-center space-x-2 text-amber-700">
                <Icon name="Lock" size={16} />
                <span className="font-body font-body-medium text-sm">
                  This day is closed. Financial records are locked.
                </span>
              </div>
            </div>
          )}

          {/* New Booking Notification Toast */}
          {newBookingNotification && (
            <div className="fixed top-20 right-6 z-toast bg-primary text-white px-5 py-3 rounded-lg shadow-lg animate-fade-in max-w-sm">
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
                    onClick={handleViewNewBooking}
                    className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-body font-body-medium transition-colors"
                  >
                    View
                  </button>
                  <button
                    onClick={() => setNewBookingNotification(null)}
                    className="hover:opacity-80 text-white/80 hover:text-white"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <main className="px-4 sm:px-6 lg:px-8 py-6 bg-white rounded-tl-spa-lg border-l border-t border-[rgba(0,0,29,0.075)]">
            {viewMode === 'dashboard' && renderDashboardView()}
            {viewMode === 'bookings' && <BookingsViewPanel branchId={branchId} />}
            {viewMode === 'calendar' && renderCalendarView()}
            {viewMode === 'reports' && renderReportsView()}
            {viewMode === 'customers' && <CustomersPanel branchId={branchId} />}
            {viewMode === 'attendance' && <AttendancePanel branchId={branchId} />}
            {viewMode === 'performance' && <TherapistPerformancePanel branchId={branchId} />}
            {viewMode === 'infrastructure' && renderInfrastructureView()}
            {viewMode === 'rooms' && <RoomManagementPanel branchId={branchId} />}
            {viewMode === 'services' && <ServiceManagementPanel />}
            {viewMode === 'therapists' && <TherapistManagementPanel branchId={branchId} />}
            {viewMode === 'audit' && <AuditPanel branchId={branchId} initialRecordId={searchParams.get('recordId') || ''} />}
          </main>
        </div>
      </div>
    </>
  );
};

export default BranchManagerDashboard;
