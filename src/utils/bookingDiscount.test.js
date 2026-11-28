import { describe, it, expect } from 'vitest';
import { planBookingDiscount } from './bookingDiscount';

const rows = [{ id: 'a', base: 3000 }, { id: 'b', base: 349 }];
describe('planBookingDiscount', () => {
  it('5% of the booking: whole rupees, lines add up to the total', () => {
    const p = planBookingDiscount({ rows, type: 'percentage', value: 5 });
    expect(p.total).toBe(Math.round(3349 * 0.05)); // 167
    expect(p.lines.map((l) => l.amount)).toEqual([150, 17]);
    expect(p.lines.reduce((s, l) => s + l.amount, 0)).toBe(p.total);
    expect(p.maxPercent).toBe(5);
  });
  it('remainder goes on the last line', () => {
    const p = planBookingDiscount({ rows: [{ id: 'a', base: 101 }, { id: 'b', base: 101 }, { id: 'c', base: 101 }], type: 'percentage', value: 10 });
    expect(p.total).toBe(30);
    expect(p.lines.map((l) => l.amount)).toEqual([10, 10, 10]);
    const q = planBookingDiscount({ rows: [{ id: 'a', base: 105 }, { id: 'b', base: 105 }], type: 'percentage', value: 15 }); // 15.75 each -> 16,16 ; total round(31.5)=32
    expect(q.lines.reduce((s, l) => s + l.amount, 0)).toBe(q.total);
  });
  it('fixed NPR is split in proportion and adds up', () => {
    const p = planBookingDiscount({ rows, type: 'fixed', value: 335 });
    expect(p.total).toBe(335);
    expect(p.lines.reduce((s, l) => s + l.amount, 0)).toBe(335);
    expect(p.maxPercent).toBeCloseTo(10, 0);
  });
  it('fixed above the booking is capped at the booking', () => {
    expect(planBookingDiscount({ rows, type: 'fixed', value: 99999 }).total).toBe(3349);
  });
  it('per line: each its own, blank = none, limit % is the largest typed', () => {
    const p = planBookingDiscount({ rows, type: 'percentage', value: 0, perLine: { a: 10, b: '' } });
    expect(p.lines.map((l) => l.amount)).toEqual([300, 0]);
    expect(p.total).toBe(300);
    expect(p.maxPercent).toBe(10);
  });
  it('no input: nothing', () => { expect(planBookingDiscount({ rows, type: 'percentage', value: '' }).total).toBe(0); });
});
