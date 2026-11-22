// The light calendar refresh (bookings only) when the caller has one, else the normal refresh. Use it after a BOOKING change only:
// a change to blocks, transfers, attendance, the team or the rooms needs the full refreshCalendar().
export const refreshLight = (refreshCalendar) => (refreshCalendar?.light || refreshCalendar)?.();
