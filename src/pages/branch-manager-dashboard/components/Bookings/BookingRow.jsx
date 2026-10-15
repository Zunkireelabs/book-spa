import React from 'react';
import Icon from '../../../../components/AppIcon';
import { getBookingStatusColors } from '../../../../utils/bookingStatusColors';
import { isNoShow, toDbStatus, to12h } from '../../../../services/bookingTransformers';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { initials } from '../../../../utils/customerDirectory';
import { formatLate, groupInfo } from '../../../../utils/bookingsList';

export const COLUMN_DEFS = [
  { id: 'service', label: 'Service' },
  { id: 'therapist', label: 'Therapist' },
  { id: 'amount', label: 'Amount' },
];

const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', 'in-progress': 'In progress', completed: 'Completed', cancelled: 'Cancelled', 'no show': 'No show' };
const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const minutesOf = (b) => {
  const m = String(b.duration || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

export const StatusPill = ({ b }) => {
  const noShow = isNoShow(b);
  const key = noShow ? 'No Show' : toDbStatus(b.status);
  const c = getBookingStatusColors(key);
  return (
    <span className="h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap" style={{ background: c.fill, color: c.text }}>
      <i className="w-1.5 h-1.5 rounded-full" style={{ background: c.bar }} />{noShow ? 'No show' : STATUS_LABEL[b.status] || b.status}
    </span>
  );
};

const AmountCell = ({ a }) => {
  if (a.tone === 'paid') return <span className="text-[12.5px] font-medium text-[#15803D]">Paid</span>;
  if (a.tone === 'due') return <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tabular-nums"><i className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />{npr(a.amount)}</span>;
  if (a.tone === 'deposit') return <span className="text-[12.5px] tabular-nums text-[#515152]">{npr(a.amount)} deposit</span>;
  if (a.tone === 'price') return <span className="text-[12.5px] tabular-nums text-[#8A8A90]">{npr(a.amount)}</span>;
  return <span className="text-[#B4B4BA]">—</span>;
};

const BookingRow = ({ b, all, columns, unread, selected, dim, late, amount, action, busy, suggestion, onSuggest, onOpen, onAction, scrollMargin }) => {
  const color = getBookingStatusColors(isNoShow(b) ? 'No Show' : toDbStatus(b.status)).bar;
  const edge = unread ? '#2D5A27' : color;
  const people = b.therapists || [];
  const grp = groupInfo(b, all);
  const mins = minutesOf(b);
  const isOnline = b.createdBy == null;
  const bg = selected ? 'bg-[#F2F6F0]' : unread ? 'bg-[#F7FAF6] hover:bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9]';
  const cell = 'h-14 border-b border-[#F1F1EF]';
  return (
    <tr data-booking-id={b.bookingId} data-unread={unread || undefined} data-dim={dim || undefined} tabIndex={0} aria-selected={selected || undefined}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      style={{ scrollMarginTop: scrollMargin }} className={`group cursor-pointer ${bg}`}>
      <td className={`${cell} pl-2 pr-2 ${dim ? 'opacity-[.55]' : ''}`} style={{ boxShadow: `inset 3px 0 0 0 ${edge}` }}>
        <div className="pl-2 text-[13px] font-medium tabular-nums whitespace-nowrap">{b.time ? to12h(b.time) : '—'}</div>
        {mins != null && <div className="pl-2 text-[12px] text-[#8A8A90] tabular-nums">{mins} min</div>}
      </td>
      <td className={`${cell} pr-3 ${dim ? 'opacity-[.55]' : ''}`}>
        <div className={`text-[13.5px] tracking-[-0.1px] flex items-center gap-1.5 text-text-primary ${unread ? 'font-semibold' : 'font-medium'}`}>
          {unread && <i className="w-2 h-2 rounded-full bg-[#22A04B] flex-shrink-0" aria-label="New" />}
          <span className="truncate">{b.customerName}</span>
          {b.specialRequests && <span title={b.specialRequests} aria-label={`Note: ${b.specialRequests}`} className="text-[#8A8A90] flex-shrink-0"><Icon name="MessageSquare" size={13} /></span>}
          {isOnline && <span className="h-5 rounded-full px-[7px] text-[11.5px] font-medium inline-flex items-center bg-[#EEF0FF] text-[#4F46E5] flex-shrink-0">Online</span>}
        </div>
        <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{formatPhoneGrouped(b.customerPhone)}</div>
        <div className="md:hidden text-[12.5px] text-[#515152] truncate">{b.service}</div>
        <div className="sm:hidden mt-0.5 flex items-center gap-2"><StatusPill b={b} />{late != null && <span className="text-[11.5px] font-medium text-[#B45309]">Late · {formatLate(late)}</span>}</div>
      </td>
      {columns.service && (
        <td className={`${cell} pr-3 hidden md:table-cell ${dim ? 'opacity-[.55]' : ''}`}>
          <div className="text-[13px] truncate">{b.service}</div>
          <div className="text-[12.5px] text-[#8A8A90] truncate">{[b.roomName, grp > 1 && `Group of ${grp}`].filter(Boolean).join(' · ') || ' '}</div>
        </td>
      )}
      {columns.therapist && (
        <td className={`${cell} pr-3 hidden lg:table-cell ${dim ? 'opacity-[.55]' : ''}`}>
          {people.length === 0 ? (
            <>
              <div className="text-[13px] font-medium text-[#B45309]">Unassigned</div>
              {suggestion && (
                <button type="button" title={suggestion.label} aria-label={`Assign ${suggestion.therapist.name}: ${suggestion.label}`} data-suggest={suggestion.therapist.id}
                  onClick={(e) => { e.stopPropagation(); onSuggest(suggestion.therapist.id); }}
                  className="text-[12px] text-[#8A8A90] mt-0.5 hover:text-text-primary text-left max-w-full truncate block">
                  <span aria-hidden="true" className="text-primary">✦ </span>Suggest <b className="text-primary font-medium">{suggestion.therapist.name}</b> · free
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded-full bg-[#F1F1EF] text-[#4A4A4F] text-[10px] font-semibold grid place-items-center flex-shrink-0">{initials(people[0].name)}</span>
              <span className="text-[13px] truncate" title={people.map((t) => t.name).join(' + ')}>{people.map((t) => t.name).join(' + ')}</span>
            </div>
          )}
        </td>
      )}
      <td className={`${cell} pr-3 hidden sm:table-cell ${dim ? 'opacity-[.55]' : ''}`}>
        <StatusPill b={b} />
        {late != null && <div className="text-[11.5px] font-medium text-[#B45309] mt-0.5">Late · {formatLate(late)}</div>}
      </td>
      {columns.amount && <td className={`${cell} pr-4 text-right whitespace-nowrap hidden sm:table-cell ${dim ? 'opacity-[.55]' : ''}`}><AmountCell a={amount} /></td>}
      <td className={`${cell} w-[88px] pl-1 pr-1`}>
        <div className="flex gap-1.5 justify-end items-center text-[#8A8A90]">
          {action && (
            <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onAction(action); }}
              className="h-[26px] px-[9px] border border-[#CFDCCC] rounded-md bg-white text-[12px] font-medium text-primary hover:bg-[#F2F6F0] disabled:opacity-50">{busy ? '…' : action.label}</button>
          )}
          <Icon name="ChevronRight" size={15} />
        </div>
      </td>
    </tr>
  );
};

export default BookingRow;
