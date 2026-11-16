import { CUSTOMER_REFERRALS_ENABLED } from 'lib/featureFlags';

// Registry for the Settings area (same shape as the report registry, plus `overallHidden`). Roles, gates and icons mirror the
// sidebar's former "Setup" group. Reward Catalog moved here from Reports.
const STAFF_UP = ['manager', 'admin', 'admin_viewer'];
const MGR_ADMIN = ['manager', 'admin']; // master-data pages: admin_viewer cannot read them (RLS), so they are not offered

export const SETTINGS_CATEGORIES = [
  { id: 'spa', label: 'Spa' },
  { id: 'payments', label: 'Payments' },
  { id: 'booking', label: 'Booking & profile' },
  { id: 'account', label: 'Account' },
];

export const SETTINGS = [
  // `location: true` -> the title uses the industry's location label (Rooms / ...); `needsRooms` -> only when the industry uses rooms.
  { id: 'rooms', view: 'rooms', title: 'Rooms', location: true, needsRooms: true, description: 'Rooms customers are booked into.', icon: 'DoorOpen', category: 'spa', roles: MGR_ADMIN, overallHidden: true, keywords: 'locations' },
  { id: 'services', view: 'services', title: 'Services', description: 'Services, prices and durations.', icon: 'Sparkles', category: 'spa', roles: MGR_ADMIN, overallHidden: true, keywords: 'treatments prices' },
  { id: 'price-tiers', view: 'price-tiers', title: 'Price Tiers', description: 'Staff price levels for tiered services.', icon: 'Tags', category: 'spa', roles: STAFF_UP, overallHidden: true, keywords: 'tiers senior junior pricing' },
  { id: 'locations', view: 'locations', title: 'Locations', description: 'Your branches: add, edit and set them up.', icon: 'MapPin', category: 'spa', roles: ['admin'], keywords: 'branches outlets sites' },
  { id: 'categories', view: 'categories', title: 'Categories', description: 'Groups that organise your services.', icon: 'Tags', category: 'spa', roles: MGR_ADMIN, overallHidden: true, keywords: 'groups' },

  { id: 'payment-methods', view: 'payment-methods', title: 'Payment Methods', description: 'How customers can pay at the desk.', icon: 'CreditCard', category: 'payments', roles: ['admin'], overallHidden: true, keywords: 'cash card pay methods' },
  { id: 'billing', view: 'billing', title: 'Billing', description: 'VAT, invoice numbering and billing details.', icon: 'Receipt', category: 'payments', roles: ['admin'], keywords: 'vat invoice tax pan' },
  ...(CUSTOMER_REFERRALS_ENABLED ? [
    { id: 'reward-catalog', view: 'reward-catalog', title: 'Reward Catalog', description: 'Rewards staff can pick when logging a referral.', icon: 'Gift', category: 'payments', roles: ['manager', 'admin'] },
  ] : []),

  { id: 'booking-settings', view: 'booking-settings', title: 'Booking Settings', description: 'Online booking rules and availability.', icon: 'Settings', category: 'booking', roles: ['admin'], overallHidden: true, keywords: 'online rules hours' },
  { id: 'calendar-settings', view: 'calendar-settings', title: 'Calendar Settings', description: 'Calendar hours, full-day view and display options.', icon: 'CalendarCog', category: 'booking', roles: ['admin'], overallHidden: true, keywords: 'calendar hours grid start end full day' },
  { id: 'closed-dates', view: 'closed-dates', title: 'Closed Dates', description: 'Days the branch is closed (holidays and special closures).', icon: 'CalendarOff', category: 'booking', roles: ['admin'], overallHidden: true, keywords: 'holiday closed days off' },
  { id: 'provider-profile', view: 'provider-profile', title: 'Provider Profile', description: 'Your spa profile and images shown to customers.', icon: 'Image', category: 'booking', roles: ['admin'], overallHidden: true, keywords: 'logo photos about' },

  { id: 'attendance-settings', view: 'attendance-settings', title: 'Attendance', description: 'How this branch tracks attendance.', icon: 'Clock', category: 'booking', roles: MGR_ADMIN, overallHidden: true, keywords: 'late grace check out shift' },
  { id: 'staff-access', view: 'staff-access', title: 'Staff access', description: 'Who can sign in, with which role and permissions.', icon: 'KeyRound', category: 'account', roles: STAFF_UP, keywords: 'login pin permissions users roles' },
  { id: 'notifications', view: 'notifications', title: 'Notifications', description: 'What interrupts you: pop-ups, sound and desktop alerts.', icon: 'Bell', category: 'account', roles: STAFF_UP, keywords: 'alerts pop-up sound inbox' },
  { id: 'audit', view: 'audit', title: 'Audit Log', description: 'Every change made in this spa, and who made it.', icon: 'History', category: 'account', roles: STAFF_UP, keywords: 'history log changes who' },
];

export const SETTINGS_VIEWS = new Set(SETTINGS.map((s) => s.view));
// 'settings' is the landing alias; 'infrastructure' is the retired combined page and now maps to it as well.
export const isSettingsView = (view) => view === 'settings' || view === 'infrastructure' || SETTINGS_VIEWS.has(view);
export const getSettingByView = (view) => SETTINGS.find((s) => s.view === view) || null;

export const canOpenSetting = (item, role, isOverall) => !!item && item.roles.includes(role) && !(isOverall && item.overallHidden);

// Visible pages for the role / branch / industry, in menu order.
export const getVisibleSettings = ({ role, isOverall, enableRooms }) =>
  SETTINGS.filter((s) => s.roles.includes(role) && !(isOverall && s.overallHidden) && !(s.needsRooms && !enableRooms));
