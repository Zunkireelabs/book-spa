import { describe, it, expect } from 'vitest';
import { cardTier, canNameHaveOwnLine, shouldMoveNameDown, paymentState, paidWithCredit, iconsForBooking, splitForShortCard, statusTag, lockReason, fitTinyItems, planFullCard } from './calendarCardLayout';

describe('cardTier', () => {
  it('maps heights to tiers', () => {
    expect(cardTier(18)).toBe('tiny');
    expect(cardTier(36)).toBe('short');
    expect(cardTier(54)).toBe('full');
    expect(cardTier(0)).toBe('full');
  });
});

describe('name wrap decision', () => {
  it('needs room for a second line', () => {
    expect(canNameHaveOwnLine(18)).toBe(false); // 15-min one-line card keeps a truncated name
    expect(canNameHaveOwnLine(36)).toBe(true);  // 30-min: line 1 time, line 2 name, service hidden
    expect(canNameHaveOwnLine(54)).toBe(true);
  });
  it('moves down only when it does not fit and there is room', () => {
    expect(shouldMoveNameDown({ height: 72, timeWidth: 60, nameWidth: 150, lineWidth: 170 })).toBe(true);
    expect(shouldMoveNameDown({ height: 72, timeWidth: 60, nameWidth: 100, lineWidth: 170 })).toBe(false);
    expect(shouldMoveNameDown({ height: 36, timeWidth: 60, nameWidth: 150, lineWidth: 170 })).toBe(true);
    expect(shouldMoveNameDown({ height: 36, timeWidth: 60, nameWidth: 80, lineWidth: 170 })).toBe(false);
    expect(shouldMoveNameDown({ height: 18, timeWidth: 60, nameWidth: 150, lineWidth: 170 })).toBe(false);
  });
});

describe('paymentState', () => {
  it('reads paid / partial / unpaid', () => {
    expect(paymentState({ status: 'Confirmed', paymentStatus: 'paid' })).toBe('paid');
    expect(paymentState({ status: 'Confirmed', paymentStatus: 'partial' })).toBe('partial');
    expect(paymentState({ status: 'Confirmed', paymentStatus: 'unpaid' })).toBe('unpaid');
  });
  it('hides on cancelled / no-show unless money was taken', () => {
    expect(paymentState({ status: 'Cancelled', paymentStatus: 'unpaid' })).toBe(null);
    expect(paymentState({ status: 'No Show', paymentStatus: 'unpaid' })).toBe(null);
    expect(paymentState({ status: 'No Show', paymentStatus: 'unpaid', amountPaid: 500 })).toBe('unpaid');
    expect(paymentState({ status: 'Cancelled', paymentStatus: 'partial' })).toBe('partial');
  });
});

describe('iconsForBooking', () => {
  const b = { status: 'Confirmed', paymentStatus: 'partial', specialRequests: 'x', customerNotes: 'allergy', isNewCustomer: true, isOnline: true, sharedCount: 3, payments: [{ paymentMode: 'SessionPackage', amount: 0 }] };
  it('returns all in fixed order', () => {
    expect(iconsForBooking(b).map(i => i.key)).toEqual(['pay', 'note', 'alert', 'first', 'online', 'pkg', 'group']);
  });
  it('respects the off switches', () => {
    expect(iconsForBooking(b, { pay: false, online: false }).map(i => i.key)).toEqual(['note', 'alert', 'first', 'pkg', 'group']);
  });
  it('nothing for a plain booking except payment', () => {
    expect(iconsForBooking({ status: 'Confirmed', paymentStatus: 'unpaid', sharedCount: 0 }).map(i => i.key)).toEqual(['pay']);
  });
  it('credit detection', () => {
    expect(paidWithCredit({ payments: [{ paymentMode: 'Cash', amount: 5 }] })).toBe(false);
    expect(paidWithCredit({ payments: [{ paymentMode: 'VoucherWallet', amount: 5 }] })).toBe(true);
    expect(paidWithCredit({})).toBe(false);
  });
});

describe('short cards', () => {
  it('keeps payment + alert, counts the rest', () => {
    const icons = iconsForBooking({ status: 'Confirmed', paymentStatus: 'unpaid', specialRequests: 'x', customerNotes: 'y', isNewCustomer: true });
    const { shown, more } = splitForShortCard(icons);
    expect(shown.map(i => i.key)).toEqual(['pay', 'alert']);
    expect(more).toBe(2);
  });
});

describe('statusTag', () => {
  it('tags no-show and cancelled', () => {
    expect(statusTag({ status: 'No Show' })).toBe('No-show');
    expect(statusTag({ status: 'Cancelled' })).toBe('Cancelled');
    expect(statusTag({ status: 'Cancelled', cancellationReason: 'No Show' })).toBe('No-show');
    expect(statusTag({ status: 'Confirmed' })).toBe(null);
  });
});

describe('lockReason', () => {
  const now = new Date('2026-11-19T12:00:00');
  const base = { status: 'Confirmed', paymentStatus: 'unpaid', date: '2026-11-19', startTime: '15:00:00' };
  it('is null for a movable booking', () => { expect(lockReason(base, now)).toBe(null); });
  it('paid wins over everything', () => { expect(lockReason({ ...base, paymentStatus: 'paid', status: 'In-Progress', isLocked: true }, now)).toBe('Locked: paid'); });
  it('finished, in progress, started, day closed in that order', () => {
    expect(lockReason({ ...base, status: 'Completed' }, now)).toBe('Locked: completed');
    expect(lockReason({ ...base, status: 'In-Progress', isLocked: true }, now)).toBe('Locked: in progress');
    expect(lockReason({ ...base, startTime: '10:00:00', isLocked: true }, now)).toBe('Locked: already started');
    expect(lockReason({ ...base, isLocked: true }, now)).toBe('Locked: day closed');
  });
  it('a Pending booking stays movable even if overdue', () => { expect(lockReason({ ...base, status: 'Pending', startTime: '10:00:00' }, now)).toBe(null); });
});

describe('fitTinyItems (15-min card)', () => {
  const items = [{ key: 'pay', width: 13 }, { key: 'alert', width: 13 }, { key: 'more', width: 16 }, { key: 'lock', width: 12 }];
  const keys = (o) => ['pay', 'alert', 'more', 'lock'].filter(k => o.has(k));
  it('shows everything when there is room', () => {
    expect(keys(fitTinyItems({ lineWidth: 300, fixedWidth: 70, nameWidth: 90, items }))).toEqual(['pay', 'alert', 'more', 'lock']);
  });
  it('drops +N first, then alert, then payment, lock last', () => {
    expect(keys(fitTinyItems({ lineWidth: 190, fixedWidth: 70, nameWidth: 90, items }))).toEqual(['pay', 'alert', 'lock']);
    expect(keys(fitTinyItems({ lineWidth: 175, fixedWidth: 70, nameWidth: 90, items }))).toEqual(['pay', 'lock']);
    expect(keys(fitTinyItems({ lineWidth: 155, fixedWidth: 70, nameWidth: 90, items }))).toEqual(['lock']);
    expect(keys(fitTinyItems({ lineWidth: 100, fixedWidth: 70, nameWidth: 90, items }))).toEqual([]);
  });
  it('a short name needs less room', () => {
    expect(keys(fitTinyItems({ lineWidth: 190, fixedWidth: 70, nameWidth: 30, items }))).toEqual(['pay', 'alert', 'more', 'lock']);
  });
});

describe('planFullCard (never overlap, never half-clip)', () => {
  const base = { nameDown: false, hasLead: true, serviceLines: 2, hasRoom: true, hasIcons: true };
  it('60-min card: service line + room + icons, extra service line dropped', () => {
    expect(planFullCard({ ...base, height: 72 })).toEqual({ serviceLines: 1, showRoom: true, showIcons: true });
  });
  it('tall card shows every wrapped service line', () => {
    expect(planFullCard({ ...base, height: 144 })).toEqual({ serviceLines: 2, showRoom: true, showIcons: true });
  });
  it('short-ish card drops icons, then room, whole lines only', () => {
    expect(planFullCard({ ...base, height: 56 })).toEqual({ serviceLines: 1, showRoom: true, showIcons: false });
    expect(planFullCard({ ...base, height: 50 })).toEqual({ serviceLines: 1, showRoom: false, showIcons: false });
  });
  it('a dropped-down name costs a line', () => {
    expect(planFullCard({ ...base, height: 72, nameDown: true })).toEqual({ serviceLines: 1, showRoom: true, showIcons: false });
  });
  it('nothing below the lead line when the lead line does not fit', () => {
    expect(planFullCard({ ...base, height: 46, nameDown: true })).toEqual({ serviceLines: 0, showRoom: false, showIcons: false });
  });
});
