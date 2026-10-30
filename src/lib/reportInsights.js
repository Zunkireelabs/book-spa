// ✦ suggestions under a report (ZNLY-159, rules v1). Pure, so it is unit-tested. Wording is always a suggestion ("may", "could"), never a fact,
// and every number in `why` is one the report already holds. Nothing is invented: a rule that lacks its data does not fire.
// Input is the get_report_business_health result (migration-337). Each item: { rule, score, headline, detail, why, source, view }.
// `view` is the report an "Open ..." button would go to; the UI hides the button when that report is not openable (still `soon`).

export const REPORT_INSIGHT_MAX = 3;

/** The previous period "has data" when it holds any bookings, sales or cash. Without it nothing can be compared. */
export const hasPreviousData = (data) => {
  const p = data?.previous;
  return !!p && (Number(p.made) > 0 || Number(p.sales) > 0 || Number(p.cash_in) > 0);
};

const pct = (share) => Math.round(Number(share) * 100);
const hrs = (min) => Math.round(Number(min) / 60).toLocaleString('en-IN');
const money = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const clock = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null; };

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
    why: `${low.name}: ${hrs(low.booked)} booked hours of ${hrs(low.working)} working hours (${pct(low.share)}%). ${high.name}: ${hrs(high.booked)} of ${hrs(high.working)} (${pct(high.share)}%). Working hours = the dashboard "working" rule.`,
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
