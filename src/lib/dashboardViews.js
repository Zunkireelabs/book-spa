// Dashboard views (V36a): which views a role can pick, which one opens first, and which part of the day it is.
// Pure helpers; the localStorage read/write is wrapped so private windows and blocked storage fall back to the default.

export const VIEWS = {
  business: 'Business',
  branch: 'Branch',
  frontdesk: 'Front desk',
  myday: 'My day',
};

const ROLE_VIEWS = {
  admin: ['business', 'branch', 'frontdesk', 'myday'],
  manager: ['branch', 'frontdesk', 'myday'],
  staff: ['frontdesk', 'myday'],
  admin_viewer: ['business', 'branch'],
};

/** View keys the role can switch between. Business needs more than one branch. */
export function availableViews({ role, branchCount = 1 }) {
  const views = ROLE_VIEWS[role] || ROLE_VIEWS.staff;
  return branchCount > 1 ? views : views.filter((v) => v !== 'business');
}

const storageKey = (userId) => `zennly.dashView.${userId}`;

export function readRememberedView(userId) {
  if (!userId) return null;
  try { return window.localStorage.getItem(storageKey(userId)); } catch { return null; }
}

export function rememberView(userId, view) {
  if (!userId || view === 'business') return; // Business is tied to All branches, so it is never remembered
  try { window.localStorage.setItem(storageKey(userId), view); } catch { /* storage unavailable: the choice just won't stick */ }
}

/**
 * Business always means All branches: on Overall, admin and admin_viewer see Business, and on a concrete branch they never do.
 * Otherwise a remembered choice (never Business) wins while available; else manager/admin/viewer open Branch, and staff
 * open My day with bookings today, else Front desk.
 */
export function defaultView({ role, branchCount = 1, isOverall = false, hasBookingsToday = false, remembered = null }) {
  const views = availableViews({ role, branchCount });
  if (isOverall && views.includes('business')) return 'business';
  const concrete = views.filter((v) => v !== 'business');
  if (remembered && concrete.includes(remembered)) return remembered;
  if (role === 'staff') return hasBookingsToday ? 'myday' : 'frontdesk';
  return concrete.includes('branch') ? 'branch' : concrete[0];
}

const toMinutes = (t) => {
  if (!t) return null;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/**
 * 'prep' (before open + 1h), 'live', or 'close' (from close - 1h). `hm` is the Nepal wall-clock 'HH:MM';
 * open/close are the branch's 'HH:MM[:SS]'. Missing or unusable hours mean live.
 */
export function dayPhase(hm, { open, close } = {}) {
  const now = toMinutes(hm);
  const o = toMinutes(open);
  const c = toMinutes(close);
  if (now == null || o == null || c == null || c <= o) return 'live';
  if (now < o + 60) return 'prep';
  if (now >= c - 60) return 'close';
  return 'live';
}

const norm = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * True when one of today's bookings is assigned to this user. There is no user -> therapist link in the schema, so the
 * match is by name against the booking's assigned therapists (`therapists[]`, falling back to `therapist`).
 */
export function hasOwnBookingsToday(bookings, fullName) {
  const me = norm(fullName);
  if (!me) return false;
  return (bookings || []).some((b) => {
    const assigned = b.therapists?.length ? b.therapists : (b.therapist ? [b.therapist] : []);
    return assigned.some((t) => norm(t?.name) === me);
  });
}
