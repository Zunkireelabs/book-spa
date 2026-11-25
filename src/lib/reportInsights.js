// ✦ suggestions under a report (ZNLY-159, rules v1). Pure, so it is unit-tested. Wording is always a suggestion ("may", "could"), never a fact,
// and every number in `why` is one the report already holds. Nothing is invented: a rule that lacks its data does not fire.
// Input is the get_report_business_health result (migration-371). Each item: { rule, score, headline, detail, why, source, view }.
// `view` is the report an "Open ..." button would go to; the UI hides the button when that report is not openable (still `soon`).

import { durationText } from 'utils/durationText';
import { wordBranch } from 'utils/industryTerms';
import { formatClockIsoNow } from '../utils/clockTime';

export const REPORT_INSIGHT_MAX = 3;

/** The previous period "has data" when it holds any bookings, sales or cash. Without it nothing can be compared. */
export const hasPreviousData = (data) => {
  const p = data?.previous;
  return !!p && (Number(p.made) > 0 || Number(p.sales) > 0 || Number(p.cash_in) > 0);
};

const pct = (share) => Math.round(Number(share) * 100);
const hrs = durationText;
const money = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const clock = (iso) => formatClockIsoNow(iso) || null;

const sourceLine = (what, periodLabel, data) => [what, periodLabel, clock(data?.computed_at) && `computed ${clock(data.computed_at)}`].filter(Boolean).join(' · ');

// (a) One branch far quieter than another: a busy gap of 15+ points with the quiet one under 50%.
function busyGap(data, { staffLabel, periodLabel }) {
  const rows = (data.branches || [])
    .map((b) => ({ name: b.name, share: b.current?.busy?.share, booked: b.current?.busy?.booked_min, working: b.current?.busy?.working_min }))
    .filter((r) => r.share != null && r.working > 0);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.share - b.share);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const gap = (high.share - low.share) * 100;
  if (gap < 15 || low.share >= 0.5) return null;
  return {
    rule: 'busy_gap',
    score: gap,
    headline: `${low.name} was busy ${pct(low.share)}% of its hours`,
    detail: ` vs ${high.name} ${pct(high.share)}%. Lending a ${staffLabel} on its quieter days could even it out.`,
    why: `${low.name}: ${hrs(low.booked)} booked of ${hrs(low.working)} working (${pct(low.share)}%). ${high.name}: ${hrs(high.booked)} of ${hrs(high.working)} (${pct(high.share)}%). Working hours = the dashboard "working" rule.`,
    source: sourceLine('From bookings + roster', periodLabel, data),
    view: 'utilization',
  };
}

// (b) Cancellations up 30% or more on the previous period, and at least 5 now.
function cancellations(data, { periodLabel }) {
  const now = data.current?.cancelled;
  const prev = data.previous?.cancelled;
  if (now == null || prev == null || prev < 1 || now < 5 || now < prev * 1.3) return null; // never "from 0"
  const rise = prev > 0 ? Math.round(((now - prev) / prev) * 100) : null;
  return {
    rule: 'cancellations',
    score: rise ?? 100,
    headline: `Cancellations rose to ${now}`,
    detail: ` from ${prev}. A reminder message the day before may help.`,
    why: `${now} bookings were cancelled this period vs ${prev} in the previous period${rise != null ? ` (up ${rise}%)` : ''}. Counted by booking date, Cancelled status.`,
    source: sourceLine('From bookings', periodLabel, data),
    view: 'no-shows',
  };
}

// (c) Average ticket moved 5% or more; names the service with the biggest share of service payments when the data has one.
function averageTicket(data, { periodLabel }) {
  const now = data.current?.avg_ticket;
  const prev = data.previous?.avg_ticket;
  if (now == null || prev == null || Number(prev) === 0) return null;
  const change = ((now - prev) / prev) * 100;
  if (Math.abs(change) < 5) return null;
  const up = change > 0;
  const top = data.current?.top_service;
  const topName = top?.name && top.name !== 'Other' ? top : null;
  return {
    rule: 'average_ticket',
    score: Math.abs(change),
    headline: `Average ticket ${up ? 'rose' : 'fell'} ${Math.abs(Math.round(change))}%`,
    detail: `${topName ? `, with ${topName.name} taking ${pct(topName.share)}% of service sales` : ''}. ${up
      ? `${topName ? `Featuring ${topName.name} on the booking page` : 'Keeping the same service mix'} may keep the trend.`
      : 'Looking at recent discounts and the service mix could show why.'}`,
    why: `Average ticket = service sales ÷ Completed bookings: NPR ${money(now)} now vs NPR ${money(prev)} in the previous period (${up ? '+' : '−'}${Math.abs(change).toFixed(1)}%).${topName ? ` ${topName.name} had ${pct(topName.share)}% of service payments.` : ''}`,
    source: sourceLine('From payments + bookings', periodLabel, data),
    view: 'service-revenue',
  };
}

const ORDER = ['busy_gap', 'cancellations', 'average_ticket'];

/** At most 3, best score first (ties: rule order), so the list never flickers. */
export function businessHealthInsights(data, { staffLabel = 'staff', periodLabel = '' } = {}) {
  if (!data || !data.current || !data.previous) return [];
  const opts = { staffLabel: String(staffLabel).toLowerCase(), periodLabel };
  const compare = hasPreviousData(data); // comparison rules need a previous period with data
  return [busyGap(data, opts), compare ? cancellations(data, opts) : null, compare ? averageTicket(data, opts) : null]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule))
    .slice(0, REPORT_INSIGHT_MAX);
}

// ── Therapist performance ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const BUSY_LOW = 0.4;

/**
 * Two rules over get_report_therapist_performance (migration-373), at most one item each:
 *  low_busy  therapists with working hours who were busy under 40% of them.
 *  no_show   the therapist whose no-show rate is at least 2x the team's with at least 2 no-shows.
 * Wording stays a suggestion; `why` lists the exact figures.
 */
export function therapistPerformanceInsights(data, { staffLabel = 'therapist', staffLabelPlural = 'therapists', periodLabel = '' } = {}) {
  const rows = data?.current?.therapists;
  const team = data?.current?.team;
  if (!rows?.length || !team) return [];
  const one = String(staffLabel).toLowerCase();
  const many = String(staffLabelPlural).toLowerCase();
  const source = sourceLine('From bookings, rosters and attendance', periodLabel, data);
  const out = [];

  const low = rows.filter((t) => Number(t.working_min) > 0 && t.busy != null && Number(t.busy) < BUSY_LOW).sort((a, b) => Number(a.busy) - Number(b.busy) || String(a.name).localeCompare(String(b.name)));
  if (low.length) {
    const branches = [...new Set(low.map((t) => t.branch_name))];
    out.push({
      rule: 'low_busy',
      score: low.length,
      headline: `${low.length} ${low.length === 1 ? one : many} ${low.length === 1 ? 'was' : 'were'} busy less than ${pct(BUSY_LOW)}% of their hours`,
      detail: ` (${low[0].name} ${pct(low[0].busy)}%${low.length > 1 ? ` + ${low.length - 1} more` : ''}${branches.length === 1 && low.length > 1 ? `, all ${branches[0]}` : ''}). Moving a shift to a busier day or ${wordBranch()}, or trimming it, may fit better.`,
      why: low.map((t) => `${t.name}: ${pct(t.busy)}% (${hrs(t.booked_min)} of ${hrs(t.working_min)})`).join('; ') + '.',
      source,
      view: 'utilization',
    });
  }

  const teamRate = Number(team.bookings) > 0 ? Number(team.no_show) / Number(team.bookings) : 0;
  const flagged = teamRate > 0
    ? rows.filter((t) => Number(t.no_show) >= 2 && Number(t.bookings) > 0 && Number(t.no_show) / Number(t.bookings) >= 2 * teamRate)
        .sort((a, b) => Number(b.no_show) / Number(b.bookings) - Number(a.no_show) / Number(a.bookings) || Number(b.no_show) - Number(a.no_show))
    : [];
  if (flagged.length) {
    const t = flagged[0];
    const rate = Number(t.no_show) / Number(t.bookings);
    const pct1 = (v) => (Math.round(v * 1000) / 10).toLocaleString('en-IN');
    out.push({
      rule: 'no_show',
      score: Number(t.no_show),
      headline: `${t.name}'s no-show rate is ${pct1(rate)}%`,
      detail: ` (${t.no_show} of ${t.bookings}), about ${Math.round((rate / teamRate) * 10) / 10}× the team's ${pct1(teamRate)}%. A day-before reminder for their bookings may help.`,
      why: `${flagged.map((x) => `${x.name}: ${x.no_show} of ${x.bookings} bookings (${pct1(Number(x.no_show) / Number(x.bookings))}%)`).join('; ')}. Team: ${team.no_show} of ${team.bookings} (${pct1(teamRate)}%). The rule needs at least 2 no-shows and twice the team rate.`,
      source,
      view: null,
    });
  }
  return out.slice(0, REPORT_INSIGHT_MAX); // fixed rule order: low_busy, then no_show
}

// ── Money owed ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // fixed names: some ICU builds print "Sept"
const day = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const addDaysISO = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Balances about to pass 30 days (they turn 31 days old within the next 14 days). One item, or []. `data` is get_report_money_owed (migration-372).
 * Wording is a suggestion; `why` lists the exact rows. `rows` is what a "Remind all N" button would remind.
 */
export function moneyOwedInsights(data, { periodLabel = 'As of now' } = {}) {
  const rows = (data?.rows || []).filter((r) => Number(r.age_days) >= 17 && Number(r.age_days) <= 30 && Number(r.balance) > 0);
  if (!rows.length || !data?.as_of) return [];
  const amount = rows.reduce((s, r) => s + Number(r.balance), 0);
  const ages = rows.map((r) => Number(r.age_days));
  const lo = Math.min(...ages);
  const hi = Math.max(...ages);
  const crossings = rows.map((r) => addDaysISO(r.date, 31)).sort();
  const first = crossings[0];
  const last = crossings[crossings.length - 1];
  const n = rows.length;
  return [{
    rule: 'passing_30',
    score: amount,
    headline: `${n} balance${n > 1 ? 's are' : ' is'} ${lo === hi ? `${lo}` : `${lo}–${hi}`} days old (NPR ${money(amount)})`,
    detail: `. ${n > 1 ? 'They pass' : 'It passes'} 30 days ${first === last ? `on ${day(first)}` : `between ${day(first)} and ${day(last)}`}; a reminder this week may bring ${n > 1 ? 'them' : 'it'} in.`,
    why: rows.map((r) => `${r.customer_name}${r.ref ? ` · ${r.ref}` : ''}: NPR ${money(r.balance)}, ${r.age_days} days old (booked ${day(r.date)})`).join('; ') + '.',
    source: ['From completed bookings and packages not fully paid', periodLabel, clock(data.computed_at) && `computed ${clock(data.computed_at)}`].filter(Boolean).join(' · '),
    view: null,
    remindRows: rows,
  }];
}

/** The short message copied for one balance. Industry-neutral: no "therapist", no "appointment". */
export function reminderText(row) {
  const who = row.customer_name ? `Hello ${row.customer_name}` : 'Hello';
  const ref = row.ref ? ` (${row.ref})` : '';
  return `${who}, a gentle reminder: NPR ${money(row.balance)} is still due for your visit on ${day(row.date)}${ref}. Please let us know when you can settle it. Thank you.`;
}

/** One block per balance, for "Remind all". */
export const reminderAllText = (rows) => rows.map(reminderText).join('\n\n');
