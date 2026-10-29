import { computeCommissionParts, computeReferralCommission } from '../services/payrollCalc';

const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));

/**
 * My earnings today: own tips (a customer gift, not revenue) plus commission by the payroll formula from get_dashboard's
 * my_day.commission_inputs (service revenue x rate, plus referral commission rows). commission is null without a rate, so the
 * card says "not set up" instead of showing 0. period 'month' reads the month-to-date inputs.
 */
export function myEarnings(myDay, period = 'today') {
  const month = period === 'month';
  const tips = Number(month ? myDay?.tips_month : myDay?.tips) || 0;
  const inp = month ? myDay?.commission_inputs_month : myDay?.commission_inputs;
  const rate = myDay?.commission_inputs?.commission_rate; // the rate is the same for both periods
  if (!inp || rate == null) return { tips, commission: null, total: tips };
  const refCommission = (inp.referral_rows || []).reduce((s, r) => s + computeReferralCommission(r.final_amount, r.type, r.value), 0);
  const parts = computeCommissionParts({ comp: { commission_rate: rate }, serviceRev: Number(inp.service_revenue) || 0, refCommission });
  const commission = Math.round((parts.svcCommission + parts.refCommission) * 100) / 100;
  return { tips, commission, total: Math.round((tips + commission) * 100) / 100 };
}

/** The booking to show as "next client": the one in progress, else the first not yet started that is still open. nowHm = 'HH:MM'. */
export function nextClient(bookings, nowHm) {
  const open = (bookings || []).filter((b) => ['Pending', 'Confirmed', 'In-Progress'].includes(b.status));
  const live = open.find((b) => b.status === 'In-Progress');
  if (live) return live;
  const now = toMin(nowHm);
  return open.find((b) => toMin(b.end) > now) || null;
}

/**
 * My day counts from the list: done (Completed), open (Pending/Confirmed/In-Progress), late (start passed, still Pending/Confirmed).
 * allClosed is true only when every booking is Completed/Cancelled/No Show; "All done" must not be said otherwise.
 */
export function dayStatus(bookings, nowHm) {
  const list = bookings || [];
  const open = list.filter((b) => ['Pending', 'Confirmed', 'In-Progress'].includes(b.status));
  const late = open.filter((b) => b.status !== 'In-Progress' && toMin(b.start) < toMin(nowHm)).length;
  return { total: list.length, done: list.filter((b) => b.status === 'Completed').length, open: open.length, late, allClosed: list.length > 0 && open.length === 0 };
}
