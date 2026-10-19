import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip, Menu } from '../../../../components/ui/ListToolbarKit';
import { updatePackageType } from '../../../../services/api';
import { perSession, typeUsage, validityLabel } from '../../../../services/packagesView';
import { friendlyError } from '../../../../utils/friendlyError';
import PackageTypePanel from './PackageTypePanel';
import { MiniButton, npr, csvDownload } from './packageBits';

const SHOW = { all: 'All', on: 'On sale', hidden: 'Hidden' };
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const useMinWidth = (px) => {
  const q = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
};
const typeTitle = (t) => t.name;
const serviceLine = (t) => [t.service?.name, t.service?.duration_minutes ? `${t.service.duration_minutes} min` : null].filter(Boolean).join(' · ');

// Small on/off switch for a table row (the panel kit's SwitchRow is a full-width settings row).
const RowSwitch = ({ checked, onChange, label, busy }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={busy}
    onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    className={`relative inline-flex w-[30px] h-[18px] rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 ${checked ? 'bg-primary' : 'bg-[#D6D3D1]'}`}>
    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[14px]' : 'left-[2px]'}`} />
  </button>
);

// Package types (V20): the packages on offer, what one session costs against a single visit, how many guests hold each, and an
// admin On sale switch. Turning a type off only hides it from Sell package; packages already sold are untouched.
const PackageOverviewPanel = ({ packages, types, today, error, onRetry, onChanged, readOnly, role, stickyTop, onSell, notify, registerExport }) => {
  const isAdmin = role === 'admin' && !readOnly;
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);

  const query = sp.get('q') || '';
  const service = sp.get('sv') || '';
  const show = SHOW[sp.get('show')] ? sp.get('show') : 'all';
  const spRef = useRef(sp);
  spRef.current = sp;
  const patch = useCallback((obj) => {
    const next = new URLSearchParams(spRef.current);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, String(v)); });
    spRef.current = next;
    setSp(next, { replace: true });
  }, [setSp]);
  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Optimistic On sale: the switch flips at once and reverts (with a toast) if the save fails.
  const [overrides, setOverrides] = useState({});
  const [busyId, setBusyId] = useState(null);
  const activeOf = (t) => (overrides[t.id] !== undefined ? overrides[t.id] : !!t.is_active);
  const toggle = async (t, next) => {
    setOverrides((o) => ({ ...o, [t.id]: next }));
    setBusyId(t.id);
    const { error: err } = await updatePackageType({ id: t.id, isActive: next });
    setBusyId(null);
    if (err) {
      setOverrides((o) => ({ ...o, [t.id]: !next }));
      notify(friendlyError(err, 'Could not change the package type.'), 'error');
      return;
    }
    notify(next ? `${t.name} is on sale` : `${t.name} is hidden from Sell package`);
    await onChanged();
    setOverrides((o) => { const { [t.id]: _drop, ...rest } = o; return rest; });
  };

  const [editing, setEditing] = useState(null); // null | 'new' | type
  const usage = useMemo(() => typeUsage(packages || [], today), [packages, today]);
  const serviceOptions = useMemo(() => {
    const seen = new Map();
    (types || []).forEach((t) => { if (t.service?.id && !seen.has(t.service.id)) seen.set(t.service.id, t.service.name); });
    return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [types]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (types || []).filter((t) => {
      if (service && t.service?.id !== service) return false;
      const on = overrides[t.id] !== undefined ? overrides[t.id] : !!t.is_active;
      if (show === 'on' && !on) return false;
      if (show === 'hidden' && on) return false;
      return !q || `${t.name} ${t.service?.name || ''}`.toLowerCase().includes(q);
    });
  }, [types, query, service, show, overrides]);

  const exportCsv = useCallback(() => {
    csvDownload(`package-types-${today}.csv`,
      ['Package', 'Service', 'Minutes', 'Sessions', 'Price', 'Per session', 'Single visit', 'Valid for (days)', 'Active guests', 'Sold', 'On sale'],
      visible.map((t) => {
        const ps = perSession(t);
        return [t.name, t.service?.name || '', t.service?.duration_minutes || '', t.default_sessions ?? 'Open', t.standard_price ?? 'Set at sale',
          ps.per != null ? Math.round(ps.per) : '', ps.single ?? '', t.validity_days, usage[t.id]?.active || 0, usage[t.id]?.sold || 0, t.is_active ? 'Yes' : 'No'];
      }));
  }, [visible, usage, today]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !types || visible.length === 0 }); }, [exportCsv, types, visible.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  // Sticky toolbar; the column headings stick under it.
  const blockRef = useRef(null);
  const [blockH, setBlockH] = useState(60);
  useEffect(() => {
    const el = blockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setBlockH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loading = !types && !error;
  const showSessions = isMd;
  const showPer = isLg;
  const showValid = isMd;
  const showGuests = isLg;
  const showPrice = isSm;
  const colCount = 3 + (showSessions ? 1 : 0) + (showPrice ? 1 : 0) + (showPer ? 1 : 0) + (showValid ? 1 : 0) + (showGuests ? 1 : 0);
  const th = 'h-[34px] text-[12px] font-medium whitespace-nowrap border-b border-border bg-white text-[#8A8A90] sticky z-[5]';
  const thTop = { top: stickyTop + blockH };
  const anyFilter = !!(query || service || show !== 'all');

  const showMenu = (
    <Menu trigger={(open, toggleMenu) => (
      <button type="button" onClick={toggleMenu} aria-haspopup="menu" aria-expanded={open} className="h-7 px-2 rounded-md text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] whitespace-nowrap">
        Show <b className="text-text-primary font-medium">{SHOW[show]}</b><Icon name="ChevronDown" size={13} />
      </button>)}>
      {(close) => Object.entries(SHOW).map(([id, label]) => (
        <button key={id} type="button" onClick={() => { patch({ show: id === 'all' ? '' : id }); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${show === id ? 'font-medium' : ''}`}>
          {label}{show === id && <Icon name="Check" size={13} />}
        </button>))}
    </Menu>
  );

  let body = null;
  if (loading) {
    body = Array.from({ length: 5 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = visible.map((t) => {
      const on = activeOf(t);
      const ps = perSession(t);
      const u = usage[t.id] || { active: 0, sold: 0 };
      const fade = on ? '' : 'opacity-[.55]';
      return (
        <tr key={t.id} data-type-id={t.id} data-on-sale={on ? '1' : '0'} tabIndex={isAdmin ? 0 : undefined}
          onClick={isAdmin ? () => setEditing(t) : undefined} onKeyDown={isAdmin ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(t); } : undefined}
          className={`group ${isAdmin ? 'cursor-pointer hover:bg-[#FAFAF9] focus:outline-none focus-visible:bg-[#FAFAF9]' : ''}`}>
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            <div className={`pl-2 min-w-0 ${fade}`}>
              <div className="font-medium text-[13px] text-text-primary truncate">{typeTitle(t)}</div>
              <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">
                {isSm ? serviceLine(t) || '—' : [t.default_sessions != null ? `${t.default_sessions} sessions` : 'Open sessions', t.standard_price != null ? npr(t.standard_price) : 'Price set at sale'].join(' · ')}
              </div>
            </div>
          </td>
          {showSessions && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] font-medium tabular-nums"><span className={fade}>{t.default_sessions ?? <span className="text-[#8A8A90] font-normal">Open</span>}</span></td>}
          {showPrice && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] font-medium tabular-nums whitespace-nowrap"><span className={fade}>{t.standard_price != null ? npr(t.standard_price) : <span className="text-[#8A8A90] font-normal">Set at sale</span>}</span></td>}
          {showPer && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-4 text-right">
              <div className={fade}>
                <div className="text-[13px] font-medium tabular-nums whitespace-nowrap inline-flex items-center justify-end gap-2">
                  {ps.per != null ? npr(ps.per) : <span className="text-[#8A8A90] font-normal">—</span>}
                  {ps.saves != null && <span className="h-5 px-[7px] rounded-full bg-[#EEF3EC] text-primary text-[11.5px] font-medium inline-flex items-center" data-saves>saves {ps.saves}%</span>}
                </div>
                {ps.per != null && ps.single != null && <div className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums whitespace-nowrap">single visit {npr(ps.single)}</div>}
              </div>
            </td>
          )}
          {showValid && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] whitespace-nowrap"><span className={fade}>{validityLabel(t.validity_days)}</span></td>}
          {showGuests && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade} data-guests>
                <div className="text-[13px] font-medium tabular-nums">{u.active} active</div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums">{u.sold} sold</div>
              </div>
            </td>
          )}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            {isAdmin
              ? <RowSwitch checked={on} busy={busyId === t.id} label={`${t.name} on sale`} onChange={(next) => toggle(t, next)} />
              : <span className={`text-[12.5px] ${on ? 'text-text-primary' : 'text-[#8A8A90]'}`}>{on ? 'On sale' : 'Hidden'}</span>}
          </td>
          <td className="h-[58px] border-b border-[#F1F1EF] pr-1">
            <div className="flex gap-1.5 justify-end items-center text-[#8A8A90]">
              {isSm && (on
                ? (!readOnly && <MiniButton primary data-row-action="Sell" onClick={(e) => { e.stopPropagation(); onSell({ typeId: t.id }); }}>Sell</MiniButton>)
                : <span className="h-5 px-[7px] rounded-full text-[11.5px] font-medium inline-flex items-center bg-white text-[#8A8A90] shadow-[inset_0_0_0_1px_#E7E8E6] whitespace-nowrap">Hidden from sale</span>)}
              {isAdmin && <Icon name="ChevronRight" size={15} />}
            </div>
          </td>
        </tr>
      );
    });
  }

  return (
    <div>
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>
        <div className="flex items-center gap-2 pt-[18px] pb-2 flex-wrap">
          <div className="relative w-full sm:w-[300px]">
            <Icon name="Search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A8A90]" />
            <input ref={searchRef} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search package or service" aria-label="Search package types"
              className="w-full h-[34px] pl-8 pr-8 border border-border rounded-[7px] text-[13px] bg-white placeholder:text-[#8A8A90] focus:outline-none focus:border-[#cfd2cc] focus:shadow-[0_0_0_3px_rgba(45,90,39,.08)]" />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] font-medium text-[#8A8A90] border border-border rounded px-[5px] py-px bg-white">/</kbd>
          </div>
          <FilterChip label="Service" value={service} options={serviceOptions} onChange={(v) => patch({ sv: v })} selectedLabel={serviceOptions.find((o) => o.id === service)?.label} />
          <div className="ml-auto flex items-center gap-2">
            {showMenu}
            {isAdmin && (
              <button type="button" onClick={() => setEditing('new')} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] whitespace-nowrap">
                <Icon name="Plus" size={14} />New package type
              </button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="border border-error/20 bg-error/5 rounded-lg p-4 mt-2 flex items-center gap-3 text-[13px] text-error">
          <Icon name="AlertCircle" size={16} />{error}
          <button type="button" onClick={onRetry} className="ml-auto underline font-medium">Retry</button>
        </div>
      ) : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col />
            {showSessions && <col style={{ width: 80 }} />}
            {showPrice && <col style={{ width: 112 }} />}
            {showPer && <col style={{ width: 200 }} />}
            {showValid && <col style={{ width: 96 }} />}
            {showGuests && <col style={{ width: 96 }} />}
            <col style={{ width: isAdmin ? 72 : 84 }} />
            <col style={{ width: isSm ? 150 : 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Package</th>
              {showSessions && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Sessions</th>}
              {showPrice && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Price</th>}
              {showPer && <th scope="col" className={`${th} text-right pr-4`} style={thTop}>Per session</th>}
              {showValid && <th scope="col" className={`${th} text-left`} style={thTop}>Valid for</th>}
              {showGuests && <th scope="col" className={`${th} text-left`} style={thTop}>Guests</th>}
              <th scope="col" className={`${th} text-left`} style={thTop}>On sale</th>
              <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-16">
          <Icon name="Layers" size={28} className="text-[#B4B4BA] mx-auto mb-3" />
          {(types || []).length === 0 ? (
            <>
              <p className="text-[14px] font-medium text-text-primary">No package types yet</p>
              <p className="text-[13px] text-[#8A8A90] mt-1">{isAdmin ? 'Create the packages you offer, then sell them to guests.' : 'An admin can add the packages you offer.'}</p>
              {isAdmin && <button type="button" onClick={() => setEditing('new')} className="mt-3 text-[13px] font-medium text-primary hover:underline">New package type</button>}
            </>
          ) : (
            <>
              <p className="text-[14px] font-medium text-text-primary">No package types match</p>
              <p className="text-[13px] text-[#8A8A90] mt-1">Try a different search or clear a filter.</p>
              {anyFilter && <button type="button" onClick={() => { setSearchText(''); patch({ q: '', sv: '', show: '' }); }} className="mt-3 text-[13px] font-medium text-primary hover:underline">Clear filters</button>}
            </>
          )}
        </div>
      )}
      {!loading && !error && visible.length > 0 && (
        <p className="text-[12.5px] text-[#8A8A90] mt-3.5">Turning a package off hides it from &ldquo;Sell package&rdquo;. Guests who already bought it keep their sessions.</p>
      )}

      {isAdmin && editing && (
        <PackageTypePanel
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved, created) => { setEditing(null); notify(created ? `${saved.name} added` : `${saved.name} saved`); await onChanged(); }}
        />
      )}
    </div>
  );
};

export default PackageOverviewPanel;
