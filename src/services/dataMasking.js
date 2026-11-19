// ZNLY-235: the ONE place that decides how a hidden customer detail looks and who counts as restricted.
// The database already masks for restricted logins (migration 393: bookings_safe, customers_safe, ...); the same two
// mask functions exist in SQL (mask_person_name, mask_phone_digits) and are held in step by dataMasking.test.js.
// Screens use these helpers for anything not read from the database (notifications text, local drafts, search results).

// "Sadin Shrestha" -> "Sadin S."; a single word stays as is; never stars (owner decision 2026-11-17). Twin of SQL mask_person_name.
export function maskCustomerName(name) {
  if (!name) return name;
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// "+9779800000012" -> "98•••••012": first 2 + 5 dots + last 3 of the national number, always the same width. Twin of SQL mask_phone_digits.
export function maskPhone(phone) {
  if (!phone) return phone;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 5) return '•'.repeat(10);
  const nat = digits.slice(-10);
  return `${nat.slice(0, 2)}•••••${digits.slice(-3)}`;
}

// Last three digits of a (masked or real) phone, for telling two "Sita S." apart in a list: "Sadin S. · 094".
export const phoneTail = (phone) => (phone ? String(phone).replace(/\D/g, '').slice(-3) : '');
// Name for a list or calendar block: a masked phone (it has •) adds the last 3 digits, a real one adds nothing.
export const nameForList = (name, phone) => (String(phone || '').includes('•') ? nameWithTail(name, phone) : name);
export const nameWithTailDigits = (name, tail) => (name && tail ? `${name} · ${tail}` : name);
export const nameWithTail = (name, phone) => { const t = phoneTail(phone); return t ? `${name} · ${t}` : name; };

// What a login may see, from its users row. Managers and admins are never restricted (same rule as migration 393's
// caller_hides_* and api.js resolveVisibility); the hide flags only mean something for the Staff role.
export function viewerAccess(profile) {
  const staff = !!profile && profile.role === 'staff';
  return {
    ownOnly: !!profile && !['manager', 'admin'].includes(profile.role) && profile.calendar_visibility === 'own',
    canViewCustomerDetails: !staff || profile.can_view_customer_details !== false,
    canViewPrices: !staff || profile.can_view_prices !== false,
  };
}

// True when this login must read sensitive tables through the *_safe views.
export const isRestricted = (profile) => {
  const a = viewerAccess(profile);
  return a.ownOnly || !a.canViewCustomerDetails || !a.canViewPrices;
};

// Display helpers every screen shares: a hidden value is dashes, never "NPR 0" or "undefined".
export const moneyOrDash = (amount, canViewPrices, format) => (canViewPrices === false || amount == null ? '—' : format(amount));
export const nameForViewer = (name, canViewCustomerDetails) => (canViewCustomerDetails === false ? maskCustomerName(name) : name);
export const phoneForViewer = (phone, canViewCustomerDetails) => (canViewCustomerDetails === false ? maskPhone(phone) : phone);

// Copy of a booking-shaped object with whatever this viewer may not see removed or masked. Idempotent on already-masked rows.
export function maskBookingForViewer(b, access) {
  if (!b) return b;
  const out = { ...b };
  if (access.canViewCustomerDetails === false) {
    ['customer_name', 'customerName', 'companion_name'].forEach((k) => { if (k in out) out[k] = maskCustomerName(out[k]); });
    ['customer_phone', 'customerPhone', 'companion_phone', 'companionPhone'].forEach((k) => { if (k in out) out[k] = maskPhone(out[k]); });
    ['customer_email', 'customerEmail'].forEach((k) => { if (k in out) out[k] = null; });
  }
  if (access.canViewPrices === false) {
    ['base_amount', 'discount_amount', 'final_amount', 'service_price_snapshot', 'member_discount', 'baseAmount', 'discountAmount', 'finalAmount', 'amount']
      .forEach((k) => { if (k in out) out[k] = null; });
  }
  return out;
}

export const UNLINKED_LOGIN_MESSAGE = "Your login isn't linked to a team member yet. Ask your manager.";
export const OWN_BOOKINGS_HEADER = 'Your bookings';
