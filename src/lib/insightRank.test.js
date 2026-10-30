import { describe, it, expect } from 'vitest';
import { rankInsights, INSIGHT_VIEWS } from './insightRank';

const mk = (rule, subject, score) => ({ rule, subject, score });

describe('rankInsights', () => {
  it('orders by score, best first', () => {
    const out = rankInsights([mk('quiet_days', 'a', 43), mk('no_show_risk', 'b', 70), mk('rebook_due', 'c', 60)], 'branch');
    expect(out.map((i) => i.subject)).toEqual(['b', 'c', 'a']);
  });

  it('shows at most 3 per view', () => {
    const items = [mk('rebook_due', 'a', 90), mk('no_show_risk', 'b', 80), mk('membership_expiring', 'c', 70), mk('quiet_days', 'd', 60)];
    expect(rankInsights(items, 'branch')).toHaveLength(3);
    expect(rankInsights(items, 'branch').map((i) => i.subject)).toEqual(['a', 'b', 'c']);
  });

  it('never shows more than 2 of one rule, so one rule cannot fill the card', () => {
    const items = [mk('no_show_risk', 'a', 90), mk('no_show_risk', 'b', 89), mk('no_show_risk', 'c', 88), mk('rebook_due', 'd', 50)];
    expect(rankInsights(items, 'branch').map((i) => i.subject)).toEqual(['a', 'b', 'd']);
  });

  it('only shows the rules a view may show', () => {
    const items = [mk('addon_habit', 'a', 99), mk('discount_anomaly', 'b', 98), mk('no_show_risk', 'c', 10)];
    expect(rankInsights(items, 'branch').map((i) => i.subject)).toEqual(['c']);
    expect(rankInsights(items, 'business').map((i) => i.subject)).toEqual(['b', 'c']);
    expect(rankInsights(items, 'myday').map((i) => i.subject)).toEqual(['a']);
    expect(rankInsights(items, 'frontdesk').map((i) => i.subject)).toEqual(['c']);
  });

  it('Business ranks the admin rules first, whatever the branch-level scores', () => {
    const items = [mk('rebook_due', 'a', 90), mk('no_show_risk', 'b', 80), mk('no_show_risk', 'c', 75), mk('lend_therapist', 'd', 30), mk('discount_anomaly', 'e', 20)];
    expect(rankInsights(items, 'business').map((i) => i.subject)).toEqual(['d', 'e', 'a']);
    expect(rankInsights(items, 'branch').map((i) => i.subject)).toEqual(['a', 'b', 'c']);
  });

  it('Front desk has a single slot', () => {
    expect(INSIGHT_VIEWS.frontdesk.max).toBe(1);
    expect(rankInsights([mk('no_show_risk', 'a', 70), mk('no_show_risk', 'b', 65)], 'frontdesk')).toHaveLength(1);
  });

  it('breaks ties by rule order then subject, so the list does not flicker between refreshes', () => {
    const a = [mk('quiet_days', 'z', 50), mk('rebook_due', 'y', 50), mk('rebook_due', 'x', 50)];
    const b = [...a].reverse();
    expect(rankInsights(a, 'branch').map((i) => i.subject)).toEqual(['x', 'y', 'z']);
    expect(rankInsights(b, 'branch').map((i) => i.subject)).toEqual(['x', 'y', 'z']);
  });

  it('returns nothing for empty, malformed or unknown input', () => {
    expect(rankInsights([], 'branch')).toEqual([]);
    expect(rankInsights(null, 'branch')).toEqual([]);
    expect(rankInsights([mk('rebook_due', 'a', 5)], 'nowhere')).toEqual([]);
    expect(rankInsights([null, { rule: 'rebook_due' }, mk('mystery', 'q', 99)], 'branch')).toEqual([]);
  });

  it('does not change its input', () => {
    const items = [mk('quiet_days', 'a', 1), mk('rebook_due', 'b', 2)];
    const copy = JSON.parse(JSON.stringify(items));
    rankInsights(items, 'branch');
    expect(items).toEqual(copy);
  });
});
