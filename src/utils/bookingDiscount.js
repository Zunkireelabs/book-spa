// ZNLY-402 piece 4 (v3): the whole-rupee discount plan for a booking with several services. Pure.
// ONE discount for the whole booking, or one per service ("per line"). Everything is WHOLE RUPEES: each line is rounded, and any rounding
// remainder goes on the LAST line, so the lines always add up to the total shown. `limitPercent` is what the role limit is checked against
// (the % the person typed, or the total's %, or the line's own %): never a percent distorted by rounding a few rupees.

const whole = (n) => Math.round(Number(n) || 0);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * rows: [{ id, base }] in the order shown. type: 'percentage' | 'fixed'. value: the whole-booking value (ignored when perLine is set).
 * perLine: null (one discount for all) | { [id]: value } (each line its own, same type).
 * -> { lines: [{ id, base, amount, limitPercent }], total, totalBase, maxPercent }
 */
export function planBookingDiscount({ rows, type, value, perLine = null }) {
  const list = (rows || []).map((r) => ({ id: r.id, base: whole(r.base) }));
  const totalBase = list.reduce((s, r) => s + r.base, 0);
  let lines;
  if (perLine) {
    lines = list.map((r) => {
      const v = Number(perLine[r.id]) || 0;
      const amount = clamp(type === 'percentage' ? whole(r.base * v / 100) : whole(v), 0, r.base);
      return { id: r.id, base: r.base, amount, limitPercent: type === 'percentage' ? v : (r.base > 0 ? (amount / r.base) * 100 : 0) };
    });
  } else {
    const v = Number(value) || 0;
    const target = type === 'percentage' ? whole(totalBase * v / 100) : clamp(whole(v), 0, totalBase);
    const limitPercent = type === 'percentage' ? v : (totalBase > 0 ? (target / totalBase) * 100 : 0);
    let used = 0;
    lines = list.map((r, i) => {
      const isLast = i === list.length - 1;
      let amount = isLast ? target - used : (type === 'percentage' ? whole(r.base * v / 100) : whole(target * r.base / (totalBase || 1)));
      amount = clamp(amount, 0, r.base);
      used += amount;
      return { id: r.id, base: r.base, amount, limitPercent };
    });
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const maxPercent = lines.reduce((m, l) => (l.amount > 0 ? Math.max(m, l.limitPercent) : m), 0);
  return { lines, total, totalBase, maxPercent };
}
