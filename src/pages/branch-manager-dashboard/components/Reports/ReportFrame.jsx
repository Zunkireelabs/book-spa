import React, { useState } from 'react';
import Icon from 'components/AppIcon';
import CustomSelect from 'components/ui/CustomSelect';
import { REPORT_PERIODS, getReportRange } from 'utils/reportPeriod';


// The shared frame every report uses (ZNLY-159, approved mockup scene B): breadcrumb, title, subtitle, period picker with "vs previous N",
// Favourite, Export (CSV of the visible table + Print), headline tiles with the previous value and ▲/▼, a tabs slot, the ✦ insights and a
// collapsed "How we count". The ✦ list (InsightList) is exported here and each report places it where its layout wants it. The branch filter is the header branch switcher, so there is no second branch picker here.

const TONE = {
  good: 'bg-primary/10 text-primary',
  bad: 'bg-error/10 text-error',
  flat: 'bg-black/[0.05] text-text-secondary',
};

export const DeltaChip = ({ delta }) => (delta
  ? <span className={`inline-block rounded-full px-1.5 text-[11.5px] font-semibold ${TONE[delta.tone]}`}>{delta.text}</span>
  : null);

// tile: { key, label, value, prevText, delta, lead }. `prevText` is the previous value already formatted ("vs 4,30,600").
export const Tile = ({ tile }) => (
  <div className={`bg-surface rounded-spa-lg border px-3.5 py-3 ${tile.lead ? 'border-primary shadow-[inset_0_0_0_1px_#2D5A27]' : 'border-border'}`}>
    <div className="text-[11.5px] font-medium text-text-tertiary">{tile.label}</div>
    <div className={`font-data tabular-nums text-[19px] font-semibold tracking-tight text-text-primary mt-1 mb-0.5`}>{tile.value}</div>
    <div className="text-[11.5px] text-text-tertiary flex flex-wrap items-center gap-x-1.5 min-h-[18px]">
      {tile.delta ? <DeltaChip delta={tile.delta} /> : null}
      {tile.prevText ? <span>{tile.prevText}</span> : null}
    </div>
  </div>
);

// One control reading "Last 30 days · vs previous 30" (the mockup's pick). Custom range adds two date inputs beside it.
export const PeriodPicker = ({ periodId, range, onPeriod, onCustom }) => {
  const options = REPORT_PERIODS.map((p) => ({
    value: p.id,
    label: p.id === 'custom' ? `Custom range${periodId === 'custom' ? ` · ${range.vsLabel}` : ''}` : `${p.label} · ${getReportRange(p.id).vsLabel}`,
  }));
  const dateCls = 'h-9 px-2 rounded-spa border border-border bg-surface text-xs text-text-primary';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-[250px]"><CustomSelect size="sm" value={periodId} onChange={onPeriod} options={options} /></div>
      {periodId === 'custom' && (
        <>
          <input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => e.target.value && onCustom({ from: e.target.value, to: range.to })} className={dateCls} />
          <span className="text-xs text-text-tertiary">to</span>
          <input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => e.target.value && onCustom({ from: range.from, to: e.target.value })} className={dateCls} />
        </>
      )}
    </div>
  );
};

export const InsightList = ({ insights, canOpen, onOpen }) => {
  const [open, setOpen] = useState(null);
  if (!insights?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-spa-lg">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <b className="text-sm font-semibold text-text-primary">✦ Worth a look</b>
        <span className="ml-auto text-xs text-text-tertiary">{insights.length} suggestion{insights.length > 1 ? 's' : ''} · ranked</span>
      </div>
      {insights.map((i) => (
        <div key={i.rule} className="border-b border-border last:border-b-0">
          <div className="px-4 py-3 flex flex-col sm:flex-row gap-2 sm:gap-3 text-[13px] leading-relaxed">
            <span className="text-accent flex-shrink-0">✦</span>
            <div className="flex-1 min-w-0 text-text-secondary">
              <b className="text-text-primary font-semibold">{i.headline}</b>{i.detail}{' '}
              <span className="text-[10.5px] bg-accent/10 text-[#8a6a10] rounded-full px-1.5 font-semibold">Suggestion</span>
            </div>
            <div className="flex gap-1.5 items-start flex-shrink-0 print:hidden">
              <button type="button" onClick={() => setOpen(open === i.rule ? null : i.rule)} aria-expanded={open === i.rule} className="h-7 px-2.5 rounded-spa border border-border text-xs font-medium hover:bg-black/[0.03]">Why?</button>
              {i.view && canOpen(i.view) && (
                <button type="button" onClick={() => onOpen(i.view)} className="h-7 px-2.5 rounded-spa border border-border text-xs font-medium hover:bg-black/[0.03]">Open report</button>
              )}
            </div>
          </div>
          {open === i.rule && (
            <div className="mx-4 mb-3 rounded-spa border border-border bg-background px-3 py-2 text-xs text-text-secondary leading-relaxed">
              {i.why}
              <div className="text-[11px] text-text-tertiary mt-1">{i.source}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const HowWeCount = ({ items }) => {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-spa-lg">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} className="text-text-tertiary" />
        <b className="text-sm font-semibold text-text-primary">How we count</b>
      </button>
      {open && (
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 px-4 pb-4 text-xs text-text-secondary leading-relaxed">
          {items.map((d) => <div key={d.term}><b className="text-text-primary font-semibold">{d.term}</b>: {d.text}</div>)}
        </div>
      )}
    </div>
  );
};

const ReportFrame = ({
  groupLabel, title, subtitle, titleExtra = null, reopen = null, onBack, onHome,
  range, periodId, onPeriod, onCustom, previousNote = null, tiles = [], tabs = [], activeTab, onTab,
  definitions = [], onExport, isFavourite, onToggleFav, children,
}) => (
  <div className="content-scroll flex-1 min-h-0 overflow-y-auto">
    <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-10 flex flex-col gap-4 max-w-[1400px]">
      <button type="button" onClick={onBack} className="lg:hidden inline-flex items-center gap-1 text-[13px] text-text-secondary self-start print:hidden">
        <Icon name="ChevronLeft" size={14} /> Reports
      </button>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            {reopen}
            <button type="button" onClick={onHome} className="hover:text-text-primary print:no-underline">Reports</button>
            <span>›</span><span>{groupLabel}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="font-heading font-heading-semibold text-xl text-text-primary">{title}</h1>
            {titleExtra}
          </div>
          <p className="text-[13px] text-text-secondary mt-0.5">{subtitle}</p>
          {range && <p className="hidden print:block text-xs text-text-tertiary mt-1">{range.from} to {range.to} ({range.label}, {range.vsLabel})</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
          {range && <PeriodPicker periodId={periodId} range={range} onPeriod={onPeriod} onCustom={onCustom} />}
          {onToggleFav && (
            <button type="button" onClick={onToggleFav} aria-pressed={isFavourite} className="h-9 px-3 rounded-spa border border-border bg-surface text-xs font-medium inline-flex items-center gap-1.5 hover:bg-black/[0.03]">
              <Icon name="Star" size={14} fill={isFavourite ? 'currentColor' : 'none'} className={isFavourite ? 'text-warning' : ''} /> Favourite
            </button>
          )}
          {onExport && (
            <>
              <button type="button" onClick={onExport} className="h-9 px-3 rounded-spa border border-border bg-surface text-xs font-medium inline-flex items-center gap-1.5 hover:bg-black/[0.03]">
                <Icon name="Download" size={14} /> Export CSV
              </button>
              <button type="button" onClick={() => window.print()} className="h-9 px-3 rounded-spa border border-border bg-surface text-xs font-medium inline-flex items-center gap-1.5 hover:bg-black/[0.03]">
                <Icon name="Printer" size={14} /> Print
              </button>
            </>
          )}
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {tiles.map((t) => <Tile key={t.key} tile={t} />)}
        </div>
      )}

      {previousNote && <p className="-mt-2 text-xs text-text-tertiary">{previousNote}</p>}

      {tabs.length > 1 && (
        <div className="flex gap-5 border-b border-border print:hidden" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id} onClick={() => onTab(t.id)}
              className={`py-2 -mb-px text-[13px] font-medium border-b-2 ${activeTab === t.id ? 'text-text-primary border-primary' : 'text-text-tertiary border-transparent hover:text-text-secondary'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {children}
      <HowWeCount items={definitions} />
    </div>
  </div>
);

export default ReportFrame;
