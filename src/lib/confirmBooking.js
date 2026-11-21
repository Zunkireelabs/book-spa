// Staff "Confirm" on a Pending booking (dashboard home). Never silent: a refusal is said in plain words and the booking stays Pending.
// `update` is updateBookingStatus (its error is already plain text, ZNLY-266); `notify(message, 'error')` shows the toast.
export async function confirmPendingBooking(bookingId, { update, notify }) {
  const result = await update({ bookingId, newStatus: 'Confirmed' });
  if (result?.error) {
    notify(result.error.message || "Couldn't confirm this booking. Please try again.", 'error');
    return false;
  }
  return true;
}
