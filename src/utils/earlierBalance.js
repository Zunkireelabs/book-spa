// Whose "earlier balance" a booking shows: ONE rule for the calendar chip, the panel line and the checkout's rows.
// The booking's customer when it has one (customer_id), else its normalised phone (E.164, a full number only).
// customer_id ONLY (never "or phone") when there is one: shared/placeholder phones merged different people (ZNLY-328).
// And the phone key owns only rows WITHOUT a customer_id: a customer-linked row belongs to its customer, never to a phone-only booking.
export function earlierBalanceKey({ customerId, phone } = {}) {
  if (customerId) return { customerId };
  return phone && phone.length >= 11 ? { phone } : null;
}

// Does candidate row `o` ({ customer_id, phone }) belong to the owner named by `key`?
export const ownsEarlierBalance = (key, o) => !!key && (key.customerId ? o.customer_id === key.customerId : !o.customer_id && o.phone === key.phone);
