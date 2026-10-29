import { describe, it, expect } from 'vitest';
import { buildNeeds } from './dashboardNeeds';

const T = '2026-10-29';
const row = (o) => ({ id: o.id, status: 'Confirmed', date: T, payment_status: 'unpaid', final_amount: 1000, payments: [], booking_therapists: [{ therapist_id: 't1' }], ...o });

describe('buildNeeds', () => {
  it('lists completed, not-fully-paid bookings from any day as unpaid, with the balance due', () => {
    const n = buildNeeds([
      row({ id: 'a', status: 'Completed', date: '2026-10-26', payments: [{ amount: 400 }] }),
      row({ id: 'b', status: 'Completed', payment_status: 'paid' }),
      row({ id: 'c', status: 'Confirmed' }),
    ], T);
    expect(n.unpaid.map((b) => b.id)).toEqual(['a']);
    expect(n.unpaid[0]).toMatchObject({ amount_paid: 400, amount_due: 600 });
  });
  it('does not list an over-paid booking (balance is never negative)', () => {
    const n = buildNeeds([row({ id: 'a', status: 'Completed', payments: [{ amount: 1500 }] })], T);
    expect(n.unpaid).toEqual([]);
  });
  it('lists only today\'s Pending bookings as unconfirmed', () => {
    const n = buildNeeds([row({ id: 'a', status: 'Pending' }), row({ id: 'b', status: 'Pending', date: '2026-10-28' }), row({ id: 'c' })], T);
    expect(n.unconfirmed.map((b) => b.id)).toEqual(['a']);
  });
  it('lists today\'s open bookings with nobody assigned as unassigned', () => {
    const n = buildNeeds([
      row({ id: 'a', status: 'Pending', booking_therapists: [] }),
      row({ id: 'b', booking_therapists: [] }),
      row({ id: 'c', status: 'Completed', booking_therapists: [] }),
      row({ id: 'd', booking_therapists: [], date: '2026-10-30' }),
      row({ id: 'e' }),
    ], T);
    expect(n.unassigned.map((b) => b.id)).toEqual(['a', 'b']);
  });
  it('handles no rows', () => {
    expect(buildNeeds(null, T)).toEqual({ unpaid: [], unconfirmed: [], unassigned: [] });
  });
});
