// The one checkout submit (ZNLY-233). PaymentModal hands every host the same payload; a host that saves treatment tenders but drops
// `products` makes the receipt say "paid" while no product sale, stock or commission is saved (BK-20260917-0002 lost 800).
// Every host's onConfirm goes through submitCheckout: products on the bill => ONE call, checkoutWithProducts (products + stock + treatment
// payment in one transaction); no products => the host's own treatment-only path (`treatment`), unchanged.
import { checkoutWithProducts as apiCheckoutWithProducts, recordTip as apiRecordTip } from './api';

// Hosts that render PaymentModal with `savesProducts` must route through submitCheckout; checkoutSubmit.test.js enforces it.
export async function submitCheckout({ bookingId, payload, treatment, onSaved, deps = {} }) {
  const checkout = deps.checkoutWithProducts || apiCheckoutWithProducts;
  const tip = deps.recordTip || apiRecordTip;
  const { tenders = [], additionalAllocations = [], dueHolderName, notes, tipSplits = [], products = [], productTenders = [] } = payload || {};

  if (products.length === 0) return treatment(payload);

  if (!bookingId) return { data: null, error: { message: 'Cannot save products: no booking to attach them to.' } };
  const { data, error } = await checkout({
    bookingId,
    // `productTenders` first, then the treatment's tenders: the server pays the products first, in that order, and rejects anything
    // that does not cover them in full.
    tenders: [...productTenders, ...tenders],
    products,
    dueHolderName,
    notes,
    additional: additionalAllocations.map((a) => ({ bookingId: a.bookingId, tenders: a.tenders })),
  });
  if (error) return { data: null, error };
  // A tip is its own best-effort write; it must never undo a checkout that already succeeded.
  for (const split of tipSplits) {
    const r = await tip({ bookingId, amount: split.amount, receivedBy: split.receivedBy });
    if (r?.error) console.warn('[Tips] recordTip failed:', r.error.message);
  }
  // The server's answer is the truth: a bill with products must come back with sales, or nothing was saved.
  if (!data || !Array.isArray(data.sales) || data.sales.length === 0) {
    return { data: null, error: { message: 'The products were not saved, so this payment was not completed. Please try again.' } };
  }
  if (onSaved) await onSaved(data);
  return { data, error: null };
}
