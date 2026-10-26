import { describe, it, expect } from 'vitest';
import { computeReferralCommission, payrollMonthBounds, tallyBookingEarnings, computeCommissionParts, computeNetPay, totalCommissionEarned } from './payrollCalc';

// ---- REFERENCE: the commission maths exactly as it was inline in generatePayroll() before the extraction (git show 847a5c9:src/services/api.js).
function oldReferral(finalAmount, type, value) {
  const v = Number(value);
  if (!type || !(v >= 0)) return 0;
  if (type === 'percentage') return Math.round(((Number(finalAmount) * v) / 100) * 100) / 100;
  if (type === 'amount') return Math.round(v * 100) / 100;
  return 0;
}
function oldPayroll({ therapists, bookings, productPay, daysInMonth, periodMonth }) {
  const firstDay = `${periodMonth}-01`;
  const [year, month] = periodMonth.split('-').map(Number);
  const dim = new Date(year, month, 0).getDate();
  const lastDay = `${periodMonth}-${String(dim).padStart(2, '0')}`;
  const therapistIds = therapists.map((t) => t.id);
  const therapistByName = {};
  for (const t of therapists) therapistByName[t.name.trim().toLowerCase()] = t.id;
  const serviceRevenueMap = {};
  const referralCommissionMap = {};
  for (const therapistId of therapistIds) { serviceRevenueMap[therapistId] = 0; referralCommissionMap[therapistId] = 0; }
  for (const b of (bookings || [])) {
    if (b.therapist_id && serviceRevenueMap[b.therapist_id] !== undefined) {
      serviceRevenueMap[b.therapist_id] = Math.round((serviceRevenueMap[b.therapist_id] + Number(b.final_amount)) * 100) / 100;
    }
    if (b.referred_by) {
      const refKey = b.referred_by.trim().toLowerCase();
      const matchedId = therapistByName[refKey];
      if (matchedId !== undefined) {
        const earned = oldReferral(b.final_amount, b.referral_commission_type, b.referral_commission_value);
        referralCommissionMap[matchedId] = Math.round((referralCommissionMap[matchedId] + earned) * 100) / 100;
      }
    }
  }
  const items = [];
  let totalNet = 0;
  for (const t of therapists) {
    const comp = t.staff_compensation;
    const salary = comp?.monthly_salary != null ? Number(comp.monthly_salary) : 0;
    const rate = comp?.commission_rate != null ? Number(comp.commission_rate) : 0;
    const att = t.att || { absent: 0, halfDay: 0 };
    const unpaidLeaveDays = t.unpaidLeaveDays || 0;
    const perDay = dim > 0 ? salary / dim : 0;
    const deduction = Math.round(perDay * (att.absent + 0.5 * att.halfDay + unpaidLeaveDays) * 100) / 100;
    const serviceRev = serviceRevenueMap[t.id] || 0;
    const svcCommission = Math.round(serviceRev * (rate / 100) * 100) / 100;
    const refCommission = referralCommissionMap[t.id] || 0;
    const productRate = comp?.product_commission_rate != null ? Number(comp.product_commission_rate) : 0;
    const productRev = productPay.earned[t.id] || 0;
    const productEarned = Math.round(productRev * (productRate / 100) * 100) / 100;
    const productDeduction = Math.round((productPay.refunded[t.id] || 0) * (productRate / 100) * 100) / 100;
    const netPay = Math.round((salary - deduction + svcCommission + refCommission + productEarned - productDeduction) * 100) / 100;
    totalNet = Math.round((totalNet + netPay) * 100) / 100;
    items.push({ id: t.id, salary, rate, deduction, serviceRev, svcCommission, refCommission, productRate, productRev, productEarned, productDeduction, netPay });
  }
  return { items, totalNet, firstDay, lastDay, dim };
}

// ---- NEW: the same run, through the shared helpers (this is what generatePayroll now does).
function newPayroll({ therapists, bookings, productPay, periodMonth }) {
  const { firstDay, lastDay, daysInMonth } = payrollMonthBounds(periodMonth);
  const { serviceRevenueMap, referralCommissionMap } = tallyBookingEarnings({ bookings, therapists });
  const items = [];
  let totalNet = 0;
  for (const t of therapists) {
    const comp = t.staff_compensation;
    const att = t.att || { absent: 0, halfDay: 0 };
    const unpaidLeaveDays = t.unpaidLeaveDays || 0;
    const parts = computeCommissionParts({
      comp, serviceRev: serviceRevenueMap[t.id] || 0, refCommission: referralCommissionMap[t.id] || 0,
      productRev: productPay.earned[t.id] || 0, productRefunded: productPay.refunded[t.id] || 0,
    });
    const { salary, rate, productRate, serviceRev, svcCommission, refCommission, productRev, productEarned, productDeduction } = parts;
    const perDay = daysInMonth > 0 ? salary / daysInMonth : 0;
    const deduction = Math.round(perDay * (att.absent + 0.5 * att.halfDay + unpaidLeaveDays) * 100) / 100;
    const netPay = computeNetPay({ salary, deduction, svcCommission, refCommission, productEarned, productDeduction });
    totalNet = Math.round((totalNet + netPay) * 100) / 100;
    items.push({ id: t.id, salary, rate, deduction, serviceRev, svcCommission, refCommission, productRate, productRev, productEarned, productDeduction, netPay });
  }
  return { items, totalNet, firstDay, lastDay, dim: daysInMonth };
}

const fixture = () => ({
  periodMonth: '2026-02',
  therapists: [
    { id: 't1', name: 'Asha T.', staff_compensation: { monthly_salary: 30000, commission_rate: 12.5, product_commission_rate: 7.5 }, att: { absent: 1, halfDay: 2 }, unpaidLeaveDays: 1 },
    { id: 't2', name: ' Bina R. ', staff_compensation: { monthly_salary: 24999.99, commission_rate: 10, product_commission_rate: 5 } },
    { id: 't3', name: 'Chandra M.', staff_compensation: null },
    { id: 't4', name: 'Dipa S.', staff_compensation: { monthly_salary: null, commission_rate: 0.005, product_commission_rate: 0 } },
  ],
  bookings: [
    { therapist_id: 't1', final_amount: '2250.50', referred_by: 'bina r.', referral_commission_type: 'percentage', referral_commission_value: '7.5' },
    { therapist_id: 't1', final_amount: 1800, referred_by: null },
    { therapist_id: 't2', final_amount: 0.005, referred_by: 'Asha T.', referral_commission_type: 'amount', referral_commission_value: 150.555 },
    { therapist_id: 't2', final_amount: 3333.33, referred_by: 'Nobody', referral_commission_type: 'percentage', referral_commission_value: 10 },
    { therapist_id: 't4', final_amount: 1000.005, referred_by: 'dipa s.', referral_commission_type: 'percentage', referral_commission_value: 33.333 },
    { therapist_id: null, final_amount: 999, referred_by: 'Asha T.', referral_commission_type: 'bogus', referral_commission_value: 5 },
    { therapist_id: 'gone', final_amount: 100, referred_by: 'Chandra M.', referral_commission_type: 'percentage', referral_commission_value: -3 },
  ],
  productPay: { earned: { t1: 4567.45, t2: 1200.5, t3: 0, t4: 99.99 }, refunded: { t1: 850, t2: 0.5, t4: 1.005 } },
});

describe('payroll maths extracted from generatePayroll', () => {
  it('matches the old inline maths on a mixed fixture (service + referral + product + refunds + .5 rounding)', () => {
    const f = fixture();
    expect(newPayroll(f)).toEqual(oldPayroll(f));
  });

  it('matches on a deterministic fuzz of 300 random months', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 4);
      const therapists = Array.from({ length: n }, (_, i) => ({
        id: `t${i}`, name: `Person ${i}`,
        staff_compensation: rnd() < 0.2 ? null : {
          monthly_salary: rnd() < 0.1 ? null : Math.round(rnd() * 5000000) / 100,
          commission_rate: Math.round(rnd() * 3000) / 100, product_commission_rate: Math.round(rnd() * 2000) / 100,
        },
        att: { absent: Math.floor(rnd() * 4), halfDay: Math.floor(rnd() * 4) }, unpaidLeaveDays: Math.floor(rnd() * 3),
      }));
      const bookings = Array.from({ length: Math.floor(rnd() * 12) }, () => ({
        therapist_id: `t${Math.floor(rnd() * (n + 1))}`, final_amount: Math.round(rnd() * 1000000) / 100,
        referred_by: rnd() < 0.4 ? `person ${Math.floor(rnd() * n)}` : null,
        referral_commission_type: ['percentage', 'amount', null, 'x'][Math.floor(rnd() * 4)],
        referral_commission_value: Math.round(rnd() * 5000) / 100,
      }));
      const productPay = { earned: {}, refunded: {} };
      therapists.forEach((t) => { productPay.earned[t.id] = Math.round(rnd() * 500000) / 100; productPay.refunded[t.id] = rnd() < 0.5 ? Math.round(rnd() * 100000) / 100 : 0; });
      const periodMonth = ['2026-01', '2026-02', '2028-02', '2026-11'][Math.floor(rnd() * 4)];
      const f = { therapists, bookings, productPay, periodMonth };
      expect(newPayroll(f)).toEqual(oldPayroll(f));
    }
  });

  it('referral commission is unchanged', () => {
    for (const [a, t, v] of [[1000, 'percentage', 12.5], [333.33, 'percentage', 33.333], [10, 'amount', 5.555], [10, 'percentage', -1], [10, null, 5], [10, 'x', 5], [0.005, 'percentage', 50]]) {
      expect(computeReferralCommission(a, t, v)).toBe(oldReferral(a, t, v));
    }
  });

  it('keeps the calendar month bounds (leap years, 30/31-day months)', () => {
    expect(payrollMonthBounds('2028-02')).toMatchObject({ firstDay: '2028-02-01', lastDay: '2028-02-29', daysInMonth: 29, year: 2028, month: 2 });
    expect(payrollMonthBounds('2026-11')).toMatchObject({ lastDay: '2026-11-30', daysInMonth: 30 });
    expect(payrollMonthBounds('2026-12')).toMatchObject({ lastDay: '2026-12-31', daysInMonth: 31 });
  });

  it('totalCommissionEarned = service + referral + product - refund deduction', () => {
    const f = fixture();
    const { serviceRevenueMap, referralCommissionMap } = tallyBookingEarnings({ bookings: f.bookings, therapists: f.therapists });
    const p = computeCommissionParts({ comp: f.therapists[0].staff_compensation, serviceRev: serviceRevenueMap.t1, refCommission: referralCommissionMap.t1, productRev: f.productPay.earned.t1, productRefunded: f.productPay.refunded.t1 });
    expect(totalCommissionEarned(p)).toBe(Math.round((p.svcCommission + p.refCommission + p.productEarned - p.productDeduction) * 100) / 100);
  });
});
