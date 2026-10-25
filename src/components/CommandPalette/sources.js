import { getNav } from 'navigation/navRegistry';
import { getVisibleReports } from 'pages/branch-manager-dashboard/components/Reports/reportRegistry';
import { getVisibleSettings } from 'pages/branch-manager-dashboard/components/Settings/settingsRegistry';
import { AREAS, getVisibleTabs } from 'pages/branch-manager-dashboard/components/Area/areaTabsRegistry';
import { searchCustomers, searchBookings } from 'services/api';

// Result builders for the command palette. Everything here is client-side except the two remote groups, which reuse existing
// RLS-guarded API functions (no new endpoints).

const STAFF_UP = ['manager', 'admin', 'admin_viewer'];

// ── Matching ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Case-insensitive: every query word must appear in the label / secondary text / keywords; the start of a word scores highest.
// Returns 0 for no match.
export const score = (query, haystack) => {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const h = haystack.toLowerCase();
  const words = q.split(/\s+/);
  let total = 0;
  for (const w of words) {
    const idx = h.indexOf(w);
    if (idx < 0) { total = 0; break; }
    total += (idx === 0 || h[idx - 1] === ' ' ? 100 : 40) - Math.min(idx, 30);
  }
  return total;
};

const rank = (items, query) => items
  .map((it) => ({ it, s: score(query, `${it.label} ${it.secondary || ''} ${it.keywords || ''}`) }))
  .filter((x) => x.s > 0)
  .sort((a, b) => b.s - a.s)
  .map((x) => x.it);

const viewHref = (basePath, view, extra = '') => `${basePath}?view=${view}${extra}`;

// ── Pages + Actions (from the registries, already role / flag / Overall filtered) ─────────────────────────────────────
export const buildPages = ({ role, isOverall, staffLabelPlural, productLabel, enableRooms, locationLabelPlural, basePath }) => {
  const nav = getNav({ role, isOverall, staffLabelPlural, productLabel });
  const pages = [];
  const seenViews = new Set();
  const add = (item) => { if (!seenViews.has(item.view)) { seenViews.add(item.view); pages.push(item); } };

  [...nav.sections.flatMap((s) => s.items), ...nav.footer].forEach((n) =>
    add({ key: `page:${n.view}`, kind: 'page', label: n.label, icon: n.icon, view: n.view, href: viewHref(basePath, n.view), keywords: n.keywords }));

  // Report pages (staff have none), settings pages, and the tabs of each area ("Bookings · New booking")
  getVisibleReports(role).forEach((r) =>
    add({ key: `page:${r.view}`, kind: 'page', label: r.title, secondary: 'Reports', icon: r.icon, view: r.view, href: viewHref(basePath, r.view), keywords: r.keywords }));
  getVisibleSettings({ role, isOverall, enableRooms }).forEach((s) =>
    add({ key: `page:${s.view}`, kind: 'page', label: s.location ? (locationLabelPlural || s.title) : s.title, secondary: 'Settings', icon: s.icon, view: s.view, href: viewHref(basePath, s.view), keywords: s.keywords }));
  AREAS.forEach((area) => {
    const ctx = { role, isOverall, staffLabelPlural, productLabel };
    const tabs = getVisibleTabs(area, ctx);
    if (tabs.length < 2) return;
    const title = typeof area.title === 'function' ? area.title(ctx) : area.title;
    tabs.forEach((t) => add({ key: `page:${t.view}`, kind: 'page', label: `${title} · ${t.label}`, icon: 'ArrowRight', view: t.view, href: viewHref(basePath, t.view) }));
  });
  return pages;
};

export const buildActions = ({ role, isOverall, basePath }) => {
  const actions = [];
  if (!isOverall) actions.push({ key: 'action:new-booking', kind: 'action', label: 'New booking', icon: 'Plus', view: 'new-booking', href: viewHref(basePath, 'new-booking'), keywords: 'create add appointment book' });
  actions.push({ key: 'action:today', kind: 'action', label: 'Go to today on the calendar', icon: 'CalendarDays', view: 'calendar', href: viewHref(basePath, 'calendar'), keywords: 'now date jump' });
  if (role === 'staff') actions.push({ key: 'action:collect-payment', kind: 'action', label: 'Collect payment', icon: 'HandCoins', view: 'collect-payment', href: viewHref(basePath, 'collect-payment'), keywords: 'pay balance dues' });
  return actions;
};

// Pages and actions matching a query (each ranked). A tab page that is also an action ("Bookings · New booking") is dropped
// so the same destination doesn't appear twice.
export const matchLocal = (query, ctx) => {
  const actions = buildActions(ctx);
  const actionViews = new Set(actions.map((a) => a.view));
  const pages = buildPages(ctx).filter((p) => !(p.label.includes(' · ') && actionViews.has(p.view)));
  return { pages: rank(pages, query), actions: rank(actions, query) };
};

// ── Remote groups ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Customers: managers / admins only, and only with a concrete branch (the lookup resolves that branch's org). A bounded server-side
// search (limit 5), same table and RLS as the Customers panel.
export const searchCustomerRows = async (query, { role, isOverall, branchId, basePath }) => {
  if (!STAFF_UP.includes(role) || isOverall || !branchId) return [];
  const r = await searchCustomers(branchId, query, 5);
  if (r.error) throw r.error;
  return (r.data || []).map((c) => ({ key: `customer:${c.id}`, kind: 'customer', label: c.full_name || 'Unnamed', secondary: c.phone || '', icon: 'User', href: viewHref(basePath, 'customers', `&customer=${c.id}`) }));
};

export const searchBookingRows = async (query, { isOverall, branchId, orgSlug }) => {
  if (isOverall || !branchId || !orgSlug) return [];
  const r = await searchBookings(branchId, query);
  if (r.error) throw r.error;
  return (r.data || []).slice(0, 5).map((b) => ({
    key: `booking:${b.id}`, kind: 'booking', label: b.booking_number, icon: 'ClipboardList',
    secondary: [b.customer_name, b.date, b.service?.name].filter(Boolean).join(' · '),
    href: `/${orgSlug}/bookings/${b.id}`,
  }));
};
