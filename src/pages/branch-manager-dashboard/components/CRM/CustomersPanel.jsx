import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { getCustomerIntelligence } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import CustomerProfileModal from './CustomerProfileModal';
import DuplicateCustomersPanel from './DuplicateCustomersPanel';

const LOYALTY_CONFIG = {
  VIP:        { color: 'bg-amber-100 text-amber-800', icon: 'Crown' },
  Regular:    { color: 'bg-primary/10 text-primary', icon: 'Star' },
  Occasional: { color: 'bg-blue-100 text-blue-700', icon: 'UserCheck' },
  'At Risk':  { color: 'bg-error/10 text-error', icon: 'AlertTriangle' },
  New:        { color: 'bg-success/10 text-success', icon: 'UserPlus' },
  Standard:   { color: 'bg-background text-text-secondary', icon: 'User' },
};

const SUMMARY_CARDS = [
  { key: 'totalCustomers', label: 'Total', icon: 'Users', color: 'text-text-primary', bg: 'bg-background' },
  { key: 'vipCount', label: 'VIP', icon: 'Crown', color: 'text-amber-700', bg: 'bg-amber-50' },
  { key: 'regularCount', label: 'Regular', icon: 'Star', color: 'text-primary', bg: 'bg-primary/5' },
  { key: 'occasionalCount', label: 'Occasional', icon: 'UserCheck', color: 'text-blue-600', bg: 'bg-blue-50' },
  { key: 'atRiskCount', label: 'At Risk', icon: 'AlertTriangle', color: 'text-error', bg: 'bg-error/5' },
  { key: 'newCount', label: 'New', icon: 'UserPlus', color: 'text-success', bg: 'bg-success/5' },
];

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

// readOnly accepted for the Overall view; this panel has no write affordances, so it is unused.
const CustomersPanel = ({ branchId, readOnly = false }) => { // eslint-disable-line no-unused-vars
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState('customers');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterTier, setFilterTier] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getCustomerIntelligence({ branchId });

    if (result.error) {
      setError(result.error.message || 'Failed to load customer data.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const tabs = (
    <div className="flex items-center gap-1 border-b border-border">
      {[
        { key: 'customers', label: 'Customers' },
        { key: 'duplicates', label: 'Potential Duplicates' },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          className={`px-3 py-2 font-body font-body-medium text-sm spa-transition-fast border-b-2 -mb-px ${
            activeTab === tab.key
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  if (activeTab === 'duplicates') {
    return (
      <div className="space-y-4">
        {tabs}
        <DuplicateCustomersPanel orgId={profile?.org_id} role={profile?.role} branchId={profile?.branch_id} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {tabs}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-3 bg-background rounded w-12 mb-2" />
              <div className="h-6 bg-background rounded w-8" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-10 bg-background rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {tabs}
        <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
          <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
          <p className="font-body text-sm text-error">{error}</p>
          <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, customers } = data;

  // Filter + search
  const filtered = customers.filter(c => {
    if (filterTier !== 'all' && c.loyaltyTier !== filterTier) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (c.fullName || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {tabs}
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {SUMMARY_CARDS.map(card => (
          <button
            key={card.key}
            onClick={() => setFilterTier(
              card.key === 'totalCustomers' ? 'all' : card.label
            )}
            className={`bg-surface rounded-spa-lg border p-4 text-left spa-transition-fast hover:shadow-sm ${
              (filterTier === 'all' && card.key === 'totalCustomers') ||
              filterTier === card.label
                ? 'border-primary/30 ring-1 ring-primary/10'
                : 'border-border'
            }`}
          >
            <div className="flex items-center space-x-2 mb-2">
              <div className={`w-6 h-6 rounded flex items-center justify-center ${card.bg}`}>
                <Icon name={card.icon} size={14} className={card.color} />
              </div>
              <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">
                {card.label}
              </span>
            </div>
            <p className={`font-heading font-heading-semibold text-xl ${card.color}`}>
              {summary[card.key]}
            </p>
          </button>
        ))}
      </div>

      {/* Filter + Search Row */}
      <div className="flex items-center space-x-3">
        <div className="relative flex-1 max-w-sm">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search by name, phone, email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        {filterTier !== 'all' && (
          <button
            onClick={() => setFilterTier('all')}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa bg-primary/10 text-primary text-xs font-caption font-caption-medium spa-transition-fast hover:bg-primary/20"
          >
            <span>{filterTier}</span>
            <Icon name="X" size={12} />
          </button>
        )}
        <span className="font-caption font-caption-normal text-xs text-text-tertiary">
          {filtered.length} customer{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Customer Table */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {customers.length === 0 ? 'No customers yet' : 'No customers match your filter'}
            </p>
            {customers.length === 0 && (
              <p className="font-caption text-xs text-text-tertiary mt-1">
                Customers are created automatically when bookings are made.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">#</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Customer</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary hidden sm:table-cell">Tier</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Revenue</th>
                  <th className="text-center px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary hidden md:table-cell">Visits</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary hidden lg:table-cell">Last Visit</th>
                  <th className="text-center px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary hidden md:table-cell">Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const lc = LOYALTY_CONFIG[c.loyaltyTier] || LOYALTY_CONFIG.Standard;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCustomerId(c.id)}
                      className="border-b border-border last:border-0 hover:bg-background/50 cursor-pointer spa-transition-fast"
                    >
                      <td className="px-4 py-3 font-data font-data-normal text-xs text-text-tertiary">
                        {c.rankByRevenue}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-body font-body-medium text-sm text-text-primary">{c.fullName}</p>
                          <p className="font-caption font-caption-normal text-xs text-text-tertiary">{c.phone}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${lc.color}`}>
                          <Icon name={lc.icon} size={10} />
                          <span>{c.loyaltyTier}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-data font-data-medium text-sm text-text-primary">
                          {formatNPR(c.totalRevenue)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <span className="font-data font-data-normal text-sm text-text-primary">
                          {c.completedVisits}
                          <span className="text-text-tertiary text-xs">/{c.totalVisits}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="font-caption font-caption-normal text-xs text-text-secondary">
                          {c.lastVisitDate
                            ? new Date(c.lastVisitDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                            : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        {c.unpaidCount > 0 ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-error/10 text-error text-[10px] font-caption font-caption-medium">
                            {c.unpaidCount}
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      {selectedCustomerId && (
        <CustomerProfileModal
          customerId={selectedCustomerId}
          onClose={() => setSelectedCustomerId(null)}
        />
      )}
    </div>
  );
};

export default CustomersPanel;
