import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchPackage, fetchPackageRedemptions } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CONFIG = {
  unused:         { label: 'Not Started',  pill: 'bg-gray-100 text-gray-600',   icon: 'Circle' },
  partially_used: { label: 'In Progress',  pill: 'bg-warning/10 text-warning',  icon: 'CircleDashed' },
  fully_redeemed: { label: 'Completed',    pill: 'bg-success/10 text-success',  icon: 'CheckCircle2' },
  expired:        { label: 'Expired',      pill: 'bg-error/10 text-error',      icon: 'AlertCircle' },
};

// Manager/admin only. Shows one package's details + full redemption ledger
// (package_redemptions). Unlike VoucherDetailModal, this has no manual
// "record a claim" form — session redemptions run through
// redeem_package_session() at booking checkout (see PaymentModal /
// recordPayment's SessionPackage tender handling, Task 2/3), so this modal
// stays read-only rather than opening a second, parallel write path for the
// same action outside the booking flow. `onChanged` is accepted (mirroring
// VoucherDetailModal's prop shape for the parent) but unused since nothing
// here mutates package state.
const PackageDetailModal = ({ packageId, onClose, onChanged: _onChanged }) => {
  const [pkg, setPkg] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [packageRes, redemptionsRes] = await Promise.all([
      fetchPackage(packageId),
      fetchPackageRedemptions(packageId),
    ]);
    if (packageRes.error) {
      setLoadError(packageRes.error.message || 'Failed to load package.');
      setLoading(false);
      return;
    }
    setPkg(packageRes.data);
    setRedemptions(redemptionsRes.data || []);
    setLoading(false);
  }, [packageId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const cfg = pkg ? (STATUS_CONFIG[pkg.status] || STATUS_CONFIG.unused) : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-detail-title"
      >
        <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-xl max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-header">
            <div>
              <h2 id="package-detail-title" className="font-heading font-heading-semibold text-base text-text-primary">
                {loading ? 'Loading...' : (pkg?.packageTypeName || 'Package')}
              </h2>
              {pkg && <p className="font-body text-xs text-text-secondary">{pkg.guestName}</p>}
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
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Service</p>
                  <p className="font-body font-body-medium text-sm text-text-primary">
                    {pkg.serviceName}
                    {pkg.serviceDurationMinutes ? ` (${pkg.serviceDurationMinutes} min)` : ''}
                  </p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Issuing branch</p>
                  <p className="font-body font-body-medium text-sm text-text-primary">{pkg.branchName}</p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Issued</p>
                  <p className="font-body text-sm text-text-secondary">{formatDate(pkg.issuedDate)}</p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Expires</p>
                  <p className="font-body text-sm text-text-secondary">{formatDate(pkg.expiryDate)}</p>
                </div>
                <div>
                  <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Issued by</p>
                  <p className="font-body text-sm text-text-secondary">{pkg.issuedByName}</p>
                </div>
                {pkg.guestInfo && (
                  <div>
                    <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Guest Info</p>
                    <p className="font-body text-sm text-text-secondary">{pkg.guestInfo}</p>
                  </div>
                )}
                {pkg.remarks && (
                  <div className="col-span-2">
                    <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">Remarks</p>
                    <p className="font-body text-sm text-text-secondary">{pkg.remarks}</p>
                  </div>
                )}
              </div>

              {/* Session summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-spa border border-border p-3">
                  <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Total sessions</p>
                  <p className="font-data font-data-semibold text-sm text-text-primary">{pkg.sessionsTotal}</p>
                </div>
                <div className="bg-surface rounded-spa border border-border p-3">
                  <p className="font-caption text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Used</p>
                  <p className="font-data font-data-semibold text-sm text-warning">{pkg.sessionsUsed}</p>
                </div>
                <div className="bg-primary/5 rounded-spa border border-primary/20 p-3">
                  <p className="font-caption text-[10px] text-primary uppercase tracking-wide mb-1">Remaining</p>
                  <p className="font-data font-data-semibold text-sm text-primary">{pkg.sessionsRemaining}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${cfg.pill}`}>
                    <Icon name={cfg.icon} size={11} />
                    <span>{cfg.label}</span>
                  </span>
                  <span className="font-caption text-xs text-text-tertiary">Paid {formatNPR(pkg.paidAmount)}</span>
                </div>
                {pkg.lastRedeemedDate && (
                  <span className="font-caption text-xs text-text-tertiary">Last used {formatDate(pkg.lastRedeemedDate)}</span>
                )}
              </div>

              {/* Redemption history */}
              <div>
                <h3 className="font-body font-body-medium text-xs text-text-secondary mb-2">Redemption history</h3>
                {redemptions.length === 0 ? (
                  <p className="font-caption text-xs text-text-tertiary bg-background border border-border rounded-spa px-3 py-3 text-center">
                    No sessions redeemed yet.
                  </p>
                ) : (
                  <div className="bg-background border border-border rounded-spa overflow-hidden">
                    {redemptions.map((r) => (
                      <div key={r.id} className="px-3 py-2.5 border-b border-border last:border-0 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-body font-body-medium text-sm text-text-primary truncate">
                            {r.guest_name_used_by || pkg.guestName}
                          </p>
                          <p className="font-caption text-xs text-text-tertiary">
                            {formatDate(r.redeemed_date)} · {r.branch?.name || '—'}
                            {r.performer?.full_name ? ` · ${r.performer.full_name}` : ''}
                          </p>
                          {r.notes && (
                            <p className="font-caption text-xs text-text-tertiary mt-0.5">{r.notes}</p>
                          )}
                        </div>
                        <span className="font-data font-data-medium text-sm text-warning flex-shrink-0">
                          -1 session
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {pkg.sessionsRemaining <= 0 && (
                <div className="bg-success/5 border border-success/20 rounded-spa px-3 py-2.5 flex items-center space-x-2">
                  <Icon name="CheckCircle2" size={14} className="text-success flex-shrink-0" />
                  <p className="font-body text-xs text-success">All sessions on this package have been redeemed.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default PackageDetailModal;
