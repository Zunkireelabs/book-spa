import { announceBooking } from '../../utils/visitAnnounce';
import { nepalToday } from '../../utils/nepalTime';
import { nepalNow } from '../../utils/customerDirectory';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { useLock } from '../../contexts/LockContext';
import { useBranch } from '../../contexts/BranchContext';
import AppShell from '../../components/ui/AppShell';
import { fetchTherapists, hasLockedBookings, fetchPendingDiscounts } from '../../services/api';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useOrg } from '../../contexts/OrgContext';

// Import all components
import MetricsCard from './components/MetricsCard';
import TherapistUtilizationChart from './components/TherapistUtilizationChart';
import BookingPipelineChart from './components/BookingPipelineChart';
import RealtimeBookingFeed from './components/RealtimeBookingFeed';
import RevenueAnalyticsChart from './components/RevenueAnalyticsChart';
import DailyOperationalReportPanel from './components/DailyOperationalReportPanel';
import OperationalCalendar from './components/calendar';
import RoomManagementPanel from './components/MasterData/RoomManagementPanel';
import TherapistsPage from './components/MasterData/TherapistsPage';
import ServiceManagementPanel from './components/MasterData/ServiceManagementPanel';
import CategoryManagementPanel from './components/MasterData/CategoryManagementPanel';
import PaymentMethodsPanel from './components/MasterData/PaymentMethodsPanel';
import BookingSettingsPanel from './components/MasterData/BookingSettingsPanel';
import CalendarSettingsPanel from './components/MasterData/CalendarSettingsPanel';
import ClosedDatesPanel from './components/MasterData/ClosedDatesPanel';
import AttendanceSettingsPanel from './components/MasterData/AttendanceSettingsPanel';
import ProviderProfilePanel from './components/MasterData/ProviderProfilePanel';
import OnlineBookingCapacityPanel from './components/MasterData/OnlineBookingCapacityPanel';
import AdvanceBookingWindowPanel from './components/MasterData/AdvanceBookingWindowPanel';
import LocationsPanel from './components/MasterData/LocationsPanel';
import BillingSettingsPanel from './components/MasterData/BillingSettingsPanel';
import PriceTiersPanel from './components/MasterData/PriceTiersPanel';
import NotificationSettingsContent from '../inbox/NotificationSettingsPanel';
import AuditPanel from './components/Governance/AuditPanel';
import CustomersPanel from './components/CRM/CustomersPanel';
import BookingsViewPanel from './components/BookingsViewPanel';
import RevenueCards from './components/RevenueCards';
import TipsSummaryCard from './components/TipsSummaryCard';
import TodayInsightsPanel from './components/TodayInsightsPanel';
import PeriodFilter from './components/PeriodFilter';
import { getTodayISO } from '../../utils/periodPresets';
import UtilizationPanel from './components/UtilizationPanel';
import RiskIndicatorsPanel from './components/RiskIndicatorsPanel';
import AttendancePanel from './components/Operations/AttendancePanel';
import TherapistPerformancePanel from './components/Performance/TherapistPerformancePanel';
import TopPerformersCard from './components/Performance/TopPerformersCard';
import StatusLegend from '../../components/ui/StatusLegend';
import PendingDiscountsPanel from './components/PendingDiscountsPanel';
import DiscountsPanel from './components/DiscountsPanel';
import AttendanceReportPanel from './components/AttendanceReportPanel';
import BranchPending from './components/Area/BranchPending';
import AreaTabs from './components/Area/AreaTabs';
import { getAreaForView } from './components/Area/areaTabsRegistry';
import SettingsLayout from './components/Settings/SettingsLayout';
import { isSettingsView } from './components/Settings/settingsRegistry';
import ReportsLayout from './components/Reports/ReportsLayout';
import { isReportView } from './components/Reports/reportRegistry';
import AttendanceCalendarPage from 'pages/attendance-calendar';
import TransferReportPanel from './components/TransferReportPanel';
import ReferralsReportPanel from './components/Referrals/ReferralsReportPanel';
import CustomerReferralsReportPanel from './components/Referrals/CustomerReferralsReportPanel';
import ReferralWalletPanel from './components/Referrals/ReferralWalletPanel';
import RewardCatalogPanel from './components/Referrals/RewardCatalogPanel';
import ServiceRevenueReportPanel from './components/ServiceRevenueReportPanel';
import CategoryRevenueReportPanel from './components/CategoryRevenueReportPanel';
import PayrollPanel from './components/Payroll/PayrollPanel';
import MembershipsPage from './components/Memberships/MembershipsPage';
import { MEMBERSHIP_ENABLED, CUSTOMER_REFERRALS_ENABLED, VOUCHER_ENABLED, OUTREACH_ENABLED, PRODUCTS_ENABLED, CAMPAIGNS_ENABLED } from '../../lib/featureFlags';
import ProductsPage from './components/Products/ProductsPage';
import CampaignsPanel from './components/Campaigns/CampaignsPanel';
import VouchersPage from './components/Vouchers/VouchersPage';
import PackagesPage from './components/Packages/PackagesPage';
import RulesEditorPanel from './components/Outreach/RulesEditorPanel';
import TemplateEditorPanel from './components/Outreach/TemplateEditorPanel';
import ReviewQueuePanel from './components/Outreach/ReviewQueuePanel';
import MessageLogPanel from './components/Outreach/MessageLogPanel';
import ProviderSettingsPanel from './components/Outreach/ProviderSettingsPanel';
import CheckBookingPanel from '../branch-staff-dashboard/components/CheckBookingPanel';
import CollectPaymentPanel from '../branch-staff-dashboard/components/CollectPaymentPanel';
import EnrollMemberPanel from './components/Memberships/EnrollMemberPanel';
import NewVoucherPanel from './components/Vouchers/NewVoucherPanel';
import DashboardHome from '../dashboard-home';
import { AIAssistantPanel } from '../../components/ui/AIAssistant';
import { useAIAssistant } from '../../contexts/AIAssistantContext';
import { wordBranch, wordBranchCap } from '../../utils/industryTerms';

// Views that render org-wide data and therefore hide the branch switcher —
// see the comment at its render site for why each one qualifies.
const ORG_WIDE_VIEWS = new Set(['customers', 'transfer-report']);

const BranchManagerDashboard = () => {
  const { profile, user } = useAuth();
  // Gates the online-booking-limit panel: the cap only bites when customers DON'T pick a staff member (check_branch_online_capacity()
  // exempts bookings with a therapist_id). orgLoading matters because settings are null until the org loads.
  const { showStaffSelection, loading: orgLoading, orgId } = useOrg();
  const { branchId, branchName, isOverall, loading: branchLoading } = useBranch();
  const { items: persistentNotifs, openItem: openNotificationItem, markAllRead: markAllPersistentRead } = useNotifications();
  const { isOpen: isAssistantOpen, toggleAssistant } = useAIAssistant();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [period, setPeriodState] = useState(() => ({ key: 'daily', from: getTodayISO(), to: getTodayISO() }));
  const todayDateStr = getTodayISO();
  const setPeriod = setPeriodState;
  const viewMode = searchParams.get('view') || 'dashboard';
  const [dayLocked, setDayLocked] = useState(false); // any of today's bookings closed → the "This day is closed" banner
  const [loading, setLoading] = useState(true);
  const [newBookingNotification, setNewBookingNotification] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const showSuccess = (msg) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 3000);
  };
  const [notifications, setNotifications] = useState([]);
  const [discountNotifs, setDiscountNotifs] = useState([]);
  const [readDiscountIds, setReadDiscountIds] = useState(() => new Set());
  const [realtimeStatus, setRealtimeStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected' | 'idle' (no subscription, e.g. Overall)

  const managerData = {
    name: profile?.full_name || 'Manager',
    role: profile?.role === 'admin' ? 'Admin' : `${wordBranchCap()} Manager`,
    branch: branchName || profile?.branches?.name || '',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
    email: profile?.email || ''
  };

  // The banner only needs a yes/no, so ask for exactly that (a head count), not the day's bookings with their joins.
  const loadDayLock = useCallback(async ({ silent = false } = {}) => {
    if (!branchId) return;
    if (!silent) setLoading(true); // a realtime re-check must not flash the banner away
    const today = nepalNow().today; // the spa's day (Nepal), not the UTC date, which is yesterday until 05:45
    const result = await hasLockedBookings(branchId, today);
    if (result.data != null) setDayLocked(result.data);
    if (!silent) setLoading(false);
  }, [branchId]);

  const loadDayLockRef = useRef(loadDayLock);
  loadDayLockRef.current = loadDayLock;
  useEffect(() => { loadDayLock(); }, [loadDayLock]);

  // Pending discount approvals routed to the current user → notification feed
  const loadDiscountNotifs = useCallback(async () => {
    if (!branchId) { setDiscountNotifs([]); return; }
    const { data } = await fetchPendingDiscounts(branchId);
    setDiscountNotifs(
      (data || []).map((d) => ({
        id: `discount-${d.bookingId}`,
        type: 'discount',
        bookingId: d.bookingId,
        bookingNumber: d.bookingNumber,
        customerName: d.customerName,
        discountPercent: d.discountPercent,
        discountAmount: d.discountAmount,
        requestedByName: d.requestedByName,
      }))
    );
  }, [branchId]);

  useEffect(() => {
    loadDiscountNotifs();
    const onChange = () => loadDiscountNotifs();
    window.addEventListener('pending-approvals-changed', onChange);
    const interval = setInterval(loadDiscountNotifs, 60000);
    return () => {
      window.removeEventListener('pending-approvals-changed', onChange);
      clearInterval(interval);
    };
  }, [loadDiscountNotifs]);

  // Real-time subscription for booking changes
  useEffect(() => {
    // Overall is a read-only org-wide aggregate — no single branch to subscribe to. Nothing is
    // subscribed there, so report 'idle' (the header shows no status) rather than a stale 'disconnected'
    // left by the previous branch's channel closing.
    if (isOverall) { setRealtimeStatus('idle'); return; }
    if (!branchId) return;
    let active = true;
    setRealtimeStatus('connecting');

    // A burst of booking events (a group booking, a bulk update) re-checks the day lock once, not once per event.
    let lockTimer = null;
    const scheduleLockCheck = () => {
      clearTimeout(lockTimer);
      lockTimer = setTimeout(() => { if (active) loadDayLockRef.current?.({ silent: true }); }, 400);
    };

    const handleRealtimeUpdate = (payload) => {
      // Small delay to ensure DB triggers (booking_number generation, end_time calculation) complete
      setTimeout(() => {
        scheduleLockCheck();

        // Show notification for new bookings not for today
        if (payload.eventType === 'INSERT' && payload.new) {
          const newBooking = payload.new;
          // ZNLY-402: once per multi-service booking, and never for one that was rolled back (rows without a visit_id announce at once, as before).
          announceBooking(newBooking, async (id) => (await supabase.from('bookings').select('status').eq('id', id).maybeSingle()).data?.status, () => {
          const today = nepalToday();
          const isToday = newBooking.date === today;

          // Add every new booking to the header notification feed (deduped by id). Online bookings (created_by IS NULL) already
          // arrive as a persisted new_online_booking notification (migration-335), so they are not added a second time here.
          if (newBooking.created_by != null) setNotifications((prev) =>
            prev.some((n) => n.id === newBooking.id)
              ? prev
              : [
                  {
                    id: newBooking.id,
                    bookingNumber: newBooking.booking_number,
                    customerName: newBooking.customer_name,
                    date: newBooking.date,
                    createdAt: new Date(),
                    read: false,
                  },
                  ...prev,
                ].slice(0, 30)
          );

          // Online bookings (created_by IS NULL) get the NotificationsProvider pop-up card instead.
          if (!isToday && newBooking.date && newBooking.created_by != null) {
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
          });
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
        // Ignore callbacks from a channel this effect has already torn down (its CLOSED must not read as offline).
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => { active = false; clearTimeout(lockTimer); supabase.removeChannel(channel); };
  }, [branchId, isOverall]); // the channel is rebuilt only when the branch (its filter) changes

  // The old single Outreach page: its tabs are now URL tabs, so old links land on Rules.
  useEffect(() => {
    if (viewMode === 'outreach') navigate('?view=outreach-rules', { replace: true });
    // V23: the old "All vouchers" overview is now the Vouchers tab.
    if (viewMode === 'voucher-overview') navigate('?view=vouchers', { replace: true });
  }, [viewMode, navigate]);

  // Overall is read-only: redirect away from booking-creation / per-branch write views.
  useEffect(() => {
    const writeOnlyViews = ['new-booking', 'check-booking', 'attendance', 'rooms', 'services', 'categories'];
    if (isOverall && writeOnlyViews.includes(viewMode)) {
      navigate('?view=dashboard', { replace: true });
    }
  }, [isOverall, viewMode, navigate]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setPeriodState((prev) =>
      prev.key === 'daily' && prev.from === prev.to && prev.from !== todayDateStr
        ? { key: 'daily', from: todayDateStr, to: todayDateStr }
        : prev
    );
  }, [todayDateStr]);

  // Handle viewing a booking from the new booking notification
  const handleViewNewBooking = () => {
    setNewBookingNotification(null);
    navigate('?view=bookings');
  };

  // Header notification feed — pending approvals, decision updates, then new bookings
  const feedNotifications = [
    ...discountNotifs.map((n) => ({ ...n, read: readDiscountIds.has(n.id) })),
    ...persistentNotifs,
    ...notifications,
  ];
  const unreadNotifications = feedNotifications.filter((n) => !n.read).length;
  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setReadDiscountIds(new Set(discountNotifs.map((n) => n.id)));
    markAllPersistentRead();
  };
  const handleNotificationClick = (n) => {
    if (n.type === 'discount') {
      setReadDiscountIds((prev) => new Set(prev).add(n.id));
      navigate(`?view=dashboard&highlight=${n.bookingId}`);
      return;
    }
    if (n.type === 'new_online_booking' || n.type === 'discount_approved' || n.type === 'discount_declined') {
      openNotificationItem(n); // marks read; opens the booking, or the Inbox when the booking is gone
      return;
    }
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    navigate('?view=bookings');
  };

  // V36a: the old widget stack is retired; DashboardHome owns the dashboard (the widgets stay in the repo for Reports).
  // V36c: the Branch view carries its own Needs action (incl. pending discounts + the ?highlight= deep link).
  const renderDashboardView = () => <DashboardHome />;

  const renderCalendarView = () => (
    <OperationalCalendar branchId={branchId} />
  );

  const renderReportsView = () => (
    <DailyOperationalReportPanel branchId={branchId} />
  );

  // The Reports area: the layout frames each report; the panels themselves are unchanged and keep their own guards.
  const isReportsView = isReportView(viewMode);
  const renderReportView = (view) => {
    if (branchLoading) return <BranchPending />; // panels need the resolved branch
    switch (view) {
      case 'reports': return renderReportsView();
      case 'service-revenue': return <ServiceRevenueReportPanel branchId={branchId} />;
      case 'category-revenue': return <CategoryRevenueReportPanel branchId={branchId} />;
      case 'discounts': return <DiscountsPanel branchId={branchId} />;
      case 'performance': return <TherapistPerformancePanel branchId={branchId} />;
      case 'attendance-report': return <AttendanceReportPanel branchId={branchId} />;
      case 'attendance-calendar': return <AttendanceCalendarPage embedded />;
      case 'transfer-report': return <TransferReportPanel />;
      case 'referrals': return <ReferralsReportPanel branchId={branchId} />;
      case 'customer-referrals': return CUSTOMER_REFERRALS_ENABLED ? <CustomerReferralsReportPanel branchId={branchId} /> : null;
      case 'referral-wallet': return CUSTOMER_REFERRALS_ENABLED ? <ReferralWalletPanel branchId={branchId} /> : null;
      default: return null;
    }
  };

  // Tabbed areas (Bookings, Packages, plus flagged Memberships / Vouchers) and single pages (Therapists, Attendance, Payroll): each tab
  // is an existing view; the panels keep their own role / Overall guards.
  const areaForView = getAreaForView(viewMode);
  const renderAreaView = (view) => {
    if (branchLoading) return <BranchPending />; // panels need the resolved branch
    const salesReadOnly = profile?.role === 'admin_viewer'; // #411 access is view-only
    const salesViewer = ['manager', 'admin', 'admin_viewer'].includes(profile?.role); // #411: admin_viewer can open Packages / Memberships / Vouchers
    const frontDesk = ['manager', 'admin'].includes(profile?.role);
    // Panel is the second child so switching between the sell tabs doesn't remount (refetch + flash) the bookings list
    const withBookingsList = (overlay) => (<><BookingsViewPanel key="bookings-list" branchId={branchId} />{overlay}</>);
    const outreachAdmin = OUTREACH_ENABLED && profile?.role === 'admin';
    switch (view) {
      case 'bookings': return withBookingsList(null);
      case 'new-booking': return !isOverall ? withBookingsList(null) : null; // the New booking panel opens over the list (BookingsViewPanel reads ?view=new-booking)
      case 'check-booking': return !isOverall ? <CheckBookingPanel branchId={branchId} /> : null;
      // Front-desk tools (ZNLY-149): manager and admin sell and collect too; admin_viewer stays read-only.
      case 'collect-payment': return frontDesk && !isOverall ? <CollectPaymentPanel onSuccess={showSuccess} /> : null;
      case 'new-membership':
        return MEMBERSHIP_ENABLED && frontDesk && !isOverall ? withBookingsList(
          <EnrollMemberPanel
            onClose={() => setSearchParams({ view: 'bookings' })}
            onEnrolled={(id, info) => {
              setSearchParams({ view: 'bookings' });
              showSuccess(info.message || 'Membership created.');
            }}
          />,
        ) : null;
      case 'new-voucher':
        return VOUCHER_ENABLED && frontDesk && !isOverall ? withBookingsList(
          <NewVoucherPanel
            userRole={profile?.role}
            onClose={() => setSearchParams({ view: 'bookings' })}
            onIssued={() => {
              setSearchParams({ view: 'bookings' });
              showSuccess('Voucher issued.');
            }}
          />,
        ) : null;
      case 'therapists':
      case 'therapists-inactive':
      case 'therapists-positions':
      case 'therapists-transfers':
      case 'roster': return <TherapistsPage view={view} />;
      case 'attendance': return !isOverall ? <AttendancePanel branchId={branchId} /> : null;
      case 'payroll': return ['admin', 'admin_viewer'].includes(profile?.role) ? <PayrollPanel branchId={branchId} isOverall={isOverall} readOnly={profile?.role === 'admin_viewer'} /> : null;
      case 'package-overview':
      case 'packages': return salesViewer ? <PackagesPage view={view} branchId={branchId} readOnly={salesReadOnly} /> : null;
      case 'memberships':
      case 'membership-collection':
      case 'wallet-usage': return MEMBERSHIP_ENABLED && salesViewer ? <MembershipsPage view={view} branchId={branchId} readOnly={salesReadOnly} /> : null;
      case 'outreach-rules': return outreachAdmin ? <RulesEditorPanel /> : null;
      case 'outreach-templates': return outreachAdmin ? <TemplateEditorPanel /> : null;
      case 'outreach-review': return outreachAdmin ? <ReviewQueuePanel /> : null;
      case 'outreach-log': return outreachAdmin ? <MessageLogPanel /> : null;
      case 'outreach-settings': return outreachAdmin ? <ProviderSettingsPanel /> : null;
      case 'vouchers':
      case 'voucher-types':
      case 'voucher-activity': return VOUCHER_ENABLED && salesViewer ? <VouchersPage view={view} branchId={branchId} readOnly={salesReadOnly} /> : null;
      case 'products':
      case 'stock-history':
      case 'suppliers':
      case 'product-categories': return PRODUCTS_ENABLED ? <ProductsPage view={view} readOnly={salesReadOnly} /> : null;
      default: return null;
    }
  };

  // The Settings area: same idea as Reports; the layout enforces role / Overall visibility.
  const isSettingsViewActive = isSettingsView(viewMode);
  const renderSettingView = (view) => {
    if (branchLoading) return <BranchPending />; // panels need the resolved branch
    switch (view) {
      case 'rooms': return <RoomManagementPanel branchId={branchId} />;
      case 'services': return <ServiceManagementPanel />;
      case 'categories': return <CategoryManagementPanel />;
      case 'payment-methods': return <PaymentMethodsPanel />;
      case 'reward-catalog': return <RewardCatalogPanel />;
      case 'booking-settings': return (
        <div className="space-y-8">
          <BookingSettingsPanel />
          {!isOverall && !orgLoading ? (
            <>
              {!showStaffSelection && (
                <div className="border-t border-border pt-8"><OnlineBookingCapacityPanel branchId={branchId} /></div>
              )}
              <div className="border-t border-border pt-8"><AdvanceBookingWindowPanel branchId={branchId} /></div>
            </>
          ) : (
            <div className="border-t border-border pt-8 font-body text-sm text-text-secondary">
              Select a specific {wordBranch()} to configure the online booking limit and advance booking window.
            </div>
          )}
        </div>
      );
      case 'locations': return profile?.role === 'admin' ? <LocationsPanel orgId={orgId} /> : null;
      case 'billing': return profile?.role === 'admin' ? <BillingSettingsPanel /> : null;
      case 'price-tiers': return !isOverall && ['manager', 'admin', 'admin_viewer'].includes(profile?.role) ? <PriceTiersPanel readOnly={profile?.role === 'admin_viewer'} /> : null;
      case 'calendar-settings': return profile?.role === 'admin' ? <CalendarSettingsPanel /> : null;
      case 'attendance-settings': return !isOverall && ['admin', 'manager'].includes(profile?.role) ? <AttendanceSettingsPanel branchId={branchId} /> : null;
      case 'closed-dates': return !isOverall && profile?.role === 'admin' ? <ClosedDatesPanel branchId={branchId} /> : null;
      case 'provider-profile': return <ProviderProfilePanel />;
      case 'notifications': return <NotificationSettingsContent />;
      case 'audit': return <AuditPanel branchId={branchId} initialRecordId={searchParams.get('recordId') || ''} />;
      default: return null;
    }
  };

  return (
    <>
      <Helmet>
        <title>{`${wordBranchCap()} Manager Dashboard - Zennly`}</title>
        <meta name="description" content={`Comprehensive ${wordBranch()} management dashboard for Zennly managers with analytics, staff oversight, and operational controls.`} />
      </Helmet>

      <AppShell
        variant={viewMode === 'calendar' || isReportsView || isSettingsViewActive || areaForView ? 'fill' : 'page'}
        sidebar={{ userRole: 'manager', userName: managerData.name, branchName: managerData.branch }}
        header={{
          realtimeStatus,
          leftExtra: null, // the dashboard is always today, so no period picker
          onToggleAssistant: toggleAssistant,
          assistantOpen: isAssistantOpen,
          notifications: feedNotifications,
          unreadCount: unreadNotifications,
          onMarkAllRead: markAllNotificationsRead,
          onItemClick: handleNotificationClick,
        }}
        banner={
          viewMode === 'dashboard' && !loading && dayLocked && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 lg:px-8 py-2">
              <div className="flex items-center space-x-2 text-amber-700">
                <Icon name="Lock" size={16} />
                <span className="font-body font-body-medium text-sm">
                  This day is closed. Financial records are locked.
                </span>
              </div>
            </div>
          )
        }
        floating={
          actionSuccess ? (
            <div className="fixed toast-top left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-toast bg-success text-white px-4 sm:px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in">
              <span className="font-body font-body-medium text-sm">{actionSuccess}</span>
            </div>
          ) : newBookingNotification && (
            <div className="fixed toast-top left-4 right-4 sm:left-auto sm:right-6 z-toast bg-primary text-white px-4 sm:px-5 py-3 rounded-lg shadow-lg animate-fade-in sm:max-w-sm">
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
          )
        }
        aside={<AIAssistantPanel />}
        asideOpen={isAssistantOpen}
      >
          {viewMode === 'dashboard' && renderDashboardView()}
          {viewMode === 'calendar' && renderCalendarView()}
          {isReportsView && <ReportsLayout view={viewMode} renderReport={renderReportView} />}
          {isSettingsViewActive && <SettingsLayout view={viewMode} renderSetting={renderSettingView} />}
          {areaForView && <AreaTabs area={areaForView} view={viewMode}>{renderAreaView(viewMode)}</AreaTabs>}
          {viewMode === 'customers' && (branchLoading ? <BranchPending /> : <CustomersPanel branchId={branchId} readOnly={isOverall} />)}
          {CAMPAIGNS_ENABLED && viewMode === 'campaigns' && ['manager','admin'].includes(profile?.role) && <CampaignsPanel />}
      </AppShell>
    </>
  );
};

export default BranchManagerDashboard;
