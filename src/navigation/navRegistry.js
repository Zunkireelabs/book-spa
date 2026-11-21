import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED, OUTREACH_ENABLED, PRODUCTS_ENABLED, CAMPAIGNS_ENABLED } from 'lib/featureFlags';
import { isReportView } from 'pages/branch-manager-dashboard/components/Reports/reportRegistry';
import { isSettingsView } from 'pages/branch-manager-dashboard/components/Settings/settingsRegistry';

/**
 * The module registry: every top-level page of the app, who may open it, and how to get there.
 *
 * The sidebar is generated from this file. It is deliberately also the source the ⌘K "search or ask" palette and the
 * Assistant will read later, so they know every page, the roles / flags / Overall rules that gate it, and its `?view=` URL.
 * (Pages that live inside an area — report pages, settings pages, tabs — are described by that area's own registry:
 * Reports/reportRegistry.js, Settings/settingsRegistry.js, Area/areaTabsRegistry.js.)
 *
 * item: { id, label (string | ({staffLabelPlural, productLabel}) => string), icon, view, roles, overallHidden?,
 *         activeViews?: string[]   - the item is also active on these views (e.g. the other tabs of its area)
 *         isActiveView?: (view)=>bool - same, for areas that have their own registry (Reports, Settings) }
 */
const ALL = ['staff', 'manager', 'admin', 'admin_viewer'];
const STAFF_UP = ['manager', 'admin', 'admin_viewer'];
const MGR_ADMIN = ['manager', 'admin'];
const MGR_ADMIN_VIEWER = ['manager', 'admin', 'admin_viewer']; // Packages / Memberships / Vouchers are read-only for admin_viewer (#411)

const flagged = (enabled, items) => (enabled ? items : []);

export const NAV_SECTIONS = [
  { id: 'main', label: null, items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', view: 'dashboard', roles: ALL },
    { id: 'inbox', label: 'Inbox', icon: 'Inbox', path: 'inbox', keywords: 'notifications alerts approvals', roles: ALL },
    { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', view: 'calendar', keywords: 'schedule diary bookings', roles: ALL },
    { id: 'reports', label: 'Reports', icon: 'BarChart3', view: 'all-reports', keywords: 'analytics insights', roles: STAFF_UP, isActiveView: isReportView },
  ] },
  { id: 'operations', label: 'Operations', items: [
    { id: 'bookings', label: 'Bookings', icon: 'ClipboardList', view: 'bookings', keywords: 'appointments', roles: ALL,
      activeViews: ['bookings', 'new-booking', 'check-booking', 'collect-payment', 'new-membership', 'new-voucher'] },
    { id: 'customers', label: 'Customers', icon: 'Users', view: 'customers', keywords: 'clients guests', roles: STAFF_UP },
  ] },
  { id: 'sales', label: 'Sales', items: [
    { id: 'packages', label: 'Packages', icon: 'Layers', view: 'packages', keywords: 'sessions bundles', roles: MGR_ADMIN_VIEWER, activeViews: ['package-overview', 'packages'] },
    ...flagged(MEMBERSHIP_ENABLED, [
      { id: 'memberships', label: 'Memberships', icon: 'CreditCard', view: 'memberships', keywords: 'wallet tiers', roles: MGR_ADMIN_VIEWER, activeViews: ['memberships', 'membership-collection', 'wallet-usage'] },
    ]),
    ...flagged(VOUCHER_ENABLED, [
      { id: 'vouchers', label: 'Vouchers', icon: 'Ticket', view: 'vouchers', keywords: 'gift coupon', roles: MGR_ADMIN_VIEWER, activeViews: ['vouchers', 'voucher-types', 'voucher-activity', 'voucher-overview'] },
    ]),
    ...flagged(PRODUCTS_ENABLED, [
      { id: 'products', label: ({ productLabel }) => productLabel || 'Products', icon: 'ShoppingBag', view: 'products', keywords: 'retail stock inventory supplies suppliers', roles: ['staff', 'manager', 'admin', 'admin_viewer'],
        activeViews: ['products', 'stock-history', 'suppliers', 'product-categories'] },
    ]),
  ] },
  { id: 'people', label: 'People', items: [ // the future HRMS module
    { id: 'therapists', label: ({ staffLabelPlural }) => staffLabelPlural || 'Staff', icon: 'UserCog', view: 'therapists', keywords: 'team staff', roles: STAFF_UP },
    { id: 'attendance', label: 'Attendance', icon: 'Clock', view: 'attendance', keywords: 'check in leave', roles: STAFF_UP, overallHidden: true },
    { id: 'payroll', label: 'Payroll', icon: 'Banknote', view: 'payroll', keywords: 'salary wages pay', roles: ['admin', 'admin_viewer'] },
  ] },
  { id: 'marketing', label: 'Marketing', items: [
    ...flagged(CAMPAIGNS_ENABLED, [
      { id: 'campaigns', label: 'Campaigns', icon: 'Megaphone', view: 'campaigns', keywords: 'promotions messages', roles: MGR_ADMIN },
    ]),
    ...flagged(OUTREACH_ENABLED, [
      { id: 'outreach', label: 'Outreach', icon: 'Send', view: 'outreach-rules', keywords: 'campaign messages', roles: ['admin'],
        activeViews: ['outreach', 'outreach-rules', 'outreach-templates', 'outreach-review', 'outreach-log', 'outreach-settings'] },
    ]),
  ] },
];

// Pinned to the bottom of the nav column.
export const NAV_FOOTER = [
  { id: 'settings', label: 'Settings', icon: 'Settings', view: 'settings', keywords: 'preferences setup configuration', roles: STAFF_UP, isActiveView: isSettingsView },
];

// Most pages are `?view=` tabs of the dashboard route; a few (the Inbox) are routes of their own (`path`).
export const navPath = (item, basePath) => (item.path ? `${basePath.replace(/\/dashboard$/, '')}/${item.path}` : `${basePath}?view=${item.view}`);

// Is `item` the current page? `view` is the `?view=` value, with the bare-URL landing already resolved by the caller.
export const isNavItemActive = (item, view) =>
  view === item.view || !!item.activeViews?.includes(view) || !!item.isActiveView?.(view);

/**
 * What a user may see. Sections with no visible items are dropped. A role that sees at most MAX_UNLABELLED items in total
 * (excluding the footer) gets no section labels — they are noise on a short list.
 */
export const MAX_UNLABELLED = 4;

export const getNav = ({ role, isOverall, staffLabelPlural, productLabel }) => {
  const visible = (item) => item.roles.includes(role) && !(isOverall && item.overallHidden);
  const resolve = (item) => ({ ...item, label: typeof item.label === 'function' ? item.label({ staffLabelPlural, productLabel }) : item.label });

  const sections = NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter(visible).map(resolve) }))
    .filter((s) => s.items.length > 0);
  const footer = NAV_FOOTER.filter(visible).map(resolve);
  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return { sections, footer, showLabels: total > MAX_UNLABELLED };
};
