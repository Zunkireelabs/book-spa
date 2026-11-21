import React, { useState } from 'react';
import { Card, VisitRow, visitMoney, npr, clock } from './CustomerVisitRow';
import { shortDate } from '../../../utils/customerDirectory';

const UPCOMING_STATUS = ['Pending', 'Confirmed'];
const void_ = ['Cancelled', 'No Show'];

// One list for every booking (was Visit History + Appointments). "Upcoming N · Past N bookings" is a toggle, not a tab count,
// so the word "visits" only ever means the header's visits that actually happened.
const CustomerVisitsTab = ({ data, detail, onOpenBooking }) => {
  const today = detail?.today || '';
  const upcoming = data.history.filter((h) => UPCOMING_STATUS.includes(h.status) && h.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = data.history.filter((h) => !upcoming.includes(h));
  const [which, setWhich] = useState(upcoming.length > 0 ? 'upcoming' : 'past');
  const owedById = Object.fromEntries((detail?.owed || []).map((o) => [o.bookingId, o]));
  const rows = which === 'upcoming' ? upcoming : past;
  const pill = (key, label) => (
    <button type="button" onClick={() => setWhich(key)} className={`h-8 px-3 rounded-full text-[13px] border ${which === key ? 'bg-primary/10 border-primary/30 text-primary font-medium' : 'bg-surface border-border text-text-secondary hover:bg-background'}`}>{label}</button>
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">{pill('upcoming', `Upcoming ${upcoming.length}`)}{pill('past', `Past ${past.length} booking${past.length === 1 ? '' : 's'}`)}</div>
      <Card title={which === 'upcoming' ? 'Upcoming' : 'Past bookings'}>
        {rows.length === 0 ? <p className="px-4 py-4 text-[13px] text-text-secondary">{which === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}</p> : rows.map((h) => {
          const mo = void_.includes(h.status) && !h.refundTotal ? { text: 'Nothing owed', cls: 'text-text-secondary' } : visitMoney(h, owedById);
          const dep = which === 'upcoming' ? Math.min(h.paidTotal || 0, h.finalAmount) : 0;
          return (
            <VisitRow key={h.bookingId} date={shortDate(h.date)} time={h.startTime ? clock(String(h.startTime).slice(0, 5)) : ''} service={h.serviceName} staff={h.therapistName} status={h.status}
              money={npr(h.finalAmount)} moneySub={dep > 0 ? `${npr(dep)} deposit` : <span className={mo.cls}>{mo.text}</span>} onOpen={() => onOpenBooking(h.bookingId)} />
          );
        })}
      </Card>
    </div>
  );
};

export default CustomerVisitsTab;
