// Words for the Insights ✦ (get_dashboard_insights, migration-336). The server returns numbers only; the sentence is built here so
// industry words come from useIndustry (`labels.staff` / `labels.staffPlural`), never from SQL. Pure.
import { npr } from './dashboardMoney';

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const pct = (share) => `${Math.min(100, Math.round(Number(share) * 100))}%`;  // booked minutes can pass available ones (breaks, leave, overbooking): never show over 100%
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
const hm = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const span = (vals, unit) => { const lo = Math.min(...vals), hi = Math.max(...vals); return lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`; };
const nameList = (list) => (list || []).map((c) => c.name).filter(Boolean).join(', ');
const joinNames = (list) => {
  const names = (list || []).map((c) => c.name).filter(Boolean);
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
};

/**
 * One insight as UI copy. `lead` is [{ t, b }] segments (b = the bold key fact); `evidence` is [[label, value]] for "Why?";
 * `cta` is { label, kind } where kind is the action to run. `labels` = { staff, staffPlural } from useIndustry (any case).
 */
export function describeInsight(item, labels = {}) {
  const f = item.facts || {};
  const staff = String(labels.staff || 'team member').toLowerCase();
  const staffPlural = String(labels.staffPlural || 'team members').toLowerCase();
  const a = item.action || {};
  switch (item.rule) {
    case 'rebook_due': {
      const n = f.count;
      return {
        lead: [{ t: `${plural(n, 'customer')} ${n === 1 ? 'is' : 'are'} past their usual visit gap.`, b: true },
          { t: f.gap_fill ? ` ${f.branch_name} is only ${pct(f.today_booked_share)} booked today, so there is room to fill.` : ` Nudge ${joinNames(f.customers)}${n > 2 ? '' : ' to rebook'}.` }],
        evidence: [
          [plural(n, 'customer'), (f.customers || []).length ? `${nameList(f.customers)}: last visit ${span(f.customers.map((c) => Number(c.days_since)), 'days')} ago, usual gap ${span(f.customers.map((c) => Number(c.usual_gap_days)), 'days')}` : 'past their usual gap'],
          ...(f.today_booked_share != null ? [[`${f.branch_name} booked today`, pct(f.today_booked_share)]] : []),
        ],
        cta: { label: n === 1 ? 'Draft 1 message' : `Draft ${Math.min(n, (a.customer_ids || []).length || n)} messages`, kind: 'draft' },
      };
    }
    case 'no_show_risk':
      if (f.kind === 'followup') {
        return {
          lead: [{ t: `${f.customer?.name} was a no-show today.`, b: true },
            { t: ` They have come ${f.visits} times before${f.no_shows > 1 ? ` and have now missed ${f.no_shows}` : '; this is the first miss'}. Send a friendly rebook link instead of a fee?` }],
          evidence: [['Earlier completed visits', String(f.visits)], ['No-shows so far', String(f.no_shows)]],
          cta: { label: 'Draft message', kind: 'draft' },
        };
      }
      return {
        lead: [{ t: `${f.customer?.name} may not show up ${f.date === item.as_of?.slice(0, 10) ? 'today' : 'tomorrow'} at ${hm(f.start_time)}.`, b: true },
          { t: ` ${f.no_shows} of ${f.bookings_before} earlier bookings were no-shows. Worth a confirmation call.` }],
        evidence: [['Earlier bookings', String(f.bookings_before)], ['No-shows', String(f.no_shows)], ['Rate', pct(f.no_shows / f.bookings_before)]],
        cta: { label: 'Open booking', kind: 'booking' },
      };
    case 'membership_expiring':
      return {
        lead: [{ t: `${plural(f.count, 'membership')} ${f.count === 1 ? 'expires' : 'expire'} this week`, b: true },
          { t: ` with ${npr(f.unused)} unused. Remind them while they still have time to come in.` }],
        evidence: [['Expiring within 7 days', `${nameList(f.customers) || f.count}, first on ${day(f.first_expiry)}`],
          ['Unused value', `${npr(f.unused)} in total${(f.customers || []).length ? ` (largest ${npr(Math.max(...f.customers.map((c) => Number(c.balance))))})` : ''}`]],
        cta: { label: 'Draft reminders', kind: 'draft' },
      };
    case 'quiet_days': {
      const days = f.days || [];
      const names = days.slice(0, 3).map((d) => weekday(d.date).slice(0, 3)).join(', ');
      return {
        lead: [{ t: `${plural(days.length, 'quiet day')} ahead: ${names}${days.length > 3 ? '…' : ''}.`, b: true },
          { t: ` ${f.branch_name} is under ${pct(f.threshold)} booked. A good moment for a weekday offer.` }],
        evidence: days.map((d) => [day(d.date), `${pct(d.booked_share)} of ${staffPlural} hours booked`]),
        cta: { label: 'Book a slot', kind: 'calendar' },
      };
    }
    case 'discount_anomaly':
      return {
        lead: [{ t: `${f.user_name} gave a discount on ${f.discounted} of ${f.bookings} completed bookings in the last ${f.window_days} days.`, b: true },
          { t: ` The rest of the team: ${f.others_discounted} of ${f.others_bookings} (${f.others_rate_pct}%). Worth a look at why.` }],
        evidence: [['Completed bookings', String(f.bookings)], ['With a discount', `${f.discounted} (${f.rate_pct}%)`], ['Everyone else', `${f.others_discounted} of ${f.others_bookings} (${f.others_rate_pct}%)`], ['Total discount given', npr(f.discount_total)]],
        cta: { label: 'Review discounts', kind: 'branch' },
      };
    case 'lend_therapist':
      return {
        lead: [{ t: Number(f.busy_share) >= 1 ? `${f.busy_branch} is fully booked on ${weekday(f.date)}` : `${f.busy_branch} is ${pct(f.busy_share)} booked on ${weekday(f.date)}`, b: true },
          { t: ` while ${f.idle_branch} is ${pct(f.idle_share)}. Lend a ${staff} across?` }],
        evidence: [[`${f.busy_branch} booked`, Number(f.busy_share) >= 1 ? 'fully' : pct(f.busy_share)], [`${f.idle_branch} booked`, pct(f.idle_share)], [`${f.idle_branch} ${staffPlural} working`, String(f.idle_working)], ['Day', day(f.date)]],
        cta: { label: `Open ${f.busy_branch}`, kind: 'branch' },
      };
    case 'addon_habit':
      return {
        lead: [{ t: `${f.customer?.name} usually adds ${f.addon_name}`, b: true },
          { t: ` (${f.times} of ${f.visits} visits). Offer it at ${hm(f.start_time)} today.` }],
        evidence: [['Earlier visits', String(f.visits)], [`With ${f.addon_name}`, `${f.times} of ${f.visits}`]],
        cta: { label: 'Open booking', kind: 'booking' },
      };
    default:
      return null;
  }
}

export const sourceLine = (item) => {
  const t = item.as_of ? new Date(item.as_of).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' }) : '';
  return `Source: rule · ${item.rule} v${item.version} · data as of ${t}`;
};
