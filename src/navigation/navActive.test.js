import { describe, it, expect } from 'vitest';
import { getNav, navPath } from './navRegistry';
import { resolveActiveNav, claimedItemId, ROUTE_OWNER } from './navActive';
import { REPORTS } from 'pages/branch-manager-dashboard/components/Reports/reportRegistry';
import { SETTINGS } from 'pages/branch-manager-dashboard/components/Settings/settingsRegistry';
import { AREAS } from 'pages/branch-manager-dashboard/components/Area/areaTabsRegistry';

// Same construction as StaffSidebar: the role's nav, flattened, with routePath kept.
const build = (role) => {
  const { sections, footer } = getNav({ role, isOverall: false, staffLabelPlural: 'Therapists', productLabel: 'Products' });
  const items = [...sections.flatMap((s) => s.items), ...footer].map((i) => ({ ...i, routePath: i.path, path: navPath(i, '/org/dashboard') }));
  const primaryIds = ['dashboard', 'calendar', 'bookings', ['manager', 'admin', 'admin_viewer'].includes(role) ? 'customers' : null].filter(Boolean);
  return { role, items, primaryIds };
};
const at = (ctx, pathname, view = null) => resolveActiveNav({ ...ctx, pathname, view });
const D = '/org/dashboard';

describe('resolveActiveNav: view to tab', () => {
  const m = build('manager');
  it.each([
    [null, 'dashboard', 'dashboard'],                 // bare URL = landing
    ['dashboard', 'dashboard', 'dashboard'],
    ['calendar', 'calendar', 'calendar'],
    ['bookings', 'bookings', 'bookings'],
    ['new-booking', 'bookings', 'bookings'],          // sub-views of an area
    ['check-booking', 'bookings', 'bookings'],
    ['collect-payment', 'bookings', 'bookings'],
    ['customers', 'customers', 'customers'],
    ['branch', 'dashboard', 'dashboard'],             // home page's own tabs
    ['myday', 'dashboard', 'dashboard'],
  ])('view %s lights %s', (view, item, tab) => {
    expect(at(m, D, view)).toMatchObject({ itemId: item, tabId: tab });
  });
  it.each([
    ['all-reports', 'reports'], ['service-revenue', 'reports'], ['performance', 'reports'],
    ['settings', 'settings'], ['rooms', 'settings'], ['billing', 'settings'], ['provider-profile', 'settings'],
    ['therapists', 'therapists'], ['therapists-inactive', 'therapists'], ['therapists-transfers', 'therapists'], ['roster', 'therapists'],
    ['attendance', 'attendance'],
    ['packages', 'packages'], ['package-overview', 'packages'],
  ])('view %s lights More, marking %s inside it', (view, item) => {
    expect(at(m, D, view)).toMatchObject({ itemId: item, tabId: 'more', claimed: true });
  });
  it('routes of their own', () => {
    expect(at(m, '/org/inbox')).toMatchObject({ itemId: 'inbox', tabId: 'more' });
    expect(at(m, '/org/bookings/abc')).toMatchObject({ itemId: 'bookings', tabId: 'bookings' });
    expect(at(m, '/org/customers/abc')).toMatchObject({ itemId: 'customers', tabId: 'customers' });
    expect(at(m, '/org/customers/abc/messages')).toMatchObject({ itemId: 'customers', tabId: 'customers' });
    expect(at(m, '/org/staff/abc')).toMatchObject({ itemId: 'therapists', tabId: 'more' });
    expect(at(m, '/org/staff/new')).toMatchObject({ itemId: 'therapists', tabId: 'more' });
    expect(at(m, '/org/attendance-calendar')).toMatchObject({ itemId: 'attendance', tabId: 'more' });
    expect(at(m, '/org/services/s1')).toMatchObject({ itemId: 'settings', tabId: 'more' });
    expect(at(m, '/org/locations/new')).toMatchObject({ itemId: 'settings', tabId: 'more' });
  });
  it('an unknown view falls back to Dashboard, flagged unclaimed; there is always exactly one tab', () => {
    expect(at(m, D, 'nonsense')).toEqual({ itemId: 'dashboard', tabId: 'dashboard', claimed: false });
  });
});

describe('roles', () => {
  it('staff: bare URL lands on Calendar; Customers is not a pill', () => {
    const s = build('staff');
    expect(s.primaryIds).toEqual(['dashboard', 'calendar', 'bookings']);
    expect(at(s, D, null)).toMatchObject({ itemId: 'calendar', tabId: 'calendar' });
    expect(at(s, '/org/inbox')).toMatchObject({ itemId: 'inbox', tabId: 'more' });
  });
  it('a page the role cannot see falls back to Dashboard instead of lighting nothing', () => {
    const s = build('staff');
    expect(at(s, '/org/staff/abc')).toMatchObject({ itemId: 'dashboard', claimed: false });
    expect(at(s, D, 'payroll')).toMatchObject({ itemId: 'dashboard', claimed: false });
  });
  it('admin sees Payroll and Outreach views inside More', () => {
    const a = build('admin');
    expect(at(a, D, 'payroll')).toMatchObject({ itemId: 'payroll', tabId: 'more' });
    expect(at(a, D, 'outreach-templates')).toMatchObject({ itemId: 'outreach', tabId: 'more' });
  });
});

describe('every view the app knows is claimed (no registry drift)', () => {
  const admin = build('admin');
  const views = [
    ...REPORTS.filter((r) => r.status !== 'soon').flatMap((r) => [r.view, ...(r.tabs || []).map((t) => t.view)]).filter(Boolean),
    ...SETTINGS.map((s) => s.view),
    ...AREAS.flatMap((a) => a.tabs.map((t) => t.view)),
  ];
  it.each([...new Set(views)])('%s', (view) => {
    const id = claimedItemId({ pathname: D, view, role: 'admin', items: admin.items });
    expect(id).not.toBeNull();
  });
});

describe('every /:orgSlug/<page> app route is owned or deliberately excluded', () => {
  // Hard-coded from Routes.jsx. Staff-facing pages must have a ROUTE_OWNER (so the nav never lights the wrong thing).
  const OWNED = ['attendance-calendar', 'bookings', 'customers', 'inbox', 'locations', 'services', 'staff'];
  // Not part of the staff nav at all: the staff sidebar is never rendered on them.
  const EXCLUDED = {
    book: 'public customer booking flow',
    manage: 'public redirect to /book',
    login: 'staff login (no nav yet)',
    signup: 'customer signup',
    'customer-login': 'customer login',
    account: 'CUSTOMER account page (TenantWrapper), not the staff profile menu, which opens ?view=settings',
    dashboard: 'the ?view= route, resolved by view',
  };
  it.each(OWNED)('%s has a ROUTE_OWNER', (page) => { expect(ROUTE_OWNER[page]).toBeTruthy(); });
  it.each(Object.keys(EXCLUDED))('%s is excluded on purpose', (page) => { expect(ROUTE_OWNER[page]).toBeUndefined(); });
  it('the profile menu destination (?view=settings) lights More/Settings for manager and admin; staff falls back', () => {
    for (const role of ['manager', 'admin']) expect(at(build(role), D, 'settings')).toMatchObject({ itemId: 'settings', tabId: 'more' });
    expect(at(build('staff'), D, 'settings')).toMatchObject({ itemId: 'dashboard', claimed: false }); // Settings is not in staff's nav
  });
});
