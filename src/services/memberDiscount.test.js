import { describe, it, expect } from 'vitest';
import { categoryKey, ruleRate, isActiveMember, memberReason, memberDiscountFor, effectOf, defaultOn } from './memberDiscount';

const TODAY = '2026-10-19';
const RULES = { spa: 45, salon: 25, body_scrub: 30, package: 10 };
const member = (o = {}) => ({ tierName: 'Premium Club', tierDiscountRules: RULES, balance: 64200, activationDate: '2026-06-20', expiryDate: '2027-06-20', totalDeposited: 100000, tierAdvanceAmount: 100000, ...o });
const booking = (o = {}) => ({ baseAmount: 2800, discountAmount: 0, discountStatus: 'none', discountReason: null, amountPaid: 0, paymentStatus: 'unpaid', isLocked: false, status: 'Completed', serviceCategory: 'Spa', ...o });

describe('matching rule', () => {
  it('normalises category text to a key', () => {
    expect(categoryKey('Spa')).toBe('spa');
    expect(categoryKey(' Body Scrub ')).toBe('body_scrub');
    expect(categoryKey('body-scrub')).toBe('body_scrub');
    expect(categoryKey('Hair  -  Care')).toBe('hair_care');
    expect(categoryKey(null)).toBe('');
  });
  it('rule lookup accepts 1–100 only', () => {
    expect(ruleRate(RULES, 'spa')).toBe(45);
    expect(ruleRate({ spa: '20' }, 'spa')).toBe(20);
    expect(ruleRate({ spa: 0 }, 'spa')).toBeNull();
    expect(ruleRate({ spa: 120 }, 'spa')).toBeNull();
    expect(ruleRate({ spa: 'x' }, 'spa')).toBeNull();
    expect(ruleRate(RULES, 'nails')).toBeNull();
    expect(ruleRate(RULES, '')).toBeNull();
    expect(ruleRate(RULES, 'package')).toBeNull(); // vouchers only
  });
  it('active member at Nepal today', () => {
    expect(isActiveMember(member(), TODAY)).toBe(true);
    expect(isActiveMember(member({ expiryDate: TODAY }), TODAY)).toBe(true);
    expect(isActiveMember(member({ expiryDate: '2026-10-18' }), TODAY)).toBe(false); // lapsed
    expect(isActiveMember(member({ balance: 0 }), TODAY)).toBe(false); // used up
    expect(isActiveMember(member({ activationDate: null, totalDeposited: 60000 }), TODAY)).toBe(false); // pending
    expect(isActiveMember(null, TODAY)).toBe(false);
  });
  it('member reason text (same as the SQL)', () => {
    expect(memberReason('Premium Club', 45, 'spa')).toBe('Premium Club member · 45% spa');
    expect(memberReason('Premium Club', 30, 'body_scrub')).toBe('Premium Club member · 30% body scrub');
  });
});

describe('memberDiscountFor', () => {
  it('applies the tier rate to a spa booking', () => {
    expect(memberDiscountFor({ booking: booking(), membership: member(), today: TODAY })).toMatchObject({ kind: 'apply', pct: 45, amount: 1260, capped: false, label: 'Spa', reason: 'Premium Club member · 45% spa' });
  });
  it('quiet line when the tier has no rate for the category; nothing at all for non-members', () => {
    expect(memberDiscountFor({ booking: booking({ serviceCategory: 'Nails' }), membership: member(), today: TODAY })).toMatchObject({ kind: 'noRule', label: 'Nails' });
    expect(memberDiscountFor({ booking: booking({ serviceCategory: null }), membership: member(), today: TODAY })).toMatchObject({ kind: 'noRule' });
    expect(memberDiscountFor({ booking: booking(), membership: null, today: TODAY })).toBeNull();
    expect(memberDiscountFor({ booking: booking(), membership: member({ expiryDate: '2026-09-30' }), today: TODAY })).toBeNull();
  });
  it('never on paid / locked / cancelled bookings', () => {
    expect(memberDiscountFor({ booking: booking({ paymentStatus: 'paid' }), membership: member(), today: TODAY })).toBeNull();
    expect(memberDiscountFor({ booking: booking({ isLocked: true }), membership: member(), today: TODAY })).toBeNull();
    expect(memberDiscountFor({ booking: booking({ status: 'Cancelled' }), membership: member(), today: TODAY })).toBeNull();
  });
  it('caps at what is already paid', () => {
    const md = memberDiscountFor({ booking: booking({ amountPaid: 2000, paymentStatus: 'partial' }), membership: member(), today: TODAY });
    expect(md).toMatchObject({ kind: 'apply', amount: 800, capped: true, paid: 2000 });
  });
  it('never stacks: better rate replaces, worse rate shows nothing', () => {
    const better = memberDiscountFor({ booking: booking({ discountAmount: 560, discountStatus: 'approved', discountReason: 'Dashain offer 20%' }), membership: member(), today: TODAY });
    expect(better).toMatchObject({ kind: 'better', amount: 1260, current: 560, extra: 700 });
    expect(memberDiscountFor({ booking: booking({ discountAmount: 1400, discountStatus: 'approved', discountReason: 'Manager 50%' }), membership: member(), today: TODAY })).toBeNull();
    expect(memberDiscountFor({ booking: booking({ discountAmount: 560, discountStatus: 'pending', discountReason: 'Asked 20%' }), membership: member(), today: TODAY })).toMatchObject({ kind: 'better' });
  });
  it('follows bookings.member_discount, not the reason text', () => {
    expect(memberDiscountFor({ booking: booking({ discountAmount: 1260, discountStatus: 'approved', discountReason: 'anything', memberDiscount: 'applied' }), membership: member(), today: TODAY }))
      .toMatchObject({ kind: 'saved', amount: 1260 });
    // A reason that looks like a member one is still a manual discount without the column.
    expect(memberDiscountFor({ booking: booking({ discountAmount: 560, discountStatus: 'approved', discountReason: 'Premium Club member · 20% spa' }), membership: member(), today: TODAY }))
      .toMatchObject({ kind: 'better' });
    expect(memberDiscountFor({ booking: booking({ memberDiscount: 'declined' }), membership: member(), today: TODAY })).toMatchObject({ kind: 'apply', declined: true });
  });
});

describe('effect on the amount due', () => {
  const apply = memberDiscountFor({ booking: booking(), membership: member(), today: TODAY });
  const better = memberDiscountFor({ booking: booking({ discountAmount: 560, discountStatus: 'approved', discountReason: 'Dashain offer 20%' }), membership: member(), today: TODAY });
  const saved = memberDiscountFor({ booking: booking({ discountAmount: 1260, discountStatus: 'approved', discountReason: 'Premium Club member · 45% spa', memberDiscount: 'applied' }), membership: member(), today: TODAY });
  const declined = memberDiscountFor({ booking: booking({ memberDiscount: 'declined' }), membership: member(), today: TODAY });
  it('defaults', () => {
    expect([defaultOn(apply), defaultOn(better), defaultOn(saved), defaultOn(declined), defaultOn(null)]).toEqual([true, false, true, false, false]);
  });
  it('deltas and actions', () => {
    expect(effectOf(apply, true)).toEqual({ delta: 1260, memberAmount: 1260, action: 'apply' });
    expect(effectOf(apply, false)).toEqual({ delta: 0, memberAmount: 0, action: 'remove' }); // records "declined"
    expect(effectOf(declined, false)).toEqual({ delta: 0, memberAmount: 0, action: null }); // already declined
    expect(effectOf(declined, true)).toEqual({ delta: 1260, memberAmount: 1260, action: 'apply' }); // Add back
    expect(effectOf(better, true)).toEqual({ delta: 700, memberAmount: 1260, action: 'apply' });
    expect(effectOf(saved, true)).toEqual({ delta: 0, memberAmount: 1260, action: null });
    expect(effectOf(saved, false)).toEqual({ delta: -1260, memberAmount: 0, action: 'remove' });
    expect(effectOf(null, true)).toEqual({ delta: 0, memberAmount: 0, action: null });
  });
});
