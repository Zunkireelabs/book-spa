// The primary therapist (junction row index 0) always uses the booking's own room_id —
// a room override only ever applies to a companion. This must be enforced here,
// unconditionally, rather than left to whatever the caller's override map happens to
// contain: BookingActionModal only ever builds an override entry for non-primary
// therapists, so if a former companion gets promoted to index 0 (the old primary was
// removed), their stale override would otherwise silently carry over with no UI to
// see or clear it.
export function resolveJunctionRoomId({ index, therapistId, overridesMap, existingRoomId }) {
  if (index === 0) return null;
  if (overridesMap && Object.prototype.hasOwnProperty.call(overridesMap, therapistId)) {
    return overridesMap[therapistId] || null;
  }
  return existingRoomId || null;
}

// Counts booking_therapists rows overlapping a time window for one room, matching what
// the check_room_capacity()/check_booking_therapist_room_capacity() DB triggers
// (migration-171) do in SQL. Falls back to the parent booking's own start_time/end_time
// when the row's own are null, mirroring the triggers' COALESCE(bt.start_time,
// b2.start_time) — without this fallback, a null-timed row would silently never count.
export function countOverlappingRoomRows(rows, { branchId, date, startTime, endTime, excludeBookingId }) {
  return (rows || []).filter(row => {
    if (excludeBookingId && row.booking_id === excludeBookingId) return false;
    const b = row.bookings || {};
    if (b.branch_id !== branchId) return false;
    if (b.date !== date) return false;
    if (['Cancelled', 'No Show'].includes(b.status)) return false;
    const rowStart = row.start_time || b.start_time;
    const rowEnd = row.end_time || b.end_time;
    if (!rowStart || !rowEnd) return false;
    return rowStart < endTime && rowEnd > startTime;
  }).length;
}
