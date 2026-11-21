/** A new tenant has under two weeks of bookings: no earlier booking than 14 days before today (or none at all). */
export function isNewTenant(firstBookingDate, today) {
  if (!firstBookingDate) return true;
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  return firstBookingDate > cutoff.toISOString().slice(0, 10);
}

/** Setup checklist from real counts: [{ key, label, done, view }]. `view` is the dashboard ?view= that fixes it. */
export function setupSteps({ services = 0, staff = 0, rooms = 0, bookings = 0 } = {}, { staffLabel = 'Staff', roomLabel = 'Rooms', enableRooms = true } = {}) {
  const steps = [
    { key: 'services', label: 'Add your services', done: services > 0, view: 'services' },
    { key: 'staff', label: `Add your ${staffLabel.toLowerCase()}`, done: staff > 0, view: 'therapists' },
    { key: 'rooms', label: `Add your ${roomLabel.toLowerCase()}`, done: rooms > 0, view: 'rooms' },
    { key: 'booking', label: 'Take your first booking', done: bookings > 0, view: 'calendar' },
  ];
  // Industries without rooms (beauty, cleaning) have no rooms step, so the card can complete and hide.
  return enableRooms ? steps : steps.filter((s) => s.key !== 'rooms');
}
