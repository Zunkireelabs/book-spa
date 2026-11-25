// ONE status line for "today" for one staff member, fed by the therapist_shifts_for_range row (via hoursFromShiftRow) plus
// attendance. The profile header, the Therapists list Today column, the calendar column header and the Free now card all call it,
// so the same person never reads two different ways. `full` always shows the whole shift range; `short` + `dot` are for the narrow
// calendar header. "Shift" only appears when real hours exist (weekly hours or a roster date change), never for a no-hours day.
//
//   hours:      hoursFromShiftRow(row)  ({ source, startTime, endTime, isDayOff, breaks, openNoHours, off, missing })
//   attendance: { status, checkInTime: 'HH:MM' Nepal, checkOutTime: 'HH:MM' } | null
//   nowMin:     Nepal-local minutes since midnight (only meaningful when the day is today)
//   branchClosed: today is a closed date for the branch
//   back:       nextWorkingDay(...) result | null, the wording for "back Tue 09:00"
//   -> { key, row, full, parts: [title, sub], short, dot: 'grey'|'amber'|'green'|'purple', tone }
import { timeToMinutes, hoursFromShiftRow } from './staffDay';
import { wordBranch, wordBranchCap } from './industryTerms';
import { readUse24h } from './clockPref';
import { formatClockRange } from './clockTime';

const LEAVE_STATUSES = new Set(['Leave', 'Annual Leave', 'Sick Leave']);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STATUS_DOT_COLOR = { grey: '#B8B8BD', amber: '#F59E0B', green: '#2D5A27', purple: '#7A4B86' };

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const range = (a, b) => `${a}–${b}`;
const h12 = (min) => { if (readUse24h()) return hhmm(min); const h = Math.floor(min / 60) % 24; return `${h % 12 === 0 ? 12 : h % 12}:${String(min % 60).padStart(2, '0')}`; };
const ampm = (min) => (readUse24h() ? '' : Math.floor(min / 60) % 24 >= 12 ? 'pm' : 'am');
/** "6:55 – 9:55 pm" (am/pm shown once when both ends agree). */
const t12 = (min) => (readUse24h() ? hhmm(min) : `${h12(min)} ${ampm(min)}`);
const range12 = (a, b) => formatClockRange(hhmm(a % 1440), hhmm(b % 1440), readUse24h());
const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

/** Is `date` inside one of fetchClosedDateRanges' { startDate, endDate } ranges? */
export const isClosedDate = (ranges, date) => (ranges || []).some((r) => r.startDate <= date && date <= r.endDate);

/** Is `date` closed by a whole-branch, all-day block occurrence ({ date, startTime, endTime, therapistId, roomId })? A 1440-min block wraps to endTime 00:00. */
export const isClosedByBlocks = (occurrences, date) => (occurrences || []).some((o) => o.date === date && !o.therapistId && !o.roomId
  && String(o.startTime).slice(0, 5) === '00:00' && ['00:00', '24:00'].includes(String(o.endTime).slice(0, 5)));

/** First day after `fromDate` (within `horizon` days) this person is working: { date, startTime } | null. hoursOn(date) -> hoursFromShiftRow(...). */
export function nextWorkingDay(fromDate, hoursOn, horizon = 7) {
  const [y, m, d] = fromDate.split('-').map(Number);
  for (let i = 1; i <= horizon; i += 1) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    const h = hoursOn(date);
    if (!h || h.missing || h.isDayOff) continue;
    if ((h.off || []).some((o) => o.code === 'ON_LEAVE' && o.reason === 'leave_full')) continue;
    return { date, startTime: h.startTime };
  }
  return null;
}

const line = (key, row, rawParts, short, dot, tone) => {
  const parts = rawParts.filter(Boolean);
  return { key, row, parts, full: parts.join(' · '), short, dot, tone };
};

export function todayStatusLine({ hours, attendance = null, nowMin = 0, branchClosed = false, back = null } = {}) {
  const h = hours || hoursFromShiftRow(null);
  const att = attendance?.status ? attendance : null;
  const checkedIn = attendance?.checkInTime || null;
  const checkedOut = attendance?.checkOutTime || null;
  const backDay = back ? `${weekdayOf(back.date)}${back.startTime ? ` ${back.startTime}` : ''}` : null;
  const backLeave = back ? weekdayOf(back.date) : null;

  if (branchClosed) return line('closed', 13, [`${wordBranchCap()} closed today`], 'Closed', 'grey', 'off');
  if (h.missing && !att) return line('no-roster', null, ['No shift set', 'Set hours in their profile'], 'No shift', 'grey', 'none');

  const off = h.off || [];
  const fullLeave = off.some((o) => o.code === 'ON_LEAVE' && o.reason === 'leave_full') || (att && LEAVE_STATUSES.has(att.status) && !checkedIn);
  if (fullLeave) return line('leave', 7, ['On leave', backLeave ? `back ${backLeave}` : null], 'On leave', 'purple', 'leave');
  if (att?.status === 'Absent') return line('absent', null, ['Absent today', 'Marked absent'], 'Absent', 'grey', 'off');
  if (att?.status === 'Day Off' || h.isDayOff) return line('off', 6, ['Off today', backDay ? `back ${backDay}` : null], 'Day off', 'grey', 'off');

  const noHours = h.source === 'none';
  const start = timeToMinutes(h.startTime);
  const end = timeToMinutes(h.endTime);
  const startS = h.startTime;
  const endS = h.endTime;

  const away = off.find((o) => o.code === 'OTHER_BRANCH' && o.start_min <= nowMin && nowMin < o.end_min);
  if (away) {
    const where = away.label || `another ${wordBranch()}`;
    return line('other-branch', 9, [`At ${where} until ${hhmm(Math.min(away.end_min, 1439))}`], `At ${where}`, 'grey', 'off');
  }
  const half = off.find((o) => o.code === 'ON_LEAVE' && o.reason === 'leave_half');
  if (half) {
    const r = range(hhmm(half.start_min), hhmm(Math.min(half.end_min, 1439)));
    return line('half-day', 8, ['Half day', `off ${r}`], `Away ${r}`, 'purple', 'leave');
  }

  // Visitor today (ZNLY-113 A+): the shift IS the visit window(s), i.e. the open hours minus the OTHER_BRANCH stretches.
  if (h.source === 'window' && start != null && end != null) {
    const gaps = off.filter((o) => o.code === 'OTHER_BRANCH').sort((a, b) => a.start_min - b.start_min);
    const wins = [];
    let cursor = start;
    for (const g of gaps) {
      if (g.start_min > cursor) wins.push([cursor, Math.min(g.start_min, end)]);
      cursor = Math.max(cursor, g.end_min);
    }
    if (cursor < end) wins.push([cursor, end]);
    const spans = wins.filter(([a, z]) => z > a);
    const cur = spans.find(([a, z]) => a <= nowMin && nowMin < z);
    const next = spans.find(([a]) => a > nowMin);
    const text = spans.map(([a, z]) => range12(a, z)).join(', ');
    if (cur) return line('visiting', checkedIn ? 3 : 1, [checkedIn ? `Checked in ${checkedIn}` : null, `Here ${range12(cur[0], cur[1])}`], `Here ${range12(cur[0], cur[1])}`, 'green', 'shift');
    if (next) return line('visiting-upcoming', 1, [`Here ${range12(next[0], next[1])}`], `Here ${t12(next[0])}`, 'grey', 'shift');
    return line('finished', 5, [text ? `Visit ended (${text})` : 'Visit ended'], 'Finished', 'grey', 'off');
  }

  if (noHours) {
    const branch = startS && endS ? `bookable in ${wordBranch()} hours ${range(startS, endS)}` : `bookable in ${wordBranch()} hours`;
    if (start != null && end != null && (nowMin < start || nowMin >= end)) return line('no-hours-closed', 12, ['No hours set', `${wordBranch()} closed now`], 'No set hours', 'grey', 'none');
    return line('no-hours', checkedIn ? 11 : 10, [checkedIn ? `Checked in ${checkedIn}` : null, 'No hours set', branch], 'No set hours', 'green', 'none');
  }

  const shift = `Shift ${range(startS, endS)}`;
  const shortShift = range(startS, endS);
  const breakNow = (h.breaks || []).find((b) => timeToMinutes(b.startTime) <= nowMin && nowMin < timeToMinutes(b.endTime));
  if (breakNow && !checkedOut) return line('on-break', 4, [`On break until ${breakNow.endTime}`, shift], `Break till ${breakNow.endTime}`, 'amber', 'shift');
  if (checkedOut) return line('finished', 5, [`Checked out ${checkedOut}`], 'Finished', 'grey', 'off');
  if (nowMin >= end) return line('finished', 5, [`Shift ended ${endS}`], 'Finished', 'grey', 'off');
  if (checkedIn) return line('checked-in', 3, [`Checked in ${checkedIn}`, shift], shortShift, 'green', 'shift');
  if (nowMin >= start) return line('not-checked-in', 2, ['Not checked in', `Shift started ${startS}`], 'Not checked in', 'amber', 'alert');
  return line('upcoming', 1, [`Starts ${startS}`, shift], shortShift, 'grey', 'shift');
}
