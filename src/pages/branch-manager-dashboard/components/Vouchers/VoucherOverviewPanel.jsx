import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchVoucherOverview, fetchVoucherTypes } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import NewVoucherModal from './NewVoucherModal';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

// "All Voucher" — org-wide voucher dashboard: totals, status breakdown,
// wallet summary, and a per-branch table showing how many vouchers each
// branch has been given and what it still owes against them.
const VoucherOverviewPanel = () => {
  const { profile } = useAuth();
  const userRole = profile?.role || 'manager';
  const [overview, setOverview] = useState(null);
  const [voucherTypes, setVoucherTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNewVoucher, setShowNewVoucher] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: fetchError }, { data: types, error: typesError }] = await Promise.all([
      fetchVoucherOverview(),
      fetchVoucherTypes(),
    ]);
    if (fetchError) {
      setError(fetchError.message || 'Failed to load voucher overview.');
      setLoading(false);
      return;
    }
    setOverview(data);
    setVoucherTypes(typesError ? [] : types);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-3 bg-background rounded w-16 mb-2" />
              <div className="h-6 bg-background rounded w-20" />
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

  const { totals, branches } = overview;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">All Voucher</h3>
          <p className="font-body text-sm text-text-secondary">Org-wide voucher totals and branch breakdown</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewVoucher(true)}
          className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast flex-shrink-0"
        >
          <Icon name="Plus" size={14} />
          <span>New Voucher</span>
        </button>
      </div>

      {/* Top-line totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/10">
              <Icon name="Ticket" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Issued</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-text-primary">{totals.totalVouchers}</p>
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/10">
              <Icon name="ArrowDownToLine" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Amount Issued</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-text-primary">{formatNPR(totals.totalIssuedAmount)}</p>
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-warning/10">
              <Icon name="ArrowUpFromLine" size={14} className="text-warning" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Amount Claimed</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-warning">{formatNPR(totals.totalClaimedAmount)}</p>
        </div>
        <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/15">
              <Icon name="AlertCircle" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-primary uppercase tracking-wide">Outstanding</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-primary">{formatNPR(totals.totalRemaining)}</p>
        </div>
      </div>

      {/* Voucher types catalog — the same name + price list used in the New Voucher dropdown */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 bg-background border-b border-border">
          <span className="font-body font-body-medium text-xs text-text-secondary">Voucher Types</span>
        </div>
        {voucherTypes.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Ticket" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">No voucher types found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Name</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Price</th>
                </tr>
              </thead>
              <tbody>
                {voucherTypes.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-body font-body-medium text-sm text-text-primary">{t.name}</span>
                      {t.is_wallet && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-caption text-[10px] uppercase tracking-wide">
                          Wallet
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-medium text-sm text-text-primary">{formatNPR(t.standard_price)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Branch breakdown */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 bg-background border-b border-border">
          <span className="font-body font-body-medium text-xs text-text-secondary">Vouchers by Branch</span>
        </div>
        {branches.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Building2" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">No branches found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Branch</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Issued (Count)</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Amount Issued</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Claimed (Count)</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Amount Claimed</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.branchId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-body font-body-medium text-sm text-text-primary">{b.branchName}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{b.issuedCount}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(b.issuedAmount)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{b.claimedCount}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-medium text-sm text-warning">{formatNPR(b.claimedAmount)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-medium text-sm text-primary">{formatNPR(b.outstanding)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{totals.totalVouchers}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(totals.totalIssuedAmount)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">
                    {branches.reduce((sum, b) => sum + b.claimedCount, 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-warning">{formatNPR(totals.totalClaimedAmount)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-primary">{formatNPR(totals.totalRemaining)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showNewVoucher && (
        <NewVoucherModal
          userRole={userRole}
          onClose={() => setShowNewVoucher(false)}
          onIssued={() => {
            setShowNewVoucher(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};

export default VoucherOverviewPanel;
