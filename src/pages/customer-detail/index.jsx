import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import StaffSidebar from '../../components/ui/StaffSidebar';
import CustomerSummaryTab from './components/CustomerSummaryTab';
import CustomerAppointmentsTab from './components/CustomerAppointmentsTab';
import CustomerSalesTab from './components/CustomerSalesTab';
import CustomerNotesTab from './components/CustomerNotesTab';
import CustomerPackagesTab from './components/CustomerPackagesTab';
import CustomerMembershipTab from './components/CustomerMembershipTab';
import CustomerPhotosTab from './components/CustomerPhotosTab';
import CustomerDocumentsTab from './components/CustomerDocumentsTab';
import CustomerVouchersTab from './components/CustomerVouchersTab';
import CustomerLogTab from './components/CustomerLogTab';
import CustomerEditModal from './components/CustomerEditModal';
import CustomerMessagesModal from './components/CustomerMessagesModal';
import CustomerMergeModal from './components/CustomerMergeModal';
import { useAuth } from '../../contexts/AuthContext';
import { fetchCustomerProfile, setCustomerActive, deleteCustomer } from '../../services/api';

// Small outside-click-aware dropdown, local to this page's header actions.
const HeaderDropdown = ({ trigger, children, align = 'right' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(o => !o)}>{trigger}</div>
      {open && (
        <div
          className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} min-w-[180px] bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown py-1`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
};

const DropdownItem = ({ onClick, danger, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full text-left px-3 py-2 font-body text-sm spa-transition-fast hover:bg-background ${danger ? 'text-error' : 'text-text-primary'}`}
  >
    {children}
  </button>
);

const CustomerDetailPage = () => {
  const navigate = useNavigate();
  const { orgSlug, customerId } = useParams();
  const { profile } = useAuth();
  const userRole = profile?.role || 'staff';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);

    const result = await fetchCustomerProfile(customerId);

    if (result.error) {
      setError(result.error.message || 'Failed to load customer profile.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const goBack = () => navigate(`/${orgSlug}/dashboard?view=customers`);

  const handleConfirmAction = async (reason) => {
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

  const TABS = data ? [
    { key: 'summary', label: 'Summary' },
    { key: 'appointments', label: `Appointments (${data.history.length})` },
    { key: 'sales', label: `Sales (${data.history.filter(b => b.paymentStatus === 'paid').length})` },
    { key: 'notes', label: `Notes (${data.customer.notes ? 1 : 0})` },
    { key: 'packages', label: 'Packages' },
    { key: 'membership', label: 'Membership' },
    { key: 'photos', label: 'Photos' },
    { key: 'documents', label: 'Documents' },
    { key: 'vouchers', label: 'Gift Vouchers' },
    { key: 'log', label: 'Log (0)' },
  ] : [];

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} lg:mb-0 mb-16 spa-transition-slow`}>
        <div className="sticky top-0 z-header bg-surface border-b border-border px-6 py-3 flex items-center justify-between">
          <button onClick={goBack} className="font-body text-sm text-text-secondary hover:text-primary spa-transition-fast">
            ← Back to Customers
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)} disabled={!data}>Edit</Button>

            <HeaderDropdown
              trigger={
                <Button variant="outline" size="sm" disabled={!data}>
                  Messages <Icon name="ChevronDown" size={14} className="ml-1 inline" />
                </Button>
              }
            >
              <DropdownItem onClick={() => setShowMessagesModal(true)}>Send a message</DropdownItem>
              <DropdownItem onClick={() => navigate(`/${orgSlug}/customers/${customerId}/messages`)}>View sent messages</DropdownItem>
            </HeaderDropdown>

            <HeaderDropdown
              trigger={
                <button
                  type="button"
                  disabled={!data}
                  className="w-9 h-9 flex items-center justify-center rounded-spa border border-border hover:bg-background spa-transition-fast disabled:opacity-50"
                >
                  <Icon name="MoreVertical" size={16} className="text-text-secondary" />
                </button>
              }
            >
              <DropdownItem onClick={() => setShowMergeModal(true)}>Merge</DropdownItem>
              <DropdownItem onClick={() => { setActionError(null); setConfirmAction(data?.customer?.isActive === false ? 'unblock' : 'block'); }}>
                {data?.customer?.isActive === false ? 'Unblock' : 'Block'}
              </DropdownItem>
              <DropdownItem danger onClick={() => { setActionError(null); setConfirmAction('delete'); }}>Delete</DropdownItem>
            </HeaderDropdown>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          {loading ? (
            <div className="text-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="font-body text-sm text-text-secondary">Loading profile...</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
              <Icon name="AlertCircle" size={16} />
              <span>{error}</span>
              <button onClick={loadProfile} className="ml-auto underline">Retry</button>
            </div>
          ) : (
            <>
              <h1 className="font-accent text-5xl text-text-primary">{data.customer.fullName}</h1>

              <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                {TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-3 font-body text-base whitespace-nowrap spa-transition-fast border-b-2 -mb-px ${
                      activeTab === tab.key
                        ? 'border-primary text-primary font-body-medium'
                        : 'border-transparent text-text-primary hover:text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'summary' && <CustomerSummaryTab data={data} onNavigateTab={setActiveTab} />}
              {activeTab === 'appointments' && <CustomerAppointmentsTab data={data} />}
              {activeTab === 'sales' && <CustomerSalesTab data={data} />}
              {activeTab === 'notes' && <CustomerNotesTab customer={data.customer} onSaved={loadProfile} />}
              {activeTab === 'packages' && <CustomerPackagesTab customerId={data.customer.id} />}
              {activeTab === 'membership' && <CustomerMembershipTab membership={data.membership} />}
              {activeTab === 'photos' && <CustomerPhotosTab customerId={data.customer.id} branchId={data.customer.branchId} />}
              {activeTab === 'documents' && <CustomerDocumentsTab customerId={data.customer.id} branchId={data.customer.branchId} />}
              {activeTab === 'vouchers' && <CustomerVouchersTab customerId={data.customer.id} />}
              {activeTab === 'log' && <CustomerLogTab />}
            </>
          )}
        </div>
      </div>

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
    </div>
  );
};

export default CustomerDetailPage;
