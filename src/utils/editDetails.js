// True when the Edit details form differs from the booking it was opened on (ZNLY-324): drives the unsaved-changes confirm.
export function editFormChanged(form, booking) {
  if (!form || !booking) return false;
  const time = booking.startTime ? booking.startTime.slice(0, 5) : booking.time || '';
  return (form.customerName || '') !== (booking.customerName || '')
    || (form.serviceId || '') !== (booking.serviceId || '')
    || (form.date || '') !== (booking.date || '')
    || (form.startTime || '') !== time
    || (form.specialRequests || '') !== (booking.specialRequests || '')
    || (form.referredBy || '') !== (booking.referredBy || '')
    || form.phoneDial !== form.phoneDialInitial
    || form.phoneNational !== form.phoneNationalInitial;
}
