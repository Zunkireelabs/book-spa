// Whose "earlier balance" a booking shows: ONE rule for the calendar chip, the panel line and the checkout's rows.
// The booking's customer when it has one (customer_id), else its normalised phone (E.164, a full number only).
// customer_id ONLY (never "or phone") when there is one: shared/placeholder phones merged different people (ZNLY-328).
// And the phone key owns only rows WITHOUT a customer_id: a customer-linked row belongs to its customer, never to a phone-only booking.
export function earlierBalanceKey({ customerId, phone } = {}) {
  if (customerId) return { customerId };
  return phone && phone.length >= 11 ? { phone } : null;
}

// OFF orgs (no visit): is `o` one of the bookings the CHECKOUT bundles with `b` as "related", so it is not also an earlier balance? Same rule as
// fetchRelatedUnpaidBookings: the booking group when `b` has one, else the same client name + date; and nothing paid on it. `paid` = payments minus refunds.
export const isCheckoutSibling = (b, o, paid) => paid === 0 && (b.booking_group_id
  ? o.booking_group_id === b.booking_group_id
  : o.customer_name === b.customer_name && o.date === b.date);

// A phone search ("Collect payment" by phone) lists every due on that phone, whoever owns it. Pre-tick them only when ONE person owns them all:
// the same customer_id on every row, or no customer on any row. Otherwise tick none: someone else's debt is never bundled quietly.
export const oneOwner = (rows) => {
  const ids = new Set((rows || []).map((r) => r.customerId || r.customer_id || null));
  return ids.size <= 1;
};

// Does candidate row `o` ({ customer_id, phone }) belong to the owner named by `key`?
export const ownsEarlierBalance = (key, o) => !!key && (key.customerId ? o.customer_id === key.customerId : !o.customer_id && o.phone === key.phone);
