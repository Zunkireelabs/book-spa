// Count live bookings that a proposed manual block would sit on top of (preview-only; blocks are warn-only).
// `bookings` are the calendar's raw DB rows: { date, start_time, end_time, status, therapist_id, booking_therapists[], room_id, service_id }.
// A block with a therapist matches that therapist's bookings; a room-only block matches that room's; a whole-branch block matches all.
const toMin = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};

export function countBookingsInRange(bookings, { date, startTime, durationMinutes, therapistId, roomId }) {
  const s = toMin(startTime);
  const dur = Number(durationMinutes) || 0;
  if (!date || s == null || dur <= 0) return 0;
  const e = s + dur;
  let n = 0;
  for (const b of bookings || []) {
    const status = String(b.status || '').toLowerCase();
    if (['cancelled', 'no show'].includes(status)) continue;
    if (b.date !== date) continue;
    const bs = toMin(b.start_time);
    const be = toMin(b.end_time);
    if (bs == null || be == null || !(s < be && e > bs)) continue;
    const bookingTherapists = b.booking_therapists?.length ? b.booking_therapists.map((d) => d.therapist_id) : (b.therapist_id ? [b.therapist_id] : []);
    const matches = (!therapistId && !roomId)
      || (therapistId && bookingTherapists.includes(therapistId))
      || (roomId && b.room_id === roomId && !therapistId);
    if (matches) n += 1;
  }
  return n;
}

export const bookingsInRangeMessage = (n) => (n > 0 ? `${n} booking${n === 1 ? '' : 's'} in this time` : '');
