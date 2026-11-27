import { describe, it, expect } from 'vitest';
import { fillBillMessage, badBillPlaceholders, DEFAULT_BILL_MESSAGE } from './billMessage';

describe('fillBillMessage', () => {
  it('fills the three placeholders', () => {
    const out = fillBillMessage(DEFAULT_BILL_MESSAGE.email.body, { first_name: 'Aliza', business: "Sami's", bill_number: 'BK-1' });
    expect(out).toBe("Hi Aliza, thank you for visiting Sami's today. Your bill BK-1 is ready.");
  });
  it('missing first name reads "Hi there"', () => {
    expect(fillBillMessage('Hi {first_name},', { first_name: '  ', business: 'X', bill_number: 'B' })).toBe('Hi there,');
    expect(fillBillMessage('Hi {first_name},', {})).toBe('Hi there,');
  });
  it('no amount placeholder survives', () => {
    const out = fillBillMessage('Total {total} / {amount} / {{due}} for {bill_number}', { bill_number: 'BK-9' });
    expect(out).not.toMatch(/[{}]/);
    expect(out).toContain('BK-9');
  });
});

describe('badBillPlaceholders', () => {
  it('flags anything but the three', () => {
    expect(badBillPlaceholders('{first_name} {total} {business}')).toEqual(['total']);
    expect(badBillPlaceholders(DEFAULT_BILL_MESSAGE.email.subject)).toEqual([]);
  });
});
