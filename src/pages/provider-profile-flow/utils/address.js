// Placeholder addresses seeded during onboarding shouldn't be shown to customers.
// Treated as "unset" rather than printed verbatim.
const PLACEHOLDER_ADDRESSES = new Set(['tbd', 'n/a', 'na', '-', 'tba']);

export const isRealAddress = (address) => {
  const trimmed = (address || '').trim();
  return trimmed.length > 0 && !PLACEHOLDER_ADDRESSES.has(trimmed.toLowerCase());
};
