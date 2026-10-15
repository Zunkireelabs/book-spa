import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomerContactQuickEdit from '../../../../components/ui/CustomerContactQuickEdit';
import ValueCorrectionView from '../../../../components/ui/ValueCorrectionView';
import { PanelShell, FormBody, InfoRows, TabBar, OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { fetchPackage, fetchPackageRedemptions, adminCorrectPackageSessions } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const STATUS_CONFIG = {
  unused:         { label: 'Not started', pill: 'bg-black/[0.05] text-text-secondary' },
  partially_used: { label: 'In progress', pill: 'bg-warning/10 text-warning' },
  fully_redeemed: { label: 'Completed',   pill: 'bg-success/10 text-success' },
  expired:        { label: 'Expired',     pill: 'bg-error/10 text-error' },
};
const TABS = [{ id: 'details', label: 'Details' }, { id: 'usage', label: 'Usage' }];

// Package detail in the right-hand panel (manager/admin). Read-only apart from the admin "Correct sessions" sub-view: session
// redemptions run through redeem_package_session() at booking checkout, so there is deliberately no "record usage" here.
const PackageDetailPanel = ({ packageId, readOnly = false, width, onClose, onChanged }) => {
  const { orgSlug } = useParams();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [pkg, setPkg] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('details');
  const [view, setView] = useState('detail'); // detail | correct
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    setLoadError(null);
    const [packageRes, redemptionsRes] = await Promise.all([fetchPackage(packageId), fetchPackageRedemptions(packageId)]);
    if (packageRes.error) { setLoadError(packageRes.error.message || 'Failed to load package.'); return; }
    setPkg(packageRes.data);
    setRedemptions(redemptionsRes.data || []);
  }, [packageId]);
  useEffect(() => { setPkg(null); loadData(); }, [loadData]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (pkg && isAdmin && !readOnly && view === 'correct') {
    return (
      <ValueCorrectionView width={width}
        title="Correct sessions" label="Total sessions on this package" currentLabel={`${pkg.sessionsTotal} total, ${pkg.sessionsUsed} used`} kind="integer"
        warning="Sessions remaining is calculated as total minus redemptions, so this corrects the total. It cannot be set below the number already redeemed; void the incorrect redemption first."
        blocked={(v) => (v < pkg.sessionsUsed ? `Can't be below the ${pkg.sessionsUsed} already redeemed.` : null)}
        afterRows={(v) => [['Total sessions', `${pkg.sessionsTotal} → ${v}`], ['Remaining', `${pkg.sessionsRemaining} → ${v - pkg.sessionsUsed}`, v < pkg.sessionsUsed ? 'error' : 'total']]}
        onSubmit={({ value, reason }) => adminCorrectPackageSessions({ packageId, newSessionsTotal: value, reason })}
        onBack={() => setView('detail')} onClose={onClose}
        onDone={() => { setView('detail'); setNotice('Sessions corrected.'); loadData(); onChanged?.(); }}
      />
    );
  }

  const cfg = pkg ? STATUS_CONFIG[pkg.status] || STATUS_CONFIG.unused : null;
  return (
    <PanelShell
      width={width} variant="panel" title={pkg?.packageTypeName || 'Package'} onClose={onClose} hideFooter
      headerExtra={pkg && isAdmin && !readOnly ? <OverflowMenu items={[{ key: 'correct', label: 'Correct sessions', icon: 'Pencil', run: () => setView('correct') }]} /> : null}
    >
      <FormBody>
        {!pkg && !loadError && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading package">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-spa border border-border bg-background animate-pulse" />)}
          </div>
        )}
        {loadError && (
          <div role="alert" className="flex items-center gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="flex-1 text-[13px] text-error">{loadError}</p>
            <button type="button" onClick={loadData} className="text-[13px] font-body-medium text-error underline">Retry</button>
          </div>
        )}
        {notice && (
          <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success">
            <Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
          </p>
        )}
        {pkg && (
          <>
            <div>
              <div className="flex items-center gap-2">
                {pkg.customerId ? (
                  <Link to={`/${orgSlug}/customers/${pkg.customerId}`} className="font-heading font-heading-semibold text-[17px] text-text-primary hover:text-primary hover:underline">{pkg.guestName}</Link>
                ) : (
                  <h4 className="font-heading font-heading-semibold text-[17px] text-text-primary">{pkg.guestName}</h4>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cfg.pill}`}>{cfg.label}</span>
              </div>
              {pkg.customerId && (
                <>
                  <p className="mt-1 text-[13px] text-text-secondary">{pkg.customerEmail || 'No email on file'}{pkg.customerPhone ? ` · ${pkg.customerPhone}` : ''}</p>
                  {!readOnly && <CustomerContactQuickEdit customerId={pkg.customerId} email={pkg.customerEmail} phone={pkg.customerPhone} onSaved={loadData} />}
                </>
              )}
            </div>

            <TabBar tabs={TABS} value={tab} onChange={setTab} />

            {tab === 'details' ? (
              <div className="space-y-4">
                <InfoRows rows={[
                  ['Sessions remaining', `${pkg.sessionsRemaining} of ${pkg.sessionsTotal}`, 'total'],
                  ['Sessions used', String(pkg.sessionsUsed)],
                  ['Service', `${pkg.serviceName}${pkg.serviceDurationMinutes ? ` (${pkg.serviceDurationMinutes} min)` : ''}`],
                  ['Paid', `${formatNPR(pkg.paidAmount)}${pkg.paymentMethod ? ` (${pkg.paymentMethod})` : ''}`],
                  pkg.baseAmount != null ? ['Price', formatNPR(pkg.baseAmount)] : null,
                  pkg.baseAmount != null && pkg.discountAmount > 0 ? [`Discount${pkg.discountType === 'percentage' ? ` (${pkg.discountValue}%)` : ''}`, `-${formatNPR(pkg.discountAmount)}`] : null,
                  pkg.baseAmount != null ? ['Total', formatNPR(pkg.finalAmount)] : null,
                  pkg.dueAmount > 0 ? [`Due${pkg.dueHolderName ? ` — ${pkg.dueHolderName}` : ''}`, formatNPR(pkg.dueAmount), 'amber'] : null,
                  ['Valid until', formatDate(pkg.expiryDate)],
                  ['Issued', formatDate(pkg.issuedDate)],
                  ['Issuing branch', pkg.branchName || '—'],
                  ['Issued by', pkg.issuedByName || '—'],
                  pkg.lastRedeemedDate ? ['Last used', formatDate(pkg.lastRedeemedDate)] : null,
                ]} />
                {pkg.sessionsRemaining <= 0 && <p className="text-[13px] text-success">All sessions on this package have been redeemed.</p>}
                {pkg.guestInfo && (<div><p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Guest info</p><p className="text-[13px] text-text-secondary whitespace-pre-wrap">{pkg.guestInfo}</p></div>)}
                {pkg.remarks && (<div><p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Remarks</p><p className="text-[13px] text-text-secondary whitespace-pre-wrap">{pkg.remarks}</p></div>)}
              </div>
            ) : redemptions.length === 0 ? (
              <div className="py-8 text-center">
                <Icon name="Receipt" size={24} className="text-text-tertiary mx-auto mb-2" />
                <p className="text-[13px] text-text-secondary">No sessions redeemed yet.</p>
              </div>
            ) : (
              <ul className="border border-border rounded-spa divide-y divide-border">
                {redemptions.map((r) => (
                  <li key={r.id} className="px-3 py-2 text-[13px]">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 text-text-primary truncate">{r.guest_name_used_by || pkg.guestName}</span>
                      <span className="font-data tabular-nums text-warning">-1 session</span>
                    </div>
                    <p className="text-xs text-text-tertiary">{formatDate(r.redeemed_date)} · {r.branch?.name || '—'}{r.performer?.full_name ? ` · ${r.performer.full_name}` : ''}{r.notes ? ` · ${r.notes}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default PackageDetailPanel;
