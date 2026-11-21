// Shared real-availability helpers for the customer booking flow — used by both
// DateTimeSelection (full multi-day grid) and AvailableTodayPanel (same-day quick picks), so the
// two stay consistent about what "available" means (room capacity + gender headcount).

// Legacy online range, used only when a branch has no hours configured anywhere (ZNLY-222).
export const START_HOUR = 10;
export const END_HOUR = 18;

// Online slot range for one calendar date, from the branch's own hours (ZNLY-222).
// hours = { weekly: [{ day_of_week, start_time, end_time, is_day_off }], openTime, closeTime } | null
// day_of_week follows branch_working_hours: Monday = 0 ... Sunday = 6.
// Returns { startMin, endMin } (minutes from midnight), or null for a day off (no slots).
// A weekday with no row falls back to branches.open_time/close_time; with nothing configured, the legacy 10:00-18:00.
export function slotRangeForDate(dateStr, hours) {
  const dow = (new Date(`${dateStr}T00:00:00`).getDay() + 6) % 7;
  const toMin = (t) => timeToMinutes(String(t).slice(0, 5));
  const row = (hours?.weekly || []).find((r) => r.day_of_week === dow);
  if (row) {
    if (row.is_day_off || !row.start_time || !row.end_time) return null;
    return { startMin: toMin(row.start_time), endMin: toMin(row.end_time) };
  }
  if (hours?.openTime && hours?.closeTime) return { startMin: toMin(hours.openTime), endMin: toMin(hours.closeTime) };
  return { startMin: START_HOUR * 60, endMin: END_HOUR * 60 };
}

export function getNepalNow() {
  const now = new Date();
  const nepalTime = now.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
  return new Date(nepalTime);
}

export function getNepalToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

// Closed-date ranges, as returned by fetchClosedDateRanges: [{ startDate, endDate }].
export function isDateInRanges(dateStr, ranges) {
  return (ranges || []).some((r) => dateStr >= r.startDate && dateStr <= r.endDate);
}

// openTime/closeTime are 'HH:MM:SS' strings (branches.open_time/close_time). Compares
// against the current Nepal clock time — same timezone basis as getNepalNow/getNepalToday.
export function isBranchOpenNow(openTime, closeTime) {
  if (!openTime || !closeTime) return true; // unconfigured hours — don't falsely mark closed
  const nowMinutes = timeToMinutes(getNepalNow().toTimeString().slice(0, 5));
  const openMinutes = timeToMinutes(openTime.slice(0, 5));
  const closeMinutes = timeToMinutes(closeTime.slice(0, 5));
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

// 'HH:MM:SS' -> '10:00 AM', for the branch-card hours line.
export function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime24(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function minutesToTime12(mins) {
  const d = new Date();
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Bucket every booking's full [start, start+duration) span into 30-min slots, per room, per
// gender and per branch — so a candidate slot can be checked against the ENTIRE span a service
// would occupy, not just the exact clicked half-hour.
//
// byBranch only counts rows the DB flagged counts_as_online_capacity (migration-301: an
// anonymous online booking, therapist_id IS NULL AND created_by IS NULL) — the same rows
// check_branch_online_capacity() counts against branches.online_booking_capacity. Staff-created
// unassigned bookings and manual_blocks are excluded by the DB, so they never consume a unit
// here either.
export function buildOccupancy(bookings) {
  const byRoom = {}; // date -> roomId -> Map(slotStartMinutes -> count)
  const byGender = {}; // date -> Map(slotStartMinutes -> { male, female })
  const byBranch = {}; // date -> Map(slotStartMinutes -> count of online-capacity bookings)

  for (const b of bookings || []) {
    const date = b.booking_date;
    const startMin = timeToMinutes(b.start_time?.slice(0, 5) || '00:00');
    const duration = b.duration_minutes || 60;
    const endMin = startMin + duration;
    // A booking placed through the public flow has no therapist assigned yet
    // (therapist_id NULL — assignment happens later, manually by staff), so
    // therapist_gender is null until then. Fall back to the customer's own stated
    // gender_preference so a pending booking still reserves its slot against the
    // headcount, instead of being invisible to it (ZNLY-168).
    const gender = (b.therapist_gender || b.gender_preference)?.toLowerCase();

    // Bookings don't always start on a 30-min boundary (e.g. 16:05) — align down to the grid so
    // every 30-min slot the booking actually overlaps gets counted, not just the raw start time.
    const gridStart = Math.floor(startMin / 30) * 30;

    for (let slotMin = gridStart; slotMin < endMin; slotMin += 30) {

      if (b.room_id) {
        byRoom[date] = byRoom[date] || {};
        byRoom[date][b.room_id] = byRoom[date][b.room_id] || new Map();
        const map = byRoom[date][b.room_id];
        map.set(slotMin, (map.get(slotMin) || 0) + 1);
      }

      if (gender === 'male' || gender === 'female') {
        byGender[date] = byGender[date] || new Map();
        const entry = byGender[date].get(slotMin) || { male: 0, female: 0 };
        entry[gender]++;
        byGender[date].set(slotMin, entry);
      }

      if (b.counts_as_online_capacity) {
        byBranch[date] = byBranch[date] || new Map();
        const map = byBranch[date];
        map.set(slotMin, (map.get(slotMin) || 0) + 1);
      }
    }
  }

  return { byRoom, byGender, byBranch };
}
