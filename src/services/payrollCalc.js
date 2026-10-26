// The ONE place Payroll's money maths lives. generatePayroll() (api.js) and the therapist profile both call these, so a
// number on the profile is the number Payroll would produce. Pure functions only: no Supabase, no Date.now.
//
// Extracted verbatim from generatePayroll -- order of operations and every Math.round(x * 100) / 100 are unchanged on purpose.
// payrollCalc.test.js runs the old inline code and these helpers on the same fixtures and asserts identical output.

const round2 = (x) => Math.round(x * 100) / 100;

// Earned commission for a booking from its per-booking commission config.
// percentage -> final_amount * value / 100 ; amount -> flat value.
export function computeReferralCommission(finalAmount, type, value) {
  const v = Number(value);
  if (!type || !(v >= 0)) return 0;
  if (type === 'percentage') {
    return Math.round(((Number(finalAmount) * v) / 100) * 100) / 100;
  }
  if (type === 'amount') {
    return Math.round(v * 100) / 100;
  }
  return 0;
}

/** 'YYYY-MM' -> { firstDay, lastDay, daysInMonth, year, month } (calendar dates, as Payroll uses them). */
export function payrollMonthBounds(periodMonth) {
  const firstDay = `${periodMonth}-01`;
  const [year, month] = periodMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDay = `${periodMonth}-${String(daysInMonth).padStart(2, '0')}`;
  return { firstDay, lastDay, daysInMonth, year, month };
}

/**
 * Service revenue (completed + paid bookings) per therapist, and referral commission per therapist matched by name.
 * bookings: rows with { therapist_id, final_amount, referred_by, referral_commission_type, referral_commission_value }.
 * therapists: [{ id, name }]. Returns { serviceRevenueMap, referralCommissionMap } keyed by therapist id.
 */
export function tallyBookingEarnings({ bookings, therapists }) {
  const therapistIds = therapists.map((t) => t.id);
  const therapistByName = {};
  for (const t of therapists) {
    therapistByName[t.name.trim().toLowerCase()] = t.id;
  }
  const serviceRevenueMap = {};
  const referralCommissionMap = {};
  for (const therapistId of therapistIds) {
    serviceRevenueMap[therapistId] = 0;
    referralCommissionMap[therapistId] = 0;
  }
  for (const b of (bookings || [])) {
    if (b.therapist_id && serviceRevenueMap[b.therapist_id] !== undefined) {
      serviceRevenueMap[b.therapist_id] = Math.round(
        (serviceRevenueMap[b.therapist_id] + Number(b.final_amount)) * 100
      ) / 100;
    }
    // Attribute referral commission by name match.
    if (b.referred_by) {
      const refKey = b.referred_by.trim().toLowerCase();
      const matchedId = therapistByName[refKey];
      if (matchedId !== undefined) {
        const earned = computeReferralCommission(
          b.final_amount,
          b.referral_commission_type,
          b.referral_commission_value
        );
        referralCommissionMap[matchedId] = Math.round(
          (referralCommissionMap[matchedId] + earned) * 100
        ) / 100;
      }
    }
  }
  return { serviceRevenueMap, referralCommissionMap };
}

/**
 * One person's commission parts for the month.
 *   comp: the staff_compensation row ({ monthly_salary, commission_rate, product_commission_rate }) or null
 *   serviceRev / refCommission: from tallyBookingEarnings;  productRev / productRefunded: from computeProductCommissionBase
 */
export function computeCommissionParts({ comp, serviceRev = 0, refCommission = 0, productRev = 0, productRefunded = 0 }) {
  const salary = comp?.monthly_salary != null ? Number(comp.monthly_salary) : 0;
  const rate = comp?.commission_rate != null ? Number(comp.commission_rate) : 0;
  const svcCommission = Math.round(serviceRev * (rate / 100) * 100) / 100;
  const productRate = comp?.product_commission_rate != null ? Number(comp.product_commission_rate) : 0;
  const productEarned = Math.round(productRev * (productRate / 100) * 100) / 100;
  const productDeduction = Math.round((productRefunded || 0) * (productRate / 100) * 100) / 100;
  return { salary, rate, productRate, serviceRev, svcCommission, refCommission, productRev, productEarned, productDeduction };
}

/** Net pay: salary - attendance deduction + all commissions - refunded-product deduction (rounded once, as Payroll does). */
export function computeNetPay({ salary, deduction = 0, svcCommission = 0, refCommission = 0, productEarned = 0, productDeduction = 0 }) {
  return Math.round(
    (salary - deduction + svcCommission + refCommission + productEarned - productDeduction) * 100
  ) / 100;
}

/** Commission-only earnings (what the profile shows as "commission earned"): service + referral + product - refund deduction. */
export function totalCommissionEarned(parts) {
  return round2(parts.svcCommission + parts.refCommission + parts.productEarned - parts.productDeduction);
}
