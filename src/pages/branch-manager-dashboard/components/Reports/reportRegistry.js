import { CUSTOMER_REFERRALS_ENABLED } from 'lib/featureFlags';

// One source of truth for the Reports area (ZNLY-159): the internal menu, the home, the sidebar's active check, the command palette and the
// dashboard's renderer all read this. Roles and flags mirror the sidebar's former "Reports" group exactly.
//
// `status` says what a report is today:
//   live    a report built on the shared ReportFrame (Business health).
//   legacy  the existing panel, kept under its new name; `tabs` are the other existing views folded into the same report.
//   soon    not built yet: hidden from the menu and the home, and it cannot be opened. No placeholder pages.
// Titles and subtitles may hold {staff} / {staffs}: the industry's word for the person doing the service (useIndustry), never a hard-coded one.
const STAFF_UP = ['manager', 'admin', 'admin_viewer'];

export const REPORT_GROUPS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales & money' },
  { id: 'customers', label: 'Customers' },
  { id: 'team', label: 'Team' },
  { id: 'products', label: 'Products & prepaid' },
];

// The three reports owners open most, in this order (home "Start here" row).
export const START_HERE = ['business-health', 'money-owed', 'staff-performance'];

export const REPORTS = [
  { id: 'business-health', view: 'business-health', status: 'live', title: 'Business health', subtitle: 'What you earned, what came in, and how busy you were, vs the previous period.', icon: 'Activity', group: 'overview', roles: STAFF_UP, keywords: 'overview sales revenue cash in busy health summary' },

  { id: 'day-close', view: 'reports', status: 'legacy', title: 'Day close', subtitle: 'Printable close sheet for one day', icon: 'FileText', group: 'sales', roles: STAFF_UP, keywords: 'daily report revenue closing day end sales' },
  { id: 'revenue-by-service', view: 'service-revenue', status: 'legacy', title: 'Revenue by service', subtitle: 'What earns, by service or category', icon: 'PieChart', group: 'sales', roles: STAFF_UP, keywords: 'income sales treatments category',
    tabs: [{ view: 'service-revenue', label: 'By service' }, { view: 'category-revenue', label: 'By category' }] },
  { id: 'payments-tips', view: 'payments-tips', status: 'soon', title: 'Payments & tips', subtitle: 'Takings by method, refunds, tips per person', icon: 'Banknote', group: 'sales', roles: STAFF_UP, keywords: 'cash qr card refunds tips' },
  { id: 'discounts', view: 'discounts', status: 'legacy', title: 'Discounts', subtitle: 'Given, requested vs approved, by whom', icon: 'Percent', group: 'sales', roles: STAFF_UP, keywords: 'offers waiver' },
  { id: 'money-owed', view: 'outstanding', status: 'legacy', title: 'Money owed', subtitle: 'Unpaid and partly paid, one branch or all', icon: 'AlertCircle', group: 'sales', roles: STAFF_UP, keywords: 'outstanding dues unpaid balance owed receivable due report',
    tabs: [{ view: 'outstanding', label: 'Money owed' }, { view: 'due-report', label: 'All branches', roles: ['admin'] }] },

  { id: 'customers-retention', view: 'customers-retention', status: 'soon', title: 'Customers & retention', subtitle: 'New vs returning, top and lapsed customers', icon: 'Users', group: 'customers', roles: STAFF_UP, keywords: 'returning lapsed regulars' },
  { id: 'no-shows', view: 'no-shows', status: 'soon', title: 'No-shows & cancellations', subtitle: 'Rate, repeat cases, revenue lost', icon: 'UserX', group: 'customers', roles: STAFF_UP, keywords: 'cancelled lost' },
  { id: 'sources-referrals', view: 'referrals', status: 'legacy', title: 'Sources & referrals', subtitle: 'How customers found you, referrers, rewards', icon: 'UserPlus', group: 'customers', roles: STAFF_UP, keywords: 'commission source referral wallet',
    tabs: [
      { view: 'referrals', label: 'Sources & referrers' },
      ...(CUSTOMER_REFERRALS_ENABLED ? [{ view: 'customer-referrals', label: 'Customer referrals' }, { view: 'referral-wallet', label: 'Referral wallet' }] : []),
    ] },
  { id: 'campaigns-messages', view: 'campaigns-messages', status: 'soon', title: 'Campaigns & messages', subtitle: 'Messages sent, bookings within 7 days after', icon: 'MessageSquare', group: 'customers', roles: STAFF_UP, keywords: 'outreach sms email' },

  { id: 'staff-performance', view: 'performance', status: 'legacy', title: '{staff} performance', subtitle: 'Revenue, bookings, rebook, no-show, busy %', icon: 'TrendingUp', group: 'team', roles: STAFF_UP, keywords: 'ranking therapist productivity' },
  { id: 'utilization', view: 'utilization', status: 'soon', title: 'Utilization', subtitle: 'Booked vs working hours, {staffs} and rooms', icon: 'Gauge', group: 'team', roles: STAFF_UP, keywords: 'busy hours idle' },
  { id: 'commission-payroll', view: 'commission-payroll', status: 'soon', title: 'Commission & payroll', subtitle: 'Earned vs paid, per person and run', icon: 'Wallet', group: 'team', roles: STAFF_UP, keywords: 'salary earned paid' },
  { id: 'attendance', view: 'attendance-report', status: 'legacy', title: 'Attendance', subtitle: 'Presence, leave, late. Table or calendar', icon: 'CalendarCheck', group: 'team', roles: STAFF_UP, keywords: 'presence leave who was in',
    tabs: [{ view: 'attendance-report', label: 'Table' }, { view: 'attendance-calendar', label: 'Calendar' }] },
  { id: 'transfers', view: 'transfer-report', status: 'legacy', title: 'Transfers', subtitle: 'Who moved, when, which branch paid', icon: 'ArrowRightLeft', group: 'team', roles: STAFF_UP, keywords: 'moved branch transfer' },

  { id: 'prepaid', view: 'prepaid', status: 'soon', title: 'Prepaid', subtitle: 'Memberships, packages, vouchers: sold, used, still owed', icon: 'Ticket', group: 'products', roles: STAFF_UP, keywords: 'membership package voucher wallet' },
  { id: 'products-stock', view: 'products-stock', status: 'soon', title: 'Products & stock', subtitle: 'Sales, margin, low stock, movements', icon: 'Package', group: 'products', roles: STAFF_UP, keywords: 'inventory retail' },
];

// {staff} -> "Therapist", {staffs} -> "Therapists" (the org's own words). Without labels it falls back to the generic word.
export const fillLabels = (text, { staffLabel, staffLabelPlural } = {}) =>
  String(text || '').replace(/\{staffs\}/g, (staffLabelPlural || 'Staff').toLowerCase()).replace(/\{staff\}/g, staffLabel || 'Staff');

const entryViews = (r) => [r.view, ...(r.tabs || []).map((t) => t.view)];

// Every view a live or legacy report answers to. A `soon` report has no views: it can't be opened.
export const REPORT_VIEWS = new Set(REPORTS.filter((r) => r.status !== 'soon').flatMap(entryViews));
export const isReportView = (view) => view === 'all-reports' || REPORT_VIEWS.has(view);

// The report a view belongs to (a tab's view resolves to its parent report). `soon` reports resolve to null.
export const getReportByView = (view) => REPORTS.find((r) => r.status !== 'soon' && entryViews(r).includes(view)) || null;

// A report's tab views for this role (flags and roles already applied). Fewer than two tabs means no tab strip.
export const getReportTabs = (report, role) => (report?.tabs || []).filter((t) => !t.roles || t.roles.includes(role));

// Can this role open this view at all (role + status)? Deep links use this; a role-limited tab (Due report: admin) is checked on its own.
export const canOpenReport = (report, role, view = null) => {
  if (!report || report.status === 'soon' || !report.roles.includes(role)) return false;
  const tab = view ? (report.tabs || []).find((t) => t.view === view) : null;
  return !tab || !tab.roles || tab.roles.includes(role);
};

// What the menu and home list for this role: no `soon` reports.
export const getVisibleReports = (role) => REPORTS.filter((r) => r.status !== 'soon' && r.roles.includes(role));

export const getVisibleGroups = (role) => REPORT_GROUPS
  .map((g) => ({ ...g, items: getVisibleReports(role).filter((r) => r.group === g.id) }))
  .filter((g) => g.items.length);

// Every openable view (reports and their tabs) for the command palette: a tab such as "Sales by category" stays searchable.
export const getSearchableReportViews = (role) => getVisibleReports(role).flatMap((r) => {
  const tabs = getReportTabs(r, role);
  const views = tabs.length > 1 ? tabs.map((t) => ({ view: t.view, title: t.view === r.view ? r.title : `${r.title} · ${t.label}` })) : [{ view: r.view, title: r.title }];
  return views.map((v) => ({ ...v, icon: r.icon, keywords: r.keywords }));
});

// Is this report id one a person can open right now (an insight's "Open ..." button hides itself when not)?
export const isReportOpenable = (view, role) => {
  const r = getReportByView(view);
  return canOpenReport(r, role, view);
};

// Favourites were saved under the old report ids; they follow the report to its new id.
export const LEGACY_FAVOURITE_IDS = {
  daily: 'day-close', 'service-revenue': 'revenue-by-service', 'category-revenue': 'revenue-by-service', outstanding: 'money-owed', 'due-report': 'money-owed',
  performance: 'staff-performance', 'attendance-report': 'attendance', 'attendance-calendar': 'attendance', 'transfer-report': 'transfers',
  referrals: 'sources-referrals', 'customer-referrals': 'sources-referrals', 'referral-wallet': 'sources-referrals',
};
export const migrateFavourites = (ids) => [...new Set((ids || []).map((id) => LEGACY_FAVOURITE_IDS[id] || id))];
