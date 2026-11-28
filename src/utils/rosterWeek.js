// Roster helpers: the week that opens on a given day, and how one cell reads.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 7 consecutive 'YYYY-MM-DD' dates starting at `startIso` (+ `weekOffset` weeks). The roster opens on today, not on Monday.
export function weekDates(startIso, weekOffset = 0) {
  const [y, m, d] = startIso.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => iso(new Date(y, m - 1, d + weekOffset * 7 + i)));
}

// closed: a whole-location block that day. changed: that date has its own hours. off: not working.
export function cellKind({ closed, override, usual }) {
  if (closed) return { kind: 'closed', changed: false };
  const eff = override || usual;
  return { kind: !eff || eff.isDayOff ? 'off' : 'usual', changed: !!override };
}
