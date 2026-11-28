import { formatClockNow } from './clockTime';
// ZNLY-402 piece 5: turn a visit_* dry-run answer ({ rows: [{booking_id, service, start, staff, verdict, reason}] }) into display rows.
// `lines` = { [booking_id]: { name, price, start, staff } } from the "This booking" block (the dry run does not carry prices).

const display = (r, lines, started) => {
  const l = lines?.[r.booking_id] || {};
  const start = formatClockNow(r.start || l.start);
  const staff = r.staff || l.staff || '';
  const sub = started ? ['Started', staff].filter(Boolean).join(' · ') : [start, staff].filter(Boolean).join(' · ');
  return { id: r.booking_id, name: r.service || l.name || 'Service', price: l.price ?? null, sub, reason: r.reason || '' };
};

/** change = will change (cancelled / no-show); keep = stays (started or paid); the reason of a kept row says why (shown under "These stay"). */
export function splitStatusPreview(data, lines) {
  const rows = data?.rows || [];
  const change = rows.filter((r) => r.verdict === 'change').map((r) => display(r, lines, false));
  // A service that is already cancelled / no-show is history, not something that "stays": left out of the list.
  const keep = rows.filter((r) => r.verdict !== 'change' && !/already (cancelled|no.?show)/i.test(r.reason || '')).map((r) => {
    const d = display(r, lines, true);
    return r.reason ? { ...d, sub: [r.reason, r.staff || lines?.[r.booking_id]?.staff].filter(Boolean).join(' · ') } : d;
  });
  return { change, keep };
}
