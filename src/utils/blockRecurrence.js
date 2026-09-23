// Pure recurrence-expansion helper for manual_blocks (supabase/migration-212). Recurrence
// is computed on-the-fly at read time rather than materialized — matches this codebase's
// existing staff-transfer-window pattern (therapistBranchWindow.js), and the calendar only
// ever needs occurrences within its own bounded visible date range.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// nth (0-based) occurrence date for a recurrence rule anchored at `anchorDateStr`. Monthly
// clamps to the last valid day of the target month (matches AttendancePanel.jsx's
// computeRevertPreview — Jan 31 + 1 month is Feb 28, not an overflow into March).
function occurrenceDateStr(anchorDateStr, freq, interval, n) {
  if (n === 0) return anchorDateStr;
  const [y, m, d] = anchorDateStr.split('-').map(Number);

  if (freq === 'daily') {
    return toDateStr(new Date(y, m - 1, d + interval * n));
  }
  if (freq === 'weekly') {
    return toDateStr(new Date(y, m - 1, d + interval * n * 7));
  }
  if (freq === 'monthly') {
    const totalMonths = (m - 1) + interval * n;
    const targetYear = y + Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(d, lastDayOfTargetMonth);
    return toDateStr(new Date(targetYear, targetMonth, clampedDay));
  }
  throw new Error(`Unknown recurrence freq: ${freq}`);
}

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.slice(0, 5).split(':').map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

const MAX_OCCURRENCES = 5000; // safety bound against pathological loops, not a real limit

// block: { blockDate, startTime, durationMinutes, recurrenceFreq, recurrenceInterval,
//          recurrenceEndDate, recurrenceCount, isCancelled }
// exceptionDates: array/Set of 'YYYY-MM-DD' strings (this occurrence cancelled)
// rangeStart/rangeEnd: 'YYYY-MM-DD', inclusive
// Returns [{ date, startTime, endTime }], sorted ascending.
export function expandBlockOccurrences(block, exceptionDates, rangeStart, rangeEnd) {
  if (!block || block.isCancelled) return [];

  const exceptions = exceptionDates instanceof Set ? exceptionDates : new Set(exceptionDates || []);
  const startTime = (block.startTime || '00:00').slice(0, 5);
  const endTime = addMinutes(startTime, block.durationMinutes || 0);

  if (!block.recurrenceFreq) {
    if (block.blockDate < rangeStart || block.blockDate > rangeEnd) return [];
    if (exceptions.has(block.blockDate)) return [];
    return [{ date: block.blockDate, startTime, endTime }];
  }

  const interval = block.recurrenceInterval || 1;
  const occurrences = [];
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    if (block.recurrenceCount != null && n >= block.recurrenceCount) break;

    const date = occurrenceDateStr(block.blockDate, block.recurrenceFreq, interval, n);

    if (block.recurrenceEndDate && date > block.recurrenceEndDate) break;
    if (date > rangeEnd) break;

    if (date >= rangeStart && !exceptions.has(date)) {
      occurrences.push({ date, startTime, endTime });
    }
  }
  return occurrences;
}
