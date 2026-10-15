import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CustomerContactQuickEdit from '../../../../components/ui/CustomerContactQuickEdit';
import ValueCorrectionView from '../../../../components/ui/ValueCorrectionView';
import {
  PanelShell, FormBody, Field, TextInput, MoneyInput, DateField, InfoRows, InlineError, TabBar, OverflowMenu, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchVoucher, fetchVoucherClaims, fetchBranchesByOrgId, fetchServicesByOrgId, claimVoucher, adminCorrectVoucherBalance } from '../../../../services/api';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const STATUS_CONFIG = {
  unused:         { label: 'Not claimed',       pill: 'bg-black/[0.05] text-text-secondary' },
  partially_used: { label: 'Partially claimed', pill: 'bg-warning/10 text-warning' },
  fully_redeemed: { label: 'Claimed',           pill: 'bg-success/10 text-success' },
};
const TABS = [{ id: 'details', label: 'Details' }, { id: 'claims', label: 'Claims' }];
const headerBtn = 'h-8 px-2.5 text-[13px] font-body font-body-medium rounded-spa spa-transition-fast whitespace-nowrap';

// ── Record a claim (stacked sub-view) ──────────────────────────────────────────────────────────────────────────────────────────
const ClaimView = ({ voucher, branches, services, onBack, onClose, onDone, width }) => {
  const { branchId: currentBranchId, isOverall } = useBranch();
  const remaining = Number(voucher.remainingBalance || 0);
  const [redeemedDate, setRedeemedDate] = useState(() => toDateInputValue(new Date()));
  const [branchId, setBranchId] = useState(!isOverall && currentBranchId ? currentBranchId : '');
  const [guest, setGuest] = useState(voucher.guestName || '');
  const [service, setService] = useState('');
  const [amount, setAmount] = useState(String(remaining));
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const submitRef = useRef(null);

  const amountNum = Number(amount) || 0;
  const reason = !branchId ? 'Select the branch' : !(amountNum > 0) ? 'Enter the amount' : amountNum > remaining ? `Only ${formatNPR(remaining)} remaining` : '';
  const dirty = !!(notes || service || guest !== (voucher.guestName || '') || amount !== String(remaining) || branchId !== (!isOverall && currentBranchId ? currentBranchId : ''));

  const submit = async () => {
    if (busyRef.current) return;
    const e = {};
    if (!branchId) e.branch = 'Select the branch where this is being claimed.';
    if (!(amountNum > 0)) e.amount = 'Amount claimed must be greater than zero.';
    else if (amountNum > remaining) e.amount = `Amount exceeds the remaining balance of ${formatNPR(remaining)}.`;
    setErrors(e);
    setServerError(null);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`vc-${first}`)?.focus({ preventScroll: true }); return; }
    busyRef.current = true;
    setBusy(true);
    const { error } = await claimVoucher({
      voucherId: voucher.id, amountClaimed: amountNum, redeemedDate, guestNameUsedBy: guest.trim() || null,
      serviceClaimed: service.trim() || null, branchClaimedId: branchId, notes: notes.trim() || null,
    });
    busyRef.current = false;
    setBusy(false);
    if (error) { setServerError(friendlyError(error, 'Failed to claim voucher.')); return; }
    onDone(`Claim recorded: ${formatNPR(amountNum)}.`);
  };
  submitRef.current = submit;

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('vc-amount')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  return (
    <PanelShell
      width={width} variant="panel" title="Record claim" onBack={onBack} onClose={onClose} dirty={dirty} busy={busy} reason={reason}
      primary={{ label: busy ? 'Recording…' : (amountNum > 0 ? `Record claim · ${formatNPR(amountNum)}` : 'Record claim'), onClick: submit, disabled: !!reason, loading: busy }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Amount claimed" required id="vc-amount" error={errors.amount} hint={voucher.isWallet ? 'Wallet voucher: claim less than the full balance to leave the rest for a future visit.' : undefined}>
          <MoneyInput {...controlA11y('vc-amount', errors.amount)} error={!!errors.amount} value={amount} onChange={setAmount} />
        </Field>
        <Field label="Branch claimed" required id="vc-branch" error={errors.branch}>
          <CustomSelect value={branchId} onChange={setBranchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select branch" error={!!errors.branch} />
        </Field>
        <DateField label="Redeemed date" value={redeemedDate} onChange={setRedeemedDate} />
        <Field label="Guest name (used by)" id="vc-guest">
          <TextInput id="vc-guest" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Who's redeeming" />
        </Field>
        <Field label="Service claimed">
          <CustomSelect value={service} onChange={setService} options={services.map((s) => ({ value: s.name, label: s.name }))} placeholder="Select service" searchable />
        </Field>
        {showNotes ? (
          <Field label="Notes" id="vc-notes">
            <TextInput id="vc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember for this claim…" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add note</button>
        )}
        <InfoRows rows={[['Remaining', `${formatNPR(remaining)} → ${formatNPR(remaining - amountNum)}`, amountNum > remaining ? 'error' : 'total']]} />
      </FormBody>
    </PanelShell>
  );
};

// ── Voucher detail ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Manager/admin. Header: Record claim (while balance remains) + "⋯" (Correct balance, admin only). The claim and the correction are
// stacked sub-views; success returns here with the voucher refreshed in place.
const VoucherDetailPanel = ({ voucherId, readOnly = false, width, onClose, onChanged }) => {
  const { orgSlug } = useParams();
  const { profile } = useAuth();
  const orgId = profile?.org_id;
  const isAdmin = profile?.role === 'admin';
  const [voucher, setVoucher] = useState(null);
  const [claims, setClaims] = useState([]);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('details');
  const [view, setView] = useState('detail'); // detail | claim | correct
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    setLoadError(null);
    const [voucherRes, claimsRes, branchesRes, servicesRes] = await Promise.all([
      fetchVoucher(voucherId),
      fetchVoucherClaims(voucherId),
      orgId ? fetchBranchesByOrgId(orgId) : Promise.resolve({ data: [] }),
      orgId ? fetchServicesByOrgId(orgId) : Promise.resolve({ data: [] }),
    ]);
    if (voucherRes.error) { setLoadError(voucherRes.error.message || 'Failed to load voucher.'); return; }
    setVoucher(voucherRes.data);
    setClaims(claimsRes.data || []);
    setBranches(branchesRes.data || []);
    setServices(servicesRes.data || []);
  }, [voucherId, orgId]);
  useEffect(() => { setVoucher(null); loadData(); }, [loadData]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const done = (message) => { setView('detail'); setNotice(message || ''); loadData(); onChanged?.(); };

  if (voucher && !readOnly && view === 'claim' && voucher.remainingBalance > 0) {
    return <ClaimView voucher={{ ...voucher, id: voucherId }} branches={branches} services={services} onBack={() => setView('detail')} onClose={onClose} onDone={done} width={width} />;
  }
  if (voucher && isAdmin && !readOnly && view === 'correct') {
    return (
      <ValueCorrectionView width={width}
        title="Correct balance" label="Correct remaining balance (NPR)" kind="number"
        currentLabel={`${formatNPR(voucher.remainingBalance)} remaining of ${formatNPR(voucher.totalAmountIssued)} issued`}
        warning={`Remaining is calculated as issued minus claims, so this adjusts the issued total and leaves the claim history intact. Because it changes the issued figure, the "Gift vouchers distributed" report total for ${formatDate(voucher.issuedDate)} will change to match. Cash reconciliation is unaffected. To remove a claim that never happened, void that claim instead.`}
        afterRows={(v) => [['Remaining', `${formatNPR(voucher.remainingBalance)} → ${formatNPR(v)}`, 'total'], ['Issued total', `${formatNPR(voucher.totalAmountIssued)} → ${formatNPR(Number(voucher.totalClaimed || 0) + v)}`]]}
        onSubmit={({ value, reason }) => adminCorrectVoucherBalance({ voucherId, newRemaining: value, reason })}
        onBack={() => setView('detail')} onClose={onClose} onDone={() => done('Balance corrected.')}
      />
    );
  }

  const cfg = voucher ? STATUS_CONFIG[voucher.status] || STATUS_CONFIG.unused : null;
  const canClaim = !!voucher && !readOnly && voucher.remainingBalance > 0;
  return (
    <PanelShell
      width={width} variant="panel" title={voucher?.voucherCode || 'Voucher'} onClose={onClose} hideFooter
      headerExtra={voucher ? (
        <>
          {canClaim && <button type="button" onClick={() => setView('claim')} className={`${headerBtn} bg-primary text-white hover:bg-primary/90`}>Record claim</button>}
          <OverflowMenu items={isAdmin && !readOnly ? [{ key: 'correct', label: 'Correct balance', icon: 'Pencil', run: () => setView('correct') }] : []} />
        </>
      ) : null}
    >
      <FormBody>
        {!voucher && !loadError && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading voucher">
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
        {voucher && (
          <>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {voucher.customerId ? (
                  <Link to={`/${orgSlug}/customers/${voucher.customerId}`} className="font-heading font-heading-semibold text-[17px] text-text-primary hover:text-primary hover:underline">{voucher.guestName}</Link>
                ) : (
                  <h4 className="font-heading font-heading-semibold text-[17px] text-text-primary">{voucher.guestName}</h4>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cfg.pill}`}>{cfg.label}</span>
                {voucher.isWallet && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">Wallet</span>}
              </div>
              {voucher.customerId && (
                <>
                  <p className="mt-1 text-[13px] text-text-secondary">{voucher.customerEmail || 'No email on file'}{voucher.customerPhone ? ` · ${voucher.customerPhone}` : ''}</p>
                  {!readOnly && <CustomerContactQuickEdit customerId={voucher.customerId} email={voucher.customerEmail} phone={voucher.customerPhone} onSaved={loadData} />}
                </>
              )}
            </div>

            <TabBar tabs={TABS} value={tab} onChange={setTab} />

            {tab === 'details' ? (
              <div className="space-y-4">
                <InfoRows rows={[
                  ['Remaining', formatNPR(voucher.remainingBalance), 'total'],
                  ['Issued', formatNPR(voucher.totalAmountIssued)],
                  ['Claimed', formatNPR(voucher.totalClaimed)],
                  ['Code', (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-data tracking-wide">{voucher.voucherCode}</span>
                      <button
                        type="button" aria-label="Copy voucher code" title={copied ? 'Copied' : 'Copy voucher code'}
                        onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(voucher.voucherCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
                        className="p-1 rounded-spa text-text-tertiary hover:text-primary hover:bg-black/[0.05]"
                      >
                        <Icon name={copied ? 'Check' : 'Copy'} size={12} />
                      </button>
                    </span>
                  )],
                  ['Type', voucher.voucherTypeName],
                  ['Valid until', formatDate(voucher.expiryDate)],
                  ['Issued on', formatDate(voucher.issuedDate)],
                  ['Issuing branch', voucher.branchName || '—'],
                  voucher.lastClaimDate ? ['Last claimed', formatDate(voucher.lastClaimDate)] : null,
                ]} />
                {voucher.remainingBalance <= 0 && <p className="text-[13px] text-success">This voucher has been fully claimed.</p>}
                {voucher.guestInfo && (<div><p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Guest info</p><p className="text-[13px] text-text-secondary whitespace-pre-wrap">{voucher.guestInfo}</p></div>)}
                {voucher.remarks && (<div><p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Remarks</p><p className="text-[13px] text-text-secondary whitespace-pre-wrap">{voucher.remarks}</p></div>)}
              </div>
            ) : claims.length === 0 ? (
              <div className="py-8 text-center">
                <Icon name="Receipt" size={24} className="text-text-tertiary mx-auto mb-2" />
                <p className="text-[13px] text-text-secondary">No claims yet.</p>
              </div>
            ) : (
              <ul className="border border-border rounded-spa divide-y divide-border">
                {claims.map((c) => (
                  <li key={c.id} className="px-3 py-2 text-[13px]">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 text-text-primary truncate">{c.service_claimed || 'Service not recorded'}</span>
                      <span className="font-data tabular-nums text-warning">-{formatNPR(c.amount_claimed)}</span>
                    </div>
                    <p className="text-xs text-text-tertiary">{formatDate(c.redeemed_date)} · {c.branch?.name || '—'}{c.guest_name_used_by ? ` · ${c.guest_name_used_by}` : ''}{c.notes ? ` · ${c.notes}` : ''}</p>
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

export default VoucherDetailPanel;
