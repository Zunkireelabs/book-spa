import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getCustomerReferralsReport } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDateOnly(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const STATUS_STYLES = {
  credited: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  void: 'bg-gray-100 text-gray-500',
};

// Manager-facing report for the customer-to-customer referral reward program
// (migration-078). Distinct from ReferralsReportPanel (staff/therapist
// commission) — different table, different money, kept as a separate query
// and component rather than merged into that report.
const CustomerReferralsReportPanel = ({ branchId }) => {
  const today = getTodayISO();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [mode, setMode] = useState('all'); // 'all' | 'preset' | 'custom'
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const [expanded, setExpanded] = useState(() => new Set());

  const isPreset = mode === 'preset';

  const range = useMemo(() => {
    if (mode === 'all') return { from: undefined, to: undefined };
    if (mode === 'custom' && appliedFrom) {
      return { from: appliedFrom, to: appliedTo || today };
    }
    const r = getPeriodRange(activePreset);
    return { from: r.startDate, to: r.endDate };
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getCustomerReferralsReport({ branchId, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load customer referrals.');
    } else {
      setGroups(data || []);
    }
    setLoading(false);
  }, [branchId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => {
        if (g.referrerName.toLowerCase().includes(q)) return g;
        const referrals = g.referrals.filter(r =>
          (r.referredCustomerName || '').toLowerCase().includes(q) ||
          (r.bookingNumber || '').toLowerCase().includes(q)
        );
        if (referrals.length === 0) return null;
        return { ...g, referrals };
      })
      .filter(Boolean);
  }, [groups, searchQuery]);

  const totalCredited = useMemo(
    () => filtered.reduce((s, g) => s + Number(g.totalCredited || 0), 0),
    [filtered]
  );
  const totalReferrals = useMemo(
    () => filtered.reduce((s, g) => s + g.referrals.length, 0),
    [filtered]
  );
  const totalPending = useMemo(
    () => filtered.reduce((s, g) => s + g.pendingCount, 0),
    [filtered]
  );

  const toggleExpand = (key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const presetItems = [
    { label: 'All Time', active: mode === 'all', onClick: () => setMode('all') },
    ...PERIOD_PRESETS.map((p) => ({
      label: p.label,
      active: isPreset && activePreset === p.id,
      onClick: () => { setMode('preset'); setActivePreset(p.id); },
    })),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Customer Referrals</h3>
        <p className="font-body text-sm text-text-secondary">
          {loading
            ? 'Loading…'
            : `${formatNPR(totalCredited)} credited across ${totalReferrals} referral${totalReferrals !== 1 ? 's' : ''}${totalPending > 0 ? ` · ${totalPending} pending` : ''}`}
        </p>
      </div>

      {/* Filters */}
      <FilterBar
        count={{ value: totalReferrals, label: totalReferrals === 1 ? 'Referral' : 'Referrals' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search by referrer, customer, or booking…' }}
        presets={presetItems}
        dateRange={{
          from: customFrom,
          onFromChange: setCustomFrom,
          to: customTo,
          onToChange: setCustomTo,
          max: today,
          onApply: handleCustomApply,
          applyDisabled: !customFrom || !customDirty,
          applyActive: mode === 'custom',
        }}
        hasActiveFilters={searchQuery.trim().length > 0}
        onClear={() => setSearchQuery('')}
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Loading referrals...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {groups.length === 0
                ? 'No customer referrals logged in this period.'
                : 'No referrals match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Referred By</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Credited</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary"># Referrals</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const key = g.referringCustomerId;
                  const isOpen = expanded.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast cursor-pointer"
                        onClick={() => toggleExpand(key)}
                      >
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-body font-body-medium text-sm text-text-primary">
                            <Icon name="UserCheck" size={15} className="text-primary" />
                            {g.referrerName}
                            {g.referrerPhone && <span className="text-text-secondary font-body-normal">{g.referrerPhone}</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-data font-data-medium text-sm text-success font-semibold whitespace-nowrap">
                          {formatNPR(g.totalCredited)}
                        </td>
                        <td className="px-4 py-3 text-right font-data text-sm text-text-secondary whitespace-nowrap">
                          {g.referrals.length}
                        </td>
                        <td className="px-2 py-3 text-text-tertiary">
                          <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} />
                        </td>
                      </tr>

                      {isOpen && g.referrals.map((r) => (
                        <tr key={r.referralId} className="border-b border-border last:border-b-0 bg-background/30">
                          <td colSpan={4} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap pl-4">
                              <div className="min-w-0">
                                <span className="font-body font-body-medium text-sm text-text-primary">{r.referredCustomerName}</span>
                                <span className="font-body text-xs text-text-secondary ml-2">
                                  {r.bookingNumber ? `#${r.bookingNumber} · ` : ''}{formatDateOnly(r.bookingDate)}
                                  {r.bookingStatus ? ` · ${r.bookingStatus}` : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[r.rewardStatus] || STATUS_STYLES.pending}`}>
                                  {r.rewardStatus}
                                </span>
                                <span className="font-data text-sm text-success font-semibold w-24 text-right">
                                  {r.rewardAmount != null ? formatNPR(r.rewardAmount) : '—'}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-success whitespace-nowrap">
                    {formatNPR(totalCredited)}
                  </td>
                  <td className="px-4 py-3 text-right font-data text-sm text-text-secondary">{totalReferrals}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerReferralsReportPanel;
