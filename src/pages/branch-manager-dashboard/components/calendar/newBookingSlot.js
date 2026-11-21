import { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import { addDays } from './calendarDates';

// The slot-less opener for the New booking panel (Bookings page button, ?view=new-booking). ZNLY-301.

const toMin = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// The next quarter-hour from now, kept inside branch hours. Returns { hour, minute, nextDay }:
//   before opening -> opening, today; within hours -> next quarter today; after the last start slot (close - 15) -> opening, TOMORROW.
export const nextQuarterSlot = ({ nowHM, openTime = '09:00', closeTime = '21:00' }) => {
  const open = toMin(openTime);
  const close = toMin(closeTime);
  const t = Math.ceil(toMin(nowHM) / 15) * 15;
  if (t > close - 15) return { hour: Math.floor(open / 60), minute: open % 60, nextDay: true };
  const at = t < open ? open : t;
  return { hour: Math.floor(at / 60), minute: at % 60, nextDay: false };
};

// location.state.prefill (Customers / Memberships / Packages / customer-detail "Book") -> the panel's default* slot fields.
export const prefillToDefaults = (prefill) => {
  if (!prefill) return {};
  const { dial, national } = parsePhone(prefill.phone);
  return {
    defaultServiceId: prefill.serviceId || undefined,
    defaultCustomerName: prefill.fullName || undefined,
    defaultCustomerPhone: national || undefined,
    defaultCustomerCountryCode: national ? dial : undefined,
    defaultCustomerEmail: prefill.email || undefined,
    defaultCustomerGender: prefill.gender || undefined,
    defaultCustomerExisting: !!(prefill.fullName || prefill.phone),
  };
};

export const newBookingSlot = ({ today, nowHM, branchHours, prefill }) => {
  const { nextDay, ...time } = nextQuarterSlot({ nowHM, openTime: branchHours?.openTime?.slice(0, 5), closeTime: branchHours?.closeTime?.slice(0, 5) });
  // Closed days are not skipped here: the panel's own checks explain it and the date can be changed.
  return {
    day: nextDay ? addDays(today, 1) : today,
    colType: null,
    colId: null,
    colName: 'Unassigned',
    ...time,
    ...prefillToDefaults(prefill),
  };
};
