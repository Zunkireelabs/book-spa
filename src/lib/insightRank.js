// Which Insights show where, and in what order. The server (get_dashboard_insights, migration-370) already scores each item;
// this decides what a view may show and caps it. Pure, so it is unit-tested.

export const INSIGHT_RULE_ORDER = [
  'no_show_risk', 'membership_expiring', 'rebook_due', 'lend_therapist', 'discount_anomaly', 'quiet_days', 'addon_habit',
];

// Rules each dashboard view may show, and how many suggestions fit its slot.
export const INSIGHT_VIEWS = {
  // `first`: org-wide rules that outrank the branch-level ones here, whatever their score
  business: { rules: ['rebook_due', 'no_show_risk', 'membership_expiring', 'quiet_days', 'discount_anomaly', 'lend_therapist'], first: ['lend_therapist', 'discount_anomaly'], max: 3 },
  branch: { rules: ['rebook_due', 'no_show_risk', 'membership_expiring', 'quiet_days'], max: 3 },
  frontdesk: { rules: ['no_show_risk'], max: 1 },
  myday: { rules: ['addon_habit'], max: 3 },
};

const MAX_PER_RULE = 2;

/**
 * The items one view shows: only its rules, admin rules first where a view lists them, then best score first (ties: rule order, then subject, so the list never flickers),
 * at most `max` in total and at most 2 of one rule so a single rule cannot fill the card.
 */
export function rankInsights(items, view, { max, perRule = MAX_PER_RULE } = {}) {
  const cfg = INSIGHT_VIEWS[view];
  if (!cfg || !Array.isArray(items)) return [];
  const limit = max ?? cfg.max;
  const order = (r) => { const i = INSIGHT_RULE_ORDER.indexOf(r); return i < 0 ? INSIGHT_RULE_ORDER.length : i; };
  const tier = (r) => (cfg.first?.includes(r) ? 0 : 1);
  const ranked = items
    .filter((i) => i && cfg.rules.includes(i.rule) && i.subject)
    .sort((a, b) => tier(a.rule) - tier(b.rule) || (Number(b.score) || 0) - (Number(a.score) || 0) || order(a.rule) - order(b.rule) || String(a.subject).localeCompare(String(b.subject)));
  const taken = {};
  const out = [];
  for (const it of ranked) {
    if (out.length >= limit) break;
    if ((taken[it.rule] || 0) >= perRule) continue;
    taken[it.rule] = (taken[it.rule] || 0) + 1;
    out.push(it);
  }
  return out;
}
