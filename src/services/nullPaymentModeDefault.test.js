import { describe, it, expect } from 'vitest';

// Mirrors the null-payment-mode default added to getWalletProductSalesForDate /
// getTodayInsights' membership-deposit and package-sold loops in src/services/api.js.
// membership_transactions.payment_mode (migration-060) and packages.payment_method
// (migration-185) are both nullable, and packages has no "required when paid_amount > 0"
// check, so a row can carry real paid cash with no recorded method. Falling through
// classifyPaymentMode('') mis-routes it into the fonepay bucket (PR #366); a raw
// modeTotals[undefined] key hides it from the UI's known buckets entirely. Both call
// sites default a missing mode to 'Cash' before bucketing, so the amount stays visible
// and totalSales always equals the sum of its own breakdown.
function classifyPaymentMode(mode) {
  if (mode === 'Cash') return 'cash';
  if (mode.includes('Card')) return 'card';
  return 'fonepay';
}

function sumWalletProductSales(rows) {
  let total = 0;
  const breakdown = { cash: 0, card: 0, fonepay: 0 };
  for (const r of rows) {
    const amount = Number(r.amount);
    total += amount;
    breakdown[classifyPaymentMode(r.mode || 'Cash')] += amount;
  }
  return { total, breakdown };
}

function sumTodayInsightsBucket(rows) {
  let totalSales = 0;
  const modeTotals = {};
  for (const r of rows) {
    const amount = Number(r.amount);
    totalSales += amount;
    const mode = r.mode || 'Cash';
    modeTotals[mode] = (modeTotals[mode] || 0) + amount;
  }
  return { totalSales, modeTotals };
}

describe('null payment_mode/payment_method default (PR #366 follow-up)', () => {
  it('getWalletProductSalesForDate: buckets a null mode under cash, not fonepay', () => {
    const { total, breakdown } = sumWalletProductSales([
      { amount: 25000, mode: 'MobileBanking' },
      { amount: 5000, mode: null },
    ]);
    expect(total).toBe(30000);
    expect(breakdown).toEqual({ cash: 5000, card: 0, fonepay: 25000 });
  });

  it('getTodayInsights: buckets a null mode under the literal "Cash" key, not "null"', () => {
    const { totalSales, modeTotals } = sumTodayInsightsBucket([
      { amount: 25000, mode: 'MobileBanking' },
      { amount: 5000, mode: null },
    ]);
    expect(totalSales).toBe(30000);
    expect(modeTotals).toEqual({ MobileBanking: 25000, Cash: 5000 });
    expect(modeTotals.null).toBeUndefined();
    const bucketSum = Object.values(modeTotals).reduce((a, b) => a + b, 0);
    expect(bucketSum).toBe(totalSales);
  });
});
