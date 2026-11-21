import { parsePhone } from '../components/ui/CountryCodeSelect';

// A walk-in with no client profile: its "name" is the optional label and it has no phone (ZNLY-330).
export const isClientlessWalkIn = (booking) => !!booking?.isWalkIn && !booking?.customerId;

// The one place Edit details values are seeded from a booking; editFormChanged compares against this same seed (ZNLY-324/326).
export function editFormSeed(booking) {
  const { dial, national } = parsePhone(booking?.customerPhone || '');
  const walkIn = isClientlessWalkIn(booking);
  return {
    customerName: walkIn ? (booking?.walkInLabel || '') : (booking?.customerName || ''),
    customerPhone: booking?.customerPhone || '',
    phoneDial: dial,
    phoneNational: national,
    serviceId: booking?.serviceId || '',
    date: booking?.date || '',
    startTime: booking?.startTime ? booking.startTime.slice(0, 5) : booking?.time || '',
    specialRequests: booking?.specialRequests || '',
    referredBy: booking?.referredBy || '',
  };
}

// True when the Edit details form differs from what startEditing seeded for this booking: drives the unsaved-changes confirm.
export function editFormChanged(form, booking) {
  if (!form || !booking) return false;
  const seed = editFormSeed(booking);
  return changedKeys(form, seed, booking).length > 0;
}

const changedKeys = (form, seed, booking) => {
  const keys = ['customerName', 'serviceId', 'date', 'startTime', 'specialRequests', 'referredBy'];
  if (!isClientlessWalkIn(booking)) keys.push('phoneDial', 'phoneNational');
  return keys.filter((k) => (form[k] || '') !== (seed[k] || ''));
};

/**
 * The save payload for Edit details: ONLY fields the user changed, so an untouched name/phone/notes is never re-sent, re-cased or
 * re-resolved (ZNLY-330). A client-less walk-in edits its label (walkInLabel), never a customer name or phone.
 * phoneValue = the stored-format phone for the form (phoneFieldValue), only read when the phone changed.
 */
export function editChanges(form, booking, phoneValue) {
  const seed = editFormSeed(booking);
  const changed = new Set(changedKeys(form, seed, booking));
  const out = {};
  if (changed.has('customerName')) {
    if (isClientlessWalkIn(booking)) out.walkInLabel = String(form.customerName || '').trim();
    else out.customerName = String(form.customerName || '').trim();
  }
  if (changed.has('phoneDial') || changed.has('phoneNational')) out.customerPhone = phoneValue;
  if (changed.has('serviceId')) out.serviceId = form.serviceId || undefined;
  if (changed.has('date')) out.date = form.date || undefined;
  if (changed.has('startTime')) out.startTime = form.startTime ? `${form.startTime}:00` : undefined;
  if (changed.has('specialRequests')) out.specialRequests = String(form.specialRequests || '').trim() || null;
  if (changed.has('referredBy')) out.referredBy = String(form.referredBy || '').trim() || null;
  return out;
}

// True when the add-service / rebook form differs from the values openNewBookingForm seeded it with (ZNLY-326).
export function newBookingFormChanged(form, mode, booking, today) {
  if (!form || !mode || !booking) return false;
  const initial = {
    serviceId: mode === 'rebook' ? (booking.serviceId || '') : '',
    date: mode === 'rebook' ? '' : (booking.date || today || ''),
    startTime: '', therapistId: '', roomId: '',
  };
  return Object.keys(initial).some((k) => (form[k] || '') !== initial[k]);
}
