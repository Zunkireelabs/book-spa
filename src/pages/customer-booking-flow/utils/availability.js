// Shared real-availability helpers for the customer booking flow — used by both
// DateTimeSelection (full multi-day grid) and AvailableTodayPanel (same-day quick picks), so the
// two stay consistent about what "available" means (room capacity + gender headcount).

export const START_HOUR = 9;
export const END_HOUR = 21;

export function getNepalNow() {
  const now = new Date();
  const nepalTime = now.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
  return new Date(nepalTime);
}

export function getNepalToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
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

// Bucket every booking's full [start, start+duration) span into 30-min slots, per room and per
// gender — so a candidate slot can be checked against the ENTIRE span a service would occupy,
// not just the exact clicked half-hour.
export function buildOccupancy(bookings) {
  const byRoom = {}; // date -> roomId -> Map(slotStartMinutes -> count)
  const byGender = {}; // date -> Map(slotStartMinutes -> { male, female })

  for (const b of bookings || []) {
    const date = b.booking_date;
    const startMin = timeToMinutes(b.start_time?.slice(0, 5) || '00:00');
    const duration = b.duration_minutes || 60;
    const endMin = startMin + duration;
    const gender = b.therapist_gender?.toLowerCase();

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
    }
  }

  return { byRoom, byGender };
}
