import { isNavItemActive } from './navRegistry';
import { getAreaForView } from 'pages/branch-manager-dashboard/components/Area/areaTabsRegistry';

/**
 * ONE rule for "which nav entry is the current page", shared by the desktop sidebar, the phone pill nav and the More sheet.
 * It reads the same registry the nav is built from (navRegistry items + their activeViews / isActiveView, plus the Area tabs
 * registry for sub-tabs), so there is no second hand-written list to drift.
 *
 *   resolveActiveNav({ pathname, view, role, items, primaryIds }) -> { itemId, tabId }
 *     itemId: the nav item that is current (marked in the sidebar and inside the More sheet)
 *     tabId : the phone pill that lights: itemId when it is a primary pill, otherwise 'more'
 *   Exactly one of each, never none: a page nobody claims falls back to the Dashboard (see `claimed`).
 *
 * items: the nav items this role sees, as { id, view?, routePath?, activeViews?, isActiveView? } (routePath = the registry's `path`).
 */

// Pages that are routes of their own (not ?view= tabs): the nav item they belong to, by first path segment after /:orgSlug.
export const ROUTE_OWNER = {
  inbox: 'inbox',
  staff: 'therapists',               // /staff/new, /staff/:id
  customers: 'customers',            // /customers/:id, /customers/:id/messages
  bookings: 'bookings',              // /bookings/:id (booking details)
  'attendance-calendar': 'attendance',
  services: 'settings',              // /services/new, /services/:id
  locations: 'settings',             // /locations/new, /locations/:id
};

// Dashboard-internal tabs (the home page's own switcher): they are the Dashboard, not separate pages.
const HOME_TABS = new Set(['branch', 'business', 'frontdesk', 'myday']);

const landingView = (role) => (role === 'staff' ? 'calendar' : 'dashboard');

const owner = (items, view) => {
  const hit = items.find((i) => isNavItemActive(i, view));
  if (hit) return hit.id;
  const areaId = getAreaForView(view)?.id;
  return areaId && items.some((i) => i.id === areaId) ? areaId : null;
};

// Which item claims this location, or null (pure; also used by the tests to list unclaimed views).
export const claimedItemId = ({ pathname = '', view = null, role, items }) => {
  const segs = String(pathname).split('/').filter(Boolean);
  // /:orgSlug/<page>/..., or the legacy un-scoped /branch-manager-dashboard
  const page = segs[1];
  if (page && page !== 'dashboard' && ROUTE_OWNER[page]) {
    const id = ROUTE_OWNER[page];
    return items.some((i) => i.id === id) ? id : null;
  }
  const v = view || landingView(role);
  if (HOME_TABS.has(v)) return items.some((i) => i.id === 'dashboard') ? 'dashboard' : null;
  return owner(items, v);
};

export const resolveActiveNav = ({ pathname, view, role, items, primaryIds }) => {
  const claimed = claimedItemId({ pathname, view, role, items });
  const fallback = items.find((i) => i.id === 'dashboard')?.id || primaryIds[0] || items[0]?.id || null;
  const itemId = claimed || fallback;
  return { itemId, tabId: primaryIds.includes(itemId) ? itemId : 'more', claimed: !!claimed };
};
