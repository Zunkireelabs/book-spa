import React from 'react';
import { formatClockTime } from '../../pages/branch-manager-dashboard/components/calendar/timeFormat';
import { useUse24h } from '../../hooks/useUse24h';

// ZNLY-402 piece 4 (v3): the Discount tab of a booking with several services. Every service is a line (time order, same as Details) with
// its price and a live preview: "Discount - NPR x" and "New price", then the booking's new total. Whole rupees only.
// "Set a different discount per service" turns each line into its own field (same % / NPR choice as the whole-booking one).
const npr = (n) => `NPR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// A line planned at 0 while another line has a discount, and that already carries one: Apply CLEARS it (ZNLY-402 A2), the preview says so.
const planOn = (plan) => (plan?.total || 0) > 0;
const BookingDiscountLines = ({ rows, plan, perService, onTogglePer, type, values, onChange, use24h: use24hProp, canEdit, existingTotal, onRemove, removing }) => {
  const [use24hPref] = useUse24h();
  const use24h = use24hProp ?? use24hPref;
  const cleared = (r, l) => planOn(plan) && l.amount === 0 && r.discount > 0;
  const byId = Object.fromEntries((plan?.lines || []).map((l) => [l.id, l]));
  const newTotal = rows.reduce((s, r) => {
    const l = byId[r.id];
    return s + (l && l.amount > 0 ? l.base - l.amount : l && cleared(r, l) ? r.base : r.final);
  }, 0);
  return (
    <div className="space-y-3" data-discount-lines>
      <div className="rounded-spa-lg border border-border bg-surface divide-y divide-border">
        {rows.map((r) => {
          const l = byId[r.id];
          const editable = canEdit && !!l; // paid services are not in the plan: they cannot be discounted
          const clearing = !!l && cleared(r, l);
          const preview = (l && l.amount > 0) || clearing;
          const disc = clearing ? 0 : preview ? l.amount : r.discount;
          const showDisc = disc > 0 || clearing;
          return (
            <div key={r.id} className="px-3 py-2.5" data-discount-line={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">{r.name}</p>
                  <p className="text-[12px] text-text-secondary">{[r.start ? formatClockTime(r.start, use24h) : '', r.minutes ? `${r.minutes} min` : ''].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="text-[13px] tabular-nums text-text-primary flex-shrink-0">{npr(r.base)}</span>
              </div>
              {perService && editable && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number" min="0" inputMode="numeric"
                    value={values[r.id] ?? ''}
                    onWheel={(e) => e.target.blur()}
                    onChange={(e) => onChange(r.id, e.target.value)}
                    placeholder={type === 'percentage' ? '0' : '0'}
                    aria-label={`Discount for ${r.name}`}
                    className="w-24 px-2.5 py-1.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                  <span className="text-[12px] text-text-secondary">{type === 'percentage' ? '%' : 'NPR'}</span>
                </div>
              )}
              {!l && r.paymentStatus === 'paid' && <p className="mt-1 text-[12px] text-text-secondary">Paid, so its price cannot change.</p>}
              {showDisc && (
                <div className="mt-1.5 space-y-0.5 text-[12px]">
                  <div className="flex justify-between"><span className="text-text-secondary">{clearing ? 'Discount removed' : 'Discount'}</span><span className={`tabular-nums ${preview ? 'text-warning' : 'text-error'}`}>{clearing ? `was − ${npr(r.discount)}` : `− ${npr(disc)}`}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">New price</span><span className={`tabular-nums ${preview ? 'text-warning' : 'text-text-primary'}`}>{npr(preview ? l.base - l.amount : r.final)}</span></div>
                </div>
              )}
            </div>
          );
        })}
        <div className="px-3 py-2.5 flex justify-between items-center">
          <span className="text-[13px] font-semibold text-text-primary">Total for the booking</span>
          <span className="text-[13px] font-semibold tabular-nums text-text-primary" data-discount-total>{npr(newTotal)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {canEdit && <button type="button" onClick={onTogglePer} className="text-[13px] text-primary hover:underline">{perService ? 'Use one discount for the whole booking' : 'Set a different discount per service'}</button>}
        {existingTotal > 0 && canEdit && <button type="button" onClick={onRemove} disabled={removing} className="text-[13px] text-error hover:underline disabled:opacity-40">Remove the discount</button>}
      </div>
    </div>
  );
};

export default BookingDiscountLines;
