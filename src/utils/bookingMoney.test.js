import { describe, it, expect } from 'vitest';
import { classifyBooking, summarizeMoney, roundMoney } from './bookingMoney';

const TODAY = '2026-10-15';
const mk = (status, date, price, paid, extra = {}) => ({ id: `${status}-${date}-${paid}`, status, date, final_amount: price, payments: paid ? [{ amount: paid }] : [], ...extra });
const c = (b) => classifyBooking(b, { today: TODAY });

describe('classifyBooking: rendered', () => {
  it.each([
    // [status, price, paid, due, credit]
    ['Completed', 1000, 0, 1000, 0],
    ['Completed', 1000, 400, 600, 0],
    ['Completed', 1000, 1000, 0, 0],
    ['Completed', 1000, 1300, 0, 300],
    ['In-Progress', 1000, 0, 1000, 0],
    ['In-Progress', 1000, 400, 600, 0],
    ['In-Progress', 1000, 1000, 0, 0],
    ['In-Progress', 1000, 1300, 0, 300],
  ])('%s price %i paid %i → due %i credit %i', (status, price, paid, due, credit) => {
    const m = c(mk(status, '2026-10-12', price, paid));
    expect(m).toMatchObject({ kind: 'rendered', due, credit, upcoming: 0, deposit: 0, atStake: 0 });
  });
});

describe('classifyBooking: scheduled (today or later)', () => {
  it.each([
    ['Pending', 1000, 0, 1000, 0, 0],
    ['Pending', 1000, 400, 600, 400, 0],
    ['Confirmed', 1000, 1000, 0, 1000, 0],
    ['Confirmed', 1000, 1300, 0, 1000, 300],
  ])('%s price %i paid %i → upcoming %i deposit %i credit %i', (status, price, paid, upcoming, deposit, credit) => {
    const m = c(mk(status, '2026-10-19', price, paid));
    expect(m).toMatchObject({ kind: 'scheduled', due: 0, upcoming, deposit, credit });
  });
  it('a Confirmed booking today is scheduled, not unclosed, whatever its time', () => {
    const m = c(mk('Confirmed', TODAY, 3000, 0, { start_time: '08:00:00' }));
    expect(m.kind).toBe('scheduled');
    expect(m.upcoming).toBe(3000);
  });
});

describe('classifyBooking: unclosed (strictly before today)', () => {
  it.each(['Pending', 'Confirmed'])('%s yesterday is unclosed and owes nothing', (status) => {
    const m = c(mk(status, '2026-10-14', 5000, 1000));
    expect(m).toMatchObject({ kind: 'unclosed', due: 0, upcoming: 0, deposit: 0, atStake: 4000 });
  });
  it('Nepal midnight: the injected today decides', () => {
    const b = mk('Confirmed', '2026-10-15', 100, 0);
    expect(classifyBooking(b, { today: '2026-10-15' }).kind).toBe('scheduled');
    expect(classifyBooking(b, { today: '2026-10-16' }).kind).toBe('unclosed');
  });
});

describe('classifyBooking: void', () => {
  it.each(['Cancelled', 'No Show'])('%s owes nothing; any payment is credit', (status) => {
    expect(c(mk(status, '2026-10-12', 1000, 0))).toMatchObject({ kind: 'void', due: 0, credit: 0, paid: 0 });
    expect(c(mk(status, '2026-10-12', 1000, 400))).toMatchObject({ kind: 'void', due: 0, credit: 400, paid: 400 });
  });
});

describe('classifyBooking: robustness and rounding', () => {
  it('paid comes from payments, ignoring payment_status', () => {
    expect(c({ ...mk('Completed', '2026-10-12', 1000, 0), payment_status: 'paid' }).due).toBe(1000);
    expect(c({ ...mk('Completed', '2026-10-12', 1000, 1000), payment_status: 'unpaid' }).due).toBe(0);
  });
  it('missing / empty payments and null final_amount', () => {
    expect(c({ status: 'Completed', date: '2026-10-12', final_amount: null })).toMatchObject({ price: 0, paid: 0, due: 0 });
    expect(c({ status: 'Completed', date: '2026-10-12', final_amount: 500, payments: null }).due).toBe(500);
    expect(c({ status: 'Completed', date: '2026-10-12', final_amount: 500, payments: [] }).due).toBe(500);
  });
  it('0.1 + 0.2 style amounts are exact', () => {
    const m = c({ status: 'Completed', date: '2026-10-12', final_amount: 0.3, payments: [{ amount: 0.1 }, { amount: 0.2 }] });
    expect(m.due).toBe(0);
    expect(m.credit).toBe(0);
  });
  it('three payments of 33.33 against 99.99 settle exactly', () => {
    const m = c({ status: 'Completed', date: '2026-10-12', final_amount: 99.99, payments: [{ amount: 33.33 }, { amount: 33.33 }, { amount: 33.33 }] });
    expect(m.due).toBe(0);
    expect(m.paid).toBe(99.99);
  });
  it('roundMoney strips float residue', () => { expect(roundMoney(0.1 + 0.2)).toBe(0.3); });
});

describe('refunds (payments − payment_refunds)', () => {
  const withRefund = (b, amounts) => ({ ...b, payment_refunds: amounts.map((amount) => ({ amount })) });
  it('paid is payments minus refunds, so a refunded visit is due again', () => {
    const m = c(withRefund(mk('Completed', '2026-10-12', 1000, 1000), [400]));
    expect(m).toMatchObject({ paid: 600, due: 400, refunded: 400, credit: 0 });
  });
  it('a fully refunded visit owes its full price', () => {
    expect(c(withRefund(mk('Completed', '2026-10-12', 1000, 1000), [1000]))).toMatchObject({ paid: 0, due: 1000 });
  });
  it('credit on a void booking is what is still held after refunds', () => {
    expect(c(withRefund(mk('Cancelled', '2026-10-12', 1000, 500), []))).toMatchObject({ kind: 'void', credit: 500 });
    expect(c(withRefund(mk('Cancelled', '2026-10-12', 1000, 500), [500]))).toMatchObject({ credit: 0, paid: 0 });
    expect(c(withRefund(mk('No Show', '2026-10-12', 1000, 500), [200]))).toMatchObject({ credit: 300 });
  });
  it('a deposit on a future booking shrinks by its refund', () => {
    expect(c(withRefund(mk('Confirmed', '2026-10-19', 3000, 1000), [400]))).toMatchObject({ deposit: 600, upcoming: 2400 });
  });
  it('refunds are paisa-exact and never push paid below zero', () => {
    expect(c(withRefund({ status: 'Completed', date: '2026-10-12', final_amount: 99.99, payments: [{ amount: 99.99 }] }, [33.33, 33.33, 33.33]))).toMatchObject({ paid: 0, due: 99.99 });
    expect(c(withRefund(mk('Completed', '2026-10-12', 100, 50), [80]))).toMatchObject({ paid: 0 });
  });
  it('paid to date in the summary excludes refunded money', () => {
    const s = summarizeMoney([withRefund(mk('Completed', '2026-10-12', 1000, 1000, { id: 'a' }), [300]), mk('Completed', '2026-10-13', 500, 500, { id: 'b' })], { today: TODAY });
    expect(s.paidToDate).toBe(1200);
    expect(s.due).toBe(300);
  });
});

describe('stale In-Progress', () => {
  it('In-Progress before today is flagged stale and still due', () => {
    expect(c(mk('In-Progress', '2026-10-14', 8000, 0))).toMatchObject({ kind: 'rendered', stale: true, due: 8000, atStake: 0 });
  });
  it('In-Progress today, Completed and scheduled are not stale', () => {
    expect(c(mk('In-Progress', TODAY, 100, 0)).stale).toBe(false);
    expect(c(mk('Completed', '2026-10-01', 100, 0)).stale).toBe(false);
    expect(c(mk('Confirmed', '2026-10-01', 100, 0)).stale).toBe(false);
  });
  it('summary keeps them apart from unclosed so at-stake is not double counted', () => {
    const s = summarizeMoney([mk('In-Progress', '2026-10-14', 8000, 0, { id: 's' }), mk('Confirmed', '2026-10-12', 500, 0, { id: 'u' })], { today: TODAY });
    expect(s.staleInProgress.map((b) => b.id)).toEqual(['s']);
    expect(s.unclosed.map((b) => b.id)).toEqual(['u']);
    expect(s.unclosedAtStake).toBe(500);
    expect(s.due).toBe(8000);
  });
});

describe('summarizeMoney', () => {
  const list = [
    mk('Completed', '2026-10-12', 1500, 0, { id: 'a' }),            // due 1500
    mk('In-Progress', '2026-10-14', 8000, 0, { id: 'b' }),          // due 8000
    mk('Confirmed', '2026-10-19', 3000, 1000, { id: 'c' }),         // upcoming 2000, deposit 1000
    mk('Cancelled', '2026-10-12', 2000, 500, { id: 'd' }),          // credit 500
    mk('Confirmed', '2026-10-12', 4000, 0, { id: 'e' }),            // unclosed, 4000 at stake
    mk('Completed', '2026-10-10', 700, 1000, { id: 'f' }),          // credit 300, paid 1000
  ];
  const s = summarizeMoney(list, { today: TODAY });
  it('splits the money', () => {
    expect(s).toMatchObject({ due: 9500, dueCount: 2, upcoming: 2000, upcomingCount: 1, deposit: 1000, credit: 800, unclosedAtStake: 4000 });
    expect(s.paidToDate).toBe(2500);
    expect(s.unclosed.map((b) => b.id)).toEqual(['e']);
    expect(s.dueBookings.map((b) => b.id)).toEqual(['a', 'b']);
  });
  it('excludeBookingId leaves that booking out of everything', () => {
    const x = summarizeMoney(list, { today: TODAY, excludeBookingId: 'b' });
    expect(x.due).toBe(1500);
    expect(x.dueCount).toBe(1);
  });
  it('handles empty input', () => {
    expect(summarizeMoney([], { today: TODAY })).toMatchObject({ due: 0, upcoming: 0, deposit: 0, credit: 0, paidToDate: 0, unclosed: [] });
    expect(summarizeMoney(undefined, { today: TODAY }).due).toBe(0);
  });
});

describe('closed (locked) days and the Nepal clock', () => {
  it('a locked booking classifies exactly like an unlocked one (the lock only changes what can be collected)', () => {
    const a = c(mk('Completed', '2026-10-12', 1000, 400));
    const b = c({ ...mk('Completed', '2026-10-12', 1000, 400), is_locked: true });
    expect(b).toEqual(a);
  });
  it('locked due bookings stay in dueBookings with their lock flag so callers can split them out', () => {
    const s = summarizeMoney([{ ...mk('Completed', '2026-10-12', 1000, 0, { id: 'l' }), is_locked: true }, mk('Completed', '2026-10-13', 500, 0, { id: 'o' })], { today: TODAY });
    expect(s.dueBookings.map((b) => [b.id, !!b.is_locked])).toEqual([['l', true], ['o', false]]);
    expect(s.due).toBe(1500);
  });
  it('the midnight boundary: a Confirmed booking on the 15th is upcoming at 23:59 Nepal and unclosed from 00:00 on the 16th', () => {
    const b = mk('Confirmed', '2026-10-15', 700, 0);
    expect(classifyBooking(b, { today: '2026-10-15' })).toMatchObject({ kind: 'scheduled', upcoming: 700 });
    expect(classifyBooking(b, { today: '2026-10-16' })).toMatchObject({ kind: 'unclosed', atStake: 700 });
  });
});
