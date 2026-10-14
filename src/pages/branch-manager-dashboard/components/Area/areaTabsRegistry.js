import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED, OUTREACH_ENABLED } from 'lib/featureFlags';

// Small areas (2–4 pages) get tabs at the top of the page; each tab is an existing `?view=` URL, so every view URL keeps working.
// Roles, flags and `overallHidden` mirror the sidebar entries these tabs replace.
const ALL = ['staff', 'manager', 'admin', 'admin_viewer'];
const STAFF_UP = ['manager', 'admin', 'admin_viewer'];

export const AREAS = [
  {
    id: 'bookings',
    title: 'Bookings',
    description: ({ branchName, isOverall }) => `Every booking at ${isOverall ? 'all branches' : (branchName || 'this branch')}.`,
    tabs: [
      { view: 'bookings', label: 'All bookings', roles: ALL },
      { view: 'new-booking', label: 'New booking', roles: ALL, overallHidden: true },
      { view: 'check-booking', label: 'Check booking', roles: ALL, overallHidden: true },
      { view: 'collect-payment', label: 'Collect payment', roles: ['staff'] },
      ...(MEMBERSHIP_ENABLED ? [{ view: 'new-membership', label: 'New membership', roles: ['staff'] }] : []),
      ...(VOUCHER_ENABLED ? [{ view: 'new-voucher', label: 'New voucher', roles: ['staff'] }] : []),
    ],
  },
  // Single pages: one tab, so the header shows and there is no tab row.
  {
    id: 'therapists',
    title: ({ staffLabelPlural }) => staffLabelPlural || 'Staff',
    description: () => 'Everyone who serves customers, and their positions.',
    tabs: [{ view: 'therapists', label: ({ staffLabelPlural }) => staffLabelPlural || 'Staff', roles: STAFF_UP }],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    description: () => "Who's in today, check-ins and check-outs.",
    tabs: [{ view: 'attendance', label: 'Attendance', roles: STAFF_UP, overallHidden: true }],
  },
  {
    id: 'payroll',
    title: 'Payroll',
    description: () => 'Monthly pay runs for your team.',
    tabs: [{ view: 'payroll', label: 'Payroll', roles: ['admin', 'admin_viewer'] }],
  },
  {
    id: 'packages',
    title: 'Packages',
    description: () => 'Packages you sell and the ones customers hold.',
    tabs: [
      { view: 'package-overview', label: 'All packages', roles: ['manager', 'admin'] },
      { view: 'packages', label: 'Issued', roles: ['manager', 'admin'] },
    ],
  },
  // Flagged areas: only present when the feature is on.
  ...(MEMBERSHIP_ENABLED ? [{
    id: 'memberships',
    title: 'Memberships',
    description: () => 'Prepaid memberships, what has been collected and how wallets are used.',
    tabs: [
      { view: 'memberships', label: 'All memberships', roles: ['manager', 'admin'] },
      { view: 'membership-collection', label: 'Collection', roles: ['manager', 'admin'] },
      { view: 'wallet-usage', label: 'Wallet usage', roles: ['manager', 'admin'] },
    ],
  }] : []),
  ...(VOUCHER_ENABLED ? [{
    id: 'vouchers',
    title: 'Vouchers',
    description: () => 'Gift vouchers you sell and the ones that have been issued.',
    tabs: [
      { view: 'voucher-overview', label: 'All vouchers', roles: ['manager', 'admin'] },
      { view: 'vouchers', label: 'Issued', roles: ['manager', 'admin'] },
    ],
  }] : []),
  ...(OUTREACH_ENABLED ? [{
    id: 'outreach',
    title: 'Outreach',
    description: () => 'Automated messages to your customers.',
    tabs: [
      { view: 'outreach-rules', label: 'Rules', roles: ['admin'] },
      { view: 'outreach-templates', label: 'Templates', roles: ['admin'] },
      { view: 'outreach-review', label: 'Review queue', roles: ['admin'] },
      { view: 'outreach-log', label: 'Message log', roles: ['admin'] },
      { view: 'outreach-settings', label: 'Settings', roles: ['admin'] },
    ],
  }] : []),
];

export const getAreaForView = (view) => AREAS.find((a) => a.tabs.some((t) => t.view === view)) || null;

// Tabs this role / branch can see, in order (labels resolved).
export const getVisibleTabs = (area, { role, isOverall, ...labels }) =>
  area.tabs
    .filter((t) => t.roles.includes(role) && !(isOverall && t.overallHidden))
    .map((t) => ({ ...t, label: typeof t.label === 'function' ? t.label(labels) : t.label }));
