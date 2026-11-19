import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ScrollRow from '../../../../components/ui/ScrollRow';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import { useOrg } from '../../../../contexts/OrgContext';
import {
  SEGMENTS, SORTS, DISPLAY_STATUS, BIRTHDAY_FILTER, segmentById, displayStatus, stripStats, needsItems, sortMembers, matchesMemberSearch, reminderText,
  isBirthdaySoon, birthdayTag, toActivate, tierDeposit, headlineDiscount, goldTierId, daysUntil, ENDS_SOON_DAYS,
} from '../../../../services/membershipsView';
import { buildWhatsAppUrl } from '../../../../utils/checkoutReceipt';
import { formatPhoneGrouped } from '../../../../utils/phone';
import NeedsYouNow from '../Bookings/NeedsYouNow';
import {
  useMinWidth, useSlashFocus, isTyping, useStickyBlock, thClass, LifecycleStrip, SearchBox, SortMenu, ClearableChip, Avatar, StatusPill, MiniButton, MiniLink,
  longDate, shortDate, relativeUntil, npr, csvDownload, EmptyBlock, ErrorBlock,
} from '../Area/listKit';
import { TierPill } from './memberBits';
import { wordBranch } from '../../../../utils/industryTerms';

const uniqueOptions = (list, idOf, labelOf) => {
  const seen = new Map();
  list.forEach((m) => { const id = idOf(m); if (id && !seen.has(id)) seen.set(id, labelOf(m)); });
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
};

// Wallet meter: green; gold when low; striped blue (paid of deposit) while pending; empty when used up.
const WalletMeter = ({ m, status, width }) => {
  const dep = tierDeposit(m);
  const cycle = Math.max(Number(m.cycleDeposited) || 0, dep);
  if (status === 'pending') {
    const paid = Math.min(1, (Number(m.cycleDeposited) || 0) / (dep || 1));
    return (
      <div className="h-[5px] rounded-sm bg-[#E4E4E1] overflow-hidden" style={{ width }} aria-hidden="true">
        <div className="h-full rounded-sm" style={{ width: `${paid * 100}%`, backgroundImage: 'repeating-linear-gradient(135deg,#60A5FA 0 5px,#BFDBFE 5px 9px)' }} />
      </div>
    );
  }
  const share = cycle > 0 ? Math.min(1, (Number(m.balance) || 0) / cycle) : 0;
  const color = status === 'lowBalance' ? '#E7B93E' : status === 'lapsed' ? '#9DBF96' : '#6E9A66';
  return (
    <div className="h-[5px] rounded-sm bg-[#E4E4E1] overflow-hidden" style={{ width }} aria-hidden="true">
      {share > 0 && <div className="h-full rounded-sm" style={{ width: `${Math.max(share * 100, 3)}%`, background: color }} />}
    </div>
  );
};

// Members (V21): lifecycle strip → Needs you now → sticky toolbar + column headings → one row per membership. Row click opens the
// member in the right-hand panel (page-level, `?open=`). All list state lives in the URL.
const MembershipsPanel = ({ members, tiers, today, error, onRetry, readOnly, isOverall, stickyTop, registerExport, onOpen, openId }) => {
  const { orgName } = useOrg();
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);

  // ── URL state ────────────────────────────────────────────────────────────────────────────────────
  const segParam = sp.get('seg');
  const seg = segParam === 'all' ? null : (segmentById(segParam) ? segParam : 'active');
  const query = sp.get('q') || '';
  const sort = SORTS[sp.get('sort')] ? sp.get('sort') : 'attention';
  const filters = { tier: sp.get('tier') || '', home: sp.get('hb') || '' };
  const bday = sp.get('bday') === '1';
  const spRef = useRef(sp);
  spRef.current = sp;
  const patch = useCallback((obj, { push = false } = {}) => {
    const next = new URLSearchParams(spRef.current);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, String(v)); });
    spRef.current = next;
    setSp(next, { replace: !push });
  }, [setSp]);

  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearchText(query); }, [query]);
  useSlashFocus(searchRef);

  // ── Derived ──────────────────────────────────────────────────────────────────────────────────────
  const all = useMemo(() => members || [], [members]);
  const gold = useMemo(() => goldTierId(tiers), [tiers]);
  const stats = useMemo(() => stripStats(all, today), [all, today]);
  const options = useMemo(() => ({
    tier: uniqueOptions(all, (m) => m.tierId, (m) => m.tierName || '—'),
    home: uniqueOptions(all, (m) => m.customerBranchId, (m) => m.customerBranchName || '—'),
  }), [all]);
  const filtered = useMemo(() => {
    const segment = seg ? segmentById(seg) : null;
    const list = all.filter((m) => {
      if (segment && !segment.test(m, today)) return false;
      if (bday && !BIRTHDAY_FILTER.test(m, today)) return false;
      if (filters.tier && m.tierId !== filters.tier) return false;
      if (filters.home && m.customerBranchId !== filters.home) return false;
      return matchesMemberSearch(m, query);
    });
    return sortMembers(list, sort, today);
  }, [all, seg, bday, filters.tier, filters.home, query, sort, today]);

  // ── Actions ──────────────────────────────────────────────────────────────────────────────────────
  const remindUrl = (m) => (readOnly ? null : buildWhatsAppUrl(m.customerPhone, reminderText(m, today, orgName)));
  const rowAction = (m, status) => {
    if (readOnly) return null;
    if (status === 'pending') return { label: 'Collect', primary: true, run: () => onOpen(m.id, 'topup') };
    if (status === 'endsSoon') { const url = remindUrl(m); return url ? { label: 'Remind', icon: 'MessageSquare', href: url } : null; }
    if (status === 'lowBalance' || status === 'usedUp') return { label: 'Top up', primary: true, run: () => onOpen(m.id, 'topup') };
    if (status === 'lapsed') return Number(m.balance) > 0 ? { label: 'Extend', primary: true, run: () => onOpen(m.id, 'extend') } : { label: 'Renew', primary: true, run: () => onOpen(m.id, 'renew') };
    return null;
  };

  // Read-only viewers can't collect or message, so those items just narrow the list ("View").
  const needs = useMemo(() => needsItems(all, today).map((it) => {
    if (readOnly) return { ...it, action: 'View' };
    if (it.id === 'ending' && it.member) { const href = remindUrl(it.member); return href ? { ...it, href } : it; }
    return it;
  }), [all, today, readOnly, orgName]); // eslint-disable-line react-hooks/exhaustive-deps
  const needActive = bday ? 'birthday' : seg === 'pending' ? 'pending' : seg === 'ending' ? 'ending' : '';
  const onNeed = (id) => {
    if (!id) { patch({ seg: '', bday: '' }, { push: true }); return; }
    const it = needs.find((n) => n.id === id);
    if (id === 'pending' && it?.member && !readOnly) { onOpen(it.member.id, 'topup'); return; }
    if (id === 'birthday' && it?.member) { onOpen(it.member.id); return; }
    if (id === 'birthday') patch({ bday: '1', seg: 'all' }, { push: true });
    else patch({ seg: id, bday: '' }, { push: true });
  };

  const exportCsv = useCallback(() => {
    csvDownload(`members-${seg || 'all'}-${today}.csv`,
      ['Member', 'Phone', 'Card', 'Tier', 'Status', 'Balance', 'Deposited this cycle', 'Tier deposit', 'Valid until', 'Joined', `Home ${wordBranch()}`],
      filtered.map((m) => [m.customerName, m.customerPhone, m.membershipNumber, m.tierName, DISPLAY_STATUS[displayStatus(m, today)].label, m.balance,
        m.cycleDeposited, tierDeposit(m), m.expiryDate || '', m.activationDate || '', m.customerBranchName || '']));
  }, [filtered, seg, today]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !members || filtered.length === 0 }); }, [exportCsv, members, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  // ── Sticky + keyboard ────────────────────────────────────────────────────────────────────────────
  const { blockRef, sentinelRef, blockH, stuck, scrollToListTop } = useStickyBlock(stickyTop);
  const listKey = `${seg}|${bday}|${query}|${sort}|${filters.tier}|${filters.home}`;
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    if (stuck) scrollToListTop();
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .z-modal-overlay')) return;
      const i = filtered.findIndex((m) => m.id === openId);
      const nxt = i < 0 ? null : filtered[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!nxt) return;
      e.preventDefault();
      onOpen(nxt.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, filtered, onOpen]);
  useEffect(() => {
    if (openId) document.querySelector(`tr[data-member-id="${openId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [openId]);

  // ── Render ───────────────────────────────────────────────────────────────────────────────────────
  const loading = !members && !error;
  const chipValue = (k) => options[k].find((o) => o.id === filters[k])?.label;
  const chips = (
    <>
      <FilterChip label="Tier" value={filters.tier} options={options.tier} onChange={(v) => patch({ tier: v })} selectedLabel={chipValue('tier')} />
      <FilterChip label={`Home ${wordBranch()}`} value={filters.home} options={options.home} onChange={(v) => patch({ hb: v })} selectedLabel={chipValue('home')} />
      {bday
        ? <ClearableChip label={BIRTHDAY_FILTER.label} onClear={() => patch({ bday: '' })} />
        : (
          <button type="button" onClick={() => patch({ bday: '1', seg: 'all' }, { push: true })} className="h-7 px-2.5 rounded-full inline-flex items-center gap-[5px] text-[12.5px] font-medium border border-dashed border-[#D3D5D0] text-[#515152] hover:bg-[#FAFAF9]">
            <Icon name="Plus" size={13} />{BIRTHDAY_FILTER.label}
          </button>
        )}
    </>
  );
  const sortMenu = <SortMenu sorts={SORTS} value={sort} onChange={(id) => patch({ sort: id === 'attention' ? '' : id })} />;
  const searchBox = <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search name, phone or card no." ariaLabel="Search members" />;
  const toolbar = isSm
    ? <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">{searchBox}{chips}<div className="ml-auto">{sortMenu}</div></div>
    : <div className="pt-2.5 pb-2">{searchBox}</div>;

  const showTier = isLg;
  const showValid = isMd;
  const showHome = isLg && isOverall;
  const showActions = isLg;
  const colCount = 3 + (showTier ? 1 : 0) + (showValid ? 1 : 0) + (showHome ? 1 : 0) + (isSm ? 1 : 0);
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const anyFilter = !!(query || filters.tier || filters.home || bday);
  const clearAll = () => { setSearchText(''); patch({ q: '', tier: '', hb: '', bday: '', seg: 'all' }, { push: true }); };

  let body = null;
  if (loading) {
    body = Array.from({ length: 7 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = filtered.map((m) => {
      const status = displayStatus(m, today);
      const dim = status === 'usedUp' || status === 'lapsed';
      const fade = dim ? 'opacity-[.55]' : '';
      const selected = m.id === openId;
      const action = showActions ? rowAction(m, status) : null;
      const d = m.expiryDate ? daysUntil(m.expiryDate, today) : null;
      const warn = status === 'endsSoon' || (m.status === 'active' && d != null && d >= 0 && d <= ENDS_SOON_DAYS);
      const bdayTag = isBirthdaySoon(m, today) ? birthdayTag(m, today) : '';
      const dep = tierDeposit(m);
      const cycle = Math.max(Number(m.cycleDeposited) || 0, dep);
      const wallet = status === 'pending'
        ? <>{npr(m.cycleDeposited)} <span className="text-[#8A8A90] font-normal">paid of {npr(dep).replace('NPR ', '')}</span></>
        : status === 'lapsed' ? <>{npr(m.balance)} <span className="text-[#8A8A90] font-normal">unused</span></>
          : <>{npr(m.balance)} <span className="text-[#8A8A90] font-normal">of {npr(cycle).replace('NPR ', '')}</span></>;
      const validMain = status === 'pending' ? 'Starts when paid' : status === 'lapsed' ? `Ended ${shortDate(m.expiryDate, today)}` : longDate(m.expiryDate);
      const validSub = status === 'pending' ? `${npr(toActivate(m))} to activate`
        : status === 'lapsed' ? (Number(m.balance) > 0 ? 'extend to use it' : null)
          : status === 'usedUp' ? null : relativeUntil(m.expiryDate, today);
      const phone = m.customerPhone ? (formatPhoneGrouped(m.customerPhone) || m.customerPhone) : '';
      return (
        <tr key={m.id} data-member-id={m.id} data-status={status} tabIndex={0} aria-selected={selected || undefined}
          onClick={() => onOpen(m.id)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(m.id); }}
          style={{ scrollMarginTop: stickyTop + blockH + 40 }}
          className={`group cursor-pointer focus:outline-none ${selected ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9] focus-visible:bg-[#FAFAF9]'}`}>
          <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${selected ? 'shadow-[inset_3px_0_0_0_#2D5A27]' : ''}`}>
            <div className={`flex items-center gap-3 pl-2 ${fade}`}>
              <Avatar name={m.customerName} />
              <div className="min-w-0">
                <div className="font-medium text-[13.5px] tracking-[-0.1px] text-text-primary flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{m.customerName || '—'}</span>
                  {bdayTag && <span className="h-5 rounded-full px-1.5 text-[11.5px] font-medium inline-flex items-center gap-1 bg-[#FDF2F8] text-[#BE185D] flex-shrink-0" data-bday>{<Icon name="Cake" size={11} />}{bdayTag}</span>}
                </div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate tabular-nums">
                  {showTier ? <><span className="font-data">{m.membershipNumber || '—'}</span>{phone ? ` · ${phone}` : ''}</> : <><span className="font-data">{m.membershipNumber || '—'}</span> · {m.tierName}</>}
                </div>
              </div>
            </div>
          </td>
          {showTier && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade}>
                <TierPill name={m.tierName} gold={m.tierId === gold} />
                {headlineDiscount(m.tierDiscountRules) && <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{headlineDiscount(m.tierDiscountRules)}</div>}
              </div>
            </td>
          )}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            <div className={`flex flex-col gap-1.5 ${fade}`}>
              <div className="text-[13px] font-semibold text-text-primary tabular-nums whitespace-nowrap truncate" data-wallet>{wallet}</div>
              <WalletMeter m={m} status={status} width={isSm ? 200 : 110} />
            </div>
          </td>
          {showValid && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade}>
                <div className="text-[13px] font-medium text-text-primary tabular-nums whitespace-nowrap">{validMain}</div>
                {validSub && <div className={`text-[12.5px] mt-0.5 whitespace-nowrap ${warn ? 'text-[#B45309] font-medium' : 'text-[#8A8A90]'}`} data-valid-hint>{validSub}</div>}
              </div>
            </td>
          )}
          {showHome && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-[#515152] truncate"><span className={fade}>{m.customerBranchName || '—'}</span></td>}
          {isSm && <td className="h-[58px] border-b border-[#F1F1EF] pl-2"><span className={fade}><StatusPill status={status} config={DISPLAY_STATUS} /></span></td>}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-1">
            <div className="flex gap-1.5 justify-end items-center text-[#8A8A90]">
              {action && (
                <span className={`${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'} transition-opacity`}>
                  {action.href
                    ? <MiniLink href={action.href} icon={action.icon} data-row-action={action.label}>{action.label}</MiniLink>
                    : <MiniButton primary={action.primary} data-row-action={action.label} onClick={(e) => { e.stopPropagation(); action.run(); }}>{action.label}</MiniButton>}
                </span>
              )}
              <Icon name="ChevronRight" size={15} />
            </div>
          </td>
        </tr>
      );
    });
  }

  return (
    <div>
      <LifecycleStrip segments={SEGMENTS} stats={stats} selected={seg} loading={loading} ariaLabel="Membership lifecycle"
        onPick={(id, on) => patch({ seg: on ? 'all' : (id === 'active' ? '' : id), bday: '' }, { push: true })} />
      {!loading && !error && needs.length > 0 && (
        <div className="mt-3 -mb-3"><NeedsYouNow items={needs} active={needActive} onPick={onNeed} quietTail /></div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>{toolbar}</div>
      {!isSm && <ScrollRow className="pb-2" wrapperClassName="pb-0">{chips}{sortMenu}</ScrollRow>}

      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col />
            {showTier && <col style={{ width: '17%' }} />}
            <col style={{ width: isSm ? 236 : 132 }} />
            {showValid && <col style={{ width: 150 }} />}
            {showHome && <col style={{ width: 104 }} />}
            {isSm && <col style={{ width: 120 }} />}
            <col style={{ width: showActions ? 116 : 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Member</th>
              {showTier && <th scope="col" className={`${th} text-left`} style={thTop}>Tier</th>}
              <th scope="col" className={`${th} text-left`} style={thTop}>Wallet</th>
              {showValid && <th scope="col" className={`${th} text-left`} style={thTop}>Valid until</th>}
              {showHome && <th scope="col" className={`${th} text-left`} style={thTop}>Home {wordBranch()}</th>}
              {isSm && <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Status</th>}
              <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (all.length === 0
        ? <EmptyBlock icon="CreditCard" title="No members yet" hint="Members you enroll appear here." />
        : <EmptyBlock icon="CreditCard" title="No members match" hint={anyFilter ? 'Try a different search or clear a filter.' : `Nobody is in “${segmentById(seg)?.label}” right now.`} action={{ label: 'Clear filters', run: clearAll }} />)}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">{filtered.length} member{filtered.length === 1 ? '' : 's'}</div>
      )}
    </div>
  );
};

export default MembershipsPanel;
