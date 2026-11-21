import { describe, it, expect } from 'vitest';
import { editFormChanged } from './editDetails';

const booking = { customerName: 'Puja', serviceId: 's1', date: '2026-11-20', startTime: '10:30:00', specialRequests: '', referredBy: '' };
const form = { customerName: 'Puja', serviceId: 's1', date: '2026-11-20', startTime: '10:30', specialRequests: '', referredBy: '', phoneDial: '+977', phoneDialInitial: '+977', phoneNational: '98', phoneNationalInitial: '98' };

describe('editFormChanged', () => {
  it('a clean form is not changed', () => expect(editFormChanged(form, booking)).toBe(false));
  it('any field edit counts', () => {
    [{ customerName: 'X' }, { serviceId: 's2' }, { date: '2026-11-21' }, { startTime: '11:00' }, { specialRequests: 'a' }, { referredBy: 'b' }, { phoneDial: '+91' }, { phoneNational: '99' }]
      .forEach((c) => expect(editFormChanged({ ...form, ...c }, booking)).toBe(true));
  });
  it('null-safe', () => { expect(editFormChanged(null, booking)).toBe(false); expect(editFormChanged(form, null)).toBe(false); });
});
