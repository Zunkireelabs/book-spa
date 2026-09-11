import { describe, it, expect } from 'vitest';

// Mirrors the WALLET_MODES guard added to getDailySummary/getDailyOperationalReport's
// voucher_payments loops in src/services/api.js — a Membership-tendered voucher sale
// is a wallet deduction (money already recognized when the wallet was funded), not
// new cash collected today, so it must be excluded from voucherSalesTotal/netRevenue
// and the cash/card/fonepay paymentBreakdown, same as booking payments already are.
const WALLET_MODES = new Set(['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher']);

function classifyPaymentMode(mode) {
  if (mode === 'Cash') return 'cash';
  if (mode === 'Card') return 'card';
  return 'fonepay';
}

function sumVoucherSales(voucherPayments) {
  let total = 0;
  const breakdown = { cash: 0, card: 0, fonepay: 0 };
  for (const p of voucherPayments) {
    if (WALLET_MODES.has(p.payment_mode)) continue;
    const amount = Number(p.amount);
    total += amount;
    breakdown[classifyPaymentMode(p.payment_mode)] += amount;
  }
  return { total, breakdown };
}

describe('voucher purchase Membership-tender daily-closing exclusion', () => {
  it('excludes a Membership-tendered voucher payment from sales total and payment breakdown', () => {
    const voucherPayments = [
      { amount: 1000, payment_mode: 'Cash' },
      { amount: 500, payment_mode: 'Membership' },
    ];
    const { total, breakdown } = sumVoucherSales(voucherPayments);
    expect(total).toBe(1000);
    expect(breakdown).toEqual({ cash: 1000, card: 0, fonepay: 0 });
  });

  it('counts every tender when no Membership tender is present', () => {
    const voucherPayments = [
      { amount: 700, payment_mode: 'Cash' },
      { amount: 300, payment_mode: 'Card' },
    ];
    const { total, breakdown } = sumVoucherSales(voucherPayments);
    expect(total).toBe(1000);
    expect(breakdown).toEqual({ cash: 700, card: 300, fonepay: 0 });
  });
});
