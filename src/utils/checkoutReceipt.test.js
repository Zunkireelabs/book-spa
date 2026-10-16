import { describe, it, expect } from 'vitest';
import { computeChange, buildReceiptText, buildWhatsAppUrl, buildReceiptHtml } from './checkoutReceipt';

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
