import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import { fetchMemberships } from '../../../../services/api';
import EnrollMemberModal from './EnrollMemberModal';
import MembershipDetailModal from './MembershipDetailModal';
import TiersModal from './TiersModal';

const STATUS_CONFIG = {
  active:   { label: 'Active',   pill: 'bg-success/10 text-success',   icon: 'CheckCircle2' },
  pending:  { label: 'Pending',  pill: 'bg-amber-100 text-amber-800',  icon: 'Clock' },
  lapsed:   { label: 'Lapsed',   pill: 'bg-warning/10 text-warning',   icon: 'AlertTriangle' },
  depleted: { label: 'Depleted', pill: 'bg-gray-100 text-gray-600',    icon: 'CircleSlash' },
};

const SUMMARY_FILTERS = [
  { key: 'all',      label: 'Total',    icon: 'CreditCard',   color: 'text-text-primary', bg: 'bg-background' },
  { key: 'active',   label: 'Active',   icon: 'CheckCircle2', color: 'text-success',      bg: 'bg-success/5' },
  { key: 'pending',  label: 'Pending',  icon: 'Clock',        color: 'text-amber-700',    bg: 'bg-amber-50' },
  { key: 'lapsed',   label: 'Lapsed',   icon: 'AlertTriangle',color: 'text-warning',      bg: 'bg-warning/5' },
  { key: 'depleted', label: 'Depleted', icon: 'CircleSlash',  color: 'text-text-tertiary',bg: 'bg-gray-50' },
];

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const MembershipsPanel = () => {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showEnroll, setShowEnroll] = useState(false);
  const [showTiers, setShowTiers] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await fetchMemberships();
    if (error) {
      setError(error.message || 'Failed to load memberships.');
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Client-side filter (panel applies both the status pill click and the search box).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (q) {
        const name = (m.customerName || '').toLowerCase();
        const phone = m.customerPhone || '';
        const number = (m.membershipNumber || '').toLowerCase();
        if (!name.includes(q) && !phone.includes(q) && !number.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const summary = useMemo(() => ({
    all: rows.length,
    active: rows.filter((m) => m.status === 'active').length,
    pending: rows.filter((m) => m.status === 'pending').length,
    lapsed: rows.filter((m) => m.status === 'lapsed').length,
    depleted: rows.filter((m) => m.status === 'depleted').length,
    totalBalance: rows.reduce((sum, m) => sum + (m.balance || 0), 0),
  }), [rows]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-3 bg-background rounded w-12 mb-2" />
              <div className="h-6 bg-background rounded w-8" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-background rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {SUMMARY_FILTERS.map((card) => (
          <button
            key={card.key}
            onClick={() => setStatusFilter(card.key)}
            className={`bg-surface rounded-spa-lg border p-4 text-left spa-transition-fast hover:shadow-sm ${
              statusFilter === card.key ? 'border-primary/30 ring-1 ring-primary/10' : 'border-border'
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

      {/* Total balance strip */}
      <div className="bg-surface rounded-spa-lg border border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Icon name="Wallet" size={16} className="text-primary" />
          <span className="font-body font-body-medium text-sm text-text-secondary">Total wallet balance across all members</span>
        </div>
        <span className="font-data font-data-medium text-base text-primary">{formatNPR(summary.totalBalance)}</span>
      </div>

      {/* Filter + search + new */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search by card no., name, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        {statusFilter !== 'all' && (
          <button
            onClick={() => setStatusFilter('all')}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa bg-primary/10 text-primary text-xs font-caption font-caption-medium spa-transition-fast hover:bg-primary/20"
          >
            <span>{STATUS_CONFIG[statusFilter]?.label || statusFilter}</span>
            <Icon name="X" size={12} />
          </button>
        )}
        <span className="font-caption font-caption-normal text-xs text-text-tertiary">
          {filtered.length} member{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center space-x-2">
          {profile?.role === 'admin' && (
            <button
              type="button"
              onClick={() => setShowTiers(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa border border-border text-text-secondary text-sm font-body font-body-medium hover:bg-background spa-transition-fast"
            >
              <Icon name="Settings" size={14} />
              <span>Manage tiers</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowEnroll(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast"
          >
            <Icon name="Plus" size={14} />
            <span>New Member</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="CreditCard" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {rows.length === 0 ? 'No members yet' : 'No members match your filter'}
            </p>
            {rows.length === 0 && (
              <p className="font-caption text-xs text-text-tertiary mt-1">
                Click "New Member" to enroll your first customer.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Card no.</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Member</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Tier</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Status</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Balance</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary hidden md:table-cell">Deposited</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary hidden lg:table-cell">Expires</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const cfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.pending;
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      className="border-b border-border last:border-0 hover:bg-background/50 cursor-pointer spa-transition-fast"
                    >
                      <td className="px-4 py-3">
                        <span className="font-data font-data-medium text-xs text-text-primary tracking-wide">{m.membershipNumber || '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-body font-body-medium text-sm text-text-primary">{m.customerName || '—'}</p>
                        <p className="font-caption font-caption-normal text-xs text-text-tertiary">{m.customerPhone || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-body font-body-medium text-sm text-text-primary">{m.tierName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${cfg.pill}`}>
                          <Icon name={cfg.icon} size={10} />
                          <span>{cfg.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-data font-data-medium text-sm text-text-primary">{formatNPR(m.balance)}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(m.totalDeposited)}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="font-caption font-caption-normal text-xs text-text-secondary">
                          {formatDate(m.expiryDate)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEnroll && (
        <EnrollMemberModal
          onClose={() => setShowEnroll(false)}
          onEnrolled={(newId) => {
            setShowEnroll(false);
            loadData();
            if (newId) setSelectedId(newId);
          }}
        />
      )}

      {selectedId && (
        <MembershipDetailModal
          membershipId={selectedId}
          isAdmin={profile?.role === 'admin'}
          onClose={() => setSelectedId(null)}
          onChanged={loadData}
        />
      )}

      {showTiers && (
        <TiersModal
          orgId={profile?.org_id}
          onClose={() => setShowTiers(false)}
          onChanged={loadData}
        />
      )}
    </div>
  );
};

export default MembershipsPanel;
