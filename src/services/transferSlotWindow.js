// Which phase of a transfer window a given day falls into. 'before' (hasn't started yet) and
// 'after' (already ended) are kept DISTINCT, not collapsed into one "outside" state — a
// transferredOut therapist is never blocked in either phase, but a transferredIn visitor IS
// blocked 'before' (not yet arrived) and must NEVER be blocked 'after' (already returned home);
// collapsing these two together previously caused an already-returned visitor to be blocked on
// every later day exactly like a not-yet-arrived one. `start`/`end` are `{date, time}` shapes
// from toKathmanduParts; `end` must be non-null (callers block conservatively upstream if unknown).
export function getTransferWindowPhase(day, start, end) {
  if (start && day < start.date) return 'before';
  if (day > end.date) return 'after';
  return 'during';
}

// Whether a given (day, hour, minute) slot falls inside the [start.time, end.time) slice on a
// 'during'-phase day (a multi-day window's middle days are all-day-inside by definition).
export function isWithinTransferDaySlice(day, hour, minute, start, end) {
  const slotTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const fromTime = start && day === start.date ? start.time : '00:00';
  const toTime = day === end.date ? end.time : '23:59';
  return slotTime >= fromTime && slotTime < toTime;
}
