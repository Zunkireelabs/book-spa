import React from 'react';
import Icon from '../../components/AppIcon';
import { fmtClock } from '../../lib/dashboardFloor';

// Small shared pieces of the dashboard views (cards, rows, tiles) and the copy helpers they use.

export const npr = (n) => (n == null ? '—' : `NPR ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
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

export const Row = ({ tone = 'text-gray-500', icon, title, sub, actions }) => (
  <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
    <Icon name={icon} size={16} className={`${tone} flex-shrink-0`} />
    <div className="min-w-0 flex-1">
      <div className="text-sm text-gray-900 truncate">{title}</div>
      {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
    </div>
    <div className="flex gap-1.5 flex-shrink-0">{actions}</div>
  </div>
);

export const Tile = ({ label, value, sub, icon, onClick }) => (
  <button type="button" onClick={onClick} className="text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-primary/40 transition-colors">
    <div className="flex items-center justify-between text-xs text-gray-500"><span>{label}</span><Icon name={icon} size={14} /></div>
    <div className="text-2xl font-semibold text-gray-900 mt-1 truncate">{value}</div>
    <div className="text-xs text-gray-500 mt-0.5 truncate">{sub}</div>
  </button>
);

