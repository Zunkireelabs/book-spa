import { describe, it, expect, vi } from 'vitest';

vi.mock('lib/featureFlags', () => ({ CUSTOMER_REFERRALS_ENABLED: true }));

const reg = await import('./reportRegistry');
const { REPORTS, REPORT_GROUPS, START_HERE, getVisibleReports, getVisibleGroups, getReportByView, getReportTabs, canOpenReport, isReportView, fillLabels, isReportOpenable, getSearchableReportViews, migrateFavourites } = reg;

describe('registry shape', () => {
  it('has 17 reports in the 5 approved groups', () => {
    expect(REPORTS).toHaveLength(17);
    expect(REPORT_GROUPS.map((g) => g.label)).toEqual(['Overview', 'Sales & money', 'Customers', 'Team', 'Products & prepaid']);
    expect(REPORTS.every((r) => REPORT_GROUPS.some((g) => g.id === r.group))).toBe(true);
  });
  it('Business health and Money owed are live; ids and views are unique', () => {
    expect(REPORTS.filter((r) => r.status === 'live').map((r) => r.id)).toEqual(['business-health', 'money-owed']);
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(17);
    expect(new Set(REPORTS.map((r) => r.view)).size).toBe(17);
  });
  it('Start here points at real, visible reports', () => {
    expect(START_HERE.every((id) => getVisibleReports('admin').some((r) => r.id === id))).toBe(true);
  });
});

describe('soon reports are hidden and cannot be opened', () => {
  it('keeps them out of the menu, the groups and view resolution', () => {
    const soon = REPORTS.filter((r) => r.status === 'soon');
    expect(soon.length).toBeGreaterThan(0);
    for (const r of soon) {
      expect(getVisibleReports('admin')).not.toContain(r);
      expect(getReportByView(r.view)).toBeNull();
      expect(isReportView(r.view)).toBe(false);
      expect(canOpenReport(r, 'admin')).toBe(false);
      expect(isReportOpenable(r.view, 'admin')).toBe(false);
    }
    expect(getVisibleGroups('admin').flatMap((g) => g.items).every((r) => r.status !== 'soon')).toBe(true);
  });
});

describe('roles', () => {
  it('staff sees no reports; manager, admin and admin_viewer see the same list', () => {
    expect(getVisibleReports('staff')).toEqual([]);
    expect(getVisibleReports('manager').map((r) => r.id)).toEqual(getVisibleReports('admin').map((r) => r.id));
    expect(getVisibleReports('admin_viewer').length).toBe(getVisibleReports('admin').length);
    expect(canOpenReport(getReportByView('business-health'), 'staff')).toBe(false);
  });
  it('the old Outstanding and Due report views open Money owed, for every report role', () => {
    for (const view of ['outstanding', 'due-report']) {
      const r = getReportByView(view);
      expect(r.id).toBe('money-owed');
      expect(r.status).toBe('live');
      expect(canOpenReport(r, 'manager', view)).toBe(true);
      expect(canOpenReport(r, 'admin', view)).toBe(true);
      expect(canOpenReport(r, 'staff', view)).toBe(false);
    }
  });
});

describe('legacy views still resolve (deep links keep working)', () => {
  const legacy = {
    reports: 'day-close', 'service-revenue': 'revenue-by-service', 'category-revenue': 'revenue-by-service', discounts: 'discounts',
    outstanding: 'money-owed', 'due-report': 'money-owed', 'money-owed': 'money-owed', performance: 'staff-performance', 'attendance-report': 'attendance',
    'attendance-calendar': 'attendance', 'transfer-report': 'transfers', referrals: 'sources-referrals',
    'customer-referrals': 'sources-referrals', 'referral-wallet': 'sources-referrals',
  };
  it.each(Object.entries(legacy))('%s opens inside %s', (view, id) => {
    expect(isReportView(view)).toBe(true);
    expect(getReportByView(view).id).toBe(id);
    expect(canOpenReport(getReportByView(view), 'admin', view)).toBe(true);
  });
  it('all-reports and the new Business health view are report views', () => {
    expect(isReportView('all-reports')).toBe(true);
    expect(isReportView('business-health')).toBe(true);
    expect(isReportView('dashboard')).toBe(false);
  });
  it('the command palette can still find a folded-in view', () => {
    expect(getSearchableReportViews('admin').some((v) => v.view === 'category-revenue')).toBe(true);
  });
});

describe('industry words', () => {
  it('fills the staff word from the org, never hard-coded', () => {
    expect(fillLabels('{staff} performance', { staffLabel: 'Stylist' })).toBe('Stylist performance');
    expect(fillLabels('Booked vs working hours, {staffs} and rooms', { staffLabelPlural: 'Doctors' })).toBe('Booked vs working hours, doctors and rooms');
    expect(fillLabels('{staff} performance')).toBe('Staff performance');
  });
});

describe('favourites', () => {
  it('old ids follow the report to its new id, once', () => {
    expect(migrateFavourites(['daily', 'category-revenue', 'service-revenue', 'discounts', 'business-health'])).toEqual(['day-close', 'revenue-by-service', 'discounts', 'business-health']);
    expect(migrateFavourites(null)).toEqual([]);
  });
});
