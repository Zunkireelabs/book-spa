import { describe, it, expect } from 'vitest';
import {
  isTreatmentOnly, moneyEntered, treatmentOnlyEntered, allocateProductsFirst, splitAcrossLines, capQty, canAddOne, lineTotal, productsTotalOf, dueState,
  treatmentOnlyOverflow, collectLabel, stockLeft, parseStockError,
} from './checkoutAllocation';

const cash = (amount) => ({ paymentMode: 'Cash', amount });
const wallet = (amount) => ({ paymentMode: 'Membership', amount });
const voucher = (amount) => ({ paymentMode: 'VoucherWallet', amount, voucherId: 'v1' });

describe('which methods may pay products', () => {
  it('vouchers, packages and the referral wallet are treatment-only; money methods are not', () => {
    ['VoucherWallet', 'ReferralVoucher', 'SessionPackage', 'ReferralWallet'].forEach((m) => expect(isTreatmentOnly(m)).toBe(true));
    ['Cash', 'Card', 'Membership', 'eSewa', 'Nabil Card'].forEach((m) => expect(isTreatmentOnly(m)).toBe(false));
  });
  it('sums the money and the treatment-only parts separately', () => {
    const t = [cash(500), voucher(1540), wallet(300), { paymentMode: 'Cash', amount: 0 }];
    expect(moneyEntered(t)).toBe(800);
    expect(treatmentOnlyEntered(t)).toBe(1540);
  });
});

describe('products first', () => {
  it('one cash tender of 3,840 → products 2,300, treatment 1,540', () => {
    const r = allocateProductsFirst([cash(3840)], 2300);
    expect(r.product).toEqual([{ paymentMode: 'Cash', amount: 2300 }]);
    expect(r.treatment).toEqual([{ paymentMode: 'Cash', amount: 1540 }]);
    expect(r.shortfall).toBe(0);
  });
  it('wallet 1,540 + cash 2,300 → products Cash 2,300, treatment Membership 1,540 (the wallet goes to the treatment)', () => {
    const r = allocateProductsFirst([wallet(1540), cash(2300)], 2300);
    expect(r.product).toEqual([{ paymentMode: 'Cash', amount: 2300 }]);
    expect(r.treatment).toEqual([{ paymentMode: 'Membership', amount: 1540 }]);
    expect(r.shortfall).toBe(0);
  });
  it('wallet 3,840 alone → products 2,300 from the wallet, treatment Membership 1,540', () => {
    const r = allocateProductsFirst([wallet(3840)], 2300);
    expect(r.product).toEqual([{ paymentMode: 'Membership', amount: 2300 }]);
    expect(r.treatment).toEqual([{ paymentMode: 'Membership', amount: 1540 }]);
  });
  it('cash 1,000 + wallet 2,840 → products cash 1,000 + wallet 1,300; treatment wallet 1,540', () => {
    const r = allocateProductsFirst([cash(1000), wallet(2840)], 2300);
    expect(r.product).toEqual([{ paymentMode: 'Cash', amount: 1000 }, { paymentMode: 'Membership', amount: 1300 }]);
    expect(r.treatment).toEqual([{ paymentMode: 'Membership', amount: 1540 }]);
    // every method's total is what the guest entered
    const all = [...r.product, ...r.treatment].reduce((m, p) => ({ ...m, [p.paymentMode]: (m[p.paymentMode] || 0) + p.amount }), {});
    expect(all).toEqual({ Cash: 1000, Membership: 2840 });
  });
  it('plain money keeps its listed order even when the wallet is listed first', () => {
    const r = allocateProductsFirst([wallet(500), { paymentMode: 'Card', amount: 1000 }, cash(1000)], 1800);
    expect(r.product).toEqual([{ paymentMode: 'Card', amount: 1000 }, { paymentMode: 'Cash', amount: 800 }]);
    expect(r.treatment).toEqual([{ paymentMode: 'Membership', amount: 500 }, { paymentMode: 'Cash', amount: 200 }]);
  });
  it('a voucher is never allocated to products, even when it is listed first', () => {
    const r = allocateProductsFirst([voucher(1540), cash(2300)], 2300);
    expect(r.product).toEqual([{ paymentMode: 'Cash', amount: 2300 }]);
    expect(r.treatment).toEqual([{ ...voucher(1540), amount: 1540 }]);
  });
  it('a voucher alone cannot cover products: shortfall = the products total', () => {
    const r = allocateProductsFirst([voucher(3840)], 2300);
    expect(r.product).toEqual([]);
    expect(r.shortfall).toBe(2300);
  });
  it('money short of the products leaves a shortfall', () => {
    expect(allocateProductsFirst([cash(2000)], 2300).shortfall).toBe(300);
  });
  it('no products: everything stays with the treatment', () => {
    const r = allocateProductsFirst([cash(1540), voucher(100)], 0);
    expect(r.product).toEqual([]);
    expect(r.treatment).toHaveLength(2);
  });
  it('keeps extra fields (voucher id) on the treatment tenders', () => {
    expect(allocateProductsFirst([voucher(500)], 0).treatment[0].voucherId).toBe('v1');
  });
});

describe('split across lines (receipt)', () => {
  it('lines take the payments in order', () => {
    const lines = splitAcrossLines([900, 1400], [{ paymentMode: 'Cash', amount: 1000 }, { paymentMode: 'Membership', amount: 1300 }]);
    expect(lines[0]).toEqual([{ paymentMode: 'Cash', amount: 900 }]);
    expect(lines[1]).toEqual([{ paymentMode: 'Cash', amount: 100 }, { paymentMode: 'Membership', amount: 1300 }]);
  });
});

describe('quantity cap', () => {
  it('stops at the stock left; not-counted stock has no cap', () => {
    expect(capQty(5, 3)).toBe(3);
    expect(capQty(0, 3)).toBe(1);
    expect(capQty(9, null)).toBe(9);
    expect(canAddOne(2, 3)).toBe(true);
    expect(canAddOne(3, 3)).toBe(false);
    expect(canAddOne(50, null)).toBe(true);
    expect(stockLeft(7, 2)).toBe(5);
    expect(stockLeft(null, 2)).toBeNull();
  });
  it('line and products totals', () => {
    expect(lineTotal(700, 2)).toBe(1400);
    expect(productsTotalOf([{ price: 900, qty: 1 }, { price: 700, qty: 2 }])).toBe(2300);
  });
});

describe('leave as due: only the treatment', () => {
  it('products fully covered, treatment short → can leave 1,540 due', () => {
    const d = dueState({ treatmentDue: 1540, productsTotal: 2300, tenders: [cash(2300)] });
    expect(d.grandTotal).toBe(3840);
    expect(d.leftover).toBe(1540);
    expect(d.belowProducts).toBe(false);
    expect(d.canLeaveDue).toBe(true);
    expect(collectLabel(d)).toBe('Collect 2,300 · 1,540 due');
  });
  it('less than the products total is not allowed', () => {
    const d = dueState({ treatmentDue: 1540, productsTotal: 2300, tenders: [cash(2000)] });
    expect(d.belowProducts).toBe(true);
    expect(d.shortBy).toBe(300);
    expect(d.canLeaveDue).toBe(false);
  });
  it('a voucher does not count towards the products minimum', () => {
    const d = dueState({ treatmentDue: 1540, productsTotal: 2300, tenders: [voucher(1540), cash(1000)] });
    expect(d.money).toBe(1000);
    expect(d.belowProducts).toBe(true);
  });
  it('fully covered shows the plain label; no products behaves as before', () => {
    expect(collectLabel(dueState({ treatmentDue: 1540, productsTotal: 2300, tenders: [wallet(1540), cash(2300)] }))).toBe('Collect NPR 3,840');
    const d = dueState({ treatmentDue: 1540, productsTotal: 0, tenders: [cash(1000)] });
    expect(d.belowProducts).toBe(false);
    expect(d.leftover).toBe(540);
  });
  it('voucher money above the treatment has nowhere to go', () => {
    expect(treatmentOnlyOverflow([voucher(2000)], 1540)).toBe(460);
    expect(treatmentOnlyOverflow([voucher(1540)], 1540)).toBe(0);
  });
});

describe('stock errors from the server', () => {
  it('reads the HINT', () => {
    const e = { message: 'checkout_booking_with_products: Herbal Balm: only 1 left at Lazimpat', hint: 'STOCK:11111111-2222-3333-4444-555555555555:1' };
    expect(parseStockError(e)).toEqual({ variantId: '11111111-2222-3333-4444-555555555555', left: 1, message: 'Herbal Balm: only 1 left at Lazimpat' });
    expect(parseStockError({ message: 'x' })).toBeNull();
    expect(parseStockError(null)).toBeNull();
  });
});
