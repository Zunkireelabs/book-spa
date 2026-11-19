// Every error code createBooking() / createBookingGroup() / submitGroupBooking()
// (api.js) can return with a customer-safe message attached. Previously duplicated
// verbatim in BookingConfirmation.jsx (customer-booking-flow) and GroupConfirmStep.jsx
// (provider-profile-flow) -- two copies of "which codes are known" is exactly how one
// gets updated and the other doesn't, which is how PHONE_REQUIRED's predecessor (a
// phone-required guard with no `code` at all) went unnoticed: nothing here could have
// caught it even if someone remembered to update both lists, since the bug was the
// code's absence, not the list's.
//
// CUSTOMER_NOT_FOUND / NO_CONTACT_INFO: these two come from createBooking()'s
// knownCustomerId branch (staff-only waitlist conversion) and are not currently
// reachable from either customer-facing caller below -- included anyway so a future
// change to either flow doesn't reintroduce the same "known code missing from the
// list" failure for these specifically.
export const KNOWN_BOOKING_ERROR_CODES = [
  'COUPLE_SERVICE_NOT_ALLOWED_IN_GROUP',
  'ROOMS_FULL',
  'ROOM_FULL',
  'INVALID_ROOM',
  'ROOM_INACTIVE',
  'INVALID_THERAPIST',
  'THERAPIST_INACTIVE',
  'THERAPIST_ABSENT',
  'THERAPIST_CHECKED_OUT',
  'THERAPIST_NOT_ELIGIBLE',
  'BOOKING_GROUP_PARTIAL',
  'NO_SERVICES',
  'THERAPIST_CONFLICT',
  'BRANCH_ONLINE_CAPACITY',
  'BOOKING_CROSSES_MIDNIGHT',
  'BOOKING_CONFIRMATION_UNAVAILABLE',
  'PHONE_REQUIRED',
  'CUSTOMER_NOT_FOUND',
  'NO_CONTACT_INFO',
];

/** A customer-safe message for a createBooking-family error, or the generic retry prompt
 * for anything unrecognized. */
export const mapBookingError = (error) => {
  if (!error) return null;
  return KNOWN_BOOKING_ERROR_CODES.includes(error.code) && error.message
    ? error.message
    : 'Something went wrong while confirming your booking. Please try again.';
};
