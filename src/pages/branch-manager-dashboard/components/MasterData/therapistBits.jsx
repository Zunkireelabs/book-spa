import React from 'react';
import { todayLabels } from '../../../../utils/staffDay';
import { STATUS_DOT_COLOR } from '../../../../utils/todayStatusLine';

// Small shared bits of the Therapists list + peek (V28).

const TONE = {
  'checked-in': { dot: '#2D5A27', text: 'text-text-primary', pill: 'bg-[#E7F1E4] text-primary' },
  'not-checked-in': { dot: '#F59E0B', text: 'text-[#B45309]', pill: 'bg-[#FEF3C7] text-[#92400E]' },
  upcoming: { dot: '#C9CBC7', text: 'text-text-primary', pill: 'bg-[#F1F1EF] text-[#515152]' },
  leave: { dot: '#C9CBC7', text: 'text-text-primary', pill: 'bg-[#F1F1EF] text-[#515152]' },
  off: { dot: '#C9CBC7', text: 'text-text-primary', pill: 'bg-[#F1F1EF] text-[#515152]' },
  'no-roster': { dot: '#C9CBC7', text: 'text-[#8A8A90]', pill: 'bg-[#F1F1EF] text-[#8A8A90]' },
  'no-hours-open': { dot: '#C9CBC7', text: 'text-[#8A8A90]', pill: 'bg-[#F1F1EF] text-[#8A8A90]' },
};

export { todayLabels };

export const TodayCell = ({ t, pill = false, rosterReadable = true }) => {
  // Support staff are not rostered for bookings, so "no shift set" is noise for them; a role that cannot read rosters sees "—", not a false "no shift".
  if (!pill && (t.status.key === 'no-roster' || t.status.key === 'no-hours-open') && (!t.isServiceStaff || (t.status.key === 'no-roster' && !rosterReadable))) return <span className="text-[13px] text-[#8A8A90]">—</span>;
  const base = TONE[t.status.key] || TONE['no-roster'];
  const tone = t.statusLine ? { ...base, dot: STATUS_DOT_COLOR[t.statusLine.dot] } : base;
  const { title, sub } = todayLabels(t);
  if (pill) {
    return (
      <span className={`h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${tone.pill}`} data-today-key={t.status.key}>
        <i className="w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />{title}
      </span>
    );
  }
  return (
    <div className="min-w-0" data-today-key={t.status.key}>
      <div className={`text-[13px] font-medium flex items-center gap-1.5 truncate ${tone.text}`}><i className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: tone.dot }} />{title}</div>
      {sub && <div className="text-[12px] text-[#8A8A90] mt-0.5 truncate">{sub}</div>}
    </div>
  );
};

const DOT = { done: '#2D5A27', now: '#2D5A27', todo: '#CFDCCC' };
const MAX_DOTS = 8;

/** "5 booked · next 12:30" over a row of dots (dark = done / happening now, light = still to come). */
export const BookingsCell = ({ t }) => {
  const b = t.bookings;
  if (b.count === 0) return <span className="text-[13px] text-[#8A8A90]">—</span>;
  const dots = b.dots.slice(0, MAX_DOTS);
  return (
    <div className="min-w-0" data-bookings-count={b.count}>
      <div className="text-[13px] truncate"><b className="font-semibold">{b.count} booked</b>{b.firstOrNext && <span className="text-[#8A8A90]"> · {b.firstOrNext.kind} {b.firstOrNext.time}</span>}</div>
      <div className="flex gap-[3px] mt-1.5" aria-hidden="true">
        {dots.map((d, i) => <i key={i} className="h-1 w-[14px] rounded-full" style={{ background: DOT[d] }} />)}
        {b.dots.length > MAX_DOTS && <span className="text-[10px] text-[#8A8A90] leading-none -mt-0.5">+{b.dots.length - MAX_DOTS}</span>}
      </div>
    </div>
  );
};
