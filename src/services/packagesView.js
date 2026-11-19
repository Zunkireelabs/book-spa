// Packages page (V20): pure logic for the Guest packages / Package types tabs — display status, the lifecycle strip, the lead
// sentence, Needs-you-now, sorting and search. No React, no Supabase: `today` is a Nepal 'YYYY-MM-DD' passed in by the caller.

export const ENDS_SOON_DAYS = 30;

const dayNumber = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
/** Whole days from `today` to `iso` (negative when it is in the past); null without a date. */
export const daysUntil = (iso, today) => (iso ? dayNumber(iso) - dayNumber(today) : null);

const remainingOf = (p) => Math.max(0, Number(p.sessionsRemaining) || 0);

/** Past its expiry date with sessions left (the package_balances view says the same; this also covers a stale status). */
export const isExpired = (p, today) => p.status === 'expired'
  || ((p.status === 'unused' || p.status === 'partially_used') && p.expiryDate != null && daysUntil(p.expiryDate, today) < 0);
/** Still usable: not started or part-used, and not expired. */
export const isLive = (p, today) => (p.status === 'unused' || p.status === 'partially_used') && !isExpired(p, today);
export const isEndsSoon = (p, today) => {
  if (!isLive(p, today) || p.expiryDate == null) return false;
  const d = daysUntil(p.expiryDate, today);
  return d >= 0 && d <= ENDS_SOON_DAYS;
};
export const isLastSession = (p, today) => isLive(p, today) && remainingOf(p) === 1 && Number(p.sessionsTotal) > 1;

// One display status per row, in priority order.
export const DISPLAY_STATUS = {
  expired: { label: 'Expired', dot: '#DC2626', pill: 'bg-[#FEF2F2] text-[#991B1B]' },
  usedUp: { label: 'Used up', dot: '#9CA3AF', pill: 'bg-[#F3F4F6] text-[#4B5563]' },
  endsSoon: { label: 'Ends soon', dot: '#F59E0B', pill: 'bg-[#FEF3C7] text-[#92400E]' },
  lastSession: { label: 'Last session', dot: '#E7B93E', pill: 'bg-[#FBF3DF] text-[#9A6B0B]' },
  notStarted: { label: 'Not started', dot: '#3B82F6', pill: 'bg-[#EFF6FF] text-[#1D4ED8]' },
  active: { label: 'Active', dot: '#3E7A35', pill: 'bg-[#EEF3EC] text-[#2D5A27]' },
};
export function displayStatus(p, today) {
  if (isExpired(p, today)) return 'expired';
  if (p.status === 'fully_redeemed') return 'usedUp';
  if (isEndsSoon(p, today)) return 'endsSoon';
  if (isLastSession(p, today)) return 'lastSession';
  if (p.status === 'unused') return 'notStarted';
  return 'active';
}

/** What one session is worth on this package (final price, else what was paid), or null when sessions are unknown. */
export const valuePerSession = (p) => {
  const total = Number(p.sessionsTotal);
  if (!total || total <= 0) return null;
  return Number(p.finalAmount ?? p.paidAmount ?? 0) / total;
};

/** Prepaid value of the sessions still owed on live packages, whole NPR. */
export function owedValue(packages, today) {
  const sum = packages.reduce((n, p) => {
    if (!isLive(p, today)) return n;
    const per = valuePerSession(p);
    return per == null ? n : n + remainingOf(p) * per;
  }, 0);
  return Math.round(sum);
}
export const toCollect = (packages) => Math.round(packages.reduce((n, p) => n + (Number(p.dueAmount) || 0), 0) * 100) / 100;

// Lifecycle strip: segments filter the list and may overlap (Last session ⊂ Active).
export const SEGMENTS = [
  { id: 'active', label: 'Active', color: '#3E7A35', test: isLive },
  { id: 'last', label: 'Last session', color: '#E7B93E', test: isLastSession, hint: 'Good moment to offer a renewal' },
  { id: 'ending', label: 'Ends in 30 days', color: '#F59E0B', test: isEndsSoon, hint: 'Remind them before they lose it' },
  { id: 'usedup', label: 'Used up', color: '#9CA3AF', test: (p, today) => !isExpired(p, today) && p.status === 'fully_redeemed', hint: 'Every session given' },
  { id: 'expired', label: 'Expired', color: '#DC2626', test: isExpired, hint: 'Ended with sessions left' },
];
export const segmentById = (id) => SEGMENTS.find((s) => s.id === id) || null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function stripStats(packages, today) {
  const by = Object.fromEntries(SEGMENTS.map((s) => [s.id, packages.filter((p) => s.test(p, today))]));
  const left = (list) => list.reduce((n, p) => n + remainingOf(p), 0);
  const notStarted = by.active.filter((p) => p.status === 'unused').length;
  return {
    active: { count: by.active.length, sub: plural(left(by.active), 'session') + ' left', hint: notStarted > 0 ? `Includes ${notStarted} not started yet` : '' },
    last: { count: by.last.length, sub: '', hint: SEGMENTS[1].hint },
    ending: { count: by.ending.length, sub: plural(left(by.ending), 'session') + ' unused', hint: SEGMENTS[2].hint },
    usedup: { count: by.usedup.length, sub: '', hint: SEGMENTS[3].hint },
    expired: { count: by.expired.length, sub: plural(left(by.expired), 'session') + ' lost', hint: SEGMENTS[4].hint },
  };
}

/** Lead sentence parts; the caller bolds `strong` parts. Parts that are 0 are dropped. */
export function leadParts(packages, today) {
  const sessions = packages.filter((p) => isLive(p, today)).reduce((n, p) => n + remainingOf(p), 0);
  const worth = owedValue(packages, today);
  const due = toCollect(packages);
  const out = [];
  if (sessions > 0) {
    out.push({ strong: plural(sessions, 'session') }, { text: ' still owed to guests' });
    if (worth > 0) out.push({ text: ', worth ' }, { strong: npr(worth) }, { text: ' prepaid' });
  }
  if (due > 0) {
    if (out.length) out.push({ text: ' · ' });
    out.push({ strong: npr(due) }, { text: ' to collect' });
  }
  if (!out.length) out.push({ text: 'No sessions owed right now.' });
  return out;
}

export const npr = (n) => `NPR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** "Gaurav Karki" → "Gaurav K." */
export const shortName = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return w[0] || '';
  return `${w[0]} ${w[w.length - 1][0].toUpperCase()}.`;
};

/** Needs-you-now items (count > 0 only). `pkg` is set when exactly one package is involved. */
export function needsItems(packages, today) {
  const items = [];
  const ending = packages.filter((p) => isEndsSoon(p, today));
  if (ending.length) {
    const unused = ending.reduce((n, p) => n + remainingOf(p), 0);
    items.push({ id: 'ending', text: `${ending.length} end${ending.length === 1 ? 's' : ''} within 30 days · ${plural(unused, 'session')} unused`, action: 'Remind', dot: '#F59E0B', pkg: ending.length === 1 ? ending[0] : null });
  }
  const last = packages.filter((p) => isLastSession(p, today));
  if (last.length) {
    items.push({ id: 'last', text: last.length === 1 ? `${shortName(last[0].guestName)} is on the last session` : `${last.length} guests on their last session`, action: 'Offer renewal', dot: '#E7B93E', pkg: last.length === 1 ? last[0] : null });
  }
  const due = packages.filter((p) => (Number(p.dueAmount) || 0) > 0);
  if (due.length) {
    items.push({ id: 'due', text: `${npr(toCollect(due))} due on ${plural(due.length, 'package')}`, action: 'View', dot: '#B45309', pkg: due.length === 1 ? due[0] : null });
  }
  return items;
}

export const SORTS = {
  ends: { label: 'Ends soonest' },
  latest: { label: 'Latest sold' },
  guest: { label: 'Guest A–Z' },
  fewest: { label: 'Fewest left' },
};
const RANK = { expired: 2, usedUp: 1 }; // everything live ranks 0
export function sortPackages(list, key, today) {
  const rank = (p) => RANK[displayStatus(p, today)] || 0;
  const exp = (p) => (p.expiryDate ? dayNumber(p.expiryDate) : Infinity);
  const byName = (a, b) => String(a.guestName || '').localeCompare(String(b.guestName || ''), undefined, { sensitivity: 'base' });
  const cmp = {
    // Live first by expiry (soonest first), then used up, then expired (most recent first).
    ends: (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? exp(a) - exp(b) : exp(b) - exp(a)) || byName(a, b),
    latest: (a, b) => String(b.issuedDate || '').localeCompare(String(a.issuedDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || byName(a, b),
    guest: byName,
    fewest: (a, b) => rank(a) - rank(b) || remainingOf(a) - remainingOf(b) || exp(a) - exp(b) || byName(a, b),
  }[SORTS[key] ? key : 'ends'];
  return [...list].sort(cmp);
}

const digits = (s) => String(s || '').replace(/\D/g, '');
/** Guest name, phone / guest info, package type, service. Phone matches ignore spaces, dashes and a +977 prefix. */
export function matchesPackageSearch(p, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [p.guestName, p.guestInfo, p.customerPhone, p.packageTypeName, p.serviceName].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(q)) return true;
  const qd = digits(q).replace(/^977/, '');
  if (qd.length >= 3) return [p.guestInfo, p.customerPhone].some((v) => digits(v).includes(qd));
  return false;
}

// ── Package types ────────────────────────────────────────────────────────────────────────────────

/** 365 → "1 year", 180 → "6 months", 45 → "45 days". */
export function validityLabel(days) {
  const d = Number(days);
  if (!d || d <= 0) return '—';
  if (d % 365 === 0) return plural(d / 365, 'year');
  if (d % 30 === 0) return plural(d / 30, 'month');
  return plural(d, 'day');
}

/** Per-session price and the saving against one single visit (pill only when ≥ 1%). */
export function perSession(type) {
  const price = type.standard_price != null ? Number(type.standard_price) : null;
  const sessions = type.default_sessions != null ? Number(type.default_sessions) : null;
  const single = type.service?.price_npr != null ? Number(type.service.price_npr) : null;
  if (price == null || !sessions) return { per: null, single, saves: null };
  const per = price / sessions;
  const saves = single > 0 ? Math.round((1 - per / single) * 100) : null;
  return { per, single, saves: saves != null && saves >= 1 ? saves : null };
}

/** { [packageTypeId]: { active, sold } } over the (already branch-scoped) packages. */
export function typeUsage(packages, today) {
  const out = {};
  packages.forEach((p) => {
    if (!p.packageTypeId) return;
    const row = out[p.packageTypeId] || (out[p.packageTypeId] = { active: 0, sold: 0 });
    row.sold += 1;
    if (isLive(p, today)) row.active += 1;
  });
  return out;
}

/** WhatsApp reminder text for a package that is about to end. */
export function reminderText(p, today, orgName) {
  const first = String(p.guestName || '').trim().split(/\s+/)[0] || 'there';
  const d = daysUntil(p.expiryDate, today);
  const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  const left = remainingOf(p);
  return `Hi ${first}, a friendly reminder from ${orgName || 'us'}: your ${p.packageTypeName} package has ${plural(left, 'session')} left and ends ${when}. Reply here to book your next visit.`;
}
