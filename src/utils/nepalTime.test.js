import { describe, it, expect, afterEach } from 'vitest';
import { NEPAL_TZ, nepalToday, nepalNow, nepalDateOf, addDays } from './nepalTime';

// Instants written as Nepal wall clock (+05:45) so the expectations read as what a person in Kathmandu sees.
const at = (date, hm) => new Date(`${date}T${hm}:00+05:45`);
const DEVICE_TZS = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kathmandu'];
const realTZ = process.env.TZ;
afterEach(() => { if (realTZ === undefined) delete process.env.TZ; else process.env.TZ = realTZ; });

describe('nepalTime', () => {
  it('names the zone once', () => { expect(NEPAL_TZ).toBe('Asia/Kathmandu'); });

  it.each(DEVICE_TZS)('gives the Nepal day whatever the device timezone is (%s)', (tz) => {
    process.env.TZ = tz;
    // the dangerous hours: between 00:00 and 05:45 Nepal the UTC date is still yesterday
    expect(nepalNow(at('2026-11-22', '00:01'))).toEqual({ today: '2026-11-22', hm: '00:01' });
    expect(nepalNow(at('2026-11-22', '00:30'))).toEqual({ today: '2026-11-22', hm: '00:30' });
    expect(nepalNow(at('2026-11-22', '05:44'))).toEqual({ today: '2026-11-22', hm: '05:44' });
    expect(nepalNow(at('2026-11-22', '05:46'))).toEqual({ today: '2026-11-22', hm: '05:46' });
    expect(nepalNow(at('2026-11-22', '23:59'))).toEqual({ today: '2026-11-22', hm: '23:59' });
    expect(nepalToday(at('2026-11-23', '00:00'))).toBe('2026-11-23');
    expect(nepalToday(at('2026-11-22', '23:59'))).toBe('2026-11-22');
  });

  it('is correct across month and year boundaries', () => {
    expect(nepalToday(at('2026-12-01', '00:20'))).toBe('2026-12-01'); // UTC is still 30 Nov
    expect(nepalToday(at('2027-01-01', '00:20'))).toBe('2027-01-01'); // UTC is still 31 Dec
    expect(nepalToday(at('2026-12-31', '23:59'))).toBe('2026-12-31');
    expect(nepalToday(at('2028-02-29', '03:00'))).toBe('2028-02-29'); // leap day
  });

  it('nepalDateOf takes a Date, epoch ms or an ISO timestamp', () => {
    const d = at('2026-11-22', '00:30');
    expect(nepalDateOf(d)).toBe('2026-11-22');
    expect(nepalDateOf(d.getTime())).toBe('2026-11-22');
    expect(nepalDateOf('2026-11-21T18:45:00.000Z')).toBe('2026-11-22'); // 00:30 Nepal, as a Postgres timestamptz string
    expect(nepalDateOf('2026-11-22T18:14:00Z')).toBe('2026-11-22'); // 23:59 Nepal
    expect(nepalDateOf('2026-11-22T18:15:00Z')).toBe('2026-11-23'); // 00:00 next day Nepal
  });

  it('addDays is pure date arithmetic', () => {
    expect(addDays('2026-11-22', 1)).toBe('2026-11-23');
    expect(addDays('2026-11-22', -22)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-22T10:00:00', 0)).toBe('2026-11-22');
  });
});
