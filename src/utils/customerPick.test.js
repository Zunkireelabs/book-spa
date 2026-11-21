import { describe, it, expect } from 'vitest';
import { walkInName, seedFromSearch, searchCustomers, customerSavePayload, customerMissing, PICK_REASON } from './customerPick';

describe('walk-in naming (ZNLY-327)', () => {
  it('no label → "Walk-in"; label is title-cased', () => {
    expect(walkInName('')).toBe('Walk-in');
    expect(walkInName('  ')).toBe('Walk-in');
    expect(walkInName('ram')).toBe('Walk-in · Ram');
  });
});

describe('customerSavePayload', () => {
  it('walk-in: no profile, no phone, no known id, flagged, label kept', () => {
    const p = customerSavePayload({ kind: 'walkin', name: 'stale', phone: '9800000000', email: 'x@y.z', knownCustomerId: 'c1', walkInLabel: 'ram' });
    expect(p).toEqual({ customerName: 'Walk-in · Ram', customerPhone: null, customerEmail: null, customerGender: null, knownCustomerId: undefined, isWalkIn: true, walkInLabel: 'ram' });
  });
  it('walk-in without a label: label null', () => {
    const p = customerSavePayload({ kind: 'walkin' });
    expect(p.customerName).toBe('Walk-in');
    expect(p.walkInLabel).toBeNull();
  });
  it('new customer: typed fields, E.164 phone, never flagged walk-in', () => {
    const p = customerSavePayload({ kind: 'new', name: ' Sita ', phone: '98 000-00000', countryCode: '+977', email: ' a@b.c ', gender: 'female' });
    expect(p).toEqual({ customerName: 'Sita', customerPhone: '+9779800000000', customerEmail: 'a@b.c', customerGender: 'female', knownCustomerId: undefined });
    expect(p.isWalkIn).toBeUndefined();
  });
  it('existing customer: carries the known id', () => {
    const p = customerSavePayload({ kind: 'existing', name: 'Sita', phone: '9800000000', knownCustomerId: 'c1' });
    expect(p.knownCustomerId).toBe('c1');
    expect(p.isWalkIn).toBeUndefined();
  });
});

describe('customerMissing (footer reason)', () => {
  it('nothing picked', () => expect(customerMissing({ kind: null })).toBe(PICK_REASON));
  it('walk-in is always ready', () => expect(customerMissing({ kind: 'walkin' })).toBe(''));
  it('a typed number that is not real is rejected with the plain reason; a picked customer is never re-checked', () => {
    expect(customerMissing({ kind: 'new', name: 'Sita', phone: '98' })).toMatch(/isn't valid for Nepal.*Use Walk-in/);
    expect(customerMissing({ kind: 'existing', name: 'Sita', phone: '98' })).toBe('');
  });
  it('real customers keep the name + phone rules', () => {
    expect(customerMissing({ kind: 'new', name: '' })).toBe('Enter the customer name');
    expect(customerMissing({ kind: 'new', name: 'Sita' })).toBe('Enter the customer phone');
    expect(customerMissing({ kind: 'new', name: 'Sita', phone: '9841221840' })).toBe('');
    expect(customerMissing({ kind: 'existing', name: 'Sita', knownCustomerId: 'c1' })).toBe('');
  });
});

describe('search helpers', () => {
  it('seed: digits become the phone, text the name', () => {
    expect(seedFromSearch('Sita Rai')).toEqual({ name: 'Sita Rai', phone: '' });
    expect(seedFromSearch('98 4122-1840')).toEqual({ name: '', phone: '9841221840' });
    expect(seedFromSearch('')).toEqual({ name: '', phone: '' });
  });
  const list = [{ id: 1, full_name: 'Sita Rai', phone: '+977 9841221840' }, { id: 2, full_name: 'Ram', phone: '9800000000', email: 'r@x.com' }];
  it('matches name, email and digits-only phone', () => {
    expect(searchCustomers(list, 'sit').map((c) => c.id)).toEqual([1]);
    expect(searchCustomers(list, '9841221840').map((c) => c.id)).toEqual([1]);
    expect(searchCustomers(list, 'r@x').map((c) => c.id)).toEqual([2]);
    expect(searchCustomers(list, '')).toEqual([]);
  });
});
