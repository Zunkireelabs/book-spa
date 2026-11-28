// ZNLY-402 piece 5 (screen A): the pencil opens the SAME form as New booking, prefilled with the WHOLE booking. buildEditSlot() returns the slotInfo
// the panel reads (`edit` = the live services as form rows). Pure, so it is table-tested.
import { lockedClientOf } from './addServiceSlot';
import { formatPhoneGrouped } from '../../../../utils/phone';

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Why a service cannot be changed any more ('' = it can). Started, done and paid services are read-only in the form. */
export function lockReason(row) {
  const s = String(row.status || '').toLowerCase();
  if (s === 'in-progress') return 'Started – can\'t change';
  if (s === 'completed') return 'Done – can\'t change';
  if (row.paymentStatus === 'paid' || (row.paid > 0 && row.paid >= row.final && row.final > 0)) return 'Paid – can\'t change';
  return '';
}

/** One form row from a "This booking" block row (utils/bookingBlock toBlockRow). */
export const formRowFromBlock = (r) => ({
  bookingId: r.id, serviceId: r.serviceId || '', therapistId: r.staffIds?.[0] || '', roomId: r.roomId || '',
  start: hhmm(r.start), minutes: r.minutes || 0, name: r.name, locked: lockReason(r),
});

/** One form row from the open booking itself (an OFF org, or a booking with no visit). */
export const formRowFromBooking = (b) => ({
  bookingId: b.bookingId, serviceId: b.serviceId || '', therapistId: b.therapists?.[0]?.id || '', roomId: b.roomId || '',
  start: hhmm(b.startTime || b.time), minutes: toMin(b.endTime) != null && toMin(b.startTime || b.time) != null ? toMin(b.endTime) - toMin(b.startTime || b.time) : 0, name: b.service || '',
  locked: lockReason({ status: b.status, paymentStatus: b.paymentStatus, paid: b.amountPaid, final: b.finalAmount }),
});

export function buildEditSlot({ booking, blockRows = null, referredBy = '' }) {
  const live = (blockRows && blockRows.length ? blockRows.filter((r) => !r.dead).map(formRowFromBlock) : [formRowFromBooking(booking)])
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const first = live[0];
  const lc = lockedClientOf(booking);
  const hm = /^(\d{1,2}):(\d{2})/.exec(first?.start || '');
  return {
    day: booking.date,
    returnToBooking: booking,   // ZNLY-436: Back returns to this booking
    title: `Edit booking · ${booking.customerName || ''}`.trim(),
    hour: hm ? Number(hm[1]) : 9,
    minute: hm ? Number(hm[2]) : 0,
    lockedClient: lc ? { ...lc, phone: booking.customerPhone ? formatPhoneGrouped(booking.customerPhone) : '', bookingNumber: '' } : { kind: 'existing', customerId: null, name: booking.customerName || '', phone: booking.customerPhone ? formatPhoneGrouped(booking.customerPhone) : '' },
    defaultCustomerId: booking.customerId || null,
    defaultCustomerName: lc?.kind === 'existing' ? (lc.name || booking.customerName || '') : (booking.customerName || ''),
    ...(() => { const m = /^(\+\d{1,3})(\d+)$/.exec(booking.customerPhone || ''); return lc ? {} : { defaultCustomerPhone: m ? m[2] : (booking.customerPhone || ''), defaultCustomerCountryCode: m ? m[1] : '+977' }; })(),
    edit: {
      visitKey: booking.visitId || booking.bookingId,
      rows: live,
      specialRequests: booking.specialRequests || '',
      referredBy: referredBy || booking.referredBy || '',
      ownIds: live.map((r) => r.bookingId),
    },
  };
}

/** The p_changes of visit_update: every live row in order; removed rows are listed with remove:true; a row with no bookingId is a NEW service. */
export function buildEditChanges({ date, specialRequests, rows, removed = [] }) {
  return {
    date,
    special_requests: specialRequests || null,
    services: [
      ...rows.map((r) => ({
        booking_id: r.bookingId || null, service_id: r.serviceId, therapist_ids: r.therapistId ? [r.therapistId] : [],
        room_id: r.roomId || null, start_time: r.start, remove: false,
      })),
      ...removed.map((id) => ({ booking_id: id, remove: true, remove_reason: 'Removed in Edit booking' })),
    ],
  };
}
