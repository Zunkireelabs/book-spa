import { toTitleCase } from '../services/bookingTransformers';
import { phoneProblem } from './phone';

// ZNLY-327: the three ways a booking names its customer. 'new' = typed details (a profile is found or created), 'existing' = picked from the list,
// 'walkin' = no profile at all. `null` = nothing picked yet (the form cannot be saved).
export const PICK_REASON = 'Pick a customer or Walk-in';

/** "Walk-in" or "Walk-in · Ram": what bookings.customer_name holds for a walk-in (the label is a first name, title-cased). */
export function walkInName(label) {
  const l = toTitleCase(String(label || '').trim());
  return l ? `Walk-in · ${l}` : 'Walk-in';
}

/** What typed search text becomes when staff pick "New customer": digits (with + / spaces / dashes) are the phone, anything else the name. */
export function seedFromSearch(q) {
  const t = String(q || '').trim();
  if (!t) return { name: '', phone: '' };
  if (/^[+\d][\d\s-]*$/.test(t)) return { name: '', phone: t.replace(/\D/g, '') };
  return { name: t, phone: '' };
}

/** Case-insensitive name / email match, phone compared digits-only (so a local number finds a stored international one). */
export function searchCustomers(customers, q, limit = 8) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return [];
  const digits = term.replace(/\D/g, '');
  return (customers || []).filter((c) => (
    (c.full_name && c.full_name.toLowerCase().includes(term))
    || (c.email && c.email.toLowerCase().includes(term))
    || (digits.length >= 2 && c.phone && c.phone.replace(/\D/g, '').includes(digits))
  )).slice(0, limit);
}

/**
 * The customer part of a booking save, from the picker state. Walk-in: no profile, no phone, no email, customer_name "Walk-in[ · label]".
 * Everything else keeps today's fields (phone E.164 = dial + digits; a known customer id is passed so createBooking links, never re-resolves).
 */
export function customerSavePayload({ kind, name = '', phone = '', countryCode = '+977', email = '', gender = '', knownCustomerId = null, walkInLabel = '' }) {
  if (kind === 'walkin') {
    return { customerName: walkInName(walkInLabel), customerPhone: null, customerEmail: null, customerGender: null, knownCustomerId: undefined, isWalkIn: true, walkInLabel: String(walkInLabel || '').trim() || null };
  }
  const digits = String(phone || '').replace(/\D/g, '');
  return {
    customerName: String(name || '').trim(),
    customerPhone: digits ? countryCode + digits : null,
    customerEmail: String(email || '').trim() || null,
    customerGender: gender || null,
    knownCustomerId: knownCustomerId || undefined,
  };
}

/** The footer reason when the customer part is incomplete ('' = ready). */
export function customerMissing({ kind, name = '', phone = '', countryCode = '+977', knownCustomerId = null }) {
  if (kind === 'walkin') return '';
  if (!kind) return PICK_REASON;
  if (!String(name).trim()) return 'Enter the customer name';
  if (!String(phone).replace(/\D/g, '') && !knownCustomerId) return 'Enter the customer phone';
  // ZNLY-327: a typed number must be a real one for its country. A picked customer's stored number is never re-checked.
  if (kind === 'new') return phoneProblem(countryCode, phone);
  return '';
}
