import { wordBranch } from './industryTerms';

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The one wording for "this person is at another place" shading (a transfer window), used by the calendar's own transfer shading
// and by the availability RPC's OTHER_BRANCH ranges so they can never disagree. A range that runs to the edge of the day it is
// drawn on never prints that edge (it would read as a midnight boundary or, for 24:00, as "12:00pm"): the middle of a multi-day
// transfer reads "At X", its first day "At X from 10:00am", its return day "At X until 10:00am". Only a window that sits inside the
// day (two visits in one day, a same-day transfer) prints both ends.
// `edges` = the day's own limits: the calendar's open/close for its clipped segments, 0..1440 for the RPC's whole-day ranges.
export function awayLabel(place, startMin, endMin, { openMin = 0, closeMin = 1440, fmt = (t) => t } = {}) {
  const where = `At ${place || `another ${wordBranch()}`}`;
  const toEdge = endMin >= closeMin;
  const fromEdge = startMin <= openMin;
  if (toEdge && fromEdge) return where;
  if (toEdge) return `${where} from ${fmt(hm(startMin))}`;
  if (fromEdge) return `${where} until ${fmt(hm(endMin))}`;
  return `${where} ${fmt(hm(startMin))}–${fmt(hm(endMin))}`;
}
