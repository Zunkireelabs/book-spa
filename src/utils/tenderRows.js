// Shared setState helpers for a `tenders` array (`{amount, paymentMode, ...}[]`)
// used by any multi-tender payment form — PaymentModal (booking payments) and
// NewVoucherModal (voucher issuance) both had identical copies of these three
// one-liners before this was extracted.
export const addTenderRow = (setTenders, defaultRow) => setTenders((prev) => [...prev, defaultRow]);

export const removeTenderRow = (setTenders, index) =>
  setTenders((prev) => prev.filter((_, idx) => idx !== index));

export const updateTenderRow = (setTenders, index, patch) =>
  setTenders((prev) => prev.map((t, idx) => (idx === index ? { ...t, ...patch } : t)));
