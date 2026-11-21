import { describe, it, expect } from 'vitest';
import { paymentStatusLabel } from './paymentStatusLabel';

describe('paymentStatusLabel', () => {
  it('shows the refunded amount for a cancelled, refunded booking', () => {
    expect(paymentStatusLabel({ paymentStatus: 'refunded', refundTotal: 1500 })).toEqual({ label: 'Refunded NPR 1,500', tone: 'neutral' });
  });
  it('falls back to plain Refunded when no refund rows are loaded', () => {
    expect(paymentStatusLabel({ paymentStatus: 'refunded' }).label).toBe('Refunded');
  });
  it('keeps an unpaid cancelled booking Unpaid', () => {
    expect(paymentStatusLabel({ paymentStatus: 'unpaid', status: 'Cancelled', refundTotal: 0 }).label).toBe('Unpaid');
    expect(paymentStatusLabel({}).label).toBe('Unpaid');
  });
  it('maps paid and partial, with a short partial text', () => {
    expect(paymentStatusLabel({ paymentStatus: 'paid' })).toEqual({ label: 'Paid', tone: 'success' });
    expect(paymentStatusLabel({ paymentStatus: 'partial' }).label).toBe('Partially paid');
    expect(paymentStatusLabel({ paymentStatus: 'partial' }, { partialText: 'Partial' }).label).toBe('Partial');
  });
  it('a partly refunded paid booking stays Paid', () => {
    expect(paymentStatusLabel({ paymentStatus: 'paid', refundTotal: 200 }).label).toBe('Paid');
  });
});
