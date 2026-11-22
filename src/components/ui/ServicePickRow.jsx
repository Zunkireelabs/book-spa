import React, { useMemo, useRef, useEffect, useState } from 'react';
import PickShell from './PickShell';
import { useMediaQuery } from './BottomSheet';
import useServicePickerData from '../../hooks/useServicePickerData';
import { mostBooked, categoryGroups, showCategoryHeaders, priceLine, searchServices } from '../../utils/serviceCatalog';

// ONE service control everywhere (ZNLY-320): closed row "name / 60 min · NPR 3,499", opens a searchable list on the shared PickShell
// (popover on desktop, bottom sheet on phone). List: search · MOST BOOKED (hidden while searching) · category headers (2+ categories and
// more than 8 services) · radio on every row. `services` is whatever set the caller already filtered (branch scope, exclusions, active).
// `anyLabel` (Waitlist): "no service" is a real answer, so the empty state and the first list row read that label.
const Chip = ({ children }) => <span className="ml-1.5 px-1.5 py-px rounded-[5px] bg-indigo-50 text-indigo-700 text-[10px] font-bold align-middle">{children}</span>;

const ServicePickRow = ({ services, value, onChange, branchId = null, canViewPrices = true, title = 'Pick a service', sub = '', emptyLabel = 'Pick a service', anyLabel = '', disabled = false, loading = false, ariaLabel, required = false, invalid = false, openSignal = 0 }) => {
  const { counts, categoryOrder, tiers } = useServicePickerData(branchId);
  const list = services || [];
  const selected = list.find((s) => s.id === value) || null;
  const line = (s) => priceLine(s, tiers[s.id], canViewPrices);
  const top = useMemo(() => {
    const ids = mostBooked(counts, list);
    return ids.map((id) => list.find((s) => s.id === id)).filter(Boolean);
  }, [counts, list]);

  const empty = !selected;
  const anyPicked = empty && !!anyLabel;
  // ZNLY-322: an empty REQUIRED row is solid with primary text; an empty OPTIONAL row stays dashed with secondary text. `invalid` = red ring + reason line.
  const tone = invalid && empty ? 'border-error ring-2 ring-error/20 bg-surface' : empty && !anyPicked && !required ? 'border-dashed border-border bg-surface' : 'border-border bg-surface';

  const renderPicker = (close) => (
    <ServiceList list={list} value={value} anyLabel={anyLabel} title={title} sub={sub} top={top} categoryOrder={categoryOrder} line={line}
      onPick={(id) => { onChange(id); close(); }} />
  );

  return (
    <PickShell tone={tone} title={title} renderPicker={renderPicker} disabled={disabled || loading} openSignal={openSignal}
      belowRow={invalid && empty ? <p className="mt-1.5 px-0.5 text-xs text-error" role="alert">Pick a service</p> : null}>
      {loading ? <span className="flex-1 text-sm text-text-secondary">Loading services…</span>
        : selected ? (
          <span className="flex-1 min-w-0" aria-label={ariaLabel}>
            <span className="block truncate text-sm font-body-medium text-text-primary">{selected.name}</span>
            <span className="block truncate text-xs text-text-secondary">{line(selected)}{selected.is_combo && <Chip>Combo</Chip>}</span>
          </span>
        ) : anyPicked ? <span className="flex-1 text-sm text-text-primary">{anyLabel}</span>
          : <span className={`flex-1 text-sm ${required ? 'text-text-primary' : 'text-text-secondary'}`}>＋ {emptyLabel}</span>}
    </PickShell>
  );
};

const ServiceList = ({ list, value, anyLabel, title, sub, top, categoryOrder, line, onPick }) => {
  const [q, setQ] = useState('');
  const isPhone = useMediaQuery('(max-width: 767.98px)');
  const inputRef = useRef(null);
  const selRef = useRef(null);
  useEffect(() => { if (!isPhone) inputRef.current?.focus(); }, [isPhone]);
  useEffect(() => { selRef.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  const searching = q.trim().length > 0;
  const hits = searching ? searchServices(list, q) : list;
  const renderRow = (s) => {
    const on = s.id === value;
    return (
      <label key={s.id} ref={on ? selRef : null} className={`flex items-center gap-2.5 px-4 py-2 min-h-[54px] border-t border-[#EEF0F1] cursor-pointer ${on ? 'bg-primary/5' : 'hover:bg-background'}`}>
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-text-primary">{s.name}</span>
          <span className="block text-xs text-text-secondary">{line(s)}{s.is_combo && <Chip>Combo</Chip>}</span>
        </span>
        <input type="radio" name="service-pick" checked={on} onChange={() => onPick(s.id)} className="accent-primary w-4 h-4 flex-shrink-0" aria-label={s.name} />
      </label>
    );
  };
  const Head = ({ children, tint }) => <div className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${tint ? 'text-primary' : 'text-text-secondary'}`}>{children}</div>;
  return (
    <div>
      <div className="px-4 pt-4 pb-3 pr-14 md:pr-4">
        <h3 className="font-heading font-heading-semibold text-[17px] leading-snug text-text-primary">{title}</h3>
        {sub && <p className="text-[13.5px] text-text-secondary">{sub}</p>}
      </div>
      <div className="px-4 pt-2 pb-2 sticky top-0 bg-surface z-10">
        <input ref={inputRef} type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" aria-label="Search services"
          className="w-full h-10 px-3 border border-border rounded-spa text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {anyLabel && !searching && (
        <label className={`flex items-center gap-2.5 px-4 py-2 min-h-[54px] border-t border-[#EEF0F1] cursor-pointer ${!value ? 'bg-primary/5' : 'hover:bg-background'}`}>
          <span className="flex-1 min-w-0"><span className="block text-sm text-text-primary">{anyLabel}</span><span className="block text-xs text-text-secondary">No preference</span></span>
          <input type="radio" name="service-pick" checked={!value} onChange={() => onPick('')} className="accent-primary w-4 h-4 flex-shrink-0" aria-label={anyLabel} />
        </label>
      )}
      {searching ? (
        hits.length ? hits.map((s) => renderRow(s)) : <p className="px-4 py-6 text-sm text-text-secondary text-center">No service matches “{q.trim()}”.</p>
      ) : (
        <>
          {top.length > 0 && (<><Head tint>Most booked</Head>{top.map((s) => renderRow(s))}</>)}
          {showCategoryHeaders(list)
            ? categoryGroups(list, categoryOrder).map((g) => (<React.Fragment key={g.name}><Head>{g.name}</Head>{g.items.map((s) => renderRow(s))}</React.Fragment>))
            : list.map((s) => renderRow(s))}
        </>
      )}
    </div>
  );
};

export default ServicePickRow;
