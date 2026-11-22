import { NEPAL_TZ } from '../utils/nepalTime';
// Memberships page (V21): pure logic for the Members / Tiers / Wallet activity tabs — display status, the lifecycle strip, the
// lead sentence, Needs-you-now, sorting, search, birthdays and the activity feed. No React, no Supabase: `today` is a Nepal
// 'YYYY-MM-DD' passed in by the caller. Rows are fetchMemberships() rows (status: active / pending / lapsed / depleted).
import { daysUntil, shortName, npr } from './packagesView';

export { daysUntil, shortName, npr };

export const ENDS_SOON_DAYS = 30;
export const LOW_BALANCE_SHARE = 0.15;
export const BIRTHDAY_DAYS = 7;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (iso) => String(iso).slice(0, 10).split('-').map(Number);
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const weekday = (s) => { const [y, m, d] = ymd(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The tier's joining deposit (falls back to what was deposited this cycle when the tier has none). */
export const tierDeposit = (m) => {
  const t = Number(m.tierAdvanceAmount);
  if (t > 0) return t;
  return Number(m.cycleDeposited ?? m.totalDeposited) || 0;
};
const balanceOf = (m) => Number(m.balance) || 0;

export const isLowBalance = (m) => m.status === 'active' && balanceOf(m) > 0 && balanceOf(m) < LOW_BALANCE_SHARE * tierDeposit(m);
export const isEndsSoon = (m, today) => {
  if (m.status !== 'active' || !m.expiryDate) return false;
  const d = daysUntil(m.expiryDate, today);
  return d >= 0 && d <= ENDS_SOON_DAYS;
};
/** What a pending membership still needs before it activates (never negative). */
export const toActivate = (m) => (m.status === 'pending' ? Math.max(0, tierDeposit(m) - (Number(m.cycleDeposited ?? m.totalDeposited) || 0)) : 0);

/** Birthday perk is one per membership cycle: used if it falls between activation and expiry. */
export function perkUsedInCurrentCycle(m) {
  if (!m?.birthdayPerkUsedAt || !m.activationDate) return false;
  const used = new Date(m.birthdayPerkUsedAt);
  const start = new Date(`${m.activationDate}T00:00:00`);
  const end = m.expiryDate ? new Date(`${m.expiryDate}T23:59:59`) : null;
  if (used < start) return false;
  if (end && used > end) return false;
  return true;
}

/** Next birthday on or after today: { date: 'YYYY-MM-DD', days }. 29 Feb falls on 28 Feb in other years. */
export function nextBirthday(dob, today) {
  if (!dob) return null;
  const [, bm, bd] = ymd(dob);
  if (!bm || !bd) return null;
  const [ty] = ymd(today);
  const on = (y) => iso(y, bm, bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd);
  let date = on(ty);
  if (daysUntil(date, today) < 0) date = on(ty + 1);
  return { date, days: daysUntil(date, today) };
}
export const isBirthdaySoon = (m, today) => {
  if (m.status !== 'active' || !m.customerDateOfBirth || perkUsedInCurrentCycle(m)) return false;
  const nb = nextBirthday(m.customerDateOfBirth, today);
  return !!nb && nb.days <= BIRTHDAY_DAYS;
};
/** "Today" / "Thu" for the row tag. */
export const birthdayTag = (m, today) => {
  const nb = nextBirthday(m.customerDateOfBirth, today);
  if (!nb) return '';
  return nb.days === 0 ? 'Today' : DOW[weekday(nb.date)];
};
/** "Thursday, 22 Oct" */
export const longDay = (s) => { const [, m, d] = ymd(s); return `${DOW_LONG[weekday(s)]}, ${d} ${MON[m - 1]}`; };

// One display status per row, in priority order.
export const DISPLAY_STATUS = {
  lapsed: { label: 'Lapsed', dot: '#DC2626', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  usedUp: { label: 'Used up', dot: '#9CA3AF', pill: 'bg-[#F3F4F6] text-[#4B5563]' },
  pending: { label: 'Pending', dot: '#3B82F6', pill: 'bg-[#EFF6FF] text-[#1D4ED8]' },
  endsSoon: { label: 'Ends soon', dot: '#F59E0B', pill: 'bg-[#FEF3C7] text-[#92400E]' },
  lowBalance: { label: 'Low balance', dot: '#E7B93E', pill: 'bg-[#FBF3DF] text-[#9A6B0B]' },
  active: { label: 'Active', dot: '#3E7A35', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
};
export function displayStatus(m, today) {
  if (m.status === 'lapsed') return 'lapsed';
  if (m.status === 'depleted') return 'usedUp';
  if (m.status === 'pending') return 'pending';
  if (isEndsSoon(m, today)) return 'endsSoon';
  if (isLowBalance(m)) return 'lowBalance';
  return 'active';
}

// Lifecycle strip: segments filter the list and may overlap (Low balance / Ends soon ⊂ Active).
export const SEGMENTS = [
  { id: 'active', label: 'Active', color: '#3E7A35', test: (m) => m.status === 'active', hint: 'Can spend today' },
  { id: 'pending', label: 'Pending', color: '#3B82F6', test: (m) => m.status === 'pending', hint: 'Starts once fully paid' },
  { id: 'low', label: 'Low balance', color: '#E7B93E', test: (m) => isLowBalance(m), hint: 'Under 15% left · offer a top-up' },
  { id: 'ending', label: 'Ends in 30 days', color: '#F59E0B', test: isEndsSoon, hint: 'Remind them before it ends' },
  { id: 'ended', label: 'Ended', color: '#9CA3AF', test: (m) => m.status === 'lapsed' || m.status === 'depleted', hint: 'Lapsed or used up' },
];
export const segmentById = (id) => SEGMENTS.find((s) => s.id === id) || null;
// Not a strip segment: the "Birthday this week" filter (from Needs you now).
export const BIRTHDAY_FILTER = { id: 'birthday', label: 'Birthday this week', test: isBirthdaySoon };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

export function stripStats(members, today) {
  const by = Object.fromEntries(SEGMENTS.map((s) => [s.id, members.filter((m) => s.test(m, today))]));
  return {
    active: { count: by.active.length, sub: `${npr(sum(by.active, balanceOf))} in wallets` },
    pending: { count: by.pending.length, sub: `${npr(sum(by.pending, toActivate))} to collect` },
    low: { count: by.low.length, sub: '' },
    ending: { count: by.ending.length, sub: `${npr(sum(by.ending, balanceOf))} unused` },
    ended: { count: by.ended.length, sub: '' },
  };
}

/** Lead sentence parts (the caller bolds `strong`). Parts that are 0 are dropped. */
export function leadParts(members) {
  const active = members.filter((m) => m.status === 'active');
  const pending = members.filter((m) => m.status === 'pending' && toActivate(m) > 0);
  const held = sum(active, balanceOf);
  const collect = sum(pending, toActivate);
  const out = [];
  if (held > 0) out.push({ strong: npr(held) }, { text: ` held in ${plural(active.length, 'active wallet')}` });
  if (collect > 0) {
    if (out.length) out.push({ text: ' · ' });
    out.push({ strong: npr(collect) }, { text: ` to collect to activate ${plural(pending.length, 'membership')}` });
  }
  if (!out.length) out.push({ text: 'No wallets to look after right now.' });
  return out;
}

/** Needs-you-now items (count > 0 only). `member` is set when exactly one membership is involved. */
export function needsItems(members, today) {
  const items = [];
  const pending = members.filter((m) => m.status === 'pending' && toActivate(m) > 0);
  if (pending.length) {
    items.push({
      id: 'pending', dot: '#3B82F6', action: 'Collect', member: pending.length === 1 ? pending[0] : null,
      text: pending.length === 1 ? `${shortName(pending[0].customerName)} needs ${npr(toActivate(pending[0]))} to activate` : `${pending.length} need ${npr(sum(pending, toActivate))} to activate`,
    });
  }
  const ending = members.filter((m) => isEndsSoon(m, today));
  if (ending.length) {
    const d = ending.length === 1 ? daysUntil(ending[0].expiryDate, today) : null;
    items.push({
      id: 'ending', dot: '#F59E0B', action: 'Remind', member: ending.length === 1 ? ending[0] : null,
      text: ending.length === 1 ? `${shortName(ending[0].customerName)} ends ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}` : `${ending.length} end within 30 days`,
    });
  }
  const bday = members.filter((m) => isBirthdaySoon(m, today));
  if (bday.length) {
    const tag = bday.length === 1 ? birthdayTag(bday[0], today) : '';
    items.push({
      id: 'birthday', dot: '#DB2777', action: 'View', member: bday.length === 1 ? bday[0] : null,
      text: bday.length === 1 ? `${shortName(bday[0].customerName)}'s birthday is ${tag === 'Today' ? 'today' : tag} · gift unused` : `${bday.length} birthdays this week · gifts unused`,
    });
  }
  return items;
}

export const SORTS = {
  attention: { label: 'Needs attention' },
  latest: { label: 'Latest joined' },
  name: { label: 'Name A–Z' },
  balance: { label: 'Highest balance' },
  ends: { label: 'Ends soonest' },
};
// Needs attention: pending, ends soon, low balance, then active by expiry, then ended.
const ATTENTION = { pending: 0, endsSoon: 1, lowBalance: 2, active: 3, lapsed: 4, usedUp: 4 };
export function sortMembers(list, key, today) {
  const exp = (m) => (m.expiryDate ? daysUntil(m.expiryDate, today) : Infinity);
  const byName = (a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), undefined, { sensitivity: 'base' });
  const ended = (m) => (m.status === 'lapsed' || m.status === 'depleted' ? 1 : 0);
  const cmp = {
    attention: (a, b) => ATTENTION[displayStatus(a, today)] - ATTENTION[displayStatus(b, today)] || exp(a) - exp(b) || byName(a, b),
    latest: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || byName(a, b),
    name: byName,
    balance: (a, b) => balanceOf(b) - balanceOf(a) || byName(a, b),
    ends: (a, b) => ended(a) - ended(b) || exp(a) - exp(b) || byName(a, b),
  }[SORTS[key] ? key : 'attention'];
  return [...list].sort(cmp);
}

const digits = (s) => String(s || '').replace(/\D/g, '');
/** Name, phone (any format, +977-tolerant) or card number. */
export function matchesMemberSearch(m, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if ([m.customerName, m.membershipNumber].filter(Boolean).join(' ').toLowerCase().includes(q)) return true;
  const qd = digits(q).replace(/^977/, '');
  return qd.length >= 3 && digits(m.customerPhone).includes(qd);
}

// ── Discounts ────────────────────────────────────────────────────────────────────────────────────
export const CATEGORY_LABELS = { spa: 'Spa', salon: 'Salon', body_scrub: 'Body scrub', package: 'Packages' };
export const categoryLabel = (k) => CATEGORY_LABELS[k] || String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** [{ key, label, pct }] sorted by % (largest first); non-numeric / non-positive rules are skipped. */
export function discountChips(rules) {
  return Object.entries(rules || {})
    .map(([key, v]) => ({ key, label: categoryLabel(key), pct: Number(v) }))
    .filter((r) => Number.isFinite(r.pct) && r.pct > 0)
    .sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label));
}
/** "45% off spa" (the largest rule), or '' when the tier has none. */
export const headlineDiscount = (rules) => { const top = discountChips(rules)[0]; return top ? `${top.pct}% off ${top.label.toLowerCase()}` : ''; };
/** The tier members pay most for gets the gold pill (no names hardcoded). */
export const goldTierId = (tiers) => (tiers || []).reduce((best, t) => (!best || Number(t.advance_amount) > Number(best.advance_amount) ? t : best), null)?.id || null;

/** Per tier: { active, total, held, collected } over all members. */
export function tierStats(members) {
  const out = {};
  members.forEach((m) => {
    if (!m.tierId) return;
    const row = out[m.tierId] || (out[m.tierId] = { active: 0, total: 0, held: 0, collected: 0 });
    row.total += 1;
    if (m.status === 'active') row.active += 1;
    row.held += balanceOf(m);
    row.collected += Number(m.cycleDeposited ?? m.totalDeposited) || 0;
  });
  return out;
}

// ── Wallet activity ──────────────────────────────────────────────────────────────────────────────
export const KINDS = {
  deposit: { label: 'Added', tag: 'bg-[#EEF3EC] text-[#2D5A27]' },
  deduction: { label: 'Spent', tag: 'bg-[#F3F4F6] text-[#4B5563]' },
  birthday_perk: { label: 'Birthday gift', tag: 'bg-[#FDF2F8] text-[#BE185D]' },
  adjustment: { label: 'Adjusted', tag: 'bg-[#FEF3C7] text-[#92400E]' },
  extension: { label: 'Extended', tag: 'bg-[#EEF3EC] text-[#2D5A27]' },
};
export const kindLabel = (k) => KINDS[k]?.label || 'Other';
/** The extend RPC writes "…validity extended to 2027-10-19…"; show "Valid until 19 Oct 2027" instead of the raw note. */
export const extensionNote = (notes) => {
  const hit = /extended to (\d{4})-(\d{2})-(\d{2})/.exec(notes || '');
  return hit ? `Valid until ${Number(hit[3])} ${MON[Number(hit[2]) - 1]} ${hit[1]}` : (notes || '');
};
/** Added = deposits; spent = deductions. Adjustments are corrections and count in neither. */
export const activityTotals = (rows) => ({
  added: sum(rows.filter((r) => r.kind === 'deposit'), (r) => Number(r.amount) || 0),
  spent: sum(rows.filter((r) => r.kind === 'deduction'), (r) => Math.abs(Number(r.amount) || 0)),
});

export const RANGES = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];
const addDays = (s, n) => { const [y, m, d] = ymd(s); const t = new Date(Date.UTC(y, m - 1, d + n)); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
/** { from, to } (inclusive Nepal dates) for a preset. */
export function rangeFor(id, today) {
  const [y, m] = ymd(today);
  switch (id) {
    case 'last-month': { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { from: iso(py, pm, 1), to: addDays(iso(y, m, 1), -1) }; }
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'year': return { from: iso(y, 1, 1), to: today };
    case 'all': return { from: '2000-01-01', to: today };
    default: return { from: iso(y, m, 1), to: today };
  }
}
/** Button label: "This month · Oct 2026", "Last month · Sep 2026", "1–19 Oct 2026" for custom. */
export function rangeLabel(id, from, to) {
  const [fy, fm, fd] = ymd(from);
  const [ty, tm, td] = ymd(to);
  if (id === 'month' || id === 'last-month') return `${RANGES.find((r) => r.id === id).label} · ${MON[fm - 1]} ${fy}`;
  const preset = RANGES.find((r) => r.id === id);
  if (preset) return preset.label;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MON[tm - 1]} ${ty}`;
  return `${fd} ${MON[fm - 1]}${fy !== ty ? ` ${fy}` : ''} – ${td} ${MON[tm - 1]} ${ty}`;
}
/** Lead prefix for the activity tab: "October so far", "September", "Last 7 days", "1–19 Oct 2026". */
export function rangeLead(id, from, to) {
  const [, fm] = ymd(from);
  if (id === 'month') return `${MON_LONG[fm - 1]} so far`;
  if (id === 'last-month') return MON_LONG[fm - 1];
  return rangeLabel(id, from, to);
}

const TZ = NEPAL_TZ;
/** { day: 'Today' | 'Yesterday' | '16 Oct' | '16 Oct 2025', time: '2:14pm' } in Nepal time. */
export function whenLabel(ts, today) {
  const dt = new Date(ts);
  const day = dt.toLocaleDateString('en-CA', { timeZone: TZ });
  const [h, mi] = dt.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  const d = daysUntil(day, today);
  const [y, m, dd] = ymd(day);
  const label = d === 0 ? 'Today' : d === -1 ? 'Yesterday' : `${dd} ${MON[m - 1]}${String(y) !== String(today).slice(0, 4) ? ` ${y}` : ''}`;
  return { day: label, time, date: day };
}

/** WhatsApp text for a membership that is about to end. */
export function reminderText(m, today, orgName) {
  const first = String(m.customerName || '').trim().split(/\s+/)[0] || 'there';
  const d = daysUntil(m.expiryDate, today);
  const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  return `Hi ${first}, a friendly reminder from ${orgName || 'us'}: your ${m.tierName || 'membership'} ends ${when} with ${npr(balanceOf(m))} still in your wallet. Reply here to book a visit and use it.`;
}
