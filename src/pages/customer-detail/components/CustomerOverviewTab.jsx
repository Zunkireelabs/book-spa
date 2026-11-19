import React, { useState, useEffect } from 'react';
import { fetchCustomerPhotos, fetchCustomerDocuments } from '../../../services/api';
import { Card, VisitRow, visitMoney, npr, dayDate, longDate, clock } from './CustomerVisitRow';
import { shortDate } from '../../../utils/customerDirectory';
import { useIndustry } from '../../../hooks/useIndustry';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED } from '../../../lib/featureFlags';

const CustomerOverviewTab = ({ data, detail, onOpenBooking, onNavigateTab, onEdit, onNewBooking, readOnly }) => {
  const { staffLabel } = useIndustry();
  const c = data.customer;
  const staffWord = String(staffLabel || 'therapist').toLowerCase();
  const [files, setFiles] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchCustomerPhotos(c.id), fetchCustomerDocuments(c.id)]).then(([p, d]) => { if (alive) setFiles({ photos: (p.data || []).length, docs: (d.data || []).length }); });
    return () => { alive = false; };
  }, [c.id]);

  const owedById = Object.fromEntries((detail?.owed || []).map((o) => [o.bookingId, o]));
  const rendered = data.history.filter((h) => ['Completed', 'In-Progress'].includes(h.status) && h.date <= (detail?.today || '9999'));
  const recent = rendered.slice(0, 3);
  const next = detail?.upcoming ? { ...detail.upcoming, h: data.history.find((h) => h.bookingId === detail.upcoming.id) } : null;
  const m = detail?.membership; const pk = detail?.packages || []; const vc = detail?.vouchers || [];
  const hasPlans = (MEMBERSHIP_ENABLED && m) || pk.length > 0 || (VOUCHER_ENABLED && vc.length > 0);
  const about = [
    c.gender && ['Gender', c.gender],
    c.dateOfBirth && ['Birthday', new Date(`${String(c.dateOfBirth).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })],
    c.clientSource && ['Came from', c.clientSource],
    c.referredBy && ['Referred by', c.referredBy],
    c.preferredLanguage && ['Language', c.preferredLanguage],
    data.stats.usualTherapist && [`Usual ${staffWord}`, `${data.stats.usualTherapist} (${data.stats.usualTherapistVisits} of ${data.stats.completedVisits} visits)`],
    data.stats.favouriteService && ['Favourite service', data.stats.favouriteService],
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
      <div className="flex flex-col gap-4 min-w-0">
        {c.notes && <div className="rounded-spa-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] leading-relaxed text-text-primary"><b className="font-semibold">Note:</b> {c.notes}</div>}

        {data.history.length === 0 ? (
          <div className="bg-surface border border-border rounded-spa-lg px-4 py-10 text-center">
            <p className="text-sm font-medium text-text-primary">No visits yet</p>
            <p className="text-[13px] text-text-secondary mt-1">Book {c.fullName.split(' ')[0]}'s first appointment to start their history.</p>
            {!readOnly && <button type="button" onClick={onNewBooking} className="mt-4 h-9 px-3.5 rounded-md bg-primary text-white text-[13px] font-medium hover:bg-primary/95">New booking</button>}
          </div>
        ) : (<>
        <Card title="Next visit" link="All visits →" onLink={() => onNavigateTab('visits')}>
          {next ? (() => { const left = next.h ? Math.max(next.h.finalAmount - (next.h.paidTotal || 0), 0) : 0; const dep = next.h ? Math.min(next.h.paidTotal || 0, next.h.finalAmount) : 0;
            return <VisitRow date={dayDate(next.date)} time={clock(next.start)} service={next.service} staff={next.therapist} status={next.status} money={npr(next.h?.finalAmount ?? left)} moneySub={dep > 0 ? `${npr(dep)} deposit` : ''} onOpen={() => onOpenBooking(next.id)} />; })()
            : <p className="px-4 py-4 text-[13px] text-text-secondary">No upcoming booking</p>}
        </Card>

        <Card title="Recent visits" link="All visits →" onLink={() => onNavigateTab('visits')}>
          {recent.length === 0 ? <p className="px-4 py-4 text-[13px] text-text-secondary">No visits yet</p> : recent.map((h) => {
            const mo = visitMoney(h, owedById);
            return <VisitRow key={h.bookingId} date={shortDate(h.date)} service={h.serviceName} staff={h.therapistName} status={h.status} money={<span className={mo.cls}>{mo.text}</span>} onOpen={() => onOpenBooking(h.bookingId)} />;
          })}
        </Card>
        </>)}
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <Card title="About" link="Edit" onLink={onEdit}>
          <div className="px-4 pt-1 pb-2">
            {about.length === 0 ? <p className="py-3 text-[13px] text-text-secondary">Nothing added yet.</p> : about.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2.5 py-2 border-b border-border last:border-b-0 text-[13px]"><span className="text-text-secondary">{k}</span><span>{v}</span></div>
            ))}
          </div>
        </Card>

        {(
          <Card title="Plans" link="Open Plans →" onLink={() => onNavigateTab('plans')}>
            <div className="px-4 py-3 flex flex-col gap-2.5 text-[13px]">
              {!hasPlans && <p className="text-text-secondary">No memberships, packages or vouchers.</p>}
              {MEMBERSHIP_ENABLED && m && <div className="flex justify-between gap-3"><span><b className="font-medium">{m.tierName} membership</b> · {m.status}{m.expiryDate ? ` · until ${longDate(m.expiryDate)}` : ''}</span><span className="tabular-nums whitespace-nowrap">{npr(m.balance)} left</span></div>}
              {pk.map((p) => <div key={p.id} className="flex justify-between gap-3"><span><b className="font-medium">{p.packageTypeName}</b>{p.expiryDate ? ` · until ${longDate(p.expiryDate)}` : ''}</span><span className="tabular-nums whitespace-nowrap">{p.sessionsRemaining} of {p.sessionsTotal} left</span></div>)}
              {VOUCHER_ENABLED && vc.map((v) => <div key={v.id} className="flex justify-between gap-3"><span><b className="font-medium">{v.voucherTypeName}</b>{v.expiryDate ? ` · until ${longDate(v.expiryDate)}` : ''}</span><span className="tabular-nums whitespace-nowrap">{npr(v.remainingBalance)} left</span></div>)}
            </div>
          </Card>
        )}

        <button type="button" onClick={() => onNavigateTab('files')} className="bg-surface border border-border rounded-spa-lg px-4 py-3 flex justify-between items-center text-[13px] hover:bg-background text-left">
          <span>Files</span>
          <span className="text-text-secondary">{files ? `${files.photos} photo${files.photos === 1 ? '' : 's'} · ${files.docs} document${files.docs === 1 ? '' : 's'}` : '…'}</span>
        </button>
      </div>
    </div>
  );
};

export default CustomerOverviewTab;
