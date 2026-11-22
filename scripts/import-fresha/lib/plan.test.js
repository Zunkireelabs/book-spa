import { describe, it, expect } from 'vitest';
import { buildPlan, allocate, deriveDiscount } from './plan.js';

const clients = [
  { 'Client ID': 'c1', 'First Name': 'Asha', 'Last Name': 'Rai', 'Full Name': 'Asha Rai' },
  { 'Client ID': 'c2', 'First Name': 'Maya', 'Last Name': 'Gurung', 'Full Name': 'Maya Gurung' },
  { 'Client ID': 'c3', 'First Name': 'Maya', 'Last Name': 'Gurung', 'Full Name': 'Maya Gurung' },
];
const team = [{ 'First Name': 'Rojina', 'Last Name': 'Kc', Status: 'Active' }, { 'First Name': 'Old', 'Last Name': 'Staff', Status: 'Archived' }];
const menu = [{ 'Service Name': 'Facial', Duration: '1h' }, { 'Service Name': 'Brow', Duration: '30m' }];
const ap = (ref, client, svc, date, time, dur, price, status, staff = 'Rojina K') =>
  ({ 'Ref #': ref, Client: client, Service: svc, 'Scheduled Date': date, Time: time, Duration: dur, Staff: staff, Price: price, Status: status });

describe('allocate / discount', () => {
  it('sums exactly, last row takes the rest', () => { const a = allocate(1000, [3, 3, 3]); expect(a.reduce((x, y) => x + y)).toBe(1000); expect(a[2]).toBe(334); });
  it('derives a clean percent', () => {
    expect(deriveDiscount(10000, 8000)).toMatchObject({ discountPaisa: 2000, pct: 20, clean: true });
    expect(deriveDiscount(10000, 10000)).toBeNull(); expect(deriveDiscount(10000, 12000)).toBeNull();
  });
});

describe('buildPlan (made-up rows)', () => {
  const base = {
    clients, team, menu, today: '2026-11-22',
    appts: [
      ap('#AAA11111', 'Asha Rai', 'Facial', '2026-11-10', '10:00 am', '60', '1000.00', 'Completed'),
      ap('#BBB22222', 'Asha Rai', 'Brow', '2026-11-10', '10:00 am', '30', '500.00', 'Completed', 'Rojina K'), // same start: group + staff overlap
      ap('#CCC33333', 'Maya Gurung', 'Brow', '2026-11-11', '11:00 am', '15', '500.00', 'Completed'), // dup name, decided by payment
      ap('#DDD44444', 'Maya Gurung', 'Brow', '2026-11-12', '11:00 am', '30', '500.00', 'Booked'),    // dup name, past, undecided
      ap('#EEE55555', 'Walk-In', 'Brow', '2026-11-12', '3:00 pm', '30', '500.00', 'Canceled'),
      ap('#FFF66666', 'Asha Rai', 'Brow', '2026-11-30', '3:00 pm', '30', '500.00', 'Booked'),
    ],
    sales: [
      { 'Invoice #': '1', Client: 'Asha Rai', Status: 'Paid', 'Invoice Date': '2026-11-10 12:00 PM', Tips: '0', 'Gross total': '1200.00' },
      { 'Invoice #': '2', Client: 'Maya Gurung', Status: 'Paid', 'Invoice Date': '2026-11-11 12:00 PM', Tips: '50', 'Gross total': '500.00' },
    ],
    payments: [
      { 'Payment date': '2026-11-10 12:00 PM', 'Payment number': 'p1', 'Invoice date': '2026-11-10 12:00 PM', 'Invoice number': '1', 'Appointment ref': 'aaa11111', 'Client name': 'Asha Rai', 'Client ID': 'c1', 'Payment method': 'Cash', Amount: '1200.00', 'Transaction type': 'Sale' },
      { 'Payment date': '2026-11-11 12:00 PM', 'Payment number': 'p2', 'Invoice date': '2026-11-11 12:00 PM', 'Invoice number': '2', 'Appointment ref': 'ccc33333', 'Client name': 'Maya Gurung', 'Client ID': 'c3', 'Payment method': 'QR PAYMENT', Amount: '550.00', 'Transaction type': 'Sale' },
    ],
  };
  const plan = buildPlan(base);
  const L = (r) => plan.lines.find((l) => l.refKey === r);
  it('maps statuses and flags past Booked', () => {
    expect(L('ddd44444').status).toBe('Confirmed'); expect(plan.report.pastBooked.map((x) => x.ref)).toEqual(['#DDD44444']);
    expect(L('eee55555')).toMatchObject({ status: 'Cancelled', walkIn: true, customerFreshaId: null });
    expect(L('fff66666').future).toBe(true);
  });
  it('resolves a duplicate name by payment client id, lists the undecided one, never guesses', () => {
    expect(L('ccc33333').customerFreshaId).toBe('c3');
    expect(L('ddd44444')).toMatchObject({ ambiguous: true, customerFreshaId: null });
    expect(plan.report.ambiguous).toHaveLength(1);
  });
  it('groups same client + same start, and finds the staff overlap', () => {
    expect(L('aaa11111').groupId).toBe(L('bbb22222').groupId); expect(L('aaa11111').groupId).not.toBeNull();
    expect(plan.report.overlaps).toHaveLength(1);
  });
  it('derives a 20% discount allocated over the visit, keeps prices', () => {
    expect(L('aaa11111').price).toBe(100000);
    expect(L('aaa11111').discount + L('bbb22222').discount).toBe(30000);
  });
  it('links the payment through the invoice and notes the tip case', () => {
    const inv = plan.invoices.find((i) => i.no === '2');
    expect(inv.paid - inv.gross).toBe(inv.tips);
  });
  it('reads the Fresha created-on stamp and counts channels', () => {
    const p2 = buildPlan({ ...base, appts: [{ ...ap('#A1', 'Asha Rai', 'Brow', '2026-11-10', '10:00 am', '30', '1', 'Completed'), 'Created on': '2026-11-09 6:45 pm', Channel: 'Instagram' }, { ...ap('#A2', 'Asha Rai', 'Brow', '2026-11-11', '10:00 am', '30', '1', 'Completed'), 'Created on': 'garbage' }] });
    expect(p2.lines[0].createdOn).toEqual({ date: '2026-11-09', time: '18:45:00' });
    expect(p2.lines[1].createdOn).toBeNull(); expect(p2.report.createdUnparsed).toBe(1); expect(p2.report.channels).toEqual({ Instagram: 1, '(blank)': 1 });
  });
  it('counts a duration differing from the menu', () => { expect(plan.report.durationDiffers).toBe(1); });
  it('aborts on an unknown service and lists unknown staff', () => {
    expect(() => buildPlan({ ...base, appts: [ap('#X', 'Asha Rai', 'Nope', '2026-11-10', '10:00 am', '30', '1', 'Completed')] })).toThrow(/not on menu/);
    expect(buildPlan({ ...base, appts: [ap('#Y', 'Asha Rai', 'Brow', '2026-11-10', '10:00 am', '30', '1', 'Completed', 'Ghost G.')] }).report.unknownStaff).toEqual(['Ghost G.']);
  });
});
