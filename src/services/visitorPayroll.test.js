import { describe, it, expect } from 'vitest';
import { splitServiceRevenueByBranch, tallyBookingEarnings, visitorPayrollHelpLine } from './payrollCalc';
import { workedAtNote, visitFromText } from './visitorAttendance';

const LAZ = 'b-laz';
const SAN = 'b-san';
const govind = { id: 't-govind', name: 'Govind' };
const homeBookings = [{ therapist_id: 't-govind', final_amount: 1000, branch_id: LAZ }];
const lentBookings = [{ therapist_id: 't-govind', final_amount: 2500, branch_id: SAN, branch_name: 'Sanepa' }];

describe('home payroll (ZNLY-118)', () => {
  it('pays home for home + lent bookings and shows the split', () => {
    const all = [...homeBookings, ...lentBookings];
    const split = splitServiceRevenueByBranch({ bookings: all, homeBranchId: LAZ, therapistIds: ['t-govind'] });
    expect(split['t-govind'].atHome).toBe(1000);
    expect(split['t-govind'].lent[SAN]).toEqual({ branchName: 'Sanepa', revenue: 2500 });
    expect(tallyBookingEarnings({ bookings: all, therapists: [govind] }).serviceRevenueMap['t-govind']).toBe(3500);
  });

  it('receiving branch payroll never includes the visitor', () => {
    // Sanepa pays only its own people: Govind is not in its therapist list, so his Sanepa booking adds nothing.
    const sanepaStaff = [{ id: 't-sita', name: 'Sita' }];
    const r = tallyBookingEarnings({ bookings: lentBookings, therapists: sanepaStaff });
    expect(r.serviceRevenueMap).toEqual({ 't-sita': 0 });
    expect(visitorPayrollHelpLine({ visitors: 1, revenue: 2500 })).toBe('1 visiting therapist did NPR 2,500 here. Paid by their home branch.');
    expect(visitorPayrollHelpLine({ visitors: 0, revenue: 0 })).toBeNull();
  });

  it('does not depend on when payroll runs (same rows, any order -> same result)', () => {
    const a = splitServiceRevenueByBranch({ bookings: [...homeBookings, ...lentBookings], homeBranchId: LAZ, therapistIds: ['t-govind'] });
    const b = splitServiceRevenueByBranch({ bookings: [...lentBookings, ...homeBookings], homeBranchId: LAZ, therapistIds: ['t-govind'] });
    expect(a).toEqual(b);
  });
});

describe('home on the booking date pays (ZNLY-125)', () => {
  // payroll_home_bookings hands each branch the bookings its people did while based there, so these rows are what Lazimpat gets for Zeena
  // (moved Lazimpat -> Sanepa on 25 Oct): her 12-14 Oct Lazimpat work. Sanepa gets only her work from 25 Oct.
  const zeena = { id: 't-zeena', name: 'Zeena T.' };
  const lazRows = [{ therapist_id: 't-zeena', final_amount: 3000, branch_id: LAZ }, { therapist_id: 't-zeena', final_amount: 2500, branch_id: LAZ }, { therapist_id: 't-zeena', final_amount: 2000, branch_id: LAZ }];
  const sanRows = [{ therapist_id: 't-zeena', final_amount: 1800, branch_id: SAN }];

  it('Lazimpat pays the days she was Lazimpat\'s, with no lent split', () => {
    expect(tallyBookingEarnings({ bookings: lazRows, therapists: [zeena] }).serviceRevenueMap['t-zeena']).toBe(7500);
    const split = splitServiceRevenueByBranch({ bookings: lazRows, homeBranchId: LAZ, therapistIds: ['t-zeena'] });
    expect(split['t-zeena']).toEqual({ atHome: 7500, lent: {}, lentTotal: 0 });
  });

  it('Sanepa pays only from the day she moved', () => {
    expect(tallyBookingEarnings({ bookings: sanRows, therapists: [zeena] }).serviceRevenueMap['t-zeena']).toBe(1800);
  });

  it('temp window is unchanged: home still pays for work done at the receiving branch', () => {
    const rows = [{ therapist_id: 't-zeena', final_amount: 1000, branch_id: LAZ }, { therapist_id: 't-zeena', final_amount: 2500, branch_id: SAN, branch_name: 'Sanepa' }];
    const split = splitServiceRevenueByBranch({ bookings: rows, homeBranchId: LAZ, therapistIds: ['t-zeena'] });
    expect(split['t-zeena'].atHome).toBe(1000);
    expect(split['t-zeena'].lentTotal).toBe(2500);
  });

  it('same result whenever payroll runs (row order does not matter)', () => {
    const a = splitServiceRevenueByBranch({ bookings: [...lazRows, ...sanRows], homeBranchId: LAZ, therapistIds: ['t-zeena'] });
    const b = splitServiceRevenueByBranch({ bookings: [...sanRows, ...lazRows], homeBranchId: LAZ, therapistIds: ['t-zeena'] });
    expect(a).toEqual(b);
  });
});

describe('visitor attendance note', () => {
  it('says when an upcoming visit starts (Nepal time)', () => {
    expect(visitFromText('2026-10-27T13:10:00Z')).toBe('from 6:55pm');
  });
  it('formats 12-hour times', () => {
  });
  it('shows "Worked at <branch> in – out" only for work away from home', () => {
    const names = { [SAN]: 'Sanepa' };
    expect(workedAtNote({ row: { workedAtBranchId: SAN, checkInTime: '12:02', checkOutTime: '15:30' }, homeBranchId: LAZ, branchNameById: names }))
      .toBe('Worked at Sanepa 12:02pm – 3:30pm');
    expect(workedAtNote({ row: { workedAtBranchId: SAN, checkInTime: '12:02', checkOutTime: null }, homeBranchId: LAZ, branchNameById: names }))
      .toBe('Worked at Sanepa 12:02pm');
    expect(workedAtNote({ row: { workedAtBranchId: LAZ, checkInTime: '10:00' }, homeBranchId: LAZ, branchNameById: names })).toBeNull();
    expect(workedAtNote({ row: { workedAtBranchId: null }, homeBranchId: LAZ, branchNameById: names })).toBeNull();
  });
});
