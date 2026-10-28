// Pure notification rules (ZNLY-135 V35a): category mapping, per-category defaults, bell grouping and the
// pop-up / sound gate. No React, no Supabase, so it is unit-tested directly (notificationRules.test.js).

export const CATEGORIES = ['bookings', 'approvals', 'team', 'stock', 'guests'];

// JS mirror of public.notification_category_for (migration 331). Keep the two in step.
const CATEGORY_BY_TYPE = {
  new_online_booking: 'bookings',
  booking_cancelled_by_guest: 'bookings',
  booking_rescheduled_by_guest: 'bookings',
  discount: 'approvals',
  discount_request: 'approvals',
  discount_approved: 'approvals',
  discount_declined: 'approvals',
  discount_fyi: 'approvals',
  transferred_staff_reminder: 'team',
  attendance_gap: 'team',
  low_stock: 'stock',
  outreach_review_pending: 'guests',
  renewal_due: 'guests',
};
export const categoryOf = (type) => CATEGORY_BY_TYPE[type] || 'bookings';

// What a person gets when they have no notification_prefs row (mockup scene D).
export const DEFAULT_PREFS = {
  bookings: { popup: true, sound: true },
  approvals: { popup: true, sound: true },
  team: { popup: true, sound: false },
  stock: { popup: false, sound: false },
  guests: { popup: false, sound: false },
};
export const DEFAULT_SETTINGS = { sound_enabled: true, quiet_outside_hours: true };

// Bell tabs: categories this role can receive (front desk: bookings + answers to their own discount requests).
export const categoriesForRole = (role) =>
  (role === 'manager' || role === 'admin' ? CATEGORIES : ['bookings', 'approvals']);

export const prefFor = (prefs, category) => prefs?.[category] || DEFAULT_PREFS[category] || { popup: false, sound: false };

// Approvals stay on screen until acted on or closed.
export const isSticky = (category) => category === 'approvals';

export const GROUP_WINDOW_MS = 10 * 60 * 1000;
export const GROUP_MAX = 5;
export const BURST_COUNT = 5;
export const BURST_WINDOW_MS = 60 * 1000;
export const SOUND_MIN_GAP_MS = 10 * 1000;
export const POPUP_VISIBLE_MAX = 2;

const ts = (v) => new Date(v).getTime();

/**
 * Bell grouping. Only new_online_booking, same branch, within 10 min of the group's newest item, max 5 per group.
 * Input newest-first; output keeps that order: { kind: 'single', item } | { kind: 'group', id, items, branchId, createdAt }.
 */
export function groupNotifications(items) {
  const used = new Set();
  const out = [];
  for (const it of items) {
    if (used.has(it.id)) continue;
    used.add(it.id);
    if (it.type !== 'new_online_booking') { out.push({ kind: 'single', item: it }); continue; }
    const members = [it];
    for (const other of items) {
      if (members.length >= GROUP_MAX) break;
      if (used.has(other.id) || other.type !== 'new_online_booking') continue;
      if ((other.branchId || null) !== (it.branchId || null)) continue;
      if (Math.abs(ts(it.createdAt) - ts(other.createdAt)) > GROUP_WINDOW_MS) continue;
      members.push(other);
      used.add(other.id);
    }
    out.push(members.length > 1
      ? { kind: 'group', id: `g-${members[0].id}`, items: members, branchId: it.branchId || null, createdAt: it.createdAt }
      : { kind: 'single', item: it });
  }
  return out;
}

export const groupUnread = (entry) => (entry.kind === 'group' ? entry.items.filter((i) => !i.read).length : (entry.item.read ? 0 : 1));

/** Badge text: every item counts, capped at 99+. */
export const badgeText = (n) => (n > 99 ? '99+' : String(n));

/** Nepal-time (or the branch's timezone) minutes since midnight. */
function minutesIn(tz, now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m || 0); };

/** Is `now` inside the branch's opening hours? Unknown branch or hours = open (never silence by mistake). */
export function isWithinOpeningHours(branch, now = new Date()) {
  if (!branch?.open_time || !branch?.close_time) return true;
  const cur = minutesIn(branch.timezone, now);
  const open = toMin(branch.open_time);
  const close = toMin(branch.close_time);
  return open <= close ? cur >= open && cur < close : cur >= open || cur < close;
}

export const canPlaySound = (lastAt, now = Date.now()) => !lastAt || now - lastAt >= SOUND_MIN_GAP_MS;

/**
 * Should a LIVE insert pop up / chime? (Callers only pass INSERTs that arrive live, never the page-load fetch.)
 * row: { category, actorId?, read }.  Returns { popup, sound }; sound here is the pref gate only, the 10 s rate
 * limit and the browser-unlock are applied by the player.
 */
export function evaluateLiveEvent({ row, userId, prefs, settings, branch, now = new Date() }) {
  const none = { popup: false, sound: false };
  if (!row || row.read) return none;
  if (row.actorId && row.actorId === userId) return none; // never for the user's own actions
  const cfg = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (cfg.quiet_outside_hours && !isWithinOpeningHours(branch, now)) return none;
  const pref = prefFor(prefs, row.category);
  return { popup: !!pref.popup, sound: !!pref.sound && !!cfg.sound_enabled };
}

/** 5+ arrivals within a minute collapse into one card. */
export const isBurst = (arrivalTimes, now = Date.now()) =>
  arrivalTimes.filter((t) => now - t <= BURST_WINDOW_MS).length >= BURST_COUNT;
