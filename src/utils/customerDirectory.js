// Pure derivation for the Customers list: one row per customer with next/last visit, in-spa flag, balance, spent and a single
// lifecycle segment. "Today"/"now" are Nepal wall-clock values (never toISOString(), which shifts the date) and are injectable
// so the boundaries can be tested.

export const NEW_DAYS = 30;
export const AT_RISK_DAYS = 60;
export const LAPSED_DAYS = 180;
export const REGULAR_MIN_VISITS = 4;
// Same VIP thresholds the old loyalty tiers used: completed visits AND lifetime paid.
export const VIP_MIN_VISITS = 8;
export const VIP_MIN_SPENT = 25000;

const RENDERED = ['Completed', 'In-Progress']; // a visit that has happened (or is happening)
const UPCOMING = ['Pending', 'Confirmed'];
const TZ = 'Asia/Kathmandu';

/** { today: 'YYYY-MM-DD', hm: 'HH:MM' } in Nepal time for the given instant. */
export function nepalNow(now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const hm = now.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
  return { today, hm };
}

const hm = (t) => (t ? String(t).slice(0, 5) : '');
const dayNumber = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const daysBetween = (fromISO, toISO) => dayNumber(toISO) - dayNumber(fromISO);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Money still owed on ONE booking. Only RENDERED visits (Completed / In-Progress, date <= today) can be owed, so a future or
 * cancelled booking never counts; a paid booking owes nothing; never negative.
 * NOTE: the Outstanding report and the calendar's "Prev. due" still use the older unpaid/partial-status rule (which counts
 * confirmed future bookings). Aligning them is a separate, owner-approved task, so they are deliberately left alone here.
 */
export function bookingDue(b, today) {
  if (!RENDERED.includes(b.status)) return 0;
  if (String(b.date).slice(0, 10) > today) return 0;
  if (b.payment_status === 'paid') return 0;
  const paid = (b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return Math.max(0, round2(Number(b.final_amount || 0) - paid));
}

/**
 * The one lifecycle segment (so the counts sum to the total), in priority order:
 * new → lapsed → at-risk → regular → occasional.
 */
export function lifecycleSegment({ completedVisits, firstVisitDate, lastVisitDate, hasNext, today }) {
  if (completedVisits === 0 || (firstVisitDate && daysBetween(firstVisitDate, today) <= NEW_DAYS)) return 'new';
  const since = lastVisitDate ? daysBetween(lastVisitDate, today) : null;
  if (since != null && since > LAPSED_DAYS && !hasNext) return 'lapsed';
  if (completedVisits >= 2 && since != null && since > AT_RISK_DAYS && !hasNext) return 'at-risk';
  if (completedVisits >= REGULAR_MIN_VISITS) return 'regular';
  return 'occasional';
}

/**
 * @param {{customers: object[], bookings: object[], memberIds?: Set<string>, today: string, nowHM: string}} input
 *  customers: { id, full_name, phone, email, gender, created_at }
 *  bookings:  { customer_id, status, payment_status, final_amount, date, start_time, service_name_snapshot, therapist_id,
 *               therapist_name_snapshot, payments?: [{amount}] }
 */
export function buildCustomerDirectory({ customers = [], bookings = [], memberIds = new Set(), today, nowHM }) {
  const byCustomer = new Map();
  for (const b of bookings) {
    if (!b.customer_id) continue;
    if (!byCustomer.has(b.customer_id)) byCustomer.set(b.customer_id, []);
    byCustomer.get(b.customer_id).push(b);
  }

  return customers.map((c) => {
    const list = byCustomer.get(c.id) || [];
    let first = null; // earliest rendered visit
    let last = null; // latest rendered visit
    let next = null;
    let inSpa = false;
    let completedVisits = 0;
    let balance = 0;
    let spent = 0;
    const therapists = new Map(); // id -> name
    const services = new Set();

    for (const b of list) {
      const date = String(b.date).slice(0, 10);
      const time = hm(b.start_time);
      const info = { date, time, service: b.service_name_snapshot || '', therapist: b.therapist_name_snapshot || '' };
      if (RENDERED.includes(b.status) && date <= today) {
        completedVisits += 1;
        if (!first || date < first.date) first = info;
        if (!last || date > last.date || (date === last.date && time > last.time)) last = info;
        if (b.status === 'In-Progress' && date === today) inSpa = true;
      }
      if (UPCOMING.includes(b.status) && (date > today || (date === today && time > nowHM))) {
        if (!next || date < next.date || (date === next.date && time < next.time)) next = info;
      }
      balance = round2(balance + bookingDue(b, today));
      if (b.payment_status === 'paid') spent = round2(spent + Number(b.final_amount || 0));
      if (b.therapist_id && b.therapist_name_snapshot) therapists.set(b.therapist_id, b.therapist_name_snapshot);
      if (b.service_name_snapshot) services.add(b.service_name_snapshot);
    }

    return {
      id: c.id,
      fullName: c.full_name || '',
      phone: c.phone || '',
      email: c.email || '',
      gender: c.gender || '',
      createdAt: c.created_at,
      completedVisits,
      lastVisit: last ? { date: last.date, service: last.service, therapist: last.therapist } : null,
      nextBooking: next ? { date: next.date, time: next.time, service: next.service, therapist: next.therapist } : null,
      inSpa,
      spent,
      balance,
      vip: completedVisits >= VIP_MIN_VISITS && spent >= VIP_MIN_SPENT,
      member: memberIds.has(c.id),
      segment: lifecycleSegment({ completedVisits, firstVisitDate: first?.date, lastVisitDate: last?.date, hasNext: !!next, today }),
      therapistIds: [...therapists.keys()],
      services: [...services],
    };
  });
}

// ── Tabs, lifecycle strip, search, sort ──────────────────────────────────────────────────────

export const LIFECYCLE = [
  { id: 'new', label: 'New', hint: `First visit in the last ${NEW_DAYS} days`, color: '#7FA37A' },
  { id: 'regular', label: 'Regular', hint: `${REGULAR_MIN_VISITS}+ visits, seen in the last ${AT_RISK_DAYS} days`, color: '#2D5A27' },
  { id: 'occasional', label: 'Occasional', hint: `1–${REGULAR_MIN_VISITS - 1} visits, still active`, color: '#B7C9B4' },
  { id: 'at-risk', label: 'At risk', hint: `Was returning, gone ${AT_RISK_DAYS}+ days`, color: '#F59E0B' },
  { id: 'lapsed', label: 'Lapsed', hint: `No visit in ${Math.round(LAPSED_DAYS / 30)}+ months`, color: '#A8A29E' },
];

export const TABS = {
  all: () => true,
  'in-spa': (c) => c.inSpa,
  upcoming: (c) => !!c.nextBooking,
  owes: (c) => c.balance > 0,
  members: (c) => c.member,
  vip: (c) => c.vip,
};

export const tabCounts = (customers) => Object.fromEntries(Object.entries(TABS).map(([k, fn]) => [k, customers.filter(fn).length]));

/** Counts per lifecycle segment; they always sum to customers.length. */
export const lifecycleCounts = (customers) => {
  const out = Object.fromEntries(LIFECYCLE.map((s) => [s.id, 0]));
  for (const c of customers) out[c.segment] += 1;
  return out;
};

/** Digits only, minus a leading Nepal country code or trunk zero, so "+977 984-12" and "98412" both match. */
export const phoneSearchDigits = (value) => {
  let d = String(value || '').replace(/\D/g, '');
  if (d.startsWith('977') && d.length > 3) d = d.slice(3);
  return d.replace(/^0+/, '');
};

export function matchesSearch(c, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if ((c.fullName || '').toLowerCase().includes(q)) return true;
  if ((c.email || '').toLowerCase().includes(q)) return true;
  const qd = phoneSearchDigits(q);
  if (qd && /^[\d\s+\-()]+$/.test(q)) return phoneSearchDigits(c.phone).includes(qd);
  return false;
}

const cmpStr = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
const cmpDate = (a, b, dir) => {
  if (!a && !b) return 0;
  if (!a) return 1; // missing values always sort last
  if (!b) return -1;
  return dir * (a < b ? -1 : a > b ? 1 : 0);
};

export const SORTS = {
  next: { label: 'Next booking', dir: 'asc' },
  last: { label: 'Last visit', dir: 'desc' },
  name: { label: 'Name', dir: 'asc' },
  spent: { label: 'Spent', dir: 'desc' },
  balance: { label: 'Balance', dir: 'desc' },
  visits: { label: 'Visits', dir: 'desc' },
};

export function sortCustomers(list, key = 'next', dir = SORTS[key]?.dir || 'asc') {
  const d = dir === 'asc' ? 1 : -1;
  const out = [...list];
  out.sort((a, b) => {
    let r = 0;
    if (key === 'next') r = cmpDate(a.nextBooking && `${a.nextBooking.date} ${a.nextBooking.time}`, b.nextBooking && `${b.nextBooking.date} ${b.nextBooking.time}`, d);
    else if (key === 'last') r = cmpDate(a.lastVisit?.date, b.lastVisit?.date, d);
    else if (key === 'balance') r = d * (a.balance - b.balance);
    else if (key === 'spent') r = d * (a.spent - b.spent);
    else if (key === 'visits') r = d * (a.completedVisits - b.completedVisits);
    else r = d * cmpStr(a.fullName, b.fullName);
    return r || cmpStr(a.fullName, b.fullName);
  });
  return out;
}

// ── Labels ───────────────────────────────────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return { y, m, d, dow: new Date(y, m - 1, d).getDay() }; };

/** "Today" / "Tomorrow" / "Yesterday" / "Fri 16 Oct" (future) / "2 Oct" (past; adds the year when not this year). */
export function relativeDayLabel(iso, todayISO) {
  if (!iso) return '';
  const diff = daysBetween(todayISO, iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const p = parts(iso);
  const yr = p.y !== Number(todayISO.slice(0, 4)) ? ` ${p.y}` : '';
  return diff > 0 ? `${DOW[p.dow]} ${p.d} ${MON[p.m - 1]}${yr}` : `${p.d} ${MON[p.m - 1]}${yr}`;
}

/** "4 months" style gap for the lapsed / at-risk last-visit label. */
export const monthsSince = (iso, todayISO) => Math.floor(daysBetween(iso, todayISO) / 30.44);
export const shortDate = (iso) => { const p = parts(iso); return `${p.d} ${MON[p.m - 1]}`; };
export const monthYear = (isoOrTs) => { if (!isoOrTs) return ''; const p = parts(String(isoOrTs).slice(0, 10)); return `${MON[p.m - 1]} ${p.y}`; };
export const dayBlock = (iso) => { const p = parts(iso); return { dow: DOW[p.dow].toUpperCase(), day: p.d }; };
export const initials = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

// ── Side-panel detail (one customer's bookings) ──────────────────────────────────────────────

const topOf = (counts, visits) => {
  // The most frequent value, only when it is at least 2 visits AND at least half of all rendered visits.
  let best = null;
  for (const [name, n] of counts) if (!best || n > best.n) best = { name, n };
  return best && best.n >= 2 && best.n / visits >= 0.5 ? best : null;
};

/**
 * @param {{bookings: object[], today: string, nowHM: string}} input  bookings: one customer's rows with
 *  { id, booking_number, branch_id, status, date, start_time, end_time, service_name_snapshot, therapist_name_snapshot,
 *    room_name_snapshot, special_requests, final_amount, payment_status, payments?: [{amount}] }
 * @returns {{now, upcoming, recent, owed, preferences}} now = today's In-Progress booking; upcoming = the next Pending/Confirmed;
 *  recent = last 3 rendered visits; owed = rendered unpaid visits oldest first (the same rule as the row's Balance);
 *  preferences = { therapist, service, note }.
 */
export function buildPanelDetail({ bookings = [], today, nowHM }) {
  const row = (b) => ({
    id: b.id, bookingNumber: b.booking_number, branchId: b.branch_id || null, status: b.status, date: String(b.date).slice(0, 10),
    start: hm(b.start_time), end: hm(b.end_time), service: b.service_name_snapshot || '', therapist: b.therapist_name_snapshot || '', room: b.room_name_snapshot || '',
  });
  const sorted = [...bookings].sort((a, b) => (String(b.date).slice(0, 10) + hm(b.start_time)).localeCompare(String(a.date).slice(0, 10) + hm(a.start_time))); // newest first
  const rendered = sorted.filter((b) => RENDERED.includes(b.status) && String(b.date).slice(0, 10) <= today);

  const now = rendered.filter((b) => b.status === 'In-Progress' && String(b.date).slice(0, 10) === today).map(row)[0] || null;
  const upcoming = sorted
    .filter((b) => UPCOMING.includes(b.status) && (String(b.date).slice(0, 10) > today || (String(b.date).slice(0, 10) === today && hm(b.start_time) > nowHM)))
    .map(row).reverse()[0] || null; // sorted newest-first, so the last of the filtered ones is the earliest
  const recent = rendered.slice(0, 3).map(row);

  const owed = [...rendered].reverse()
    .map((b) => ({ b, due: bookingDue(b, today) }))
    .filter(({ due }) => due > 0)
    .map(({ b, due }) => ({
      bookingId: b.id, bookingNumber: b.booking_number, branchId: b.branch_id || null, date: String(b.date).slice(0, 10), serviceName: b.service_name_snapshot || '—',
      finalAmount: Number(b.final_amount || 0), amountPaid: round2(Number(b.final_amount || 0) - due), amountDue: due, paymentStatus: b.payment_status,
    }));

  const therapistCounts = new Map();
  const serviceCounts = new Map();
  for (const b of rendered) {
    if (b.therapist_name_snapshot) therapistCounts.set(b.therapist_name_snapshot, (therapistCounts.get(b.therapist_name_snapshot) || 0) + 1);
    if (b.service_name_snapshot) serviceCounts.set(b.service_name_snapshot, (serviceCounts.get(b.service_name_snapshot) || 0) + 1);
  }
  const noted = sorted.find((b) => String(b.special_requests || '').trim() && !['Cancelled', 'No Show'].includes(b.status) && String(b.date).slice(0, 10) <= today);
  return {
    now, upcoming, recent, owed,
    preferences: {
      therapist: topOf(therapistCounts, rendered.length)?.name || null,
      service: topOf(serviceCounts, rendered.length)?.name || null,
      note: noted ? { text: String(noted.special_requests).trim(), date: String(noted.date).slice(0, 10) } : null,
    },
  };
}
