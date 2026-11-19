import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import AppShell from '../../components/ui/AppShell';
import CustomerHeader from './components/CustomerHeader';
import CustomerTiles from './components/CustomerTiles';
import CustomerOverviewTab from './components/CustomerOverviewTab';
import CustomerVisitsTab from './components/CustomerVisitsTab';
import CustomerPaymentsTab from './components/CustomerPaymentsTab';
import CustomerPlansTab from './components/CustomerPlansTab';
import CustomerFilesTab from './components/CustomerFilesTab';
import CustomerNotesHistoryTab from './components/CustomerNotesHistoryTab';
import CollectPanel, { collectableAmount } from '../../components/ui/CollectPanel';
import InboxBookingPanel from '../inbox/InboxBookingPanel';
import { useBranch } from '../../contexts/BranchContext';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED, OUTREACH_ENABLED } from '../../lib/featureFlags';
import CustomerEditModal from './components/CustomerEditModal';
import CustomerMessagesModal from './components/CustomerMessagesModal';
import CustomerMergeModal from './components/CustomerMergeModal';
import { useAuth } from '../../contexts/AuthContext';
import { fetchCustomerProfile, getCustomerPanelDetail, setCustomerActive, deleteCustomer } from '../../services/api';

const CustomerDetailPage = () => {
  const navigate = useNavigate();
  const { orgSlug, customerId } = useParams();
  const { profile } = useAuth();
  const { isOverall } = useBranch();
  const userRole = profile?.role || 'staff';
  const canViewCustomerDetails = userRole === 'manager' || userRole === 'admin' || profile?.can_view_customer_details !== false;
  // Same rule as the Customers list: the Overall view and admin_viewer can look, not book or collect.
  const readOnly = isOverall || userRole === 'admin_viewer';

  const [activeTab, setActiveTab] = useState('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null); // the same per-customer detail the Customers panel uses (owed visits, upcoming, plans)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openBookingId, setOpenBookingId] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [notice, setNotice] = useState('');

  const loadProfile = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    const [result, panel] = await Promise.all([fetchCustomerProfile(customerId), getCustomerPanelDetail({ customerId })]);
    if (result.error) {
      setError(result.error.message || 'Failed to load customer profile.');
      setLoading(false);
      return;
    }
    setData(result.data);
    setDetail(panel.data || null);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const goBack = () => navigate(`/${orgSlug}/dashboard?view=customers`);
  // Same hand-off the Customers list's "New booking" uses: the dashboard's booking form, this customer filled in.
  const newBooking = () => { const c = data.customer; navigate(`/${orgSlug}/dashboard?view=new-booking`, { state: { prefill: { fullName: c.fullName, phone: c.phone, email: c.email, gender: c.gender } } }); };

  const handleConfirmAction = async () => {
    setActionSubmitting(true);
    setActionError(null);

    if (confirmAction === 'block' || confirmAction === 'unblock') {
      const result = await setCustomerActive(data.customer.id, confirmAction === 'unblock');
      setActionSubmitting(false);
      if (result.error) { setActionError(result.error.message || 'Failed to update customer.'); return; }
      setConfirmAction(null);
      loadProfile();
    } else if (confirmAction === 'delete') {
      const result = await deleteCustomer(data.customer.id);
      setActionSubmitting(false);
      if (result.error) { setActionError(result.error.message || 'Failed to delete customer.'); return; }
      setConfirmAction(null);
      goBack();
    }
  };

  const planCount = (MEMBERSHIP_ENABLED && detail?.membership ? 1 : 0) + (detail?.packages?.length || 0) + (VOUCHER_ENABLED ? (detail?.vouchers?.length || 0) : 0);
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'visits', label: 'Visits' },
    { key: 'payments', label: 'Payments' },
    { key: 'plans', label: 'Plans', count: planCount },
    { key: 'files', label: 'Files' },
    { key: 'notes', label: 'Notes & history' },
  ];
  const collectable = collectableAmount(data?.stats?.amountOwing);

  return (
    <AppShell variant="flush" sidebar={{ userRole }} header={{ realtimeStatus: 'connected' }}>
      <div className="bg-background min-h-full">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-44 sm:pb-6 space-y-5">
          <CustomerHeader
            loading={loading} data={data} readOnly={readOnly} isAdmin={userRole === 'admin'} showMessages={OUTREACH_ENABLED}
            onBack={goBack} onNewBooking={newBooking} onEdit={() => setShowEditModal(true)}
            onSendMessage={() => setShowMessagesModal(true)} onSentMessages={() => navigate(`/${orgSlug}/customers/${customerId}/messages`)}
            onMerge={() => setShowMergeModal(true)}
            onBlock={() => { setActionError(null); setConfirmAction(data?.customer?.isActive === false ? 'unblock' : 'block'); }}
            onDelete={() => { setActionError(null); setConfirmAction('delete'); }}
          />

          {notice && <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success"><Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></p>}

          {loading && !data ? (
            <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading customer">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] rounded-spa-lg bg-border/60" />)}</div>
              <div className="h-10 border-b border-border" />
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5"><div className="h-64 rounded-spa-lg bg-border/60" /><div className="h-64 rounded-spa-lg bg-border/60" /></div>
            </div>
          ) : error ? (
            <div role="alert" className="text-center py-16">
              <p className="text-sm font-medium text-text-primary">Couldn't load this customer.</p>
              <p className="text-[13px] text-text-secondary mt-1">Check the connection and try again.</p>
              <button type="button" onClick={loadProfile} className="mt-4 h-9 px-3.5 rounded-md border border-border bg-surface text-[13px] font-medium hover:bg-background">Try again</button>
            </div>
          ) : data && (
            <>
              <CustomerTiles stats={data.stats} today={detail?.today} canCollect={!readOnly} collectable={collectable} onCollect={() => setCollecting(true)} />

              <div className="flex items-center gap-6 border-b border-border overflow-x-auto scrollbar-hide">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`h-10 inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px] border-b-2 -mb-px ${activeTab === tab.key ? 'border-primary text-text-primary font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
                  >
                    {tab.label}{tab.count > 0 && <span className="text-[11.5px] text-text-secondary bg-background border border-border rounded-full px-[7px]">{tab.count}</span>}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && <CustomerOverviewTab data={data} detail={detail} onOpenBooking={setOpenBookingId} onNavigateTab={setActiveTab} onEdit={() => setShowEditModal(true)} onNewBooking={newBooking} readOnly={readOnly} />}
              {activeTab === 'visits' && <CustomerVisitsTab data={data} detail={detail} onOpenBooking={setOpenBookingId} />}
              {activeTab === 'payments' && <CustomerPaymentsTab data={data} detail={detail} canViewCustomerDetails={canViewCustomerDetails} onOpenBooking={setOpenBookingId} />}
              {activeTab === 'plans' && <CustomerPlansTab data={data} />}
              {activeTab === 'files' && <CustomerFilesTab customer={data.customer} />}
              {activeTab === 'notes' && <CustomerNotesHistoryTab customer={data.customer} onSaved={loadProfile} onSentMessages={OUTREACH_ENABLED ? () => navigate(`/${orgSlug}/customers/${customerId}/messages`) : null} />}
            </>
          )}
        </div>
      </div>

      {collecting && data && detail && (
        <CollectPanel
          customer={data.customer} owed={detail.owed} branchId={data.customer.branchId}
          onClose={() => setCollecting(false)} onBack={() => setCollecting(false)}
          onNotice={setNotice} onChanged={loadProfile}
        />
      )}

      {openBookingId && <InboxBookingPanel bookingId={openBookingId} onClose={() => setOpenBookingId(null)} onChanged={loadProfile} />}

      {showEditModal && data && (
        <CustomerEditModal
          customer={data.customer}
          onClose={() => setShowEditModal(false)}
          onSaved={loadProfile}
        />
      )}

      {showMessagesModal && data && (
        <CustomerMessagesModal
          customer={data.customer}
          onClose={() => setShowMessagesModal(false)}
        />
      )}

      {showMergeModal && data && (
        <CustomerMergeModal
          customer={data.customer}
          onClose={() => setShowMergeModal(false)}
          onSaved={goBack}
        />
      )}

      {confirmAction && data && (
        <ConfirmDialog
          title={
            confirmAction === 'block' ? 'Block this customer?'
              : confirmAction === 'unblock' ? 'Unblock this customer?'
              : 'Delete this customer?'
          }
          message={
            confirmAction === 'block'
              ? `${data.customer.fullName} will stop appearing in customer search and booking — their history stays intact and this can be undone.`
              : confirmAction === 'unblock'
                ? `${data.customer.fullName} will appear in customer search and booking again.`
                : `${data.customer.fullName} will be permanently deleted. This only succeeds if they have no bookings, memberships, packages, or vouchers — otherwise use Block instead.`
          }
          confirmLabel={confirmAction === 'delete' ? 'Delete' : confirmAction === 'unblock' ? 'Unblock' : 'Block'}
          onConfirm={handleConfirmAction}
          onClose={() => { setConfirmAction(null); setActionError(null); }}
          isSubmitting={actionSubmitting}
        />
      )}

      {actionError && confirmAction && (
        <div className="fixed bottom-4 right-4 z-notification flex items-center gap-2 px-4 py-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm shadow-spa-elevated">
          <Icon name="AlertCircle" size={16} />
          <span>{actionError}</span>
        </div>
      )}
    </AppShell>
  );
};

export default CustomerDetailPage;
