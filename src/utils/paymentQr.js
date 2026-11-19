// Pure helpers for per-method payment QR codes (migration-337). A QR belongs to a LEAF payment method: the exact
// value a checkout row holds in `paymentMode` and that is written to payments.payment_mode. No I/O here.

export const QR_MAX_BYTES = 1024 * 1024;
export const QR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The selectable leaf values of an org's payment-method list (organizations.settings.paymentMethods). Each entry is a
 * plain string (a leaf) or { name, subMethods } (a group): a group with sub-methods offers only those, a group with
 * none offers its own name. Same rule as buildPaymentMethodTree.
 */
export function leafMethods(paymentMethods) {
  const out = [];
  (paymentMethods || []).forEach((m) => {
    if (typeof m === 'string') { if (m) out.push(m); return; }
    if (!m || !m.name) return;
    const subs = (m.subMethods || []).filter(Boolean);
    if (subs.length > 0) out.push(...subs); else out.push(m.name);
  });
  return out;
}

/** Cash is paid over the counter, so it never gets a QR slot. */
export const isQrCapableMethod = (method) => !!method && !/^cash$/i.test(String(method));

/**
 * What a payment-method save means for existing QR rows. `renames` maps an old leaf name to its new name (in-place
 * edits from the form). A rename counts only when the old leaf is gone and the new one exists; every other leaf that
 * disappeared (deleted method, removed sub-option, a plain method that gained sub-options) is removed.
 * Returns { renamed: [[from, to]], removed: [name] }.
 */
export function qrMethodDiff(oldLeaves, newLeaves, renames = {}) {
  const next = new Set(newLeaves || []);
  const renamed = [];
  const removed = [];
  (oldLeaves || []).forEach((leaf) => {
    if (next.has(leaf)) return;
    const to = renames[leaf];
    if (to && to !== leaf && next.has(to)) renamed.push([leaf, to]);
    else removed.push(leaf);
  });
  return { renamed, removed };
}

/**
 * A QR confirmation is stamped with the row's method and amount, so changing either (including a REST row being
 * recomputed) silently un-confirms it without every update path having to remember to reset a flag.
 */
export const qrSignature = (t) => `${t?.paymentMode ?? ''}|${Number(t?.amount) || 0}`;
export const isQrConfirmed = (t) => !!t?.qrConfirmed && t.qrConfirmed === qrSignature(t);

/**
 * Checkout rows still waiting for staff to confirm a QR payment: the row's method has a usable QR, it carries an
 * amount, and it isn't confirmed for its current method/amount. `qrMap` should hold only QRs that actually loaded,
 * so a failed QR never gates a payment. Returns their indexes.
 */
export function pendingQrRows(tenders, qrMap) {
  const out = [];
  (tenders || []).forEach((t, i) => {
    if (t && t.paymentMode && qrMap && qrMap[t.paymentMode] && Number(t.amount) > 0 && !isQrConfirmed(t)) out.push(i);
  });
  return out;
}

/** Client-side check before uploading a QR image; null when fine, else a friendly message. */
export function validateQrFile(file) {
  if (!file) return 'Choose an image of your QR code.';
  if (!QR_MIME_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP image of the QR code.';
  if (file.size > QR_MAX_BYTES) return 'That image is over 1 MB. Use a smaller screenshot or export of the QR.';
  return null;
}
