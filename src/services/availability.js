// Staff-availability rule (ZNLY-100): error mapping + a data-driven pre-check over the rows
// therapist_shifts_for_range (migration-354) returns. The database is the only place the rule is enforced
// (check_therapist_booking_guards, migration-353); this module only turns its stable error codes into
// messages and shows the same verdict early, while a form is being filled in.

export const AVAILABILITY_CODES = ['OFF_SHIFT', 'ON_BREAK', 'ON_LEAVE', 'BLOCKED', 'OTHER_BRANCH', 'OVERLAP', 'OVERRIDE_NOT_ALLOWED'];

// Never overridable, not even by admins: leave is changed in Attendance, overlaps are physical.
const OVERRIDABLE = new Set(['OFF_SHIFT', 'ON_BREAK', 'BLOCKED', 'OTHER_BRANCH']);

// Same order the guard uses to pick which reason to report first.
const PRIORITY = ['ON_LEAVE', 'OVERLAP', 'OTHER_BRANCH', 'BLOCKED', 'ON_BREAK', 'OFF_SHIFT'];

export const isOverridableCode = (code) => OVERRIDABLE.has(code);

const CODE_RE = new RegExp(`^(${AVAILABILITY_CODES.join('|')}):\\s*`);

export const minutesToHHMM = (min) => {
  if (min >= 1440) return '24:00';
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const hhmmToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m || 0);
};

// "Rojina is on a break 14:00–14:30". `staffLabel` (from useIndustry) is only the fallback when the name is missing.
export function formatAvailabilityMessage(code, detail = {}, { staffLabel = 'staff member' } = {}) {
  const who = detail.therapist_name || `This ${staffLabel}`;
  const range = `${detail.range_start}–${detail.range_end}`;
  switch (code) {
    case 'ON_BREAK':
      return `${who} is on a break ${range}`;
    case 'ON_LEAVE':
      return detail.reason === 'leave_half' ? `${who} is off ${range}` : `${who} is on leave on this date`;
    case 'BLOCKED':
      return `${who} is blocked ${range}${detail.label ? ` (${detail.label})` : ''}`;
    case 'OTHER_BRANCH':
      return `${who} is at ${detail.label || 'another branch'} at this time`;
    case 'OVERLAP':
      return `${who} already has a booking ${range}`;
    case 'OFF_SHIFT':
      if (detail.reason === 'before_shift') return `${who} is off until ${detail.range_end}`;
      if (detail.reason === 'after_shift') return `${who}'s shift ends at ${detail.range_start}`;
      return `${who} is not working on this date`;
    case 'OVERRIDE_NOT_ALLOWED':
      return 'Only a manager or admin can book outside a staff member\'s availability.';
    default:
      return 'This time is not available.';
  }
}

// Supabase error (message "CODE: text", `details` = JSON from the guard) -> { code, message, overridable, detail } | null.
export function parseAvailabilityError(error, opts = {}) {
  if (!error || typeof error.message !== 'string') return null;
  const m = error.message.match(CODE_RE);
  if (!m) return null;
  const code = m[1];
  let detail = {};
  try {
    const raw = error.details || error.detail;
    if (raw) detail = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    detail = {};
  }
  const message = detail && detail.range_start
    ? formatAvailabilityMessage(code, detail, opts)
    : (code === 'OVERRIDE_NOT_ALLOWED' ? formatAvailabilityMessage(code) : error.message.replace(CODE_RE, '').trim());
  return { code, message, overridable: OVERRIDABLE.has(code), detail };
}

// ---- pre-check (no write) ----------------------------------------------------------------------------------------
// shiftDay: one row of therapist_shifts_for_range: { works, start_time, end_time, source, breaks:[{start_min,end_min,name}],
//   off:[{code,reason,label,start_min,end_min}] }. bookings: [{ startMin, endMin, number? }] of the same therapist/day,
//   excluding the booking being edited. Returns the same shape as parseAvailabilityError or null when free.
export function evaluateAvailability({ shiftDay, bookings = [], startMin, endMin, therapistName, staffLabel }) {
  const found = {};
  const add = (code, reason, s, e, label) => {
    if (s < endMin && e > startMin && !found[code]) {
      found[code] = { code, reason, label, start_min: s, end_min: e };
    }
  };
  const sMin = shiftDay?.start_time ? hhmmToMinutes(shiftDay.start_time) : null;
  let eMin = shiftDay?.end_time ? hhmmToMinutes(shiftDay.end_time) : null;
  if (eMin === 1439 && shiftDay?.end_time === '23:59:59') eMin = 1440;  // RPC renders 24:00 as 23:59:59
  if (shiftDay) {
    if (!shiftDay.works) add('OFF_SHIFT', 'day_off', 0, 1440);
    else if (sMin !== null) {
      if (sMin > 0) add('OFF_SHIFT', 'before_shift', 0, sMin);
      if (eMin < 1440) add('OFF_SHIFT', 'after_shift', eMin, 1440);
    }
    if (shiftDay.works) (shiftDay.breaks || []).forEach((b) => add('ON_BREAK', 'break', b.start_min, b.end_min, b.name));
    (shiftDay.off || []).forEach((o) => add(o.code, o.reason, o.start_min, o.end_min, o.label));
  }
  bookings.forEach((b) => add('OVERLAP', 'booking', b.startMin, b.endMin, b.number));

  const hit = PRIORITY.map((c) => found[c]).find(Boolean);
  if (!hit) return null;
  const detail = {
    code: hit.code, reason: hit.reason, therapist_name: therapistName, label: hit.label || null,
    range_start: minutesToHHMM(hit.start_min), range_end: minutesToHHMM(hit.end_min),
  };
  return { code: hit.code, message: formatAvailabilityMessage(hit.code, detail, { staffLabel }), overridable: OVERRIDABLE.has(hit.code), detail };
}

// Next `count` start times (HH:MM, 15-minute grid, spaced a full duration apart) at or after `fromMin` where the
// therapist is free for `durationMin`.
export function nextFreeStarts({ shiftDay, bookings = [], durationMin, fromMin, count = 3, step = 15 }) {
  const out = [];
  for (let s = Math.ceil(fromMin / step) * step; s + durationMin <= 1440 && out.length < count; s += step) {
    if (!evaluateAvailability({ shiftDay, bookings, startMin: s, endMin: s + durationMin })) {
      out.push(minutesToHHMM(s));
      s += durationMin - step;  // next suggestion starts after this one would end
    }
  }
  return out;
}

// First other therapist who is free at exactly this time. `candidates`: [{ id, name, shiftDay, bookings }].
export function firstOtherFreeTherapist({ candidates, excludeId, startMin, endMin }) {
  return candidates.find((c) => c.id !== excludeId && !evaluateAvailability({ shiftDay: c.shiftDay, bookings: c.bookings, startMin, endMin })) || null;
}

// Per-branch cache of "does this tenant enforce staff availability?" (organizations.enforce_staff_availability).
// When it is ON, the database guard is the single source of truth for leave and transfer windows, so the older JS
// pre-checks (THERAPIST_ABSENT / INVALID_THERAPIST) step aside and the user gets the guard's mapped code and message.
// Fails safe: if the flag can't be read (e.g. an anonymous customer), report OFF and keep the old pre-checks.
export function createEnforcementCache(fetchFlag, { ttlMs = 60000, now = () => Date.now() } = {}) {
  const entries = new Map();   // branchId -> { value, at }
  return {
    async get(branchId) {
      if (!branchId) return false;
      const hit = entries.get(branchId);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      let value = false;
      try {
        value = (await fetchFlag(branchId)) === true;
      } catch {
        value = false;
      }
      entries.set(branchId, { value, at: now() });
      return value;
    },
    clear() { entries.clear(); },
  };
}
