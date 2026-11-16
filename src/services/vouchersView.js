// Vouchers page (V23): pure logic for the Vouchers / Voucher types / Activity tabs — status, the lifecycle strip, the lead
// sentence, Needs-you-now, sorting, search, reminders and the activity feed. No React, no Supabase: `today` is a Nepal
// 'YYYY-MM-DD' passed in by the caller. Rows are fetchVouchers() rows. Since migration-344 `totalAmountIssued` is the voucher's
// VALUE (what the holder can spend) and `amountPaid` what was collected; a coupon (`percentOff`) is worth 0 and is "X% off one
// visit", used once (`couponUsed`).
import { daysUntil, shortName, npr } from './packagesView';

export { daysUntil, shortName, npr };

export const EXPIRING_DAYS = 30;
export const REMIND_DAYS = 14;
export const REMIND_AGAIN_DAYS = 7;
export const RECENT_EXPIRED_DAYS = 30;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (iso) => String(iso).slice(0, 10).split('-').map(Number);
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = ymd(s); const t = new Date(Date.UTC(y, m - 1, d + n)); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const addMonths = (s, n) => {
  const [y, m, d] = ymd(s);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(d, last));
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const TZ = 'Asia/Kathmandu';
/** Nepal calendar date of a timestamp. */
export const nepalDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

// ── One voucher ─────────────────────────────────────────────────────────────────────────────────
export const isCoupon = (v) => v.percentOff != null && v.percentOff !== '';
export const remainingOf = (v) => Math.max(0, Number(v.remainingBalance) || 0);
export const valueOf = (v) => Number(v.totalAmountIssued) || 0;
export const isExpired = (v, today) => !!v.expiryDate && daysUntil(v.expiryDate, today) < 0;
/** Still has something to use: value left, or an unused coupon. */
export const hasUse = (v) => (isCoupon(v) ? !v.couponUsed : remainingOf(v) > 0);
/** Can be used today: not expired, not waiting for a check, and something left. */
export const isReady = (v, today) => !isExpired(v, today) && !v.needsCheck && hasUse(v);
const isSoon = (v, today) => { const d = daysUntil(v.expiryDate, today); return d != null && d >= 0 && d <= EXPIRING_DAYS; };

export const STATUS = {
  check: { label: 'Needs a check', dot: '#6366F1', pill: 'bg-[#EEF2FF] text-[#4338CA]' },
  soon: { label: 'Expiring soon', dot: '#F59E0B', pill: 'bg-[#FEF3C7] text-[#92400E]' },
  part: { label: 'Part used', dot: '#E7B93E', pill: 'bg-[#FBF3DF] text-[#9A6B0B]' },
  unused: { label: 'Not used yet', dot: '#3E7A35', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
  expired: { label: 'Expired', dot: '#DC2626', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  usedUp: { label: 'Used up', dot: '#9CA3AF', pill: 'bg-[#F3F4F6] text-[#4B5563]' },
  used: { label: 'Used', dot: '#9CA3AF', pill: 'bg-[#F3F4F6] text-[#4B5563]' },
};
/** One status per voucher, in priority order (valid through the expiry date). */
export function statusOf(v, today) {
  if (v.needsCheck) return 'check';
  if (isCoupon(v)) {
    if (v.couponUsed) return 'used';
    if (isExpired(v, today)) return 'expired';
    return isSoon(v, today) ? 'soon' : 'unused';
  }
  if (remainingOf(v) <= 0) return 'usedUp';
  if (isExpired(v, today)) return 'expired';
  if (isSoon(v, today)) return 'soon';
  return Number(v.totalClaimed) > 0 ? 'part' : 'unused';
}
export const isEnded = (s) => s === 'usedUp' || s === 'used' || s === 'expired';

// ── Lifecycle strip ─────────────────────────────────────────────────────────────────────────────
// Expiring = ready and within 30 days; Expired unused = past expiry with something left.
const expiredUnused = (v, today) => isExpired(v, today) && !v.needsCheck && hasUse(v);
export const SEGMENTS = [
  { id: 'ready', label: 'Ready to use', color: '#3E7A35', test: isReady, hint: 'Valid today, value left' },
  { id: 'expiring', label: `Expiring in ${EXPIRING_DAYS} days`, color: '#F59E0B', test: (v, t) => isReady(v, t) && isSoon(v, t), hint: 'Remind them to book' },
  { id: 'check', label: 'Needs a check', color: '#6366F1', test: (v) => !!v.needsCheck, hint: 'Free, from before the update' },
  { id: 'expired', label: 'Expired unused', color: '#DC2626', test: expiredUnused, hint: 'Can be extended by an admin' },
  { id: 'usedUp', label: 'Used up', color: '#9CA3AF', test: (v, t) => { const s = statusOf(v, t); return s === 'usedUp' || s === 'used'; }, hint: 'Fully redeemed' },
];
export const segmentById = (id) => SEGMENTS.find((s) => s.id === id) || null;
/** Strip segments to show: "Needs a check" only while there is something to check. */
export const visibleSegments = (vouchers) => SEGMENTS.filter((s) => s.id !== 'check' || vouchers.some((v) => v.needsCheck));

const valueAndCoupons = (list) => {
  const coupons = list.filter(isCoupon).length;
  const owed = sum(list.filter((v) => !isCoupon(v)), remainingOf);
  if (!owed && !coupons) return '';
  if (!coupons) return npr(owed);
  return owed ? `${npr(owed)} + ${plural(coupons, 'coupon')}` : plural(coupons, 'coupon');
};
export function stripStats(vouchers, today) {
  const by = Object.fromEntries(SEGMENTS.map((s) => [s.id, vouchers.filter((v) => s.test(v, today))]));
  return {
    ready: { count: by.ready.length, sub: valueAndCoupons(by.ready) },
    expiring: { count: by.expiring.length, sub: valueAndCoupons(by.expiring) },
    check: { count: by.check.length, sub: '' },
    expired: { count: by.expired.length, sub: valueAndCoupons(by.expired) },
    usedUp: { count: by.usedUp.length, sub: '' },
  };
}

// ── Lead ────────────────────────────────────────────────────────────────────────────────────────
const inMonth = (date, today) => String(date || '').slice(0, 7) === String(today).slice(0, 7);
/** This Nepal month: { sold: money collected on sold vouchers, free: value of vouchers given free }. */
export function monthTotals(vouchers, today) {
  const month = vouchers.filter((v) => inMonth(v.issuedDate, today));
  return {
    sold: sum(month.filter((v) => v.issueKind !== 'free'), (v) => Number(v.amountPaid) || 0),
    free: sum(month.filter((v) => v.issueKind === 'free'), valueOf),
  };
}
/** "NPR X still owed to guests on N vouchers and M coupons · this month NPR Y sold, NPR Z given free" (0 parts dropped). */
export function leadParts(vouchers, today) {
  const ready = vouchers.filter((v) => isReady(v, today));
  const value = ready.filter((v) => !isCoupon(v));
  const coupons = ready.length - value.length;
  const owed = sum(value, remainingOf);
  const { sold, free } = monthTotals(vouchers, today);
  const out = [];
  if (owed > 0 || coupons > 0) {
    const on = [value.length ? plural(value.length, 'voucher') : null, coupons ? plural(coupons, 'coupon') : null].filter(Boolean).join(' and ');
    if (owed > 0) out.push({ strong: npr(owed) }, { text: ` still owed to guests on ${on}` });
    else out.push({ text: `${on[0].toUpperCase()}${on.slice(1)} ready to use` });
  }
  const month = [sold > 0 ? [{ strong: npr(sold) }, { text: ' sold' }] : null, free > 0 ? [{ strong: npr(free) }, { text: ' given free' }] : null].filter(Boolean);
  if (month.length) {
    out.push({ text: out.length ? ' · this month ' : 'This month ' });
    month.forEach((p, i) => { if (i) out.push({ text: ', ' }); out.push(...p); });
  }
  if (!out.length) out.push({ text: 'No vouchers to look after right now.' });
  return out;
}

// ── Reminders ───────────────────────────────────────────────────────────────────────────────────
const digits = (s) => String(s || '').replace(/\D/g, '');
const phoneish = (s) => (digits(s).length >= 10 ? s : null);
/** Phone to message: the linked customer's, else the stored one (≥ 10 digits), else null. */
export const forPhone = (v) => phoneish(v.customerPhone) || phoneish(v.guestInfo);
export const buyerPhoneOf = (v) => phoneish(v.buyerCustomerPhone) || phoneish(v.buyerPhone);
export const hasBuyer = (v) => !!(v.buyerName || v.buyerCustomerId);
/** Days since the last reminder (Nepal dates), or null when never reminded. */
export const daysSinceReminded = (v, today) => (v.lastRemindedAt ? -daysUntil(nepalDate(v.lastRemindedAt), today) : null);
export const remindedRecently = (v, today) => { const d = daysSinceReminded(v, today); return d != null && d < REMIND_AGAIN_DAYS; };
/** "reminded today" / "reminded Sat" within the last 7 days, else ''. */
export function remindedHint(v, today) {
  if (!remindedRecently(v, today)) return '';
  const day = nepalDate(v.lastRemindedAt);
  if (day === today) return 'reminded today';
  const [y, m, d] = ymd(day);
  return `reminded ${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
/** "NPR 1,900 left" / "25% off one visit" */
export const whatsLeft = (v) => (isCoupon(v) ? `${Number(v.percentOff)}% off one visit` : `${npr(remainingOf(v))} left`);
/** One WhatsApp text for both people; `to` = 'for' | 'buyer'. */
export function reminderText(v, { to = 'for', orgName, bookUrl }) {
  const org = orgName || 'our business';
  const tail = `has ${whatsLeft(v)} and is valid until ${longDate(v.expiryDate)}.${bookUrl ? ` Book here: ${bookUrl}` : ''}`;
  if (to === 'buyer') return `Hi ${firstName(v.buyerName)}, the ${org} voucher you gave ${v.guestName} (${v.voucherCode}) ${tail}`;
  return `Hi ${firstName(v.guestName)}, your ${org} voucher ${v.voucherCode} ${tail}`;
}
/** "28 Oct 2026" */
export const longDate = (s) => { if (!s) return '—'; const [y, m, d] = ymd(s); return `${d} ${MON[m - 1]} ${y}`; };
const dayMon = (s) => { const [, m, d] = ymd(s); return `${d} ${MON[m - 1]}`; };

// ── Needs you now ───────────────────────────────────────────────────────────────────────────────
const needsReminding = (v, today) => {
  const d = daysUntil(v.expiryDate, today);
  return !v.needsCheck && hasUse(v) && d != null && d >= 0 && d <= REMIND_DAYS && !remindedRecently(v, today);
};
const recentlyExpired = (v, today) => {
  const d = daysUntil(v.expiryDate, today);
  return !v.needsCheck && hasUse(v) && d != null && d < 0 && d >= -RECENT_EXPIRED_DAYS;
};
// One voucher: "NPR 2,400" or "25% off". Several: the money left, plus how many unused coupons are among them.
const leftOne = (v) => (isCoupon(v) ? `${Number(v.percentOff)}% off` : npr(remainingOf(v)));
const leftMany = (list) => {
  const coupons = list.filter(isCoupon).length;
  const money = list.length > coupons ? npr(sum(list, remainingOf)) : null;
  return [money, coupons ? plural(coupons, 'coupon') : null].filter(Boolean).join(' + ');
};
/** Not a strip segment: filters reached from Needs you now (and the "Matches a customer" chip). */
export const NEED_FILTERS = {
  remind: { label: `Expiring in ${REMIND_DAYS} days, not reminded`, test: needsReminding },
  extend: { label: `Expired in the last ${RECENT_EXPIRED_DAYS} days`, test: recentlyExpired },
};
const who = (v) => shortName(v.guestName);
/**
 * Up to 3 items in priority order; `voucher` is set when exactly one voucher is involved. `matches` is a Map voucherId → customer.
 * The Extend item is for admins only.
 */
export function needsItems(vouchers, today, { isAdmin = false, matches = new Map() } = {}) {
  const items = [];
  const check = vouchers.filter((v) => v.needsCheck);
  if (check.length) {
    items.push({ id: 'check', dot: '#6366F1', action: 'Check', text: `${plural(check.length, 'free voucher')} from before the update` });
  }
  const remind = vouchers.filter((v) => needsReminding(v, today));
  if (remind.length) {
    const one = remind.length === 1 ? remind[0] : null;
    const d = one ? daysUntil(one.expiryDate, today) : 0;
    items.push({
      id: 'remind', dot: '#F59E0B', action: 'Remind', voucher: one,
      text: one ? `${who(one)} · ${leftOne(one)} · ${d === 0 ? 'ends today' : `${plural(d, 'day')} left`}` : `${remind.length} expire within ${REMIND_DAYS} days · ${leftMany(remind)}`,
    });
  }
  if (isAdmin) {
    const lapsed = vouchers.filter((v) => recentlyExpired(v, today));
    if (lapsed.length) {
      const one = lapsed.length === 1 ? lapsed[0] : null;
      items.push({
        id: 'extend', dot: '#DC2626', action: 'Extend', voucher: one,
        text: one ? `${who(one)} · ${leftOne(one)} expired ${dayMon(one.expiryDate)}` : `${lapsed.length} expired in the last ${RECENT_EXPIRED_DAYS} days · ${leftMany(lapsed)}`,
      });
    }
  }
  const matched = vouchers.filter((v) => matches.has(v.id));
  if (matched.length) {
    const one = matched.length === 1 ? matched[0] : null;
    items.push({
      id: 'match', dot: '#4F46E5', action: 'Link', voucher: one,
      text: one ? `${who(one)}'s phone matches ${matches.get(one.id).customerName}` : `${matched.length} vouchers match a customer`,
    });
  }
  return items.slice(0, 3);
}

// ── Sort and search ─────────────────────────────────────────────────────────────────────────────
export const SORTS = {
  attention: { label: 'Needs attention' },
  latest: { label: 'Latest given' },
  expiring: { label: 'Expiring first' },
  value: { label: 'Highest value left' },
  name: { label: 'Guest A–Z' },
};
// Needs attention: expiring soon (soonest first), needs a check, expired in the last 30 days, part used / not used yet by
// expiry, older expired, used.
const attentionRank = (v, today) => {
  const s = statusOf(v, today);
  if (s === 'soon') return 0;
  if (s === 'check') return 1;
  if (s === 'expired') return daysUntil(v.expiryDate, today) >= -RECENT_EXPIRED_DAYS ? 2 : 4;
  if (s === 'part' || s === 'unused') return 3;
  return 5;
};
export function sortVouchers(list, key, today) {
  const exp = (v) => (v.expiryDate ? daysUntil(v.expiryDate, today) : Infinity);
  const byName = (a, b) => String(a.guestName || '').localeCompare(String(b.guestName || ''), undefined, { sensitivity: 'base' });
  const ended = (v) => (isEnded(statusOf(v, today)) ? 1 : 0);
  const cmp = {
    attention: (a, b) => {
      const ra = attentionRank(a, today);
      const rb = attentionRank(b, today);
      if (ra !== rb) return ra - rb;
      // Expired groups: most recently expired first.
      return (ra === 2 || ra === 4 ? exp(b) - exp(a) : exp(a) - exp(b)) || byName(a, b);
    },
    latest: (a, b) => String(b.issuedDate || '').localeCompare(String(a.issuedDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || byName(a, b),
    expiring: (a, b) => ended(a) - ended(b) || exp(a) - exp(b) || byName(a, b),
    value: (a, b) => remainingOf(b) - remainingOf(a) || byName(a, b),
    name: byName,
  }[SORTS[key] ? key : 'attention'];
  return [...list].sort(cmp);
}

/** Codes compare without case, spaces, dashes or brackets ("ntwv5k43260031" finds "NTWV(5K) 4326-0031"). */
export const normCode = (s) => String(s || '').toLowerCase().replace(/[\s\-()[\]{}]/g, '');
/** Code, names (For and Bought by), phone digits (+977-tolerant) or type name. */
export function matchesVoucherSearch(v, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const nq = normCode(q);
  if (nq && normCode(v.voucherCode).includes(nq)) return true;
  if ([v.guestName, v.buyerName, v.customerName, v.voucherTypeName].filter(Boolean).join(' ').toLowerCase().includes(q)) return true;
  const qd = digits(q).replace(/^977/, '');
  return qd.length >= 3 && [v.guestInfo, v.buyerPhone, v.customerPhone, v.buyerCustomerPhone].some((p) => digits(p).includes(qd));
}

// ── Detail panel ────────────────────────────────────────────────────────────────────────────────
export const FREE_REASONS = [
  { id: 'promotion', label: 'Promotion' },
  { id: 'apology', label: 'Apology' },
  { id: 'corporate', label: 'Corporate gift' },
  { id: 'staff', label: 'Staff' },
  { id: 'other', label: 'Other' },
];
export const freeReasonLabel = (id) => FREE_REASONS.find((r) => r.id === id)?.label || 'reason not recorded';
/** "Valid until 28 Oct · 9 days" / "Expired 3 Oct" / "Valid until 14 Mar 2027" and a tone. */
export function validLine(v, today) {
  const d = daysUntil(v.expiryDate, today);
  if (d == null) return { text: '', tone: '' };
  if (d < 0) return { text: `Expired ${dayMon(v.expiryDate)}${ymd(v.expiryDate)[0] !== ymd(today)[0] ? ` ${ymd(v.expiryDate)[0]}` : ''}`, tone: 'red' };
  if (d <= EXPIRING_DAYS) return { text: `Valid until ${dayMon(v.expiryDate)} · ${d === 0 ? 'today' : plural(d, 'day')}`, tone: 'amber' };
  return { text: `Valid until ${longDate(v.expiryDate)}`, tone: '' };
}
/** Distinct "used by" names from the claims: [{ name, visits, last }] (latest first). Legacy closes are not visits. */
export function usedBy(claims) {
  const map = new Map();
  (claims || []).filter((c) => !c.is_legacy && c.guest_name_used_by).forEach((c) => {
    const key = c.guest_name_used_by.trim().toLowerCase();
    const row = map.get(key) || { name: c.guest_name_used_by.trim(), visits: 0, last: null };
    row.visits += 1;
    if (!row.last || c.redeemed_date > row.last) row.last = c.redeemed_date;
    map.set(key, row);
  });
  return [...map.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
}

// ── Extend ──────────────────────────────────────────────────────────────────────────────────────
/** Chips count from today, or from the current expiry while it is still in the future. */
export const extendBase = (v, today) => (v.expiryDate && v.expiryDate >= today ? v.expiryDate : today);
export const EXTEND_CHIPS = [
  { id: '7d', label: '+7 days', next: (b) => addDays(b, 7) },
  { id: '30d', label: '+30 days', next: (b) => addDays(b, 30) },
  { id: '90d', label: '+90 days', next: (b) => addDays(b, 90) },
  { id: '6m', label: '+6 months', next: (b) => addMonths(b, 6) },
];
export const VALID_CHIPS = [
  { id: '30', label: '+30 days', next: (b) => addDays(b, 30) },
  { id: '90', label: '+90 days', next: (b) => addDays(b, 90) },
  { id: '180', label: '+180 days', next: (b) => addDays(b, 180) },
  { id: '1y', label: '+1 year', next: (b) => addMonths(b, 12) },
];
export { addDays };

// ── Voucher types ───────────────────────────────────────────────────────────────────────────────
/** Per type: { total, sold, free, owed (value left on ready vouchers), openCoupons }. */
export function typeStats(vouchers, today) {
  const out = {};
  vouchers.forEach((v) => {
    if (!v.voucherTypeId) return;
    const row = out[v.voucherTypeId] || (out[v.voucherTypeId] = { total: 0, sold: 0, free: 0, owed: 0, openCoupons: 0 });
    row.total += 1;
    if (v.issueKind === 'free') row.free += 1; else row.sold += 1;
    if (isReady(v, today)) {
      if (isCoupon(v)) row.openCoupons += 1; else row.owed += remainingOf(v);
    }
  });
  return out;
}
export const handedOutSub = (s) => (!s || !s.total ? 'none yet' : [s.sold ? `${s.sold} sold` : null, s.free ? `${s.free} free` : null].filter(Boolean).join(' · '));

// ── Activity ────────────────────────────────────────────────────────────────────────────────────
export const KINDS = {
  sold: { label: 'Sold', tag: 'bg-[#F0FDF4] text-[#15803D]' },
  free: { label: 'Given free', tag: 'bg-[#FDF2F8] text-[#BE185D]' },
  redeemed: { label: 'Redeemed', tag: 'bg-[#F1F1EF] text-[#4A4A4F]' },
  coupon: { label: 'Coupon used', tag: 'bg-[#EEF2FF] text-[#4338CA]' },
  extended: { label: 'Extended', tag: 'bg-[#EEF3EC] text-[#2D5A27]' },
  checked: { label: 'Checked', tag: 'bg-[#EEF2FF] text-[#4338CA]' },
  corrected: { label: 'Corrected', tag: 'bg-[#FEF3C7] text-[#92400E]' },
};
/** Lead totals over activity rows: money taken on sales, value given free, value redeemed (legacy closes are "Checked"). */
export const activityTotals = (rows) => ({
  sold: sum(rows.filter((r) => r.kind === 'sold'), (r) => Number(r.paid) || 0),
  free: sum(rows.filter((r) => r.kind === 'free'), (r) => Number(r.amount) || 0),
  redeemed: sum(rows.filter((r) => r.kind === 'redeemed'), (r) => Math.abs(Number(r.amount) || 0)),
});
const modesText = (modes) => {
  const m = [...new Set((modes || []).filter(Boolean))];
  return m.length ? ` by ${m.join(' + ')}` : '';
};
const dateTime = (date, ts) => ({ date, ts: ts && nepalDate(ts) === date ? ts : null });
/**
 * Merge the four sources into one feed, newest first. Each row: { id, kind, date, ts (only when it falls on `date`), voucherId,
 * guestName, code, detail, branchId, branchName, performerId, performerName, amount (voucher value; + in, − out, 0 = none), paid }.
 */
export function buildActivity({ vouchers = [], claims = [], events = [], corrections = [] }) {
  const rows = [];
  vouchers.forEach((v) => {
    const free = v.issueKind === 'free';
    const value = valueOf(v);
    const detail = free
      ? [freeReasonLabel(v.freeReason).replace(/^./, (c) => c.toUpperCase()), v.freeNote].filter(Boolean).join(' · ')
      : [`Paid ${npr(v.amountPaid)}${modesText(v.paymentModes)}`, Number(v.discountPercent) > 0 ? `${Number(v.discountPercent)}% off` : null].filter(Boolean).join(' · ');
    rows.push({
      id: `v:${v.id}`, kind: free ? 'free' : 'sold', ...dateTime(v.issuedDate, v.createdAt), voucherId: v.id, guestName: v.guestName, code: v.voucherCode,
      detail: isCoupon(v) ? `${Number(v.percentOff)}% off one visit${free ? '' : ` · ${detail}`}` : detail,
      branchId: v.branchId, branchName: v.branchName, performerId: v.issuedById, performerName: v.issuedByName,
      amount: isCoupon(v) ? 0 : value, paid: free ? 0 : Number(v.amountPaid) || 0,
    });
  });
  claims.forEach((c) => {
    const amount = -Math.abs(Number(c.amountClaimed) || 0);
    if (c.isLegacy) {
      rows.push({
        id: `c:${c.id}`, kind: 'checked', ...dateTime(c.redeemedDate, c.createdAt), voucherId: c.voucherId, guestName: c.guestName, code: c.code,
        detail: `Already used · closed for ${npr(-amount)}`, branchId: c.branchId, branchName: c.branchName, performerId: c.performerId, performerName: c.performerName, amount, paid: 0,
      });
      return;
    }
    rows.push({
      id: `c:${c.id}`, kind: 'redeemed', ...dateTime(c.redeemedDate, c.createdAt), voucherId: c.voucherId, guestName: c.guestName, code: c.code,
      detail: [c.service, c.bookingNumber, c.atCheckout ? 'at checkout' : 'by hand'].filter(Boolean).join(' · '),
      branchId: c.branchId, branchName: c.branchName, performerId: c.performerId, performerName: c.performerName, amount, paid: 0,
    });
  });
  // A review check that was undone later (same voucher) is dropped, along with the undo itself.
  const undoneAt = new Map();
  events.filter((e) => e.kind === 'legacy_check_undone').forEach((e) => {
    undoneAt.set(e.voucherId, [...(undoneAt.get(e.voucherId) || []), e.createdAt]);
  });
  const wasUndone = (e) => (undoneAt.get(e.voucherId) || []).some((t) => t > e.createdAt);
  events.forEach((e) => {
    if (e.kind.startsWith('legacy_checked') && wasUndone(e)) return;
    const base = {
      id: `e:${e.id}`, ...dateTime(nepalDate(e.createdAt), e.createdAt), voucherId: e.voucherId, guestName: e.guestName, code: e.code,
      branchId: e.branchId, branchName: e.branchName, performerId: e.performerId, performerName: e.performerName, amount: 0, paid: 0,
    };
    if (e.kind === 'extended') {
      rows.push({ ...base, kind: 'extended', detail: [`Valid until ${longDate(e.newExpiry)} (was ${e.oldExpiry ? dayMon(e.oldExpiry) : '—'})`, e.note ? `"${e.note}"` : null].filter(Boolean).join(' · ') });
    } else if (e.kind === 'coupon_used') {
      // A coupon closed by the review shows once, as "Checked".
      if (e.note === 'Used before the app tracked it') return;
      rows.push({ ...base, kind: 'coupon', detail: [e.percentOff != null ? `${Number(e.percentOff)}% off` : 'Coupon', 'marked used by hand', e.bookingNumber, e.note].filter(Boolean).join(' · ') });
    } else if (e.kind === 'legacy_checked_valid') {
      rows.push({ ...base, kind: 'checked', detail: 'Still valid · given before the update' });
    } else if (e.kind === 'legacy_checked_used' && e.percentOff != null) {
      rows.push({ ...base, kind: 'checked', detail: 'Already used · coupon closed' });
    }
  });
  corrections.forEach((a) => {
    const oldV = Number(a.oldTotal) || 0;
    const newV = Number(a.newTotal) || 0;
    rows.push({
      id: `a:${a.id}`, kind: 'corrected', ...dateTime(nepalDate(a.changedAt), a.changedAt), voucherId: a.voucherId, guestName: a.guestName, code: a.code,
      detail: [`Value ${npr(oldV)} → ${npr(newV)}`, a.reason ? `"${a.reason}"` : null].filter(Boolean).join(' · '),
      branchId: a.branchId, branchName: a.branchName, performerId: a.performerId, performerName: a.performerName, amount: newV - oldV, paid: 0,
    });
  });
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.ts || '').localeCompare(String(a.ts || '')));
}
/** { day: 'Today' | 'Yesterday' | '16 Oct' | '16 Oct 2025', time: '2:14pm' | '' } for an activity row. */
export function activityWhen(row, today) {
  const d = daysUntil(row.date, today);
  const [y, m, dd] = ymd(row.date);
  const day = d === 0 ? 'Today' : d === -1 ? 'Yesterday' : `${dd} ${MON[m - 1]}${String(y) !== String(today).slice(0, 4) ? ` ${y}` : ''}`;
  if (!row.ts) return { day, time: '' };
  const [h, mi] = new Date(row.ts).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return { day, time: `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}` };
}
