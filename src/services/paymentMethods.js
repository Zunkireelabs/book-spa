// Shared payment-method logic: the org-configurable list (organizations.settings
// .paymentMethods), the fallback for orgs that haven't configured one yet, and
// label formatting. 'Membership' is intentionally excluded — it's a wallet-driven
// option added dynamically in PaymentModal, not part of the admin-editable list.

export const DEFAULT_PAYMENT_METHODS = ['Cash', 'Card', 'MobileBanking', 'Cheque', 'Esewa', 'Khalti'];

const KNOWN_LABELS = {
  Cash: 'Cash',
  Card: 'Card',
  MobileBanking: 'Mobile Banking',
  Cheque: 'Cheque',
  Esewa: 'Esewa',
  Khalti: 'Khalti',
};

export function getOrgPaymentMethods(orgSettings) {
  const methods = orgSettings?.paymentMethods;
  return Array.isArray(methods) && methods.length > 0 ? methods : DEFAULT_PAYMENT_METHODS;
}

export function humanizePaymentMethod(value) {
  return KNOWN_LABELS[value] || value;
}
