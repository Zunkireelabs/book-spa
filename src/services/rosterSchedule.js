// Shared staff-roster resolution — the single place that knows how a therapist's
// effective working window for one calendar date is derived from:
//   - therapist_working_hours        (migration-275) recurring weekly defaults
//   - therapist_working_hours_breaks (migration-278) intra-shift breaks
//   - staff_roster_overrides         (migration-287) per-date exceptions
//
// Both the monthly Roster grid (MasterData/RosterPanel) and the calendar's
// per-column roster shading (calendar/CalendarGrid) import from here. This is
// deliberately NOT duplicated per call site: scheduling logic copied between
// components is the known failure mode in this area (see the "keep both in
// sync" comment in api.js), and the day-of-week offset below is exactly the
// kind of detail that drifts.
//
// DISPLAY ONLY. Nothing here is consulted by booking availability or conflict
// checks — a slot shaded as off-roster or on-break is still bookable.

// JS Date#getDay() is 0=Sunday..6=Saturday; therapist_working_hours.day_of_week
// is 0=Monday..6=Sunday. This converts between the two.
export function isoDayOfWeek(d) {
  return (d.getDay() + 6) % 7;
}

// Same, from a "YYYY-MM-DD" string. Built via the local-time Date constructor
// rather than Date.parse("YYYY-MM-DD"), which is specified as UTC midnight and
// would resolve to the previous day's weekday in any negative UTC offset.
export function isoDayOfWeekFromDateStr(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  return isoDayOfWeek(new Date(y, m - 1, d));
}

// "HH:MM" / "HH:MM:SS" -> minutes from midnight. Postgres `time` columns come
// back as "HH:MM:SS" while the grid's own bounds are "HH:MM", so every
// comparison here goes through minutes — lexical string compare would read
// "09:00:00" as greater than "09:00".
export function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Breaks are configured against the weekly shift, so a per-date override that
// narrows the shift can leave a break hanging outside it. Clip to the effective
// window and drop anything that falls fully outside.
function clipBreaks(breaks, startTime, endTime) {
  const windowStart = timeToMinutes(startTime);
  const windowEnd = timeToMinutes(endTime);
  if (windowStart == null || windowEnd == null) return [];

  return (breaks || []).reduce((acc, brk) => {
    const bs = timeToMinutes(brk.startTime);
    const be = timeToMinutes(brk.endTime);
    if (bs == null || be == null || be <= bs) return acc;
    const from = Math.max(bs, windowStart);
    const to = Math.min(be, windowEnd);
    if (to <= from) return acc;
    acc.push({ name: brk.name || '', startTime: minutesToTime(from), endTime: minutesToTime(to) });
    return acc;
  }, []);
}

// The effective roster for one (therapist, date).
//   weeklyByTherapist: Map<therapistId, Array<{dayOfWeek, startTime, endTime, isDayOff, breaks}>>
//                      — fetchBranchWorkingHours()
//   overridesByKey:    Map<`${therapistId}_${date}`, {startTime, endTime, isDayOff}>
//                      — fetchRosterOverrides()
//
// Returns null for "no roster configured" — NOT "day off". A therapist whose
// hours have never been set has no rows at all, and must read as fully
// available rather than fully unavailable; collapsing those two cases would
// blanket-shade every existing tenant that has not adopted the roster feature.
export function resolveEffectiveHours({ therapistId, date, weeklyByTherapist, overridesByKey }) {
  if (!therapistId || !date) return null;

  const override = overridesByKey?.get?.(`${therapistId}_${date}`) || null;
  const dayOfWeek = isoDayOfWeekFromDateStr(date);
  const weeklyRows = weeklyByTherapist?.get?.(therapistId) || [];
  const weekly = weeklyRows.find(r => r.dayOfWeek === dayOfWeek) || null;

  if (!override && !weekly) return null;

  const base = override || weekly;
  const source = override ? 'override' : 'weekly';

  if (base.isDayOff) {
    return { source, isDayOff: true, startTime: null, endTime: null, breaks: [] };
  }
  // A row flagged as working but missing either bound is malformed; treat it as
  // unconfigured rather than shading the whole column off a bad row.
  if (!base.startTime || !base.endTime) return null;
  if (timeToMinutes(base.endTime) <= timeToMinutes(base.startTime)) return null;

  return {
    source,
    isDayOff: false,
    startTime: base.startTime,
    endTime: base.endTime,
    // Overrides (migration-287) carry hours only, no breaks of their own — the
    // weekly day's breaks still apply, clipped to the override's window.
    breaks: clipBreaks(weekly?.breaks, base.startTime, base.endTime),
  };
}

// Time bands to shade in a therapist's column for one day, clipped to the
// grid's own [openTime, closeTime] bounds.
//   kind: 'off'   — outside the shift entirely (or a full day off)
//         'break' — inside the shift, but on a configured break
// Empty array means "shade nothing" (no roster configured, or a malformed row).
export function getRosterShadingSegments({ effective, openTime, closeTime }) {
  if (!effective) return [];
  const open = timeToMinutes(openTime);
  const close = timeToMinutes(closeTime);
  if (open == null || close == null || close <= open) return [];

  const segments = [];
  const push = (kind, from, to, label) => {
    if (from == null || to == null) return;
    const clippedFrom = Math.max(from, open);
    const clippedTo = Math.min(to, close);
    if (clippedTo <= clippedFrom) return;
    segments.push({ kind, fromTime: minutesToTime(clippedFrom), toTime: minutesToTime(clippedTo), label });
  };

  if (effective.isDayOff) {
    push('off', open, close, 'Day off');
    return segments;
  }

  const shiftStart = timeToMinutes(effective.startTime);
  const shiftEnd = timeToMinutes(effective.endTime);
  if (shiftStart == null || shiftEnd == null || shiftEnd <= shiftStart) return [];

  push('off', open, shiftStart, 'Off roster');
  push('off', shiftEnd, close, 'Off roster');
  (effective.breaks || []).forEach(brk => {
    push('break', timeToMinutes(brk.startTime), timeToMinutes(brk.endTime), brk.name ? `Break · ${brk.name}` : 'Break');
  });

  return segments;
}
