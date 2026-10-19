import React from 'react';
import { discountChips } from '../../../../services/membershipsView';

// Membership-only bits (V21), next to the shared list kit in Area/listKit.

/** Tier pill: gold for the tier members pay most for, neutral for the rest. */
export const TierPill = ({ name, gold = false }) => (
  <span className={`h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap max-w-full ${gold ? 'bg-[#FBF3DF] text-[#9A6B0B]' : 'bg-[#F3F4F6] text-[#4B5563]'}`}>
    <i className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: gold ? '#E7B93E' : '#9CA3AF' }} /><span className="truncate">{name || '—'}</span>
  </span>
);

/** "Spa 45%" chips, largest first. `size="sm"` for table rows. */
export const DiscountChips = ({ rules, size = 'md' }) => {
  const chips = discountChips(rules);
  if (!chips.length) return null;
  const sm = size === 'sm';
  return (
    <div className={`flex flex-wrap ${sm ? 'gap-1' : 'gap-1.5'}`} data-discounts>
      {chips.map((c) => (
        <span key={c.key} className={`rounded-md border border-border bg-white inline-flex items-center gap-1 whitespace-nowrap ${sm ? 'h-[22px] px-1.5 text-[11.5px]' : 'h-7 px-2 text-[12.5px]'}`}>
          <span className="text-[#515152]">{c.label}</span><b className="font-semibold text-text-primary tabular-nums">{c.pct}%</b>
        </span>
      ))}
    </div>
  );
};
