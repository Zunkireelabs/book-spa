import { describe, it, expect } from 'vitest';
import { computeChange, quickCashOptions, buildReceiptText, buildWhatsAppUrl, buildReceiptHtml } from './checkoutReceipt';

describe('computeChange', () => {
  it('returns the difference when received exceeds the cash amount', () => {
    expect(computeChange('1500', '1000')).toBe(500);
    expect(computeChange(1000.5, 999.25)).toBe(1.25);
  });
  it('is null when nothing/too little/exactly the amount was received', () => {
    expect(computeChange('', 1000)).toBeNull();
    expect(computeChange('900', 1000)).toBeNull();
    expect(computeChange('1000', 1000)).toBeNull();
    expect(computeChange('abc', 1000)).toBeNull();
  });
});

describe('quickCashOptions', () => {
  it('offers the next convenient notes strictly above the cash amount', () => {
    expect(quickCashOptions(4200)).toEqual([4500, 5000, 10000]);
    expect(quickCashOptions(5000)).toEqual([5500, 6000, 10000]);
    expect(quickCashOptions(1800)).toEqual([2000, 5000, 10000]);
    expect(quickCashOptions(12300)).toEqual([12500, 13000, 15000]);
  });
  it('accepts string and fractional amounts', () => {
    expect(quickCashOptions('4999.5')).toEqual([5000, 10000]);
  });
  it('is empty when there is no cash to collect', () => {
    expect(quickCashOptions(0)).toEqual([]);
    expect(quickCashOptions('')).toEqual([]);
    expect(quickCashOptions(-100)).toEqual([]);
  });
});

const receipt = {
  orgName: 'Nuad', branchName: 'Lazimpat', dateLabel: '16 Oct 2026', guestName: 'Anjali', bookingNumber: 'BK-1',
  lines: [{ label: 'Deep Tissue', amount: 3500 }, { label: 'Gold member 15%', amount: -500, sub: true }],
  tenders: [{ label: 'Cash', amount: 1000, detail: 'received 1,500, change 500' }],
  total: 3000, leftover: 0, tipTotal: 200,
};

describe('buildReceiptText', () => {
  it('summarises the payment, with the tip as a separate line', () => {
    const t = buildReceiptText(receipt);
    expect(t).toContain('Payment received: NPR 3,000');
    expect(t).toContain('Paid by Cash: NPR 1,000');
    expect(t).toContain('Tip (separate): NPR 200');
    expect(t).not.toContain('Still due');
  });
  it('shows the balance still due', () => {
    expect(buildReceiptText({ ...receipt, leftover: 800 })).toContain('Still due: NPR 800');
  });
});

describe('buildWhatsAppUrl', () => {
  it('builds a wa.me link with the E.164 digits and an encoded message', () => {
    expect(buildWhatsAppUrl('9841234567', 'Hi there')).toBe('https://wa.me/9779841234567?text=Hi%20there');
    expect(buildWhatsAppUrl('+15551234567', 'x')).toBe('https://wa.me/15551234567?text=x');
  });
  it('is null without a phone', () => {
    expect(buildWhatsAppUrl('', 'x')).toBeNull();
    expect(buildWhatsAppUrl(null, 'x')).toBeNull();
  });
});

describe('buildReceiptHtml', () => {
  it('escapes user text and includes the totals', () => {
    const html = buildReceiptHtml({ ...receipt, guestName: '<b>x</b>' });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('3,000');
  });
});

describe('receipt with products (V26)', () => {
  const base = { orgName: 'Nuad', branchName: 'Lazimpat', total: 3840, leftover: 0, bookingNumber: 'BK-1', lines: [{ label: 'Massage', amount: 1540 }], tenders: [{ label: 'Membership wallet', amount: 1540 }],
    products: { lines: [{ label: 'Lavender Oil · 500 ml', qty: 1, amount: 900 }, { label: 'Herbal Balm', qty: 2, amount: 1400 }], tenders: [{ label: 'Cash', amount: 2300 }] } };
  it('the WhatsApp text lists the products and how they were paid', () => {
    const t = buildReceiptText(base);
    expect(t).toContain('Products:');
    expect(t).toContain('Herbal Balm × 2: NPR 1,400');
    expect(t).toContain('Paid by Cash: NPR 2,300');
  });
  it('the printed receipt has a Products table', () => {
    const h = buildReceiptHtml(base);
    expect(h).toContain('<h2>Products</h2>');
    expect(h).toContain('Lavender Oil · 500 ml × 1');
  });
  it('no products: unchanged', () => {
    expect(buildReceiptText({ ...base, products: null })).not.toContain('Products:');
    expect(buildReceiptHtml({ ...base, products: null })).not.toContain('<h2>Products</h2>');
  });
});
