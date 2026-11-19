// Shared payment-method logic: the org-configurable list (organizations.settings
// .paymentMethods), the fallback for orgs that haven't configured one yet, and
// label formatting. 'Membership' is intentionally excluded — it's a wallet-driven
// option added dynamically in PaymentModal, not part of the admin-editable list.
//
// Each entry is either a plain string (a leaf method, e.g. 'Cash') or
// { name, subMethods: string[] } (a group, e.g. Card -> Mastercard). Once a group
// has sub-methods, the generic group name is no longer offered when recording a
// payment — only its specific sub-methods are, since picking a brand is always
// more precise. A group with zero sub-methods still offers its own name (there's
// nothing more specific to pick).

export const DEFAULT_PAYMENT_METHODS = [
  'Cash',
  { name: 'Card', subMethods: ['Mastercard', 'Visa'] },
  { name: 'Digital Wallet', subMethods: ['Khalti', 'eSewa', 'IME Pay'] },
  'MobileBanking',
  'Cheque',
];

const KNOWN_LABELS = {
  Cash: 'Cash',
  Card: 'Card',
  MobileBanking: 'Mobile Banking',
  Cheque: 'Cheque',
  Esewa: 'Esewa',
  Khalti: 'Khalti',
  'Digital Wallet': 'Digital Wallet',
};

export function getOrgPaymentMethods(orgSettings) {
  const methods = orgSettings?.paymentMethods;
  return Array.isArray(methods) && methods.length > 0 ? methods : DEFAULT_PAYMENT_METHODS;
}

export function humanizePaymentMethod(value) {
  return KNOWN_LABELS[value] || value;
}

// Two-level tree for the hierarchical payment-method selector: top-level entries,
// each optionally carrying its own drill-down subMethods list. A group with no
// subMethods is a selectable leaf (nothing more specific to pick).
export function buildPaymentMethodTree(paymentMethods) {
  return (paymentMethods || []).map((m) => {
    if (typeof m === 'string') return { value: m, label: humanizePaymentMethod(m) };
    const subMethods = (m.subMethods || []).map((s) => ({ value: s, label: s }));
    return { value: m.name, label: humanizePaymentMethod(m.name), subMethods };
  });
}

// Which bucket a payment mode belongs to in the day's cash / card / digital split (ZNLY-234). Card brands the org configured under a card group
// (Card -> Mastercard, Visa ...) are cards, not "fonepay"; so is any method whose own name says card (Nabil Card ...).
const CARD_NAME = /\b(cards?|visa|master ?card|amex|american express|union ?pay|rupay)\b/i;
const sameName = (a) => String(a || '').trim().toLowerCase();

// The lower-cased names that count as card, from the org's method tree (strings and { name, subMethods }).
export function cardModeNames(methods) {
  const out = new Set();
  for (const m of (Array.isArray(methods) ? methods : [])) {
    if (typeof m === 'string') { if (CARD_NAME.test(m)) out.add(sameName(m)); continue; }
    if (!m || typeof m !== 'object') continue;
    const subs = Array.isArray(m.subMethods) ? m.subMethods : [];
    if (CARD_NAME.test(m.name || '')) { out.add(sameName(m.name)); subs.forEach((x) => out.add(sameName(x))); }
    else subs.forEach((x) => { if (CARD_NAME.test(x)) out.add(sameName(x)); });
  }
  return out;
}

// 'cash' | 'card' | 'fonepay' (digital / other) for one payment mode.
export function bucketForMode(mode, cardNames = new Set()) {
  const m = sameName(mode);
  if (m === 'cash') return 'cash';
  if (cardNames.has(m) || CARD_NAME.test(m)) return 'card';
  return 'fonepay';
}
