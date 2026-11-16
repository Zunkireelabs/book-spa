// Member discount at checkout (V22): which bookings a membership tier's `discount_rules` apply to, and for how much.
// Pure — the server (apply_member_discount, migration-343) repeats the same rules and is the one that saves anything.
import { categoryLabel } from './membershipsView';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** "Body Scrub" / "body-scrub" / " Spa " → "body_scrub" / "spa". The same rule as the SQL in migration-343. */
export const categoryKey = (text) => String(text ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** The tier's % for a category key, 1–100, or null. */
// `package` rules are for vouchers (NewVoucherPanel), never a booking's service.
export function ruleRate(rules, key) {
  if (!key || key === 'package' || !rules || typeof rules !== 'object') return null;
  const v = rules[key];
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}

/** Active at Nepal `today`: money in the wallet, activated (or fully deposited) and not past its expiry. */
export function isActiveMember(m, today) {
  if (!m || !(Number(m.balance) > 0)) return false;
  if (!m.activationDate) return Number(m.totalDeposited) >= Number(m.tierAdvanceAmount || Infinity);
  return !m.expiryDate || String(m.expiryDate) >= String(today);
}

/** "Premium Club member · 45% spa" — saved as the booking's discount_reason. */
export const memberReason = (tierName, pct, key) => `${tierName} member · ${pct}% ${categoryLabel(key).toLowerCase()}`;

/**
 * What checkout should show for one booking.
 *   booking: { baseAmount, discountAmount, discountStatus, memberDiscount, amountPaid, paymentStatus, isLocked, status, serviceCategory }
 *     memberDiscount (bookings.member_discount): 'applied' = saved by apply_member_discount, 'declined' = staff chose not to
 *     apply it this visit, null = undecided (checkout applies it automatically).
 *   membership: the customer's latest membership (fetchMembershipForCustomer shape) or null
 * Returns null (show nothing) or { kind, ... }:
 *   'noRule' — active member, but the tier has no rate for this service's category
 *   'apply'  — member rate applies (no discount on the booking yet); `declined` when staff said not this visit
 *   'saved'  — a member discount is already saved on the booking
 *   'better' — the booking has another discount and the member rate saves more (replaces it, never stacks)
 */
export function memberDiscountFor({ booking, membership, today }) {
  if (!booking || !isActiveMember(membership, today)) return null;
  if (booking.isLocked || booking.paymentStatus === 'paid' || ['Cancelled', 'No Show'].includes(booking.status)) return null;
  const tierName = membership.tierName || 'Member';
  const key = categoryKey(booking.serviceCategory);
  const pct = ruleRate(membership.tierDiscountRules, key);
  const label = key ? categoryLabel(key) : 'these';
  if (pct == null) return { kind: 'noRule', tierName, label };

  const base = Number(booking.baseAmount) || 0;
  const paid = Number(booking.amountPaid) || 0;
  const full = round2((base * pct) / 100);
  const room = Math.max(0, round2(base - paid)); // final_amount may not drop below what's already been paid
  const amount = Math.min(full, room);
  const capped = amount < full;
  const out = { tierName, key, label, pct, amount, capped, paid, reason: memberReason(tierName, pct, key) };

  const current = Number(booking.discountAmount) || 0;
  // final_amount is always base − discount_amount, so any stored amount is already in the price — whatever its status.
  const hasDiscount = current > 0;
  const declined = booking.memberDiscount === 'declined';
  if (hasDiscount && booking.memberDiscount === 'applied') return { ...out, kind: 'saved', amount: current };
  if (hasDiscount) return amount > current ? { ...out, kind: 'better', current, extra: round2(amount - current), declined } : null;
  if (amount <= 0) return null;
  return { ...out, kind: 'apply', declined };
}

/**
 * The discount each booking will carry at Collect, given the staff choice (`on`), and how far that moves its amount due.
 *   saved + on  → unchanged          saved + off → removed and recorded as declined (delta = −saved)
 *   apply + on  → member amount      apply + off → recorded as declined (unless it already is)
 *   better + on → member amount replaces the other discount
 * `delta` is how much LESS the guest pays than today's saved amounts (negative when a saved discount is removed).
 */
export function effectOf(md, on) {
  if (!md || md.kind === 'noRule') return { delta: 0, memberAmount: 0, action: null };
  if (md.kind === 'saved') return on ? { delta: 0, memberAmount: md.amount, action: null } : { delta: -md.amount, memberAmount: 0, action: 'remove' };
  if (!on) return { delta: 0, memberAmount: 0, action: md.kind === 'apply' && !md.declined ? 'remove' : null };
  if (md.kind === 'apply') return { delta: md.amount, memberAmount: md.amount, action: 'apply' };
  return { delta: round2(md.amount - md.current), memberAmount: md.amount, action: 'apply' }; // better
}

/** Default choice: on for saved, and for apply unless it was declined this visit; off for better (staff opt in). */
export const defaultOn = (md) => !!md && (md.kind === 'saved' || (md.kind === 'apply' && !md.declined));
