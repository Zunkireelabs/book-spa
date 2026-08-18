import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import {
  fetchVoucher,
  fetchVoucherClaims,
  fetchBranchesByOrgId,
  fetchServicesByOrgId,
  claimVoucher,
} from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

const STATUS_CONFIG = {
  unused:         { label: 'Not Claimed',       pill: 'bg-gray-100 text-gray-600',   icon: 'Circle' },
  partially_used: { label: 'Partially Claimed', pill: 'bg-warning/10 text-warning',  icon: 'CircleDashed' },
  fully_redeemed: { label: 'Claimed',           pill: 'bg-success/10 text-success',  icon: 'CheckCircle2' },
};

// Manager/admin only. Shows one voucher's details + full redemption ledger,
// and (while balance remains) a claim form that calls claim_voucher() —
// enforces the remaining-balance check server-side too, so this form can
// only ever confirm what the DB already guarantees.
const VoucherDetailModal = ({ voucherId, onClose, onChanged }) => {
  const { profile } = useAuth();
  const { branchId: currentBranchId, isOverall } = useBranch();
  const orgId = profile?.org_id;

  const [voucher, setVoucher] = useState(null);
  const [claims, setClaims] = useState([]);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [redeemedDate, setRedeemedDate] = useState(() => toDateInputValue(new Date()));
  const [guestNameUsedBy, setGuestNameUsedBy] = useState('');
  const [serviceClaimed, setServiceClaimed] = useState('');
  const [branchClaimedId, setBranchClaimedId] = useState('');
  const [amountClaimed, setAmountClaimed] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [voucherRes, claimsRes, branchesRes, servicesRes] = await Promise.all([
      fetchVoucher(voucherId),
      fetchVoucherClaims(voucherId),
      orgId ? fetchBranchesByOrgId(orgId) : Promise.resolve({ data: [] }),
      orgId ? fetchServicesByOrgId(orgId) : Promise.resolve({ data: [] }),
    ]);
    if (voucherRes.error) {
      setLoadError(voucherRes.error.message || 'Failed to load voucher.');
      setLoading(false);
      return;
    }
    setVoucher(voucherRes.data);
    setClaims(claimsRes.data || []);
    setBranches(branchesRes.data || []);
    setServices(servicesRes.data || []);
    setGuestNameUsedBy((prev) => prev || voucherRes.data.guestName);
    setAmountClaimed(String(voucherRes.data.remainingBalance));
    setLoading(false);
  }, [voucherId, orgId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!branchClaimedId && !isOverall && currentBranchId) setBranchClaimedId(currentBranchId);
  }, [branchClaimedId, isOverall, currentBranchId]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const amountNum = Number(amountClaimed) || 0;

  const handleClaim = async (e) => {
    e.preventDefault();
    setError(null);

    if (!branchClaimedId) { setError('Please select the branch where this is being claimed.'); return; }
    if (amountNum <= 0) { setError('Amount claimed must be greater than zero.'); return; }
    if (amountNum > voucher.remainingBalance) {
      setError(`Amount exceeds the remaining balance of ${formatNPR(voucher.remainingBalance)}.`);
      return;
    }

    setSubmitting(true);
    const { error: rpcError } = await claimVoucher({
      voucherId,
      amountClaimed: amountNum,
      redeemedDate,
      guestNameUsedBy: guestNameUsedBy.trim() || null,
      serviceClaimed: serviceClaimed.trim() || null,
      branchClaimedId,
      notes: notes.trim() || null,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message || 'Failed to claim voucher.');
      return;
    }

    setServiceClaimed('');
    setNotes('');
    await loadData();
    onChanged?.();
  };

  const cfg = voucher ? (STATUS_CONFIG[voucher.status] || STATUS_CONFIG.unused) : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voucher-detail-title"
      >
        <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-xl max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-header">
            <div>
              <h2 id="voucher-detail-title" className="font-heading font-heading-semibold text-base text-text-primary">
                {loading ? 'Loading...' : voucher?.voucherCode}
              </h2>
              {voucher && <p className="font-body text-xs text-text-secondary">{voucher.guestName}</p>}
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          {loading ? (
            <div className="p-8 space-y-3 animate-pulse">
              <div className="h-4 bg-background rounded w-48" />
              <div className="h-20 bg-background rounded" />
              <div className="h-32 bg-background rounded" />
            </div>
          ) : loadError ? (
            <div className="p-5">
              <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-error">{loadError}</p>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-background border border-border rounded-spa px-3 py-3">
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Type</p>
                  <p className="font-body font-body-medium text-sm text-text-primary">
                    {voucher.voucherTypeName}
                    {voucher.isWallet && <span className="ml-1.5 text-[10px] text-primary">(wallet)</span>}
                  </p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Issuing branch</p>
                  <p className="font-body font-body-medium text-sm text-text-primary">{voucher.branchName}</p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Issued</p>
                  <p className="font-body text-sm text-text-secondary">{formatDate(voucher.issuedDate)}</p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Expires</p>
                  <p className="font-body text-sm text-text-secondary">{formatDate(voucher.expiryDate)}</p>
                </div>
                {voucher.guestInfo && (
                  <div className="col-span-2">
                    <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Guest Info</p>
                    <p className="font-body text-sm text-text-secondary">{voucher.guestInfo}</p>
                  </div>
                )}
                {voucher.remarks && (
                  <div className="col-span-2">
                    <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Remarks</p>
                    <p className="font-body text-sm text-text-secondary">{voucher.remarks}</p>
                  </div>
                )}
              </div>

              {/* Balance summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-spa border border-border p-3">
                  <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Issued</p>
                  <p className="font-data font-data-semibold text-sm text-text-primary">{formatNPR(voucher.totalAmountIssued)}</p>
                </div>
                <div className="bg-surface rounded-spa border border-border p-3">
                  <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Claimed</p>
                  <p className="font-data font-data-semibold text-sm text-warning">{formatNPR(voucher.totalClaimed)}</p>
                </div>
                <div className="bg-primary/5 rounded-spa border border-primary/20 p-3">
                  <p className="font-caption text-[10px] text-primary uppercase tracking-wide mb-1">Remaining</p>
                  <p className="font-data font-data-semibold text-sm text-primary">{formatNPR(voucher.remainingBalance)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${cfg.pill}`}>
                  <Icon name={cfg.icon} size={11} />
                  <span>{cfg.label}</span>
                </span>
                {voucher.lastClaimDate && (
                  <span className="font-caption text-xs text-text-tertiary">Last claimed {formatDate(voucher.lastClaimDate)}</span>
                )}
              </div>

              {/* Claim history */}
              <div>
                <h3 className="font-body font-body-medium text-xs text-text-secondary mb-2">Claim history</h3>
                {claims.length === 0 ? (
                  <p className="font-caption text-xs text-text-tertiary bg-background border border-border rounded-spa px-3 py-3 text-center">
                    No claims yet.
                  </p>
                ) : (
                  <div className="bg-background border border-border rounded-spa overflow-hidden">
                    {claims.map((c) => (
                      <div key={c.id} className="px-3 py-2.5 border-b border-border last:border-0 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-body font-body-medium text-sm text-text-primary truncate">
                            {c.service_claimed || 'Service not recorded'}
                          </p>
                          <p className="font-caption text-xs text-text-tertiary">
                            {formatDate(c.redeemed_date)} · {c.branch?.name || '—'}
                            {c.guest_name_used_by ? ` · ${c.guest_name_used_by}` : ''}
                          </p>
                        </div>
                        <span className="font-data font-data-medium text-sm text-warning flex-shrink-0">
                          -{formatNPR(c.amount_claimed)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Claim form */}
              {voucher.remainingBalance > 0 ? (
                <form onSubmit={handleClaim} className="space-y-3 border-t border-border pt-4">
                  <h3 className="font-body font-body-medium text-xs text-text-secondary">Record a claim</h3>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Redeemed date</label>
                      <input
                        type="date"
                        value={redeemedDate}
                        onChange={(e) => setRedeemedDate(e.target.value)}
                        className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Branch claimed</label>
                      <CustomSelect
                        value={branchClaimedId}
                        onChange={setBranchClaimedId}
                        options={branches.map((b) => ({ value: b.id, label: b.name }))}
                        placeholder="Select branch"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Guest name (used by)</label>
                      <input
                        type="text"
                        value={guestNameUsedBy}
                        onChange={(e) => setGuestNameUsedBy(e.target.value)}
                        placeholder="Who's redeeming"
                        className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Service claimed</label>
                      <CustomSelect
                        value={serviceClaimed}
                        onChange={setServiceClaimed}
                        options={services.map((s) => ({ value: s.name, label: s.name }))}
                        placeholder="Select service"
                        searchable
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                      Amount claimed (NPR) — remaining balance: {formatNPR(voucher.remainingBalance)}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={voucher.remainingBalance}
                      step="any"
                      value={amountClaimed}
                      onChange={(e) => setAmountClaimed(e.target.value)}
                      className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    {voucher.isWallet && (
                      <p className="mt-1.5 font-caption text-xs text-text-tertiary">
                        Wallet voucher — claim less than the full balance to leave the rest for a future visit.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Notes (optional)</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Anything to remember for this claim..."
                      className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>

                  {error && (
                    <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                      <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                      <p className="font-body text-xs text-error">{error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast inline-flex items-center justify-center space-x-1.5"
                  >
                    {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    <span>Record claim</span>
                  </button>
                </form>
              ) : (
                <div className="bg-success/5 border border-success/20 rounded-spa px-3 py-2.5 flex items-center space-x-2">
                  <Icon name="CheckCircle2" size={14} className="text-success flex-shrink-0" />
                  <p className="font-body text-xs text-success">This voucher has been fully claimed.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VoucherDetailModal;
