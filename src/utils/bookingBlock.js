// ZNLY-402 piece 4 / ZNLY-435: the numbers behind the "This booking" card (every booking, every org: a 1-service booking is a card with 1 row).
// Pure. One source for the count, the total and the paid state, so what the block says always equals the rows it shows (U4).
// Input rows = raw `bookings` rows of ONE visit (fetchBookingServices); output rows are display-ready.

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(num(n) * 100) / 100;
const DEAD = ['cancelled', 'no show'];

/** Minutes between two "HH:MM[:SS]" strings, or 0. */
const minutesBetween = (a, b) => {
  if (!a || !b) return 0;
  const [ah, am] = String(a).split(':').map(Number);
  const [bh, bm] = String(b).split(':').map(Number);
  const d = (bh * 60 + (bm || 0)) - (ah * 60 + (am || 0));
  return Number.isFinite(d) && d > 0 ? d : 0;
};

/** Raw DB row -> display row. Money is final_amount (what the booking already uses), paid = payments minus refunds. */
export function toBlockRow(r) {
  const paid = r2((r.payments || []).reduce((s, p) => s + num(p.amount), 0) - (r.payment_refunds || []).reduce((s, p) => s + num(p.amount), 0));
  const status = String(r.status || '').toLowerCase();
  // Everyone assigned: the junction rows first, then the row's own therapist (deduped by id).
  const people = [];
  [...(r.booking_therapists || []).map((bt) => ({ id: bt.therapist_id, name: bt.therapist?.name })), { id: r.therapist_id, name: r.therapist?.name }].forEach((t) => {
    if (t.id && !people.some((x) => x.id === t.id)) people.push({ id: t.id, name: t.name || '' });
  });
  const staff = people.map((t) => t.name).filter(Boolean);
  return {
    id: r.id,
    number: r.booking_number || '',
    status,
    dead: DEAD.includes(status),
    paymentStatus: r.payment_status || 'unpaid',
    date: r.date || null,
    start: r.start_time ? String(r.start_time).slice(0, 5) : null,
    end: r.end_time ? String(r.end_time).slice(0, 5) : null,
    name: r.service?.name || r.service_name_snapshot || 'Service',
    baseMinutes: num(r.service?.duration_minutes) || null, // the service's own length (ZNLY-407)
    minutes: minutesBetween(r.start_time, r.end_time) || num(r.service?.duration_minutes), // ZNLY-407: the booking's real length (a made-longer booking is longer than its service)
    staff,
    staffPeople: people,
    staffIds: people.map((t) => t.id),
    serviceId: r.service_id || null,
    isCouple: !!r.service?.is_couple,
    roomId: r.room_id || null,
    room: r.room?.name || null,
    base: r2(r.base_amount),
    discount: r2(r.discount_amount),
    final: r2(r.final_amount),
    paid,
  };
}

/**
 * rows (raw) + the open booking's id -> the block.
 *   show  : true when the booking has a row (a cancelled row still counts as a row: it is shown struck through, S7)
 *   live  : the rows that count (not cancelled / no show); count = live.length; total = sum of their final amounts
 *   paid / toPay : over the live rows only; toPay never negative.
 */
export function buildBookingBlock(rawRows, openId) {
  const rows = (rawRows || []).map(toBlockRow).sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.number.localeCompare(b.number));
  const live = rows.filter((r) => !r.dead);
  const total = r2(live.reduce((s, r) => s + r.final, 0));
  const paid = r2(live.reduce((s, r) => s + r.paid, 0));
  const discount = r2(live.reduce((s, r) => s + r.discount, 0));
  // A service still Pending (waiting for confirmation) is never bundled into a payment: to pay = the payable lines only.
  const payable = live.filter((r) => r.status !== 'pending');
  const waiting = live.length - payable.length;
  const payableToPay = r2(payable.reduce((s, r) => s + Math.max(r.final - r.paid, 0), 0));
  return {
    show: rows.length >= 1,
    rows,
    live,
    count: live.length,
    total,
    base: r2(live.reduce((s, r) => s + r.base, 0)),
    discount,
    paid,
    toPay: waiting > 0 ? payableToPay : Math.max(r2(total - paid), 0),
    waiting,
    openId,
    // The one reference number of the booking = the first service's number (U5).
    reference: (live[0] || rows[0])?.number || '',
    allPaid: live.length > 0 && live.every((r) => r.paymentStatus === 'paid' || r.paid >= r.final),
  };
}
