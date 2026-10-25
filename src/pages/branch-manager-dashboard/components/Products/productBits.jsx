import React from 'react';
import Icon from '../../../../components/AppIcon';
import { meterShare } from '../../../../services/productsView';

// Product-only bits (V25), next to the shared list kit in Area/listKit.

const TINTS = [
  ['#F3EFE3', '#8A7A4E'], ['#E8F0E5', '#3E7A35'], ['#FCE9F1', '#BE185D'], ['#E7EEFB', '#2F5AA8'], ['#F4ECE4', '#8B5E34'], ['#ECEAF8', '#5B52C9'],
];
const tintOf = (name) => TINTS[[...String(name || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

/** The product photo, or a tinted tile with a package icon. */
export const ProductThumb = ({ product, size = 36 }) => {
  if (product.imageUrl) {
    return <img src={product.imageUrl} alt="" className="rounded-lg object-cover flex-shrink-0 border border-border" style={{ width: size, height: size }} />;
  }
  const [bg, fg] = tintOf(product.name);
  return (
    <span className="rounded-lg grid place-items-center flex-shrink-0" style={{ width: size, height: size, background: bg, color: fg }} aria-hidden="true">
      <Icon name="Package" size={Math.round(size * 0.45)} />
    </span>
  );
};

/** Small uppercase tag after a name: "2 SIZES", "PRO USE", "OFF SALE". */
export const Tag = ({ children, className = '' }) => (
  <span className={`h-[18px] rounded-[5px] px-1.5 text-[10.5px] font-semibold tracking-[.02em] inline-flex items-center whitespace-nowrap flex-shrink-0 bg-[#F1F1EF] text-[#515152] ${className}`}>{children}</span>
);

/** Stock meter: green when fine, amber at or below the low level, a full red bar when out. `width` px. */
export const StockMeter = ({ qty, low, status, width = 150 }) => {
  const out = status === 'out';
  const share = out ? 1 : meterShare(qty, low);
  const color = out ? '#DC2626' : status === 'low' ? '#E7B93E' : '#6E9A66';
  return (
    <div className="h-[5px] rounded-full bg-[#E4E4E1] overflow-hidden" style={{ width }} aria-hidden="true">
      {share > 0 && <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 4)}%`, background: color }} />}
    </div>
  );
};

/** "Here" marker used beside the current branch. */
export const HereTag = () => <span className="text-[10.5px] font-semibold tracking-[.04em] text-primary uppercase ml-1.5">here</span>;

export const SECTION = 'text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2';
export const ghostBtn = 'h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 text-text-primary hover:bg-[#FAFAF9] disabled:opacity-50';
export const primaryBtn = 'h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95 disabled:opacity-50';
export const chipCls = (on) => `h-9 px-3 rounded-lg border text-[13px] font-medium tabular-nums whitespace-nowrap ${on ? 'border-primary bg-[#EEF3EC] text-primary shadow-[0_0_0_2px_rgba(45,90,39,.10)]' : 'border-border bg-white text-text-primary hover:bg-[#FAFAF9]'}`;

/** Two-segment control used by the action panels (Take some out | Set the real count). */
export const Seg = ({ value, onChange, options, label }) => (
  <div className="grid gap-0.5 p-0.5 bg-background border border-border rounded-lg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="group" aria-label={label}>
    {options.map(([v, l]) => (
      <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
        className={`h-9 rounded-md text-[13px] font-medium transition-colors ${value === v ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(14,13,12,.08)] border border-border' : 'text-[#515152] hover:text-text-primary'}`}>{l}</button>
    ))}
  </div>
);

/** "Lazimpat 4 → 28" summary box (before → after). */
export const BeforeAfter = ({ label, before, after, right, tone = 'ok' }) => (
  <div className="flex items-center justify-between gap-3 border border-border rounded-spa px-3.5 py-3 tabular-nums" data-before-after>
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[12.5px] text-[#8A8A90] truncate">{label}</span>
      <b className="text-[18px] font-semibold text-text-primary">{before}</b>
      <Icon name="ArrowRight" size={13} className="text-[#8A8A90] self-center" />
      <b className={`text-[18px] font-semibold ${tone === 'bad' ? 'text-error' : 'text-primary'}`}>{after}</b>
    </div>
    {right && <span className="text-[13px] text-[#515152] whitespace-nowrap">{right}</span>}
  </div>
);
