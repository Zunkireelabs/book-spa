// The "Bill" message (ZNLY-410 step 2): wording the admin sets in Outreach → Rules, used by Send to ▾.
// Only three placeholders exist, so no amount can ever be put in a message (owner rule, 27 Nov).
export const BILL_PLACEHOLDERS = [
  { key: 'first_name', label: 'first name' },
  { key: 'business', label: 'business' },
  { key: 'bill_number', label: 'bill number' },
];

// One outreach_templates row per channel: (org_id, key) is unique, so WhatsApp has its own key.
export const BILL_TEMPLATE_KEYS = { email: 'bill_ready', whatsapp: 'bill_ready_whatsapp' };

const BODY = 'Hi {first_name}, thank you for visiting {business} today. Your bill {bill_number} is ready.';
export const DEFAULT_BILL_MESSAGE = {
  email: { subject: 'Your bill {bill_number} from {business}', body: BODY },
  whatsapp: { subject: null, body: BODY },
};

// Fills the three placeholders. Any other {…} is removed, so nothing unfilled (or an amount) reaches a customer.
export function fillBillMessage(text, vars = {}) {
  const v = {
    first_name: String(vars.first_name ?? vars.firstName ?? '').trim() || 'there',
    business: String(vars.business ?? '').trim(),
    bill_number: String(vars.bill_number ?? vars.billNumber ?? '').trim(),
  };
  return String(text ?? '')
    .replace(/\{(first_name|business|bill_number)\}/g, (_, k) => v[k])
    .replace(/\{[^{}]*\}/g, '')
    .replace(/[{}]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Placeholders in the text that are not one of the three (for the save check).
export function badBillPlaceholders(text) {
  const ok = new Set(BILL_PLACEHOLDERS.map((p) => p.key));
  return [...String(text ?? '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((k) => !ok.has(k));
}
