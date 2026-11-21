// Which New-booking form field an API error code is about, so the panel can scroll to it and outline it.
// Codes come from createBooking / createBookingGroup in services/api.js. Unknown or missing code: null (caller falls back to wording).
export const ERROR_CODE_FIELD = {
  // when
  ROOMS_FULL: 'time', BRANCH_CLOSED: 'time', BRANCH_ONLINE_CAPACITY: 'time', BOOKING_CROSSES_MIDNIGHT: 'time', DAY_LOCKED: 'time', INVALID_HOURS: 'time',
  // who
  THERAPIST_CONFLICT: 'staff', THERAPIST_ABSENT: 'staff', THERAPIST_CHECKED_OUT: 'staff', THERAPIST_INACTIVE: 'staff',
  INVALID_THERAPIST: 'staff', THERAPIST_NOT_ELIGIBLE: 'staff', THERAPIST_REQUIRED: 'staff',
  // where
  ROOM_FULL: 'room', ROOM_CONFLICT: 'room', ROOM_INACTIVE: 'room', INVALID_ROOM: 'room',
  // customer
  CUSTOMER_NOT_FOUND: 'customer', NO_CONTACT_INFO: 'customer', CUSTOMER_REQUIRED: 'customer',
};

export const fieldForErrorCode = (code) => (code && ERROR_CODE_FIELD[code]) || null;
