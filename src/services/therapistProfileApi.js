// Data for the therapist profile page (V28 / ZNLY-97): Overview, Services matrix, Pay earnings, History feed, attendance strip.
// Money maths comes ONLY from ./payrollCalc (the same helpers generatePayroll uses). Pay-related fields are returned only to
// admin and admin_viewer (Payroll's rule: admin edits, admin_viewer reads; managers and staff NEVER see pay); for everyone else they
// are null (and RLS / get_therapist_activity enforce it a second time on the server).
import { supabase } from '../lib/supabase';
import { computeProductCommissionBase, fetchClosedDateRanges } from './api';
import { payrollMonthBounds, tallyBookingEarnings, computeCommissionParts, totalCommissionEarned } from './payrollCalc';
import { dbDowOfDate, effectiveHoursForDate, hoursFromShiftRow, timeToMinutes, DB_DOW_LABELS } from '../utils/staffDay';
import { nextWorkingDay, isClosedDate } from '../utils/todayStatusLine';
import { nepalNow } from '../utils/customerDirectory';
import { describeTransfer, toTransferInput, transferTitle, transferWindowLine, transferDurationText } from '../utils/transferText';

const PAY_ROLES = ['admin', 'admin_viewer'];
export const canSeePay = (role) => PAY_ROLES.includes(role);

// A check-in counts as on time when it is at most this many minutes after the shift start (Nepal time).
export const ON_TIME_GRACE_MINUTES = 10;

const round2 = (n) => Math.round(n * 100) / 100;
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const NEPAL_OFFSET_MIN = 5 * 60 + 45;

// ------------------------------------------------------------------ pure helpers

/** ISO timestamp -> minutes since midnight in Nepal time. */
export function nepalMinutesOfDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + NEPAL_OFFSET_MIN) % (24 * 60);
}

/** On time = checked in no later than shift start + grace. Returns null when there is no shift to compare against. */
export function isOnTime(checkInIso, shiftStart, graceMinutes = ON_TIME_GRACE_MINUTES) {
  const start = timeToMinutes(shiftStart);
  const at = checkInIso ? nepalMinutesOfDay(checkInIso) : null;
  if (start == null || at == null) return null;
  return at <= start + graceMinutes;
}

const LEAVE_LIKE = new Set(['Leave', 'Annual Leave', 'Sick Leave', '1st-Half Day', '2nd-Half Day']);

/**
 * One calendar day for the History attendance strip.
 *   -> 'on-time' | 'late' | 'leave' | 'off' | 'absent' | 'none'
 * attendance: therapist_attendance row ({ status, check_in_time }) or null; hours: effectiveHoursForDate() for that date.
 */
export function classifyAttendanceDay({ attendance, hours }) {
  const st = attendance?.status;
  if (st === 'Absent') return 'absent';
  if (st === 'Day Off') return 'off';
  if (st && LEAVE_LIKE.has(st) && !attendance.check_in_time) return 'leave';
  if (attendance?.check_in_time) {
    const onTime = isOnTime(attendance.check_in_time, hours?.startTime);
    return onTime === false ? 'late' : 'on-time';
  }
  if (hours && hours.source !== 'none' && hours.isDayOff) return 'off';
  return 'none';
}

const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const daysInYm = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const addDays = (dateStr, n) => { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

/** The Monday-first week (7 'YYYY-MM-DD') that contains dateStr. */
export function weekDates(dateStr) {
  const monday = addDays(dateStr, -dbDowOfDate(dateStr));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// ------------------------------------------------------------------ activity feed text (pure)

const money = (n) => `Rs ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n)}%`;
const clock = (t) => (t ? String(t).slice(0, 5) : '');
const span = (s, e) => `${clock(s)}–${clock(e)}`;
const dayName = (dow) => DB_DOW_LABELS[dow] || 'that day';
function niceDate(dateStr) {
  if (!dateStr) return 'a date';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const listOf = (a) => (Array.isArray(a) ? a.join(', ') : (a ?? ''));
const had = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// Profile fields (therapists table) -> sentence. Keys not listed are ignored (ids, display order, timestamps...).
function profileClauses(oldD, newD, { staffLabel = 'Therapist', supportLabel = 'Support staff' } = {}) {
  const out = [];
  const simple = [['name', 'Name'], ['gender', 'Gender'], ['position', 'Position'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['city', 'City'], ['pronouns', 'Pronouns']];
  for (const [k, label] of simple) {
    if (had(newD, k)) out.push(`${label} ${oldD?.[k] ? `${oldD[k]} → ${newD[k] || 'cleared'}` : `set to ${newD[k] || 'empty'}`}`);
  }
  if (had(newD, 'is_active')) out.push(newD.is_active ? 'Activated' : 'Deactivated');
  if (had(newD, 'is_service_staff')) out.push(`Type ${oldD?.is_service_staff ? staffLabel : supportLabel} → ${newD.is_service_staff ? staffLabel : supportLabel}`);
  if (had(newD, 'specialties')) out.push(`Specialties ${listOf(oldD?.specialties) || 'none'} → ${listOf(newD.specialties) || 'none'}`);
  if (had(newD, 'bio')) out.push('Bio updated');
  if (had(newD, 'photo_url')) out.push(newD.photo_url ? 'Photo changed' : 'Photo removed');
  if (had(newD, 'experience_years')) out.push(`Experience ${oldD?.experience_years ?? 0} → ${newD.experience_years ?? 0} years`);
  if (had(newD, 'rating')) out.push(`Rating ${oldD?.rating ?? '—'} → ${newD.rating ?? '—'}`);
  if (had(newD, 'branch_id')) out.push('Moved to another branch');
  return out;
}

function payClauses(oldD, newD) {
  const out = [];
  if (had(newD, 'monthly_salary')) out.push(`Monthly salary ${money(oldD?.monthly_salary ?? 0)} → ${money(newD.monthly_salary ?? 0)}`);
  if (had(newD, 'commission_rate')) out.push(`Service commission ${pct(oldD?.commission_rate ?? 0)} → ${pct(newD.commission_rate ?? 0)}`);
  if (had(newD, 'product_commission_rate')) out.push(`Product commission ${pct(oldD?.product_commission_rate ?? 0)} → ${pct(newD.product_commission_rate ?? 0)}`);
  return out;
}

/**
 * One audit/transfer row -> { category, text } with no raw column names. Hours breaks are handled by buildActivityItems
 * (they need grouping), so a lone break row falls back to a plain line here.
 * row: { table_name, action_type, old_data, new_data, from_branch_name, to_branch_name }
 */
export function formatActivityText(row, labels = {}) {
  const { table_name: t, action_type: a, old_data: o, new_data: n } = row;
  if (t === 'staff_transfers') {
    const note = n?.is_return_leg ? 'Returned' : 'Transferred';
    return `${note} from ${row.from_branch_name || 'a branch'} to ${row.to_branch_name || 'a branch'}${n?.is_permanent ? ' (permanent)' : ''}${n?.reverted ? ' — reverted' : ''}`;
  }
  if (t === 'therapists') {
    if (a === 'INSERT') return 'Profile created';
    if (a === 'DELETE') return 'Profile deleted';
    return profileClauses(o, n, labels).join(' · ') || 'Profile updated';
  }
  if (t === 'staff_compensation') {
    if (a === 'INSERT') return `Pay set: salary ${money(n?.monthly_salary ?? 0)}, service commission ${pct(n?.commission_rate ?? 0)}, product commission ${pct(n?.product_commission_rate ?? 0)}`;
    if (a === 'DELETE') return 'Pay details removed';
    return payClauses(o, n).join(' · ') || 'Pay updated';
  }
  if (t === 'staff_roster_overrides') {
    const date = niceDate(n?.override_date || o?.override_date);
    const shape = (d) => (d?.is_day_off ? 'day off' : span(d?.start_time, d?.end_time));
    if (a === 'INSERT') return `Date change added for ${date}: ${shape(n)}`;
    if (a === 'DELETE') return `Date change removed for ${date}`;
    const was = { ...o }; const now = { ...n };
    const f = (k) => (had(was, k) ? was[k] : undefined);
    const from = was.is_day_off ? 'day off' : span(f('start_time') ?? '', f('end_time') ?? '');
    const to = now.is_day_off ? 'day off' : span(now.start_time ?? f('start_time') ?? '', now.end_time ?? f('end_time') ?? '');
    return `Date change for ${date}: ${had(was, 'start_time') || had(was, 'end_time') || had(was, 'is_day_off') ? `${from} → ${to}` : 'updated'}`;
  }
  if (t === 'therapist_working_hours') {
    const day = dayName(n?.day_of_week ?? o?.day_of_week);
    if (a === 'INSERT') return n?.is_day_off ? `${day}: day off` : `${day} hours set to ${span(n?.start_time, n?.end_time)}`;
    if (a === 'DELETE') {
      const bs = Array.isArray(o?.breaks) ? o.breaks : [];
      return `${day} hours removed${bs.length ? ` (with ${bs.length === 1 ? 'break' : `${bs.length} breaks`} ${bs.map((b) => `${b.name ? `${b.name} ` : ''}${span(b.start_time, b.end_time)}`).join(', ')})` : ''}`;
    }
    if (had(n, 'is_day_off') && n.is_day_off) return `${day} changed to a day off`;
    if (had(n, 'is_day_off') && !n.is_day_off) return `${day} is now a working day${n.start_time ? ` (${span(n.start_time, n.end_time)})` : ''}`;
    const s = had(n, 'start_time') ? `starts ${clock(o?.start_time)} → ${clock(n.start_time)}` : null;
    const e = had(n, 'end_time') ? `ends ${clock(o?.end_time)} → ${clock(n.end_time)}` : null;
    return `${day} ${[s, e].filter(Boolean).join(', ') || 'hours updated'}`;
  }
  if (t === 'therapist_working_hours_breaks') {
    const day = dayName(n?.day_of_week ?? o?.day_of_week);
    const name = n?.break_name || o?.break_name || 'break';
    if (a === 'INSERT') return `${day}: added break '${name}' ${span(n?.start_time, n?.end_time)}`;
    if (a === 'DELETE') return `${day}: removed break '${name}' ${span(o?.start_time, o?.end_time)}`;
    return `${day}: changed break '${name}'`;
  }
  return 'Updated';
}

const CATEGORY = { therapists: 'profile', staff_compensation: 'pay', staff_roster_overrides: 'hours', therapist_working_hours: 'hours', therapist_working_hours_breaks: 'hours', staff_transfers: 'transfers' };
const BREAK_GROUP_WINDOW_MS = 60 * 1000;

/**
 * Raw get_therapist_activity rows -> feed items { id, at, actorName, category, text }, newest first.
 * Break rows for the same day from the same actor within a minute become ONE line ("Tuesday breaks: added Lunch 13:00–14:00; ..."),
 * and an identical remove + add pair (the app re-saves every break whenever hours are saved) is dropped as "no change".
 */
export function buildActivityItems(rows = [], labels = {}) {
  const items = [];
  const breakRows = [];
  for (const r of rows) {
    if (r.table_name === 'therapist_working_hours_breaks') { breakRows.push(r); continue; }
    items.push({ id: r.id, at: r.at, actorName: r.actor_name || null, category: r.category || CATEGORY[r.table_name] || 'profile', text: formatActivityText(r, labels) });
  }

  // group breaks: same actor + same day + within the window
  const sorted = [...breakRows].sort((a, b) => new Date(a.at) - new Date(b.at));
  const groups = [];
  for (const r of sorted) {
    const d = r.new_data?.day_of_week ?? r.old_data?.day_of_week;
    const g = groups.find((x) => x.day === d && x.actor === (r.actor_name || null) && new Date(r.at) - new Date(x.last) <= BREAK_GROUP_WINDOW_MS);
    if (g) { g.rows.push(r); g.last = r.at; } else groups.push({ day: d, actor: r.actor_name || null, rows: [r], first: r.at, last: r.at });
  }
  for (const g of groups) {
    const sig = (d) => `${d?.break_name || ''}|${clock(d?.start_time)}|${clock(d?.end_time)}`;
    const added = g.rows.filter((r) => r.action_type === 'INSERT').map((r) => ({ d: r.new_data }));
    const removed = g.rows.filter((r) => r.action_type === 'DELETE').map((r) => ({ d: r.old_data }));
    const edited = g.rows.filter((r) => r.action_type === 'UPDATE');
    // cancel identical remove + add pairs
    for (let i = removed.length - 1; i >= 0; i--) {
      const j = added.findIndex((x) => sig(x.d) === sig(removed[i].d));
      if (j >= 0) { added.splice(j, 1); removed.splice(i, 1); }
    }
    const parts = [];
    if (added.length) parts.push(`added ${added.map((x) => `${x.d?.break_name || 'break'} ${span(x.d?.start_time, x.d?.end_time)}`).join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.map((x) => `${x.d?.break_name || 'break'} ${span(x.d?.start_time, x.d?.end_time)}`).join(', ')}`);
    if (edited.length) parts.push(`changed ${edited.map((r) => `${r.new_data?.break_name || r.old_data?.break_name || 'break'}`).join(', ')}`);
    if (!parts.length) continue;
    items.push({ id: g.rows[g.rows.length - 1].id, at: g.last, actorName: g.actor, category: 'hours', text: `${dayName(g.day)} breaks: ${parts.join('; ')}` });
  }
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// ------------------------------------------------------------------ queries

/**
 * This month's earnings for ONE person, computed with the Payroll helpers over the same inputs generatePayroll reads.
 * Returns { data, error }. data is null-filled for roles that may not see pay.
 */
export async function fetchTherapistEarnings({ therapistId, branchId, periodMonth, role }) {
  try {
    if (!canSeePay(role)) return { data: null, error: null }; // role is required: no role, no pay data
    const { firstDay, lastDay } = payrollMonthBounds(periodMonth);

    // The branch's active staff, as Payroll sees them (names drive the referral match).
    const [staffRes, bookingsRes, compRes, runItemRes] = await Promise.all([
      supabase.from('therapists').select('id, name').eq('is_active', true).eq('branch_id', branchId),
      supabase.from('bookings')
        .select('therapist_id, final_amount, referred_by, referral_commission_type, referral_commission_value')
        .eq('status', 'Completed').eq('payment_status', 'paid').eq('branch_id', branchId).gte('date', firstDay).lte('date', lastDay),
      supabase.from('staff_compensation').select('monthly_salary, commission_rate, product_commission_rate').eq('therapist_id', therapistId).maybeSingle(),
      supabase.from('payroll_items')
        .select('net_pay, payroll_runs!inner(period_month, status, branch_id)')
        .eq('therapist_id', therapistId).order('created_at', { ascending: false }).limit(5),
    ]);
    for (const r of [staffRes, bookingsRes, compRes, runItemRes]) if (r.error) throw r.error;

    let staff = staffRes.data || [];
    if (!staff.some((t) => t.id === therapistId)) {
      const { data: me, error } = await supabase.from('therapists').select('id, name').eq('id', therapistId).single();
      if (error) throw error;
      staff = [...staff, me];
    }
    const { serviceRevenueMap, referralCommissionMap } = tallyBookingEarnings({ bookings: bookingsRes.data, therapists: staff });
    const productPay = await computeProductCommissionBase({ branchId, periodMonth, therapistIds: [therapistId] });
    const parts = computeCommissionParts({
      comp: compRes.data,
      serviceRev: serviceRevenueMap[therapistId] || 0,
      refCommission: referralCommissionMap[therapistId] || 0,
      productRev: productPay.earned[therapistId] || 0,
      productRefunded: productPay.refunded[therapistId] || 0,
    });

    const runs = (runItemRes.data || []).filter((i) => i.payroll_runs).sort((a, b) => (a.payroll_runs.period_month < b.payroll_runs.period_month ? 1 : -1));
    const last = runs[0];
    return {
      data: {
        serviceRevenue: parts.serviceRev,
        serviceCommission: parts.svcCommission,
        referralCommission: parts.refCommission,
        productRevenue: parts.productRev,
        productCommission: parts.productEarned,
        productCommissionDeduction: parts.productDeduction,
        total: totalCommissionEarned(parts),
        rates: { monthlySalary: parts.salary, service: parts.rate, product: parts.productRate },
        lastPayRun: last ? { periodMonth: String(last.payroll_runs.period_month).slice(0, 7), status: last.payroll_runs.status, netPay: Number(last.net_pay) } : null,
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchTherapistEarnings error:', error.message);
    return { data: null, error };
  }
}

async function fetchHoursInputs({ therapistId, from, to }) {
  const [whRes, ovRes] = await Promise.all([
    supabase.from('therapist_working_hours')
      .select('day_of_week, start_time, end_time, is_day_off, therapist_working_hours_breaks(name, start_time, end_time, sort_order)')
      .eq('therapist_id', therapistId),
    supabase.from('staff_roster_overrides')
      .select('override_date, start_time, end_time, is_day_off').eq('therapist_id', therapistId).gte('override_date', from).lte('override_date', to),
  ]);
  if (whRes.error) throw whRes.error;
  if (ovRes.error) throw ovRes.error;
  const weekly = (whRes.data || []).map((r) => ({
    dayOfWeek: r.day_of_week, startTime: hm(r.start_time), endTime: hm(r.end_time), isDayOff: !!r.is_day_off,
    breaks: [...(r.therapist_working_hours_breaks || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((b) => ({ name: b.name, startTime: hm(b.start_time), endTime: hm(b.end_time) })),
  }));
  const overrides = (ovRes.data || []).map((r) => ({ date: r.override_date, startTime: hm(r.start_time), endTime: hm(r.end_time), isDayOff: !!r.is_day_off }));
  return { weekly, overrides };
}

/**
 * Every booking SLICE this person does in [from, to] -- the same rule as the Therapists list and the Calendar cards: a combo gives
 * each component to that component's therapist, a shared (companion) booking gives each assigned therapist their own slice, anything
 * else belongs to the booking's therapist. Cancelled / No Show are left out. Returns one row per card.
 */
export async function fetchTherapistSlices({ therapistId, from, to }) {
  const cols = 'id, booking_number, date, start_time, end_time, status, payment_status, final_amount, customer_name, therapist_id, service_id, service_name_snapshot, booking_therapists(therapist_id, start_time, end_time), booking_combo_items(therapist_id, service_id, start_time, end_time, service:services(name))';
  const notDone = '("Cancelled","No Show")';
  const [prim, bt, ci] = await Promise.all([
    supabase.from('bookings').select(cols).eq('therapist_id', therapistId).gte('date', from).lte('date', to).not('status', 'in', notDone),
    supabase.from('booking_therapists').select(`bookings!inner(${cols})`).eq('therapist_id', therapistId).gte('bookings.date', from).lte('bookings.date', to).not('bookings.status', 'in', notDone),
    supabase.from('booking_combo_items').select(`bookings!inner(${cols})`).eq('therapist_id', therapistId).gte('bookings.date', from).lte('bookings.date', to).not('bookings.status', 'in', notDone),
  ]);
  for (const r of [prim, bt, ci]) if (r.error) throw r.error;
  const byId = new Map();
  (prim.data || []).forEach((b) => byId.set(b.id, b));
  (bt.data || []).forEach((r) => r.bookings && byId.set(r.bookings.id, r.bookings));
  (ci.data || []).forEach((r) => r.bookings && byId.set(r.bookings.id, r.bookings));
  const slices = [];
  for (const b of byId.values()) {
    const combo = b.booking_combo_items || [];
    const shared = b.booking_therapists || [];
    if (combo.length > 0) {
      combo.filter((c) => c.therapist_id === therapistId).forEach((c) => slices.push({ ...b, start_time: c.start_time || b.start_time, end_time: c.end_time || b.end_time, service_id: c.service_id || b.service_id, service_name_snapshot: c.service?.name || b.service_name_snapshot }));
    } else if (shared.length > 1) {
      shared.filter((x) => x.therapist_id === therapistId).forEach((x) => slices.push({ ...b, start_time: x.start_time || b.start_time, end_time: x.end_time || b.end_time }));
    } else if ((b.therapist_id || shared[0]?.therapist_id) === therapistId) {
      slices.push(b);
    }
  }
  return slices;
}

const runningTotal = (dates, days) => {
  const counts = Array(days).fill(0);
  dates.forEach((d) => { const i = Number(String(d).slice(8, 10)) - 1; if (i >= 0 && i < days) counts[i] += 1; });
  let run = 0; return counts.map((c) => (run += c));
};

/**
 * Overview tab: month-to-date tiles, today's bookings, most-booked services, this week.
 * Bookings = this person's (primary therapist) bookings that aren't Cancelled / No Show. Revenue = Completed + paid, like Payroll.
 */
export async function fetchTherapistOverview({ therapistId, branchId, today, role }) {
  try {
    const todayStr = today || nepalNow().today;
    const ym = todayStr.slice(0, 7);
    const monthStart = `${ym}-01`;
    const lastYm = prevMonth(ym);
    const dayNo = Number(todayStr.slice(8, 10));
    const lastEnd = `${lastYm}-${String(Math.min(dayNo, daysInYm(lastYm))).padStart(2, '0')}`;
    const week = weekDates(todayStr);

    const lookAheadEnd = [week[6], addDays(todayStr, 8)].sort().pop(); // +8: "back Tue 09:00" looks a week ahead
    const [slicesRes, revRes, attRes, hours, earnings, shiftsRes, closedRes] = await Promise.all([
      fetchTherapistSlices({ therapistId, from: `${lastYm}-01`, to: todayStr }),
      // Revenue is the PRIMARY therapist's Completed + paid bookings, exactly what Payroll attributes to them.
      supabase.from('bookings').select('final_amount, date').eq('therapist_id', therapistId).eq('status', 'Completed').eq('payment_status', 'paid')
        .gte('date', monthStart).lte('date', todayStr),
      supabase.from('therapist_attendance').select('date, status, check_in_time, check_out_time').eq('therapist_id', therapistId).gte('date', monthStart < week[0] ? monthStart : week[0]).lte('date', todayStr > week[6] ? todayStr : week[6]),
      fetchHoursInputs({ therapistId, from: monthStart < week[0] ? monthStart : week[0], to: week[6] > todayStr ? week[6] : todayStr }),
      canSeePay(role) ? fetchTherapistEarnings({ therapistId, branchId, periodMonth: ym, role }) : Promise.resolve({ data: null }),
      // This week's hours come only from the staff-availability rule (therapist_shifts_for_range), like the calendar and the Therapists list.
      branchId ? supabase.rpc('therapist_shifts_for_range', { p_branch_id: branchId, p_from_date: week[0], p_to_date: lookAheadEnd }) : Promise.resolve({ data: [], error: null }),
      branchId ? fetchClosedDateRanges(branchId) : Promise.resolve({ data: [] }),
    ]);
    if (revRes.error) throw revRes.error;
    if (attRes.error) throw attRes.error;

    // Bookings = slices (what the Calendar draws): primary + shared/companion + combo components assigned to this person.
    const all = slicesRes;
    const thisMonth = all.filter((b) => b.date >= monthStart);
    const lastMonthSame = all.filter((b) => b.date >= `${lastYm}-01` && b.date <= lastEnd);
    const serviceRevenue = round2((revRes.data || []).reduce((sum, b) => sum + Number(b.final_amount), 0));

    const counts = new Map();
    for (const b of thisMonth) {
      const k = b.service_id;
      const cur = counts.get(k) || { serviceId: k, name: b.service_name_snapshot || 'Service', count: 0 };
      cur.count += 1; counts.set(k, cur);
    }
    const topServices = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5);

    const attByDate = new Map((attRes.data || []).map((r) => [r.date, r]));
    // on-time %: check-ins this month against the shift that applied that day (days with no shift are left out)
    let sample = 0; let onTime = 0;
    for (const r of attRes.data || []) {
      if (r.date < monthStart || !r.check_in_time) continue;
      const h = effectiveHoursForDate(r.date, hours.weekly, hours.overrides);
      const verdict = h.isDayOff || h.source === 'none' ? null : isOnTime(r.check_in_time, h.startTime);
      if (verdict === null) continue;
      sample += 1; if (verdict) onTime += 1;
    }

    return {
      data: {
        month: {
          bookings: thisMonth.length,
          bookingsLastMonthSameDays: lastMonthSame.length,
          serviceRevenue,
          commissionEarned: canSeePay(role) && earnings.data ? earnings.data.total : null,
          onTimePct: sample ? Math.round((onTime / sample) * 100) : null,
          onTimeSample: sample,
        },
        todayBookings: all.filter((b) => b.date === todayStr).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
          .map((b) => ({ id: b.id, bookingNumber: b.booking_number, startTime: hm(b.start_time), endTime: hm(b.end_time), customerName: b.customer_name, serviceName: b.service_name_snapshot, status: b.status })),
        topServices,
        // Cumulative bookings per day (1..today) this month and last month, for the figure's sparkline.
        series: {
          thisMonth: runningTotal(thisMonth.map((b) => b.date), dayNo),
          lastMonth: runningTotal(lastMonthSame.map((b) => b.date), dayNo),
        },
        branchClosedToday: isClosedDate(closedRes.data, todayStr),
        nextWork: nextWorkingDay(todayStr, (d) => hoursFromShiftRow((shiftsRes.data || []).find((x) => x.therapist_id === therapistId && x.shift_date === d))),
        week: week.map((date) => {
          const h = hoursFromShiftRow((shiftsRes.data || []).find((r) => r.therapist_id === therapistId && r.shift_date === date));
          return { date, dbDow: dbDowOfDate(date), hours: h, attendanceStatus: attByDate.get(date)?.status || null, checkInTime: attByDate.get(date)?.check_in_time || null, checkOutTime: attByDate.get(date)?.check_out_time || null, changed: h.source === 'override' };
        }),
      },
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchTherapistOverview error:', error.message);
    return { data: null, error };
  }
}

/** Attendance strip for a month ('YYYY-MM'): one status per calendar day. */
export async function fetchTherapistAttendanceMonth({ therapistId, month }) {
  try {
    const { firstDay, lastDay, daysInMonth } = payrollMonthBounds(month);
    const [attRes, hours] = await Promise.all([
      supabase.from('therapist_attendance').select('date, status, check_in_time').eq('therapist_id', therapistId).gte('date', firstDay).lte('date', lastDay),
      fetchHoursInputs({ therapistId, from: firstDay, to: lastDay }),
    ]);
    if (attRes.error) throw attRes.error;
    const byDate = new Map((attRes.data || []).map((r) => [r.date, r]));
    const todayStr = nepalNow().today;
    const out = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const status = date > todayStr
        ? 'none'
        : classifyAttendanceDay({ attendance: byDate.get(date) || null, hours: effectiveHoursForDate(date, hours.weekly, hours.overrides) });
      out.push({ date, status });
    }
    return { data: out, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistAttendanceMonth error:', error.message);
    return { data: null, error };
  }
}

/**
 * Services tab: every active service grouped by category with this person's eligibility.
 * "Open to everyone" = no therapist AT THIS BRANCH has a service_therapists row for it (same rule as fetchServicesForTherapist);
 * those show ticked and can't be unticked here.
 */
export async function fetchTherapistServiceMatrix({ therapistId, branchId }) {
  try {
    const since = addDays(nepalNow().today, -90);
    const [svcRes, catRes, eligRes, bookRes] = await Promise.all([
      supabase.from('services').select('id, name, duration_minutes, price_npr, category, is_active').eq('is_active', true).order('name'),
      supabase.from('service_categories').select('id, name, display_order').eq('is_active', true).order('display_order').order('name'),
      supabase.from('service_therapists').select('service_id, therapist_id, therapists!inner(branch_id)').eq('therapists.branch_id', branchId),
      supabase.from('bookings').select('service_id').eq('therapist_id', therapistId).gte('date', since).not('status', 'in', '("Cancelled","No Show")'),
    ]);
    for (const r of [svcRes, catRes, eligRes, bookRes]) if (r.error) throw r.error;
    const restricted = new Set(); const mine = new Set();
    for (const r of eligRes.data || []) { restricted.add(r.service_id); if (r.therapist_id === therapistId) mine.add(r.service_id); }
    const booked = new Map();
    for (const r of bookRes.data || []) booked.set(r.service_id, (booked.get(r.service_id) || 0) + 1);

    const byCat = new Map();
    for (const s of svcRes.data || []) {
      const key = s.category || '';
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push({
        id: s.id, name: s.name, durationMinutes: s.duration_minutes, price: Number(s.price_npr),
        openToAll: !restricted.has(s.id), ticked: !restricted.has(s.id) || mine.has(s.id), bookings90d: booked.get(s.id) || 0,
      });
    }
    const order = new Map((catRes.data || []).map((c, i) => [c.name, { id: c.id, i }]));
    const categories = [...byCat.entries()]
      .map(([name, services]) => ({ id: order.get(name)?.id || (name ? `cat:${name}` : 'uncategorised'), name: name || 'Other', services, _o: order.get(name)?.i ?? 1e6 }))
      .sort((a, b) => a._o - b._o || a.name.localeCompare(b.name))
      .map(({ _o, ...c }) => c);
    return { data: { categories }, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistServiceMatrix error:', error.message);
    return { data: null, error };
  }
}

/**
 * Save the ticked services. Only services that are already restricted at this branch change (adds/removes this person's row);
 * open-to-everyone services are left alone. Removing the LAST eligible person from a service would silently open it to everyone,
 * so that removal is skipped and reported in `skipped`.
 */
export async function saveTherapistServices({ therapistId, serviceIds }) {
  try {
    const { data: me, error: meErr } = await supabase.from('therapists').select('branch_id').eq('id', therapistId).single();
    if (meErr) throw meErr;
    const { data: rows, error } = await supabase.from('service_therapists').select('service_id, therapist_id, therapists!inner(branch_id)').eq('therapists.branch_id', me.branch_id);
    if (error) throw error;
    const want = new Set(serviceIds);
    const eligibleBy = new Map();
    for (const r of rows || []) { if (!eligibleBy.has(r.service_id)) eligibleBy.set(r.service_id, new Set()); eligibleBy.get(r.service_id).add(r.therapist_id); }
    const added = []; const removed = []; const skipped = [];
    for (const [serviceId, who] of eligibleBy) {
      const has = who.has(therapistId);
      if (want.has(serviceId) && !has) added.push(serviceId);
      if (!want.has(serviceId) && has) { if (who.size === 1) skipped.push(serviceId); else removed.push(serviceId); }
    }
    if (added.length) {
      const { error: e } = await supabase.from('service_therapists').upsert(added.map((service_id) => ({ service_id, therapist_id: therapistId })), { onConflict: 'service_id,therapist_id' });
      if (e) throw e;
    }
    if (removed.length) {
      const { error: e } = await supabase.from('service_therapists').delete().eq('therapist_id', therapistId).in('service_id', removed);
      if (e) throw e;
    }
    return { data: { added, removed, skipped }, error: null };
  } catch (error) {
    console.error('[API] saveTherapistServices error:', error.message);
    return { data: null, error };
  }
}

/**
 * History feed. { items: [{ id, at, actorName, category, text }], since }.
 * `since` = when migration 314 was applied (history is recorded from then on; nothing is back-filled), or null.
 * Pay events never come back for staff / admin_viewer (checked here, in get_therapist_activity and in audit_logs RLS).
 */
/**
 * Every staff_transfers row for ONE person (read-only), as describeTransfer() inputs. The History feed RPC only carries a
 * few columns of each transfer, so the profile reads the rest (window, applied/reverted) here.
 */
export async function fetchTherapistTransfers({ therapistId }) {
  try {
    const { data, error } = await supabase
      .from('staff_transfers')
      .select(`id, from_branch_id, to_branch_id, effective_date, start_time, revert_at, applied, reverted, reverted_at, is_permanent, is_return_leg, note, transferred_at,
        fromBranch:branches!staff_transfers_from_branch_id_fkey(name), toBranch:branches!staff_transfers_to_branch_id_fkey(name)`)
      .eq('therapist_id', therapistId)
      .order('transferred_at', { ascending: false });
    if (error) throw error;
    return {
      data: (data || []).map((r) => ({
        id: r.id, fromBranchId: r.from_branch_id, toBranchId: r.to_branch_id, isReturnLeg: !!r.is_return_leg, note: r.note || null, transferredAt: r.transferred_at,
        input: toTransferInput({ ...r, fromBranch: r.fromBranch?.name || null, toBranch: r.toBranch?.name || null }),
      })),
      error: null,
    };
  } catch (error) {
    console.error('[API] fetchTherapistTransfers error:', error.message);
    return { data: null, error };
  }
}

/**
 * Give History's transfer rows their real wording: title = what happened and where, line 2 = the window (not the date it was
 * created), pill = state. Return legs (the automatic way back) are folded into the temporary transfer they close.
 * Transfer rows sort by window start, newest first, among the rest by time.
 */
export function enrichTransferItems(items = [], transfers = [], { labels = {}, use24h = false, now = new Date() } = {}) {
  const byId = new Map((transfers || []).map((t) => [t.id, t]));
  const out = [];
  for (const it of items) {
    const t = it.category === 'transfers' ? byId.get(it.id) : null;
    if (!t) { out.push(it); continue; }
    if (t.isReturnLeg) continue;
    const d = describeTransfer(t.input, { viewpoint: 'home', now, use24h, labels });
    out.push({
      ...it,
      text: transferTitle(t.input, { labels, now }),
      transfer: { state: d.state, pill: d.pill, windowLine: transferWindowLine(t.input, { use24h, now }), duration: transferDurationText(t.input), note: t.note },
      sortAt: t.input.startAt || it.at,
    });
  }
  return out.sort((a, b) => new Date(b.sortAt || b.at) - new Date(a.sortAt || a.at));
}

export async function fetchTherapistActivity({ therapistId, filter = 'all', limit = 50, role, labels, use24h }) {
  try {
    const f = filter === 'pay' && !canSeePay(role) ? 'none' : filter;
    const [feedRes, sinceRes] = await Promise.all([
      f === 'none' ? Promise.resolve({ data: [] }) : supabase.rpc('get_therapist_activity', { p_therapist_id: therapistId, p_filter: f, p_limit: limit }),
      supabase.rpc('therapist_history_since'),
    ]);
    if (feedRes.error) throw feedRes.error;
    const rows = (feedRes.data || []).filter((r) => canSeePay(role) || r.category !== 'pay');
    const items = buildActivityItems(rows, labels);
    const hasTransfers = items.some((i) => i.category === 'transfers');
    const tr = hasTransfers ? await fetchTherapistTransfers({ therapistId }) : { data: [] };
    return { data: { items: tr.data ? enrichTransferItems(items, tr.data, { labels, use24h }) : items, since: sinceRes.error ? null : (sinceRes.data || null) }, error: null };
  } catch (error) {
    console.error('[API] fetchTherapistActivity error:', error.message);
    return { data: null, error };
  }
}
