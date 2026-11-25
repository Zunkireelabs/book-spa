import React from 'react';
import { paymentStatusLabel } from '../../../utils/paymentStatusLabel';
import { shortDate } from '../../../utils/customerDirectory';
import { formatClockNow } from '../../../utils/clockTime';

export const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayDate = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${DOW[d.getDay()]} ${shortDate(iso)}`; };
export const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// One 12-hour clock for the whole page: the same formatter the booking form's time field uses ("5:50pm").
export const clock = formatClockNow;

export const STATUS_TONE = { Completed: 'bg-success/10 text-success', Confirmed: 'bg-primary/10 text-primary', Pending: 'bg-warning/10 text-warning', 'In-Progress': 'bg-primary/10 text-primary', Cancelled: 'bg-error/10 text-error', 'No Show': 'bg-background text-text-secondary' };
const TONE = { success: 'text-success', warning: 'text-warning', neutral: 'text-text-secondary' };

// A booking row: date, service · staff, status, money. Opens the right-hand booking panel (never navigates away).
export const VisitRow = ({ date, time, service, staff, status, money, moneySub, onOpen }) => (
  <button type="button" onClick={onOpen} className="w-full text-left grid grid-cols-[72px_minmax(0,1fr)_auto] sm:grid-cols-[86px_minmax(0,1fr)_110px_140px] gap-3 items-center px-4 py-3 border-b border-border last:border-b-0 text-[13px] text-text-secondary hover:bg-background">
    <span className="tabular-nums text-text-primary font-semibold">{date}{time && <><br /><span className="font-normal text-text-secondary">{time}</span></>}</span>
    <span className="min-w-0 truncate"><b className="font-medium text-text-primary">{service}</b>{staff ? ` · ${staff}` : ''}</span>
    <span className={`hidden sm:inline-flex h-[22px] px-2.5 rounded-full text-xs items-center w-fit ${STATUS_TONE[status] || 'bg-background text-text-secondary'}`}>{status}</span>
    <span className="text-right tabular-nums">{money}{moneySub && <span className="block text-xs text-text-secondary">{moneySub}</span>}</span>
  </button>
);

// Money words for a booking's right-hand column: what is still due, else the shared payment label (ZNLY-227).
export const visitMoney = (h, owedById) => {
  const owed = owedById?.[h.bookingId];
  if (owed) return { text: `${npr(owed.amountDue)} due`, cls: 'text-warning font-medium' };
  const p = paymentStatusLabel(h);
  return { text: p.label, cls: TONE[p.tone] };
};

export const Card = ({ title, link, onLink, children }) => (
  <div className="bg-surface border border-border rounded-spa-lg min-w-0">
    <div className="flex items-center justify-between px-4 py-3.5 border-b border-border"><b className="text-sm font-semibold">{title}</b>{link && <button type="button" onClick={onLink} className="text-[12.5px] font-medium text-primary hover:underline">{link}</button>}</div>
    {children}
  </div>
);

