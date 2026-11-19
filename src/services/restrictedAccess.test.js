import { describe, it, expect } from 'vitest';
import { maskCustomerName, maskPhone, phoneTail, nameWithTail, viewerAccess, isRestricted, maskBookingForViewer, moneyOrDash } from './dataMasking';
import { rewriteForRestricted, setRestrictedReads } from '../lib/restrictedReads';

describe('tails', () => {
  it('last 3 digits tell two Sita S. apart', () => {
    expect(phoneTail('98•••••094')).toBe('094');
    expect(nameWithTail('Sita S.', '98•••••094')).toBe('Sita S. · 094');
    expect(nameWithTail('Sita S.', null)).toBe('Sita S.');
  });
});

describe('viewerAccess', () => {
  const staff = (o) => ({ role: 'staff', calendar_visibility: 'all', can_view_customer_details: true, can_view_prices: true, ...o });
  it('manager and admin are never restricted, even with stray flags', () => {
    expect(isRestricted({ role: 'manager', calendar_visibility: 'own', can_view_prices: false })).toBe(false);
    expect(isRestricted({ role: 'admin', can_view_customer_details: false })).toBe(false);
  });
  it('normal staff is unrestricted', () => expect(isRestricted(staff({}))).toBe(false));
  it('each restriction alone makes a staff login restricted', () => {
    expect(isRestricted(staff({ calendar_visibility: 'own' }))).toBe(true);
    expect(isRestricted(staff({ can_view_prices: false }))).toBe(true);
    expect(isRestricted(staff({ can_view_customer_details: false }))).toBe(true);
  });
  it('no profile is not restricted', () => expect(isRestricted(null)).toBe(false));
  it('viewerAccess flags', () => {
    expect(viewerAccess(staff({ calendar_visibility: 'own', can_view_prices: false }))).toEqual({ ownOnly: true, canViewCustomerDetails: true, canViewPrices: false });
  });
});

describe('maskBookingForViewer', () => {
  const b = { customer_name: 'Anisha Thakuri', customer_phone: '+9779800000012', customer_email: 'a@b.c', final_amount: 1000 };
  it('masks and strips per flag', () => {
    expect(maskBookingForViewer(b, { canViewCustomerDetails: false, canViewPrices: false })).toEqual({ customer_name: 'Anisha T.', customer_phone: '98•••••012', customer_email: null, final_amount: null });
  });
  it('leaves a full-access viewer untouched', () => expect(maskBookingForViewer(b, { canViewCustomerDetails: true, canViewPrices: true })).toEqual(b));
  it('moneyOrDash', () => {
    expect(moneyOrDash(5, false, String)).toBe('—');
    expect(moneyOrDash(null, true, String)).toBe('—');
    expect(moneyOrDash(5, true, (n) => `NPR ${n}`)).toBe('NPR 5');
  });
});

describe('rewriteForRestricted', () => {
  const U = 'http://x/rest/v1/';
  it('is a pass-through for normal roles', () => { setRestrictedReads(false); expect(rewriteForRestricted(`${U}bookings?select=*`)).toBe(`${U}bookings?select=*`); });
  it('points reads of sensitive tables at the safe views, writes untouched', () => {
    setRestrictedReads(true);
    expect(rewriteForRestricted(`${U}bookings?select=id`, 'GET')).toBe(`${U}bookings_safe?select=id`);
    expect(rewriteForRestricted(`${U}customers`, 'HEAD')).toBe(`${U}customers_safe`);
    expect(rewriteForRestricted(`${U}bookings?id=eq.1`, 'PATCH')).toBe(`${U}bookings?id=eq.1`);
    expect(rewriteForRestricted(`${U}services?select=*`, 'GET')).toBe(`${U}services?select=*`);
    expect(rewriteForRestricted(`${U}rpc/restricted_set_booking_status`, 'POST')).toBe(`${U}rpc/restricted_set_booking_status`);
    setRestrictedReads(false);
  });
});

import { rewriteSelect, rewriteEmbeds } from '../lib/restrictedReads';
describe('embedded joins', () => {
  it('points embedded sensitive tables at the views, keeping the key', () => {
    expect(rewriteSelect('id,booking:bookings(status),payments(amount)')).toBe('id,booking:bookings_safe(status),payments:payments_safe(amount)');
  });
  it('leaves other tables alone', () => expect(rewriteSelect('id,therapist:therapists(name)')).toBe('id,therapist:therapists(name)'));
  it('rewrites an encoded query string and keeps the filters', () => {
    const out = rewriteEmbeds('?select=id%2Cbooking%3Abookings%28status%29&user_id=eq.1');
    expect(new URLSearchParams(out).get('select')).toBe('id,booking:bookings_safe(status)');
    expect(new URLSearchParams(out).get('user_id')).toBe('eq.1');
  });
});
