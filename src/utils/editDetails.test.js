import { describe, it, expect } from 'vitest';
import { editFormChanged, editFormSeed } from './editDetails';

const booking = { customerName: 'Puja', serviceId: 's1', date: '2026-11-20', startTime: '10:30:00', specialRequests: '', referredBy: '' };
const form = { customerName: 'Puja', serviceId: 's1', date: '2026-11-20', startTime: '10:30', specialRequests: '', referredBy: '', phoneDial: '+977', phoneNational: '' };

describe('editFormChanged', () => {
  it('a clean form is not changed', () => expect(editFormChanged(form, booking)).toBe(false));
  it('any field edit counts', () => {
    [{ customerName: 'X' }, { serviceId: 's2' }, { date: '2026-11-21' }, { startTime: '11:00' }, { specialRequests: 'a' }, { referredBy: 'b' }, { phoneDial: '+91' }, { phoneNational: '99' }]
      .forEach((c) => expect(editFormChanged({ ...form, ...c }, booking)).toBe(true));
  });
  it('null-safe', () => { expect(editFormChanged(null, booking)).toBe(false); expect(editFormChanged(form, null)).toBe(false); });
});

import { newBookingFormChanged } from './editDetails';
describe('newBookingFormChanged', () => {
  const seed = (mode) => ({ serviceId: mode === 'rebook' ? 's1' : '', date: mode === 'rebook' ? '' : '2026-11-20', startTime: '', therapistId: '', roomId: '' });
  it('untouched add-service / rebook form is clean', () => {
    expect(newBookingFormChanged(seed('add-service'), 'add-service', booking, '2026-11-21')).toBe(false);
    expect(newBookingFormChanged(seed('rebook'), 'rebook', booking, '2026-11-21')).toBe(false);
  });
  it('any edited field counts', () => {
    [{ serviceId: 's9' }, { date: '2026-11-25' }, { startTime: '11:00' }, { therapistId: 't1' }, { roomId: 'r1' }]
      .forEach((c) => expect(newBookingFormChanged({ ...seed('add-service'), ...c }, 'add-service', booking, 'x')).toBe(true));
  });
  it('no mode / null-safe', () => { expect(newBookingFormChanged(seed('rebook'), null, booking)).toBe(false); expect(newBookingFormChanged(null, 'rebook', booking)).toBe(false); });
});

describe('startEditing seed is never "changed"', () => {
  [
    { customerName: 'Walk-in', customerPhone: null, serviceId: 's1', date: '2026-11-24', startTime: '14:00:00', specialRequests: null, referredBy: null },
    { customerName: 'Puja Qc', customerPhone: '+9779841234567', serviceId: 's1', date: '2026-11-24', startTime: '14:00:00', specialRequests: null, referredBy: null },
    { customerName: 'A', customerPhone: '+919812345678', serviceId: 's2', date: '2026-11-24', time: '09:30', specialRequests: 'x', referredBy: 'y' },
  ].forEach((b, i) => it(`real-shaped booking ${i}`, () => expect(editFormChanged(editFormSeed(b), b)).toBe(false)));
  it('phone edit still counts', () => {
    const b = { customerName: 'P', customerPhone: '+9779841234567', startTime: '14:00:00' };
    expect(editFormChanged({ ...editFormSeed(b), phoneNational: '1' }, b)).toBe(true);
  });
});

import { editChanges } from './editDetails';
describe('editChanges: only changed fields are sent (ZNLY-330)', () => {
  const real = { customerName: 'Puja Qc', customerPhone: '+9779841234567', customerId: 'c1', serviceId: 's1', date: '2026-11-24', startTime: '14:00:00', specialRequests: null, referredBy: null };
  const walk = { customerName: 'Walk-in', customerPhone: null, customerId: null, isWalkIn: true, walkInLabel: null, serviceId: 's1', date: '2026-11-24', startTime: '14:00:00', specialRequests: null, referredBy: null };
  it('time-only edit sends only startTime', () => {
    expect(editChanges({ ...editFormSeed(real), startTime: '14:15' }, real, '+9779841234567')).toEqual({ startTime: '14:15:00' });
    expect(editChanges({ ...editFormSeed(walk), startTime: '14:15' }, walk, null)).toEqual({ startTime: '14:15:00' });
  });
  it('an unchanged name or phone is never sent', () => {
    const out = editChanges({ ...editFormSeed(real), specialRequests: 'hi' }, real, '+9779841234567');
    expect(out).toEqual({ specialRequests: 'hi' });
  });
  it('a changed name / phone is sent', () => {
    expect(editChanges({ ...editFormSeed(real), customerName: 'Puja Q', phoneNational: '9800000000' }, real, '+9779800000000'))
      .toEqual({ customerName: 'Puja Q', customerPhone: '+9779800000000' });
  });
  it('client-less walk-in edits its label, never name or phone', () => {
    expect(editChanges({ ...editFormSeed(walk), customerName: ' Ram ' }, walk, null)).toEqual({ walkInLabel: 'Ram' });
    expect(editChanges({ ...editFormSeed(walk), phoneNational: '98' }, walk, '+97798')).toEqual({});
    expect(editFormChanged({ ...editFormSeed(walk), phoneNational: '98' }, walk)).toBe(false);
  });
});
