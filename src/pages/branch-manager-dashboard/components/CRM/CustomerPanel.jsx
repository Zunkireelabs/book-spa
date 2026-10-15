import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import SidePanel from '../../../../components/ui/SidePanel';
import PaymentModal from '../../../../components/ui/PaymentModal';
import { PanelShell, FormBody, InfoRows } from '../../../../components/ui/PanelFormKit';
import MembershipDetailPanel from '../Memberships/MembershipDetailPanel';
import PackageDetailPanel from '../Packages/PackageDetailPanel';
import VoucherDetailPanel from '../Vouchers/VoucherDetailPanel';
import { getCustomerPanelDetail, recordPayment, recordTip } from '../../../../services/api';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { initials, monthYear, dayBlock, relativeDayLabel, shortDate } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { InSpaTag } from './customerBits';

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const clock = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`; };
const range = (b) => (b.end ? `${clock(b.start)} – ${clock(b.end)}` : clock(b.start));

const Label = ({ children, action }) => (
  <div className="flex justify-between items-center mb-2 text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]"><span>{children}</span>{action}</div>
);
const DateBlock = ({ iso }) => {
  const d = dayBlock(iso);
  return (
    <div className="w-10 text-center rounded-md bg-[#FAFAF9] border border-border py-1 flex-shrink-0">
      <span className="block text-[10px] font-semibold uppercase text-[#8A8A90] leading-tight">{d.dow}</span>
      <b className="block text-[15px] font-semibold tracking-tight leading-tight">{d.day}</b>
    </div>
  );
};
const StatusPill = ({ status }) => (
  <span className={`h-5 px-2 rounded-full text-[11.5px] font-medium inline-flex items-center ${status === 'Confirmed' ? 'bg-[#EEF4FF] text-[#1D4ED8]' : 'bg-[#F1F1EF] text-[#4A4A4F]'}`}>{status}</span>
);
const SkeletonCard = () => <div className="h-[66px] rounded-lg border border-border animate-pulse bg-[#FAFAF9]" />;
const Stat = ({ label, value, amber, divider }) => (
  <div className={`px-3.5 py-3 ${divider ? 'border-l border-border' : ''}`}>
    <span className="text-[12px] text-[#8A8A90]">{label}</span>
    <b className={`block text-[16px] font-semibold tracking-[-0.3px] mt-[3px] tabular-nums ${amber ? 'text-[#B45309]' : ''}`}>{value}</b>
  </div>
);
const PrepaidRow = ({ icon, title, sub, value, valueSub, onClick }) => (
  <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#FAFAF9]">
    <span className="w-7 h-7 rounded-md bg-[#FAFAF9] grid place-items-center text-[#515152] flex-shrink-0"><Icon name={icon} size={14} /></span>
    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium truncate">{title}</span><span className="block text-[12.5px] text-[#8A8A90] truncate">{sub}</span></span>
    <span className="text-right flex-shrink-0"><span className="block text-[13px] font-medium tabular-nums">{value}</span><span className="block text-[12.5px] text-[#8A8A90]">{valueSub}</span></span>
  </button>
);

// Customer side panel (460px) over the list. `customer` is the directory row; the per-customer detail loads when it opens.
// readOnly (Overall / admin_viewer): no booking or collect actions; prepaid records still open their detail panels (which apply
// their own read-only rules).
const CustomerPanel = ({ customer, today, readOnly, branchId, isAdmin, onClose, onNewBooking, onOpenProfile, onChanged }) => {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState('main'); // main | collect
  const [notice, setNotice] = useState('');
  const [prepaid, setPrepaid] = useState(null); // { kind: 'membership'|'package'|'voucher', id }
  const id = customer?.id;

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setFailed(false);
    getCustomerPanelDetail({ customerId: id }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setFailed(true); else setDetail(data);
    });
    return () => { cancelled = true; };
  }, [id, reloadKey]);
  useEffect(() => { setDetail(null); setView('main'); setNotice(''); setPrepaid(null); }, [id]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Keep the last customer rendered while the panel slides out.
  const [shown, setShown] = useState(customer);
  useEffect(() => { if (customer) setShown(customer); }, [customer]);
  const c = customer || shown;

  const refresh = () => { setReloadKey((k) => k + 1); onChanged?.(); };

  // ── Collect: tick the owed visits, then pay them through the same PaymentModal path as the Outstanding report ──
  const [ticked, setTicked] = useState(null); // Set of bookingIds
  const owed = detail?.owed || [];
  useEffect(() => { if (view === 'collect') setTicked(new Set(owed.map((o) => o.bookingId))); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => owed.filter((o) => ticked?.has(o.bookingId)), [owed, ticked]);
  const chosenTotal = Math.round(chosen.reduce((s, o) => s + o.amountDue, 0) * 100) / 100;
  const [paying, setPaying] = useState(null); // { primary, others }
  const [paySubmitting, setPaySubmitting] = useState(false);

  const handleRecordPayment = async ({ tenders, additionalAllocations, dueHolderName, notes, tipSplits }) => {
    setPaySubmitting(true);
    const result = await recordPayment({ bookingId: paying.primary.bookingId, tenders, dueHolderName, notes });
    if (result.error) { setPaySubmitting(false); return { error: result.error }; }
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId: paying.primary.bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }
    for (const alloc of (additionalAllocations || [])) await recordPayment({ bookingId: alloc.bookingId, tenders: alloc.tenders, notes });
    setPaySubmitting(false);
    setPaying(null);
    setView('main');
    setNotice(`Payment recorded for ${c.fullName}.`);
    refresh();
    return { error: null };
  };

  if (view === 'collect' && c) {
    return (
      <>
        <PanelShell
          variant="panel" title={`Collect from ${c.fullName}`} onClose={onClose} onBack={() => setView('main')}
          reason={chosen.length === 0 ? 'Tick at least one visit' : ''}
          primary={{ label: chosen.length ? `Collect ${npr(chosenTotal)}` : 'Collect', disabled: chosen.length === 0, onClick: () => setPaying({ primary: chosen[0], others: chosen.slice(1) }) }}
        >
          <FormBody>
            <p className="text-[13px] text-text-secondary">Unpaid visits that have already happened. Untick any you are not collecting now; the payment window opens next.</p>
            <ul className="border border-border rounded-spa divide-y divide-border">
              {owed.map((o) => (
                <li key={o.bookingId}>
                  <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-background">
                    <input type="checkbox" className="w-4 h-4 rounded text-primary" checked={!!ticked?.has(o.bookingId)}
                      onChange={(e) => setTicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(o.bookingId); else n.delete(o.bookingId); return n; })} />
                    <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{shortDate(o.date)}</span><span className="text-[#515152]"> · {o.serviceName}</span></span>
                    <span className="text-[13px] tabular-nums font-medium">{npr(o.amountDue)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <InfoRows rows={[['Selected', `${chosen.length} of ${owed.length} visit${owed.length === 1 ? '' : 's'}`], ['To collect', npr(chosenTotal), 'total']]} />
          </FormBody>
        </PanelShell>
        {paying && (
          <PaymentModal
            booking={{
              bookingId: paying.primary.bookingId, booking_number: paying.primary.bookingNumber, branchId: paying.primary.branchId || branchId,
              finalAmount: paying.primary.finalAmount, amountPaid: paying.primary.amountPaid, service: paying.primary.serviceName, dueHolderName: '',
            }}
            additionalBookings={paying.others}
            onConfirm={handleRecordPayment}
            onClose={() => { if (!paySubmitting) setPaying(null); }}
            isSubmitting={paySubmitting}
          />
        )}
      </>
    );
  }

  const header = c && (
    <div className="px-5 pt-[18px] pb-4 border-b border-border">
      <div className="flex items-center justify-between text-[12px] text-[#8A8A90] mb-3.5">
        <span>Customer</span>
        <div className="flex gap-1">
          <button type="button" onClick={onOpenProfile} aria-label="Open full profile" className="w-7 h-7 rounded-md grid place-items-center hover:bg-background"><Icon name="Maximize2" size={15} /></button>
          <button type="button" onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-md grid place-items-center hover:bg-background"><Icon name="X" size={16} /></button>
        </div>
      </div>
      <div className="flex gap-3.5 items-center">
        <div className="w-11 h-11 rounded-full bg-[#F1F1EF] text-[#4A4A4F] text-[15px] font-semibold grid place-items-center flex-shrink-0">{initials(c.fullName)}</div>
        <div className="min-w-0">
          <h3 id="customer-panel-title" className="text-[17px] font-semibold tracking-[-0.3px] flex items-center gap-2 leading-tight flex-wrap">
            <span className="truncate">{c.fullName}</span>
            {c.inSpa && <InSpaTag />}
            {c.vip && <span className="h-5 rounded-full px-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 bg-[#FBF3DF] text-[#9A6B0B]">★ VIP</span>}
          </h3>
          <p className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{[formatPhoneGrouped(c.phone), c.createdAt && `Customer since ${monthYear(c.createdAt)}`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        {!readOnly && (
          <button type="button" onClick={onNewBooking} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25)] hover:bg-primary/95">
            <Icon name="Plus" size={15} />New booking
          </button>
        )}
        {!readOnly && c.balance > 0 && (
          <button type="button" onClick={() => setView('collect')} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium hover:bg-[#FAFAF9]">Collect {npr(c.balance)}</button>
        )}
        <button type="button" onClick={onOpenProfile} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 ml-auto hover:bg-[#FAFAF9]">
          <Icon name="FileText" size={14} />Open profile
        </button>
      </div>
    </div>
  );

  const m = detail?.membership;
  const hasPrepaid = !!m || (detail?.packages?.length > 0) || (detail?.vouchers?.length > 0);
  const prefs = detail?.preferences;
  const hasPrefs = !!(prefs?.therapist || prefs?.service || prefs?.note);

  return (
    <>
      <SidePanel isOpen={!!customer} onClose={() => { if (!prepaid) onClose(); }} title="Customer" titleId="customer-panel-title" width="460px" header={header}>
        {c && (
          <div className="px-5 py-[18px] flex flex-col gap-[22px]">
            {notice && <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success"><Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></p>}
            {failed && <p role="alert" className="text-[13px] text-[#B45309]">Couldn't load this customer's bookings. <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="underline font-medium">Retry</button></p>}

            {detail?.now && (
              <section>
                <Label>Now</Label>
                <div className="border border-[#DCDDFB] bg-[#FBFBFF] rounded-lg px-3.5 py-3 flex items-center gap-3">
                  <DateBlock iso={detail.now.date} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium truncate">{detail.now.service} <span className="text-[#515152] font-normal">· in progress</span></p>
                    <p className="text-[12.5px] text-[#8A8A90] truncate">{[range(detail.now), detail.now.therapist, detail.now.room && `Room ${detail.now.room}`].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              </section>
            )}

            <section>
              <Label>Upcoming</Label>
              {!detail && !failed ? <SkeletonCard /> : detail?.upcoming ? (
                <div className="border border-border rounded-lg px-3.5 py-3 flex items-center gap-3">
                  <DateBlock iso={detail.upcoming.date} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium truncate">{detail.upcoming.service}</p>
                    <p className="text-[12.5px] text-[#8A8A90] truncate">{[relativeDayLabel(detail.upcoming.date, today), range(detail.upcoming), detail.upcoming.therapist].filter(Boolean).join(' · ')}</p>
                  </div>
                  <StatusPill status={detail.upcoming.status} />
                </div>
              ) : !failed && <p className="text-[13px] text-[#B4B4BA]">No upcoming booking</p>}
            </section>

            <div className="grid grid-cols-3 border border-border rounded-lg">
              <Stat label="Visits" value={c.completedVisits} />
              <Stat label="Balance" value={c.balance > 0 ? npr(c.balance) : '—'} amber={c.balance > 0} divider />
              <Stat label="Spent" value={npr(c.spent)} divider />
            </div>

            {hasPrepaid && (
              <section>
                <Label>Prepaid</Label>
                <div className="border border-border rounded-lg divide-y divide-[#F1F1EF] overflow-hidden">
                  {m && <PrepaidRow icon="CreditCard" title={`${m.tierName} membership`} sub={`${m.membershipNumber}${m.expiryDate ? ` · valid until ${new Date(`${m.expiryDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ' · pending activation'}`} value={npr(m.balance)} valueSub="wallet" onClick={() => setPrepaid({ kind: 'membership', id: m.id })} />}
                  {(detail.packages || []).map((p) => <PrepaidRow key={p.id} icon="Layers" title={p.packageTypeName} sub={p.expiryDate ? `expires ${new Date(p.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'no expiry'} value={`${p.sessionsRemaining} of ${p.sessionsTotal}`} valueSub="left" onClick={() => setPrepaid({ kind: 'package', id: p.id })} />)}
                  {(detail.vouchers || []).map((v) => <PrepaidRow key={v.id} icon="Ticket" title={v.voucherTypeName} sub={`${v.voucherCode}${v.expiryDate ? ` · expires ${new Date(v.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`} value={npr(v.remainingBalance)} valueSub="remaining" onClick={() => setPrepaid({ kind: 'voucher', id: v.id })} />)}
                </div>
              </section>
            )}

            {hasPrefs && (
              <section>
                <Label>Preferences</Label>
                <div className="flex flex-col gap-2 text-[13px] text-[#2b2b2c]">
                  {(prefs.therapist || prefs.service) && (
                    <div className="flex gap-2 items-start"><Icon name="Heart" size={14} className="text-[#8A8A90] mt-0.5 flex-shrink-0" /><span>{[prefs.therapist && `Usually books ${prefs.therapist}`, prefs.service && `favourite ${prefs.service}`].filter(Boolean).join(' · ').replace(/^./, (x) => x.toUpperCase())}</span></div>
                  )}
                  {prefs.note && <div className="flex gap-2 items-start"><Icon name="MessageSquare" size={14} className="text-[#8A8A90] mt-0.5 flex-shrink-0" /><span>“{prefs.note.text}” <span className="text-[#8A8A90]">· booking note, {shortDate(prefs.note.date)}</span></span></div>}
                </div>
              </section>
            )}

            <section>
              <Label action={<button type="button" onClick={onOpenProfile} className="normal-case tracking-normal text-[#515152] font-medium hover:text-text-primary">View all</button>}>Recent visits</Label>
              {!detail && !failed ? <div className="space-y-2"><SkeletonCard /><SkeletonCard /></div> : detail?.recent.length ? (
                <div className="flex flex-col">
                  {detail.recent.map((v) => (
                    <div key={v.id} className="flex justify-between items-center py-[9px] border-b border-[#F1F1EF] last:border-0 text-[13px] gap-3">
                      <span className="min-w-0 truncate"><span className="font-medium">{v.service}</span>{v.therapist && <span className="text-[#8A8A90]"> · {v.therapist}</span>}</span>
                      <span className="text-[#8A8A90] flex-shrink-0">{relativeDayLabel(v.date, today)}</span>
                    </div>
                  ))}
                </div>
              ) : !failed && <p className="text-[13px] text-[#B4B4BA]">No visits yet</p>}
            </section>

            <section>
              <Label>Contact</Label>
              <dl className="grid grid-cols-[90px_1fr] gap-y-2 text-[13px]">
                <dt className="text-[#8A8A90]">Phone</dt><dd className="break-all">{formatPhoneGrouped(c.phone) || '—'}</dd>
                <dt className="text-[#8A8A90]">Email</dt><dd className="break-all">{c.email || '—'}</dd>
                <dt className="text-[#8A8A90]">Gender</dt><dd>{c.gender || '—'}</dd>
              </dl>
            </section>
          </div>
        )}
      </SidePanel>

      {prepaid?.kind === 'membership' && <MembershipDetailPanel membershipId={prepaid.id} isAdmin={isAdmin} readOnly={readOnly} branchId={branchId} onClose={() => setPrepaid(null)} onChanged={refresh} />}
      {prepaid?.kind === 'package' && <PackageDetailPanel packageId={prepaid.id} readOnly={readOnly} onClose={() => setPrepaid(null)} onChanged={refresh} />}
      {prepaid?.kind === 'voucher' && <VoucherDetailPanel voucherId={prepaid.id} readOnly={readOnly} onClose={() => setPrepaid(null)} onChanged={refresh} />}
    </>
  );
};

export default CustomerPanel;
