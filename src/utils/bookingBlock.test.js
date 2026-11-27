import { describe, it, expect } from 'vitest';
import { buildBookingBlock } from './bookingBlock';

const row = (o) => ({ id: 'x', booking_number: 'BK-1', status: 'Confirmed', payment_status: 'unpaid', start_time: '10:00:00', end_time: '11:00:00', base_amount: 1000, discount_amount: 0, final_amount: 1000, service: { name: 'Thai', duration_minutes: 60 }, payments: [], payment_refunds: [], ...o });

describe('buildBookingBlock', () => {
  it('one row: shown (ZNLY-435: every booking is a card, 1 service = 1 row)', () => { const b = buildBookingBlock([row({})], 'x'); expect(b.show).toBe(true); expect(b.count).toBe(1); });
  it('no rows: not shown', () => { expect(buildBookingBlock([], 'x').show).toBe(false); });
  it('count = live rows, total = sum of their final amounts (cancelled row excluded)', () => {
    const b = buildBookingBlock([row({ id: 'a', booking_number: 'BK-1' }), row({ id: 'b', booking_number: 'BK-2', start_time: '11:00:00', final_amount: 500 }), row({ id: 'c', booking_number: 'BK-3', status: 'Cancelled', final_amount: 9999 })], 'a');
    expect(b.show).toBe(true);
    expect(b.rows).toHaveLength(3);
    expect(b.count).toBe(2);
    expect(b.total).toBe(1500);
  });
  it('paid is payments minus refunds; toPay = total - paid, never negative', () => {
    const b = buildBookingBlock([row({ id: 'a', payments: [{ amount: 1000 }], payment_refunds: [{ amount: 200 }] }), row({ id: 'b', start_time: '11:00:00' })], 'a');
    expect(b.paid).toBe(800);
    expect(b.toPay).toBe(1200);
    const over = buildBookingBlock([row({ id: 'a', payments: [{ amount: 1500 }] }), row({ id: 'b', start_time: '11:00:00' })], 'a');
    expect(over.toPay).toBe(500);
  });
  it('reference = first service number by start time; sorted by start', () => {
    const b = buildBookingBlock([row({ id: 'b', booking_number: 'BK-2', start_time: '11:00:00' }), row({ id: 'a', booking_number: 'BK-1' })], 'a');
    expect(b.reference).toBe('BK-1');
    expect(b.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('minutes fall back to end-start', () => {
    const b = buildBookingBlock([row({ id: 'a', service: { name: 'X' } }), row({ id: 'b' })], 'a');
    expect(b.rows[0].minutes).toBe(60);
  });
  it('A3: a Pending service is not payable: toPay counts only the payable lines, total keeps the whole booking', () => {
    const b = buildBookingBlock([row({ id: 'a' }), row({ id: 'b', status: 'Pending', start_time: '11:00:00', final_amount: 500 })], 'a');
    expect(b.total).toBe(1500);
    expect(b.waiting).toBe(1);
    expect(b.toPay).toBe(1000);
  });
  it('A3: no Pending service = unchanged (waiting 0, toPay = total - paid)', () => {
    const b = buildBookingBlock([row({ id: 'a', payments: [{ amount: 400 }] }), row({ id: 'b', start_time: '11:00:00' })], 'a');
    expect(b.waiting).toBe(0);
    expect(b.toPay).toBe(1600);
  });
  it('A3: payable line already part paid, Pending line ignored', () => {
    const b = buildBookingBlock([row({ id: 'a', payments: [{ amount: 400 }] }), row({ id: 'b', status: 'Pending', start_time: '11:00:00' })], 'a');
    expect(b.toPay).toBe(600);
  });
});
