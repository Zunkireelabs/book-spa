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
  { name: 'Card', subMethods: ['Mastercard'] },
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

export function flattenPaymentMethodOptions(paymentMethods) {
  const options = [];
  (paymentMethods || []).forEach((m) => {
    if (typeof m === 'string') {
      options.push({ value: m, label: humanizePaymentMethod(m) });
      return;
    }
    if (m && typeof m === 'object' && m.name) {
      const subMethods = m.subMethods || [];
      if (subMethods.length > 0) {
        subMethods.forEach((sub) => options.push({ value: sub, label: sub }));
      } else {
        options.push({ value: m.name, label: humanizePaymentMethod(m.name) });
      }
    }
  });
  return options;
}
