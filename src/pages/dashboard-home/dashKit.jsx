import React, { useEffect, useState } from 'react';
import Icon from '../../components/AppIcon';
import { fmtClock } from '../../lib/dashboardFloor';
import { npr } from '../../lib/dashboardMoney';
import { useIndustry } from '../../hooks/useIndustry';
import { fetchDashboardInsights, recordInsightFeedback, draftInsightMessages } from '../../services/api';
import { rankInsights, INSIGHT_VIEWS } from '../../lib/insightRank';
import { describeInsight } from '../../lib/insightText';
import InsightCard from './InsightCard';

// Small shared pieces of the dashboard views (cards, rows, tiles) and the copy helpers they use.

export { npr };
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
/** A booked share as a whole percent, never over 100 (booked minutes can pass available ones: breaks, leave, overbooking). */
export const sharePct = (s) => (s == null ? null : Math.min(100, Math.round(Number(s) * 100)));
export const shortDay = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const part = (o) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
};
export const clock12 = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return fmtClock(h * 60 + m); };

export const LoadError = ({ onRetry }) => (
  <p className="text-sm text-error flex items-center gap-2 flex-wrap">Couldn't load. <button type="button" onClick={onRetry} className="font-medium underline">Retry</button></p>
);

export const Card = ({ icon, title, count, meta, children, className = '', error = false, onRetry }) => (
  <section className={`bg-white rounded-lg border border-gray-200 ${className}`}>
    <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
      {icon && <Icon name={icon} size={16} className="text-gray-500" />}
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {!error && count > 0 && <span className="text-[11px] font-medium bg-error/10 text-error rounded-full px-1.5 min-w-[18px] text-center">{count}</span>}
      {!error && meta && <span className="ml-auto text-xs text-gray-500">{meta}</span>}
    </header>
    <div className="p-4">{error ? <LoadError onRetry={onRetry} /> : children}</div>
  </section>
);

const TILE = { 'text-error': 'bg-error/10', 'text-warning': 'bg-warning/10', 'text-primary': 'bg-primary/10', 'text-blue-600': 'bg-blue-50', 'text-success': 'bg-success/10' };

// A needs-action row (mockup `.na`): tinted icon tile, title (+ optional branch chip), one-line sub, buttons on the right.
export const Row = ({ tone = 'text-gray-500', icon, title, sub, actions, chip }) => (
  <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
    <span className={`w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 ${TILE[tone] || 'bg-gray-100'} ${TILE[tone] ? tone : 'text-gray-600'}`}><Icon name={icon} size={16} /></span>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-gray-900 truncate">{title}{chip && <span className="ml-1.5 align-middle text-[10.5px] font-semibold text-gray-600 bg-gray-100 rounded px-1.5 py-px">{chip}</span>}</div>
      {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
    </div>
    {actions && <div className="flex gap-1.5 flex-shrink-0">{actions}</div>}
  </div>
);

/** Small grey band that splits a card into sections (mockup `.grp`). */
export const GroupBand = ({ children }) => (
  <div className="-mx-4 px-4 py-1.5 text-[10.5px] uppercase tracking-wide text-gray-500 bg-background border-y border-gray-100 first:-mt-4 first:border-t-0">{children}</div>
);

/**
 * Suggestions ✦ (V36e): the ranked, capped Insights for one view. `view` is business | branch | frontdesk | myday.
 * `handlers` = { booking(id, branchId), create(day, branchId), branch(branchId) } opens the panel an item points at; an item whose action has no handler
 * here shows no button. ✦ appears only on suggestions.
 */
export const SuggestionsCard = ({ title = 'Suggestions', view = 'branch', branchIds = [], today = null, role = 'staff', handlers = {}, reloadKey = 0 }) => {
  const labels = useIndustry();
  const [items, setItems] = useState(null);
  const [gone, setGone] = useState({});     // rule|subject hidden this session (the server hides it on the next load)
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  const key = branchIds.join(',');
  const canDraft = role === 'manager' || role === 'admin';

  useEffect(() => {
    if (!key) { setItems([]); return undefined; }
    let alive = true;
    fetchDashboardInsights({ branchIds: key.split(','), date: today }).then(({ data, error }) => { if (alive) setItems(error ? [] : data); });
    return () => { alive = false; };
  }, [key, today, reloadKey]);

  const idOf = (i) => `${i.rule}|${i.subject}`;
  const shown = rankInsights((items || []).filter((i) => !gone[idOf(i)]), view);
  const total = (items || []).filter((i) => !gone[idOf(i)] && INSIGHT_VIEWS[view]?.rules.includes(i.rule)).length;

  const feedback = async (item, action) => {
    if (action === 'snooze' || action === 'dismiss') setGone((g) => ({ ...g, [idOf(item)]: true }));
    await recordInsightFeedback({ rule: item.rule, subject: item.subject, action });
  };
  const act = async (item) => {
    const a = item.action || {};
    if (a.kind === 'draft' && !canDraft && a.booking_id) handlers.booking?.(a.booking_id, item.branch_id); // staff cannot draft: open the booking
    else if (a.kind === 'draft') {
      setBusy(idOf(item));
      const { data, error } = await draftInsightMessages({ rule: a.draft_rule, customerIds: a.customer_ids || [] });
      setBusy(null);
      setNotes((n) => ({ ...n, [idOf(item)]: error ? "Couldn't create the drafts. Try again." : data === 0 ? 'Already drafted today. Find them in Outreach, Review queue.' : `${plural(data, 'draft')} ready in Outreach, Review queue. Nothing is sent until you approve.` }));
    } else if (a.kind === 'booking') handlers.booking?.(a.booking_id, item.branch_id);
    else if (a.kind === 'calendar') handlers.create?.(a.date, item.branch_id);
    else handlers.branch?.(item.branch_id);
  };
  const canAct = (item) => {
    const k = item.action?.kind;
    return k === 'draft' ? canDraft || (!!item.action.booking_id && !!handlers.booking) : k === 'booking' ? !!handlers.booking : k === 'calendar' ? !!handlers.create : !!handlers.branch;
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <span className="text-accent text-[15px] leading-none" aria-hidden="true">✦</span>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="text-[10.5px] font-semibold bg-accent/10 text-[#8a6a10] rounded-full px-2 py-px">Rule-based</span>
        {total > shown.length && <span className="ml-auto text-xs text-gray-500">{shown.length} of {total}</span>}
      </header>
      <div className="p-4">
        {shown.length === 0
          ? <p className="text-sm text-gray-400">Nothing to suggest yet.</p>
          : shown.map((item) => {
            const copy = describeInsight(item, { staff: labels.staffLabel, staffPlural: labels.staffLabelPlural });
            if (copy?.cta?.kind === 'draft' && !canDraft) copy.cta = { label: 'Open booking', kind: 'booking' }; // draft_insight_messages refuses staff
            return copy && (
              <InsightCard key={idOf(item)} item={item} copy={copy} onAct={act} onFeedback={feedback}
                busy={busy === idOf(item)} note={notes[idOf(item)]} canAct={canAct(item)} />
            );
          })}
      </div>
    </section>
  );
};

/** 'Thursday' for a YYYY-MM-DD Nepal day. */
export const weekdayName = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** Whole-percent change vs last same weekday, or null without a baseline. */
export const pctChange = (now, prev) => (now == null || prev == null || Number(prev) === 0 ? null : Math.round(((now - prev) / prev) * 100));

export const Tile = ({ label, value, sub, icon, onClick }) => (
  <button type="button" onClick={onClick} className="text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-primary/40 transition-colors">
    <div className="flex items-center justify-between text-xs text-gray-500"><span>{label}</span><Icon name={icon} size={14} /></div>
    <div className="text-2xl font-semibold text-gray-900 mt-1 break-words">{value}</div>
    <div className="text-xs text-gray-500 mt-0.5 break-words">{sub}</div>
  </button>
);

