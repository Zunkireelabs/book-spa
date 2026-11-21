import { parsePhone } from '../components/ui/CountryCodeSelect';

// The one place Edit details values are seeded from a booking; editFormChanged compares against this same seed (ZNLY-324/326).
export function editFormSeed(booking) {
  const { dial, national } = parsePhone(booking?.customerPhone || '');
  return {
    customerName: booking?.customerName || '',
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
  return ['customerName', 'serviceId', 'date', 'startTime', 'specialRequests', 'referredBy', 'phoneDial', 'phoneNational']
    .some((k) => (form[k] || '') !== (seed[k] || ''));
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
