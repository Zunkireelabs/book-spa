import { describe, it, expect } from 'vitest';
import { nextQuarterSlot, prefillToDefaults, newBookingSlot } from './newBookingSlot';

describe('nextQuarterSlot', () => {
  it('rounds up to the next quarter hour', () => {
    expect(nextQuarterSlot({ nowHM: '10:01' })).toMatchObject({ hour: 10, minute: 15 });
    expect(nextQuarterSlot({ nowHM: '10:15' })).toMatchObject({ hour: 10, minute: 15 });
    expect(nextQuarterSlot({ nowHM: '10:46' })).toMatchObject({ hour: 11, minute: 0 });
  });
  it('before opening: the opening time', () => { expect(nextQuarterSlot({ nowHM: '06:20', openTime: '09:00' })).toEqual({ hour: 9, minute: 0, nextDay: false }); });
  it('after the last start slot: opening, next day', () => {
    expect(nextQuarterSlot({ nowHM: '20:50', openTime: '09:00', closeTime: '21:00' })).toEqual({ hour: 9, minute: 0, nextDay: true });
    expect(nextQuarterSlot({ nowHM: '23:10' })).toMatchObject({ nextDay: true });
  });
});

describe('prefillToDefaults', () => {
  it('splits the phone into country code + national and carries every field', () => {
    expect(prefillToDefaults({ fullName: 'Hema D.', phone: '+9779841000000', email: 'h@x.com', gender: 'Female', serviceId: 's1' })).toEqual({
      defaultServiceId: 's1', defaultCustomerName: 'Hema D.', defaultCustomerPhone: '9841000000', defaultCustomerCountryCode: '+977',
      defaultCustomerEmail: 'h@x.com', defaultCustomerGender: 'Female', defaultCustomerExisting: true,
    });
  });
  it('no prefill: nothing', () => { expect(prefillToDefaults(undefined)).toEqual({}); });
});

describe('newBookingSlot', () => {
  const hours = { openTime: '09:00:00', closeTime: '19:00:00' }; // Lazimpat
  const at = (nowHM) => { const r = newBookingSlot({ today: '2026-11-20', nowHM, branchHours: hours }); return `${r.day} ${r.hour}:${String(r.minute).padStart(2, '0')}`; };
  it('is slot-less (no staff)', () => {
    expect(newBookingSlot({ today: '2026-11-20', nowHM: '17:20', branchHours: hours })).toMatchObject({ colType: null, colId: null });
  });
  it.each([
    ['08:00', '2026-11-20 9:00'],
    ['10:07', '2026-11-20 10:15'],
    ['18:44', '2026-11-20 18:45'],
    ['18:51', '2026-11-21 9:00'],
    ['23:30', '2026-11-21 9:00'],
  ])('now %s -> %s', (now, want) => { expect(at(now)).toBe(want); });
  it('rolls over a month end', () => {
    expect(newBookingSlot({ today: '2026-11-30', nowHM: '23:00', branchHours: hours }).day).toBe('2026-12-01');
  });
});
