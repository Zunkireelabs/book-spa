// One place that words a staff transfer (calendar header, side panel, Attendance, profile, reports). State comes from
// the row's data only: upcoming = not applied · now = applied, not reverted, before revert_at · ended = reverted at or
// after revert_at (or revert_at passed) · back early = reverted before revert_at · permanent = no revert_at.
// All times are Nepal time, whatever the viewer's browser zone.
import { toKathmanduParts } from '../pages/branch-manager-dashboard/components/calendar/calendarDates';
import { formatClockTime } from '../pages/branch-manager-dashboard/components/calendar/timeFormat';

const DAY_FMT = { timeZone: 'Asia/Kathmandu', weekday: 'short', day: 'numeric', month: 'short' };

function dayLabel(date) {
  const label = new Date(`${date}T12:00:00+05:45`).toLocaleDateString('en-GB', DAY_FMT);
  return label.replace(',', '');
}

// 'Tue 27 Oct' -> '27 Oct' (short forms drop the weekday)
const dayNoWeekday = (date) => dayLabel(date).replace(/^\w+\s/, '');

/**
 * Normalise a staff_transfers-shaped row (snake_case) or the calendar column / attendance shapes into the helper's input.
 * { fromBranch, toBranch, isPermanent, startAt, revertAt, applied, reverted, revertedAt }  (branch names as strings)
 */
export function toTransferInput(row = {}) {
  const date = row.effective_date ?? row.effectiveDate;
  const time = row.start_time ?? row.startTime;
  const startAt = row.startAt || (date && time ? `${date}T${String(time).slice(0, 5)}:00+05:45` : null);
  return {
    fromBranch: row.fromBranch ?? row.from_branch_name ?? row.fromBranchName ?? null,
    toBranch: row.toBranch ?? row.to_branch_name ?? row.toBranchName ?? null,
    isPermanent: row.isPermanent ?? row.is_permanent ?? !(row.revertAt ?? row.revert_at),
    startAt,
    revertAt: row.revertAt ?? row.revert_at ?? null,
    applied: row.applied ?? true,
    reverted: row.reverted ?? false,
    revertedAt: row.revertedAt ?? row.reverted_at ?? null,
  };
}

export function transferState(t, now = new Date()) {
  const permanent = t.isPermanent || !t.revertAt;
  if (permanent) return t.applied ? 'permanent-done' : 'permanent-upcoming';
  if (!t.applied) return 'upcoming';
  if (t.reverted) {
    const early = t.revertedAt && new Date(t.revertedAt) < new Date(t.revertAt);
    return early ? 'back-early' : 'ended';
  }
  return new Date(now) < new Date(t.revertAt) ? 'now' : 'ended';
}

const PILLS = {
  upcoming: 'Upcoming', ended: 'Ended', 'back-early': 'Back early',
  'permanent-upcoming': 'Moving', 'permanent-done': 'Permanent',
};

/**
 * @param {object} t        normalised transfer (see toTransferInput)
 * @param {object} opts     { viewpoint: 'home'|'receiving', now, use24h, short, day: 'YYYY-MM-DD' (day being shown),
 *                            labels: { branch } }
 * @returns {{ state, pill, sentence, short, tiny }}
 */
export function describeTransfer(t, opts = {}) {
  try {
    return describeTransferUnsafe(t || {}, opts);
  } catch (e) {
    // a malformed row must never take a page down: plain fallback wording
    return { state: 'upcoming', pill: 'Transfer', sentence: 'Transfer', short: 'Transfer', tiny: 'Transfer', word: 'Transfer', full: 'Transfer' };
  }
}

function describeTransferUnsafe(t, opts) {
  const { viewpoint = 'home', use24h = false, day = null, labels = {} } = opts;
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const fallback = labels.branch ? `another ${labels.branch}` : 'another branch';
  const from = t.fromBranch || fallback;
  const to = t.toBranch || fallback;
  const home = viewpoint !== 'receiving';
  const state = transferState(t, now);
  const clock = (hhmm) => formatClockTime(hhmm, use24h);

  const start = toKathmanduParts(t.startAt);
  const end = toKathmanduParts(t.revertAt);
  const stop = toKathmanduParts(t.revertedAt);
  const startTxt = start ? `${dayLabel(start.date)} ${clock(start.time)}` : '';
  const todayNp = toKathmanduParts(new Date(now).toISOString())?.date;

  // 'Tue 27 Oct 12:00–16:00' (one day) or 'Tue 27 Oct 12:00 – Thu 29 Oct 16:00'
  const windowOf = (endParts) => {
    if (!start) return endParts ? `until ${clock(endParts.time)}` : '';
    if (!endParts) return startTxt;
    return endParts.date === start.date
      ? `${startTxt}–${clock(endParts.time)}`
      : `${startTxt} – ${dayLabel(endParts.date)} ${clock(endParts.time)}`;
  };
  // end of the window as the reader needs it: '16:00' today, 'Thu 29 Oct 16:00' on another day
  const endTxt = end ? (end.date === todayNp ? clock(end.time) : `${dayLabel(end.date)} ${clock(end.time)}`) : '';
  const sameDayEnd = end && end.date === todayNp;
  // short forms drop the date when it's the day being shown
  const startShort = start ? (day && start.date === day ? clock(start.time) : `${dayNoWeekday(start.date)} ${clock(start.time)}`) : '';
  const endShort = end ? (!day || end.date === day ? clock(end.time) : `${dayNoWeekday(end.date)} ${clock(end.time)}`) : '';

  let pill = PILLS[state];
  let sentence = '';
  let shortTxt = '';
  let tiny = '';
  let word = '';
  let full = '';
  let afterPill = '';
  let afterLadder = null;

  switch (state) {
    case 'upcoming': {
      const win = windowOf(end);
      sentence = home
        ? `To ${to} ${win}, back at ${from} ${end ? clock(end.time) : ''}`.trim()
        : `From ${from} ${win}`;
      shortTxt = home ? `To ${to} ${startShort}` : `From ${from} ${startShort}`;
      tiny = home ? `To ${to}` : `From ${from}`;
      word = home ? `Out ${startShort}` : `In ${startShort}`;
      full = end && (!day || end.date === day) ? `${home ? `To ${to}` : `From ${from}`} ${startShort}–${endShort}` : '';
      break;
    }
    case 'now': {
      pill = home ? `At ${to}` : 'Visiting';
      sentence = home
        ? `At ${to} until ${endTxt}, back at ${from} ${sameDayEnd ? clock(end.time) : 'then'}`
        : `Visiting from ${from} until ${endTxt}`;
      shortTxt = home ? `At ${to} · back ${endShort}` : `From ${from} · until ${endShort}`;
      afterLadder = home ? [`back at ${from} ${endShort}`, `back ${endShort}`] : [`from ${from} · until ${endShort}`, `until ${endShort}`, `from ${from}`];
      afterPill = afterLadder[0];
      tiny = home ? `At ${to}` : `From ${from}`;
      word = home ? 'Away' : 'Visiting';
      break;
    }
    case 'ended': {
      pill = PILLS.ended;
      sentence = home ? `Was at ${to} ${windowOf(end)}` : `Visited from ${from} ${windowOf(end)}`;
      shortTxt = home ? `Was at ${to}` : `Visited from ${from}`;
      tiny = shortTxt;
      word = 'Ended';
      break;
    }
    case 'back-early': {
      sentence = `${home ? `Was at ${to}` : `Visited from ${from}`} ${windowOf(stop)} (planned ${clock(end.time)})`;
      shortTxt = 'Back early';
      tiny = home ? `Was at ${to}` : `Visited from ${from}`;
      word = 'Back early';
      break;
    }
    case 'permanent-upcoming': {
      sentence = home
        ? `Moves to ${to} on ${startTxt} · permanent`
        : `Joins from ${from} on ${startTxt} · permanent`;
      shortTxt = home ? `Moves to ${to} ${start ? dayNoWeekday(start.date) : ''}` : `Joins from ${from} ${start ? dayNoWeekday(start.date) : ''}`;
      shortTxt = shortTxt.trim();
      tiny = home ? `Moves to ${to}` : `Joins from ${from}`;
      word = home ? 'Moving' : 'Joining';
      break;
    }
    default: { // permanent-done
      sentence = `Moved from ${from} to ${to} on ${startTxt}`;
      shortTxt = `Moved to ${to}`;
      tiny = shortTxt;
      word = 'Moved';
    }
  }
  return { state, pill, sentence: sentence.replace(/\s+/g, ' ').trim(), short: shortTxt.replace(/\s+/g, ' ').trim(), tiny, word, afterPill: (afterPill || shortTxt).replace(/\s+/g, ' ').trim(), afterPills: (afterLadder || [shortTxt, tiny]).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean), full: (full || shortTxt).replace(/\s+/g, ' ').trim() };
}

// '3 h 30 min' / '4 h' / '45 min' / '2 d 4 h': the real length of a temporary transfer (start -> planned return, or the early return).
export function transferDurationText(t) {
  const stop = t.reverted && t.revertedAt ? t.revertedAt : t.revertAt;
  if (!t.startAt || !stop) return '';
  const mins = Math.round((new Date(stop) - new Date(t.startAt)) / 60000);
  if (!(mins > 0)) return '';
  const d = Math.floor(mins / 1440); const h = Math.floor((mins % 1440) / 60); const m = mins % 60;
  return [d ? `${d} d` : '', h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

// The window line used under a History title: 'Tue 27 Oct 12:00–16:00 · back at Lazimpat 16:00', or the permanent date.
export function transferWindowLine(t, { use24h = false, now = new Date() } = {}) {
  const state = transferState(t, now);
  const start = toKathmanduParts(t.startAt);
  const clock = (hhmm) => formatClockTime(hhmm, use24h);
  if (!start) return '';
  if (state === 'permanent-done' || state === 'permanent-upcoming') return `On ${dayLabel(start.date)} ${clock(start.time)}`;
  const stopAt = state === 'back-early' ? t.revertedAt : t.revertAt;
  const end = toKathmanduParts(stopAt);
  const base = !end ? '' : end.date === start.date
    ? `${dayLabel(start.date)} ${clock(start.time)}–${clock(end.time)}`
    : `${dayLabel(start.date)} ${clock(start.time)} – ${dayLabel(end.date)} ${clock(end.time)}`;
  if (state === 'back-early') return `${base} (planned ${clock(toKathmanduParts(t.revertAt).time)})`;
  if (state === 'upcoming' || state === 'now') return `${base} · back at ${t.fromBranch || 'home'} ${clock(toKathmanduParts(t.revertAt).time)}`;
  return base;
}

// Profile History title: what happened and where.
export function transferTitle(t, { labels = {}, now = new Date() } = {}) {
  const word = labels.transfer || 'transfer';
  const state = transferState(t, now);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (state === 'permanent-done' || state === 'permanent-upcoming') return `Moved from ${t.fromBranch || 'another branch'} to ${t.toBranch || 'another branch'}`;
  return `Temporary ${word} to ${t.toBranch || 'another branch'}`.replace(/^./, (c) => cap(c));
}

// The calendar column / profile shapes -> { input, viewpoint } for describeTransfer, or null when the column has no transfer.
export function transferFromColumn(col) {
  if (!col) return null;
  if (col.transferredOut || col.transferredIn) {
    return {
      viewpoint: col.transferredIn ? 'receiving' : 'home',
      input: {
        fromBranch: col.transferFromBranch || col.fromBranch || null,
        toBranch: col.transferToBranch || null,
        isPermanent: false,
        startAt: col.transferStartAt || null,
        revertAt: col.plannedRevertAt || col.returnsAt || null,
        applied: true,
        reverted: !!col.transferReverted,
        revertedAt: col.transferRevertedAt || null,
      },
    };
  }
  const s = col.scheduledTransfer;
  if (s) {
    return {
      viewpoint: 'home',
      input: toTransferInput({ ...s, applied: false, reverted: false }),
    };
  }
  return null;
}
