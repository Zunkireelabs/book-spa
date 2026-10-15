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
  { id: 'categories', view: 'categories', title: 'Categories', description: 'Groups that organise your services.', icon: 'Tags', category: 'spa', roles: MGR_ADMIN, overallHidden: true, keywords: 'groups' },

  { id: 'payment-methods', view: 'payment-methods', title: 'Payment Methods', description: 'How customers can pay at the desk.', icon: 'CreditCard', category: 'payments', roles: ['admin'], overallHidden: true, keywords: 'cash card pay methods' },
  ...(CUSTOMER_REFERRALS_ENABLED ? [
    { id: 'reward-catalog', view: 'reward-catalog', title: 'Reward Catalog', description: 'Rewards staff can pick when logging a referral.', icon: 'Gift', category: 'payments', roles: ['manager', 'admin'] },
  ] : []),

  { id: 'booking-settings', view: 'booking-settings', title: 'Booking Settings', description: 'Online booking rules and availability.', icon: 'Settings', category: 'booking', roles: ['admin'], overallHidden: true, keywords: 'online rules hours' },
  { id: 'provider-profile', view: 'provider-profile', title: 'Provider Profile', description: 'Your spa profile and images shown to customers.', icon: 'Image', category: 'booking', roles: ['admin'], overallHidden: true, keywords: 'logo photos about' },

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
