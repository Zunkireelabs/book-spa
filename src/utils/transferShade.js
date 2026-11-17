// The part of a calendar column that is "not here" because of a transfer, as minute ranges of `day` (Nepal time).
// Needed because once a transfer APPLIES, the person's branch_id moves and the availability RPC (V29c) no longer reports an
// OTHER_BRANCH range for the branch they left: the column would look bookable. Before it applies, the RPC does shade it, so
// callers drop any range an RPC 'branch' segment already covers (never two layers).
//   transferredOut  -> away during the window  (label "At <to-branch> <range>")
//   transferredIn   -> visiting: not here before arriving (whole day) or after leaving the visit window that day
//                      (label "At <home-branch> <range>"); after the visit has ended nothing is shaded
import { toKathmanduParts } from '../pages/branch-manager-dashboard/components/calendar/calendarDates';
import { wordBranch } from './industryTerms';

const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export function transferShadeSegments(col, day, { openMin, closeMin, fmt = (t) => t }) {
  if (!col || (!col.transferredOut && !col.transferredIn)) return [];
  const start = toKathmanduParts(col.transferStartAt);
  const end = toKathmanduParts(col.returnsAt);
  const clip = (a, b, place) => {
    const startMin = Math.max(a, openMin); const endMin = Math.min(b, closeMin);
    if (endMin <= startMin) return [];
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    // never print the day's edge (it would read as a midnight boundary): "from 3:30pm" / "until 12:00pm" / just the place
    const where = `At ${place || `another ${wordBranch()}`}`;
    const toEdge = endMin >= closeMin; const fromEdge = startMin <= openMin;
    const label = toEdge && fromEdge ? where : toEdge ? `${where} from ${fmt(hm(startMin))}` : fromEdge ? `${where} until ${fmt(hm(endMin))}` : `${where} ${fmt(hm(startMin))}–${fmt(hm(endMin))}`;
    return [{ startMin, endMin, label }];
  };
  if (col.transferredOut) {
    const place = col.transferToBranch;
    if (!end) return clip(openMin, closeMin, place);                       // no return time: away all day
    if ((start && day < start.date) || day > end.date) return [];
    return clip(start && day === start.date ? toMin(start.time) : openMin, day === end.date ? toMin(end.time) : closeMin, place);
  }
  const place = col.transferFromBranch || col.fromBranch;
  if (col.visitWindows?.length > 1) {
    // Two or more visits: shade whatever is outside the UNION of the visit windows that day (the gap between visits included).
    const wins = col.visitWindows.map((w) => [toKathmanduParts(w.startAt), toKathmanduParts(w.endAt)])
      .filter(([a, b]) => a && b && a.date <= day && b.date >= day)
      .map(([a, b]) => [a.date < day ? 0 : toMin(a.time), b.date > day ? 1440 : toMin(b.time)])
      .sort((x, y) => x[0] - y[0]);
    if (col.visitWindows.every((w) => (toKathmanduParts(w.endAt)?.date ?? '9') < day)) return []; // every visit is over
    const out = [];
    let cursor = 0;
    for (const [a, b] of wins) {
      if (a > cursor) out.push(...clip(cursor, a, place));
      cursor = Math.max(cursor, b);
    }
    if (cursor < 1440) out.push(...clip(cursor, 1440, place));
    return out;
  }
  if (!end) return [];
  if (start && day < start.date) return clip(openMin, closeMin, place);   // before the visit starts
  if (day > end.date) return [];                                          // visit over
  const out = [];
  if (start && day === start.date) out.push(...clip(openMin, toMin(start.time), place));
  if (day === end.date) out.push(...clip(toMin(end.time), closeMin, place));
  return out;
}

// Drop transfer ranges an existing 'branch' segment already shades.
export function dedupeAgainst(segments, branchSegs) {
  return segments.filter((s) => !branchSegs.some((b) => b.startMin < s.endMin && s.startMin < b.endMin));
}
