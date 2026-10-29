import React from 'react';
import Icon from '../../components/AppIcon';
import { fmtClock } from '../../lib/dashboardFloor';
import { npr } from '../../lib/dashboardMoney';

// Small shared pieces of the dashboard views (cards, rows, tiles) and the copy helpers they use.

export { npr };
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
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

/** Suggestions placeholder (V36e fills it): the ✦ header with the Rule-based tag, as in the mockup. ✦ appears only on suggestions. */
export const SuggestionsCard = ({ title = 'Suggestions' }) => (
  <section className="bg-white rounded-lg border border-gray-200">
    <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
      <span className="text-accent text-[15px] leading-none" aria-hidden="true">✦</span>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <span className="text-[10.5px] font-semibold bg-accent/10 text-[#8a6a10] rounded-full px-2 py-px">Rule-based</span>
    </header>
    <div className="p-4"><p className="text-sm text-gray-400">Nothing to suggest yet.</p></div>
  </section>
);

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

