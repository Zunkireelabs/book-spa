import { describe, it, expect } from 'vitest';
import { balanceOf, isOwed, paidNote } from './dashboardMoney';
import { groupNeeds, needsOf, summarizeWaiting } from './dashboardNeeds';

const bk = (o) => ({ status: 'Completed', payment_status: 'unpaid', final_amount: 2000, date: '2026-10-29', payments: [], ...o });

describe('owed rule (dashboardMoney)', () => {
  it('owes the full amount when nothing is paid', () => {
    expect(balanceOf(bk({}))).toBe(2000);
    expect(paidNote(bk({}))).toBeNull();
  });
  it('owes only the balance on a part-paid booking, and says so', () => {
    const b = bk({ final_amount: 2500, payments: [{ amount: 1250 }] });
    expect(balanceOf(b)).toBe(1250);
    expect(paidNote(b)).toBe('NPR 1,250 of 2,500 paid');
  });
  it('owes nothing once paid in full, marked paid, over-paid or not completed', () => {
    expect(isOwed(bk({ payments: [{ amount: 2000 }] }))).toBe(false);
    expect(isOwed(bk({ payment_status: 'paid' }))).toBe(false);
    expect(isOwed(bk({ payments: [{ amount: 2500 }] }))).toBe(false);
    expect(isOwed(bk({ status: 'Confirmed' }))).toBe(false);
  });
  it('has no date floor: a booking from weeks ago is still owed', () => {
    expect(isOwed(bk({ date: '2026-10-12' }))).toBe(true);
    expect(needsOf([bk({ id: 'old', date: '2026-10-12' })], Date.parse('2026-10-29T15:00:00+05:45'), '2026-10-29').map((b) => [b.id, b.kind])).toEqual([['old', 'owed']]);
  });
  it('sums balances (not final amounts) in the Business waiting row, with the oldest date', () => {
    const now = Date.parse('2026-10-29T15:00:00+05:45');
    const rows = [
      bk({ id: 'a', branch_id: 'b1', branch_name: 'Laz', date: '2026-10-12', end_time: '11:00:00', final_amount: 3500 }),
      bk({ id: 'b', branch_id: 'b1', branch_name: 'Laz', date: '2026-10-26', end_time: '11:00:00', final_amount: 2000, payments: [{ amount: 1800 }] }),
      bk({ id: 'c', branch_id: 'b1', branch_name: 'Laz', payment_status: 'paid' }),
    ];
    const [w] = summarizeWaiting(groupNeeds(needsOf(rows, now, '2026-10-29')));
    expect([w.count, w.amount, w.oldest_date]).toEqual([2, 3700, '2026-10-12']);
  });
});
