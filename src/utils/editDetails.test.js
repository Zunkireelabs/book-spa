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
