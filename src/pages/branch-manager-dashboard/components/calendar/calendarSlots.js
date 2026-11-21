import { isAfterCheckout } from '../../../../services/therapistBranchWindow';

// Whether a (day, hour, minute) slot for a therapist falls at/after their recorded
// check-out for that specific day. `checkedOutByTherapistAndDate` is the
// "<therapistId>_<date>" -> raw check_out_time map from getCalendarBookings.
export function isCheckedOutBlockedSlot(checkedOutByTherapistAndDate, therapistId, day, hour, minute) {
  const checkOutTime = checkedOutByTherapistAndDate?.[`${therapistId}_${day}`];
  if (!checkOutTime) return false;
  const slotTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return isAfterCheckout(checkOutTime, day, slotTime);
}

// Default interval (minutes) used to pre-check an empty-slot click before a service is chosen.
export const DEFAULT_SLOT_MINUTES = 30;
