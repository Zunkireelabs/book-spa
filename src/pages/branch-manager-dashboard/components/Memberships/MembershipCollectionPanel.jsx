import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { updateMembershipTier } from '../../../../services/api';
import { tierStats, goldTierId, discountChips } from '../../../../services/membershipsView';
import { validityLabel } from '../../../../services/packagesView';
import { friendlyError } from '../../../../utils/friendlyError';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, RowSwitch, MiniButton, npr, csvDownload, EmptyBlock, ErrorBlock } from '../Area/listKit';
import { TierPill, DiscountChips } from './memberBits';
import MembershipTierPanel from './MembershipTierPanel';

// Tiers (V21): what members pay up front, the discounts they get, how many hold each tier and what is still in their wallets
// (this absorbs the old Collection tab's per-tier numbers), plus an admin On sale switch. Turning a tier off only stops new
// enrolments; current members keep their wallet and discounts.
const MembershipCollectionPanel = ({ members, tiers, error, onRetry, onChanged, readOnly, role, stickyTop, notify, registerExport, onEnroll, today }) => {
  const isAdmin = role === 'admin' && !readOnly;
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);

  const query = sp.get('q') || '';
  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText === query) return;
      const next = new URLSearchParams(sp);
      if (searchText) next.set('q', searchText); else next.delete('q');
      setSp(next, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useSlashFocus(searchRef);

  // Optimistic On sale: the switch flips at once and reverts (with a toast) if the save fails.
  const [overrides, setOverrides] = useState({});
  const [busyId, setBusyId] = useState(null);
  const activeOf = (t) => (overrides[t.id] !== undefined ? overrides[t.id] : !!t.is_active);
  const toggle = async (t, next) => {
    setOverrides((o) => ({ ...o, [t.id]: next }));
    setBusyId(t.id);
    const { error: err } = await updateMembershipTier({ id: t.id, isActive: next });
    setBusyId(null);
    if (err) {
      setOverrides((o) => ({ ...o, [t.id]: !next }));
      notify(friendlyError(err, 'Could not change the tier.'), 'error');
      return;
    }
    notify(next ? `${t.name} is open for enrolment` : `${t.name} is closed to new members`);
    await onChanged();
    setOverrides((o) => { const { [t.id]: _drop, ...rest } = o; return rest; });
  };

  const [editing, setEditing] = useState(null); // null | 'new' | tier
  const stats = useMemo(() => tierStats(members || []), [members]);
  const gold = useMemo(() => goldTierId(tiers), [tiers]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tiers || []).filter((t) => !q || `${t.name} ${t.code_prefix || ''}`.toLowerCase().includes(q));
  }, [tiers, query]);

  const exportCsv = useCallback(() => {
    csvDownload(`membership-tiers-${today}.csv`,
      ['Tier', 'Card prefix', 'Pays up front', 'Discounts', 'Valid for (days)', 'Active members', 'Members', 'Held in wallets', 'Collected', 'On sale'],
      visible.map((t) => {
        const s = stats[t.id] || { active: 0, total: 0, held: 0, collected: 0 };
        return [t.name, t.code_prefix, t.advance_amount, discountChips(t.discount_rules).map((c) => `${c.label} ${c.pct}%`).join('; '), t.validity_days, s.active, s.total, s.held, s.collected, t.is_active ? 'Yes' : 'No'];
      }));
  }, [visible, stats, today]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !tiers || visible.length === 0 }); }, [exportCsv, tiers, visible.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const { blockRef, blockH } = useStickyBlock(stickyTop);
  const loading = !tiers && !error;
  const showDiscounts = isLg;
  const showValid = isLg;
  const showMembers = isMd;
  const showHeld = isLg;
  const showPays = isSm;
  const colCount = 3 + (showPays ? 1 : 0) + (showDiscounts ? 1 : 0) + (showValid ? 1 : 0) + (showMembers ? 1 : 0) + (showHeld ? 1 : 0);
  const th = thClass(false);
  const thTop = { top: stickyTop + blockH };

  let body = null;
  if (loading) {
    body = Array.from({ length: 3 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = visible.map((t) => {
      const on = activeOf(t);
      const s = stats[t.id] || { active: 0, total: 0, held: 0, collected: 0 };
      const fade = on ? '' : 'opacity-[.55]';
      return (
        <tr key={t.id} data-tier-id={t.id} data-on-sale={on ? '1' : '0'} tabIndex={isAdmin ? 0 : undefined}
          onClick={isAdmin ? () => setEditing(t) : undefined} onKeyDown={isAdmin ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(t); } : undefined}
          className={`group ${isAdmin ? 'cursor-pointer hover:bg-[#FAFAF9] focus:outline-none focus-visible:bg-[#FAFAF9]' : ''}`}>
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            <div className={`pl-2 min-w-0 ${fade}`}>
              <TierPill name={t.name} gold={t.id === gold} />
              <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{isSm ? `Card numbers ${t.code_prefix || '—'}-0001…` : `${npr(t.advance_amount)} · ${validityLabel(t.validity_days)}`}</div>
            </div>
          </td>
          {showPays && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] font-semibold tabular-nums whitespace-nowrap"><span className={fade}>{npr(t.advance_amount)}</span></td>}
          {showDiscounts && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3 py-2">
              <div className={fade}>
                {discountChips(t.discount_rules).length ? <DiscountChips rules={t.discount_rules} size="sm" /> : <span className="text-[12.5px] text-[#8A8A90]">No discounts</span>}
                <div className="text-[12.5px] text-[#8A8A90] mt-1">+ a birthday gift each year</div>
              </div>
            </td>
          )}
          {showValid && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] whitespace-nowrap"><span className={fade}>{validityLabel(t.validity_days)}</span></td>}
          {showMembers && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade} data-members>
                <div className="text-[13px] font-medium tabular-nums">{s.active} active</div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums">{s.total} in total</div>
              </div>
            </td>
          )}
          {showHeld && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-4 text-right">
              <div className={fade} data-held>
                <div className="text-[13px] font-semibold tabular-nums whitespace-nowrap">{npr(s.held)}</div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums whitespace-nowrap">of {npr(s.collected)} collected</div>
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
                ? (!readOnly && <MiniButton primary data-row-action="Enroll" onClick={(e) => { e.stopPropagation(); onEnroll(t.id); }}>Enroll</MiniButton>)
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
          <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search tiers" ariaLabel="Search tiers" />
          {isAdmin && (
            <button type="button" onClick={() => setEditing('new')} className="ml-auto h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] whitespace-nowrap">
              <Icon name="Plus" size={14} />New tier
            </button>
          )}
        </div>
      </div>

      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col style={{ width: showDiscounts ? 212 : undefined }} />
            {showPays && <col style={{ width: 120 }} />}
            {showDiscounts && <col />}
            {showValid && <col style={{ width: 80 }} />}
            {showMembers && <col style={{ width: 92 }} />}
            {showHeld && <col style={{ width: 172 }} />}
            <col style={{ width: isAdmin ? 66 : 80 }} />
            <col style={{ width: isSm ? 132 : 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Tier</th>
              {showPays && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Pays up front</th>}
              {showDiscounts && <th scope="col" className={`${th} text-left`} style={thTop}>Member discounts</th>}
              {showValid && <th scope="col" className={`${th} text-left`} style={thTop}>Valid for</th>}
              {showMembers && <th scope="col" className={`${th} text-left`} style={thTop}>Members</th>}
              {showHeld && <th scope="col" className={`${th} text-right pr-4`} style={thTop}>Held in wallets</th>}
              <th scope="col" className={`${th} text-left`} style={thTop}>On sale</th>
              <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && visible.length === 0 && ((tiers || []).length === 0
        ? <EmptyBlock icon="CreditCard" title="No tiers yet" hint={isAdmin ? 'Create a tier, then enroll members on it.' : 'An admin can add membership tiers.'} action={isAdmin ? { label: 'New tier', run: () => setEditing('new') } : null} />
        : <EmptyBlock icon="CreditCard" title="No tiers match" hint="Try a different search." action={{ label: 'Clear search', run: () => setSearchText('') }} />)}
      {!loading && !error && visible.length > 0 && (
        <p className="text-[12.5px] text-[#8A8A90] mt-3.5" data-footnote>
          Member discounts are filled in when you sell a voucher to a member, so a change applies to vouchers sold from then on. Turning a tier off stops new enrolments; current members keep their wallet and discounts.
        </p>
      )}

      {isAdmin && editing && (
        <MembershipTierPanel
          tier={editing === 'new' ? null : editing}
          tiers={tiers || []}
          onClose={() => setEditing(null)}
          onSaved={async (saved, created) => { setEditing(null); notify(created ? `${saved.name} added` : `${saved.name} saved`); await onChanged(); }}
        />
      )}
    </div>
  );
};

export default MembershipCollectionPanel;
