// ZNLY-271: pure rules for what a calendar booking card shows. No React, no DOM: unit-tested.
import { isNoShow } from './bookingTransformers';

// Fixed display order. Each can be switched off per device (Calendar Views → Icons).
export const CARD_ICONS = [
  { key: 'pay', label: 'Payment', desc: 'Filled = paid · half = partly paid · outline = unpaid' },
  { key: 'note', label: 'Booking note', desc: 'A special request on this booking' },
  { key: 'alert', label: 'Customer alert', desc: 'A note on the customer record (allergy, caution)' },
  { key: 'first', label: 'First visit', desc: "The customer's first booking" },
  { key: 'online', label: 'Booked online', desc: 'Made by the customer on the booking page' },
  { key: 'pkg', label: 'Package / voucher', desc: 'Paid from a package, membership or voucher' },
  { key: 'group', label: 'Group', desc: 'Shared booking, with the number of people' },
  { key: 'lock', label: 'Locked', desc: "This booking can't be moved (paid, in progress, started, day closed)" },
];

// Payment modes that mean "this visit was paid from a package / membership / voucher".
export const CREDIT_PAYMENT_MODES = ['SessionPackage', 'Membership', 'VoucherWallet'];

// Card height tiers (px; 72px per hour at default zoom → 15 min = 18px, 30 min = 36px, 45 min = 54px).
export const TINY_BELOW = 30;   // one line: time · name · payment/alert
export const SHORT_BELOW = 46;  // two lines: time+name (+icons) / service
export const OWN_NAME_LINE_FROM = TINY_BELOW; // any two-line card: the name outranks the service, which is dropped if needed

export function cardTier(height) {
  if (!(height > 0)) return 'full';
  if (height < TINY_BELOW) return 'tiny';
  if (height < SHORT_BELOW) return 'short';
  return 'full';
}

// The name may drop to its own line only when the card has a row to spare. The height never grows.
export function canNameHaveOwnLine(height) {
  return height >= OWN_NAME_LINE_FROM;
}

// True when time + name can't share line 1 AND there is room to move the name down.
export function shouldMoveNameDown({ height, timeWidth, nameWidth, lineWidth, gap = 4 }) {
  if (!canNameHaveOwnLine(height)) return false;
  return timeWidth + gap + nameWidth > lineWidth;
}

// 'paid' | 'partial' | 'unpaid' | null (null = show nothing).
export function paymentState(booking) {
  const cancelled = isNoShow(booking) || booking.status === 'Cancelled';
  const paid = Number(booking.amountPaid || 0) > 0;
  const raw = booking.paymentStatus;
  const state = raw === 'paid' ? 'paid' : raw === 'partial' ? 'partial' : 'unpaid';
  // A cancelled / no-show booking is not "unpaid": hide the tag unless money was taken.
  if (cancelled && state === 'unpaid' && !paid) return null;
  return state;
}

export function paidWithCredit(booking) {
  return Array.isArray(booking.payments) && booking.payments.some(p => CREDIT_PAYMENT_MODES.includes(p.paymentMode) && Number(p.amount || 0) >= 0);
}

// Every icon that applies to this booking, in fixed order, filtered by the device's on/off prefs.
// Returns [{ key, state? , count? }]
export function iconsForBooking(booking, enabled = {}) {
  const on = (k) => enabled[k] !== false;
  const out = [];
  const pay = paymentState(booking);
  if (on('pay') && pay) out.push({ key: 'pay', state: pay });
  if (on('note') && booking.specialRequests) out.push({ key: 'note' });
  if (on('alert') && booking.customerNotes) out.push({ key: 'alert' });
  if (on('first') && booking.isNewCustomer) out.push({ key: 'first' });
  if (on('online') && booking.isOnline) out.push({ key: 'online' });
  if (on('pkg') && paidWithCredit(booking)) out.push({ key: 'pkg' });
  if (on('group') && booking.sharedCount > 0) out.push({ key: 'group', count: booking.sharedCount });
  return out;
}

// Short / tiny cards only have room for payment + alert; the rest collapse into "+N".
export function splitForShortCard(icons) {
  const shown = icons.filter(i => i.key === 'pay' || i.key === 'alert');
  return { shown, more: icons.length - shown.length };
}

// "· No-show" / "· Cancelled" tag that follows the time, or null.
export function statusTag(booking) {
  if (isNoShow(booking)) return 'No-show';
  if (booking.status === 'Cancelled') return 'Cancelled';
  return null;
}

// Why a card can't be moved, or null. Same rule as canDragBooking (paid / finished / in progress / already started / day closed),
// first match wins. `nowNepal` is a Date in Nepal wall-clock time, injected so it's testable.
const FINISHED_LABEL = { Completed: 'completed', Cancelled: 'cancelled', 'No Show': 'no-show' };
export function lockReason(booking, nowNepal) {
  if (booking.paymentStatus === 'paid') return 'Locked: paid';
  if (FINISHED_LABEL[booking.status]) return `Locked: ${FINISHED_LABEL[booking.status]}`;
  if (booking.status === 'In-Progress') return 'Locked: in progress';
  if (booking.status !== 'Pending' && booking.date && booking.startTime && nowNepal >= new Date(`${booking.date}T${booking.startTime}`)) return 'Locked: already started';
  if (booking.isLocked) return 'Locked: day closed';
  return null;
}

// One-line (15-min) cards: which right-hand items fit. Never a partly clipped item. The name keeps at least `minName` px
// (or its natural width if shorter). Dropped lowest priority first: +N, alert, payment, lock.
// items: [{ key, width }] in display order. Returns the set of visible keys.
export const TINY_PRIORITY = ['lock', 'pay', 'alert', 'more'];
export function fitTinyItems({ lineWidth, fixedWidth, nameWidth, items, minName = 60, gap = 5 }) {
  let room = lineWidth - fixedWidth - Math.min(nameWidth, minName) - gap;
  const visible = new Set();
  for (const key of TINY_PRIORITY) {
    const it = items.find(i => i.key === key);
    if (!it) continue;
    const need = it.width + gap;
    if (need <= room) { visible.add(key); room -= need; } else break; // lower priorities can't show if a higher one doesn't
  }
  return visible;
}

// Full-size cards (>= 46px): which lines fit, so a line is either shown whole or not at all and none overlaps another.
// Claim order: time(+name) > status words / first service line > room > icons row > extra wrapped service lines.
export const LINE_PX = { pad: 6, time: 17, name: 17, service: 15.6, room: 14, icons: 17 };
export function planFullCard({ height, nameDown, hasLead, serviceLines, hasRoom, hasIcons }) {
  let rem = height - LINE_PX.pad - LINE_PX.time - (nameDown ? LINE_PX.name : 0);
  const plan = { serviceLines: 0, showRoom: false, showIcons: false };
  if (hasLead && rem >= LINE_PX.service) { plan.serviceLines = 1; rem -= LINE_PX.service; }
  if (hasLead && plan.serviceLines === 0) return plan; // no room even for the lead line: nothing below it either
  if (hasRoom && rem >= LINE_PX.room) { plan.showRoom = true; rem -= LINE_PX.room; }
  if (hasIcons && rem >= LINE_PX.icons) { plan.showIcons = true; rem -= LINE_PX.icons; }
  while (plan.serviceLines < serviceLines && rem >= LINE_PX.service) { plan.serviceLines += 1; rem -= LINE_PX.service; }
  return plan;
}
