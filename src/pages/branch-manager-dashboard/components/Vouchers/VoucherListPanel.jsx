import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import {
  SORTS, STATUS, NEED_FILTERS, segmentById, visibleSegments, statusOf, stripStats, needsItems, sortVouchers, matchesVoucherSearch, remindedHint,
  isCoupon, hasUse, isEnded, isReady, remainingOf, valueOf, longDate, daysUntil, forPhone, EXPIRING_DAYS,
} from '../../../../services/vouchersView';
import { formatPhoneGrouped } from '../../../../utils/phone';
import NeedsYouNow from '../Bookings/NeedsYouNow';
import {
  useMinWidth, useSlashFocus, isTyping, useStickyBlock, thClass, LifecycleStrip, SearchBox, SortMenu, ClearableChip, StatusPill, MiniButton, MiniLink,
  shortDate, relativeUntil, npr, csvDownload, EmptyBlock, ErrorBlock,
} from '../Area/listKit';
import { KindTag, voucherTag, VoucherMeter } from './voucherBits';
import VoucherReview from './VoucherReview';

const uniqueOptions = (list, idOf, labelOf) => {
  const seen = new Map();
  list.forEach((v) => { const id = idOf(v); if (id && !seen.has(id)) seen.set(id, labelOf(v)); });
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
};
const KIND_OPTIONS = [{ id: 'sold', label: 'Sold' }, { id: 'free', label: 'Given free' }];
const MATCH_LABEL = 'Matches a customer';
const phoneText = (p) => (p ? (formatPhoneGrouped(p) || p) : '');

/** The "For" sub-line: "From <buyer>", else the phone, else the company / note. */
const forSub = (v) => {
  if (v.buyerName) return `From ${v.buyerName}`;
  const phone = forPhone(v);
  if (phone) return phoneText(phone);
  return v.guestInfo || '';
};

// Vouchers (V23): lifecycle strip → Needs you now → sticky toolbar + column headings → one row per voucher. Row click opens the
// voucher in the right-hand panel (page-level, `?open=`). All list state lives in the URL; `?review=1` is the one-off check of old
// free vouchers (VoucherReview).
const VoucherListPanel = ({ vouchers, types, matches, today, error, onRetry, onChanged, readOnly, isAdmin, stickyTop, registerExport, onOpen, openId, notify, remind }) => {
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);

  // ── URL state ────────────────────────────────────────────────────────────────────────────────────
  const seg = segmentById(sp.get('seg')) ? sp.get('seg') : null; // default: everything, sorted by Needs attention
  const query = sp.get('q') || '';
  const sort = SORTS[sp.get('sort')] ? sp.get('sort') : 'attention';
  const filters = { type: sp.get('type') || '', kind: sp.get('kind') || '', at: sp.get('at') || '' };
  const need = NEED_FILTERS[sp.get('need')] ? sp.get('need') : '';
  const matchOnly = sp.get('match') === '1';
  const review = sp.get('review') === '1' && !readOnly;
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
  const all = useMemo(() => vouchers || [], [vouchers]);
  const stats = useMemo(() => stripStats(all, today), [all, today]);
  const segments = useMemo(() => visibleSegments(all), [all]);
  const options = useMemo(() => ({
    type: uniqueOptions(all, (v) => v.voucherTypeId, (v) => v.voucherTypeName || '—'),
    kind: KIND_OPTIONS,
    at: uniqueOptions(all, (v) => v.branchId, (v) => v.branchName || '—'),
  }), [all]);
  const filtered = useMemo(() => {
    const segment = seg ? segmentById(seg) : null;
    const needF = need ? NEED_FILTERS[need] : null;
    const list = all.filter((v) => {
      if (segment && !segment.test(v, today)) return false;
      if (needF && !needF.test(v, today)) return false;
      if (matchOnly && !matches.has(v.id)) return false;
      if (filters.type && v.voucherTypeId !== filters.type) return false;
      if (filters.kind && (v.issueKind || 'sold') !== filters.kind) return false;
      if (filters.at && v.branchId !== filters.at) return false;
      return matchesVoucherSearch(v, query);
    });
    return sortVouchers(list, sort, today);
  }, [all, seg, need, matchOnly, matches, filters.type, filters.kind, filters.at, query, sort, today]);

  // ── Actions ──────────────────────────────────────────────────────────────────────────────────────
  const remindLink = (v) => {
    const href = remind.url(v, 'for') || (v.buyerName ? remind.url(v, 'buyer') : null);
    if (!href) return null;
    return { href, onClick: () => remind.log(v, remind.url(v, 'for') ? 'for' : 'buyer') };
  };
  const rowAction = (v, status) => {
    if (readOnly) return null;
    if (status === 'soon' && hasUse(v)) { const r = remindLink(v); if (r) return { label: 'Remind', icon: 'MessageSquare', ...r }; }
    if (status === 'check') return { label: 'Check', run: () => patch({ review: '1' }, { push: true }) };
    if (status === 'expired' && hasUse(v)) return isAdmin ? { label: 'Extend', run: () => onOpen(v.id, 'extend') } : null;
    if (isReady(v, today)) return isCoupon(v) ? { label: 'Mark used', run: () => onOpen(v.id, 'coupon') } : { label: 'Redeem', run: () => onOpen(v.id, 'claim') };
    return null;
  };

  // Read-only viewers can't message, extend or link, so those items just narrow the list ("View").
  const needs = useMemo(() => needsItems(all, today, { isAdmin, matches }).map((it) => (readOnly ? { ...it, action: 'View' } : it)), [all, today, isAdmin, matches, readOnly]);
  const needActive = need || (matchOnly ? 'match' : '');
  const onNeed = (id) => {
    if (!id) { patch({ need: '', match: '' }, { push: true }); return; }
    const it = needs.find((n) => n.id === id);
    if (id === 'check') { if (readOnly) patch({ seg: 'check' }, { push: true }); else patch({ review: '1' }, { push: true }); return; }
    if (id === 'match') { if (it?.voucher) onOpen(it.voucher.id); else patch({ match: '1', need: '' }, { push: true }); return; }
    if (it?.voucher && !readOnly) {
      if (id === 'remind') {
        const r = remindLink(it.voucher);
        if (r) { window.open(r.href, '_blank', 'noopener,noreferrer'); r.onClick(); return; }
        onOpen(it.voucher.id);
        return;
      }
      if (id === 'extend') { onOpen(it.voucher.id, 'extend'); return; }
    }
    patch({ need: id, match: '' }, { push: true });
  };

  const exportCsv = useCallback(() => {
    csvDownload(`vouchers-${seg || need || 'all'}-${today}.csv`,
      ['Code', 'Type', 'For', 'Phone / note', 'Bought by', 'Sold or free', 'Reason', 'Worth', 'Paid', 'Value left', 'Coupon', 'Status', 'Valid until', 'Given', 'Sold at', 'By'],
      filtered.map((v) => [v.voucherCode, v.voucherTypeName, v.guestName, v.guestInfo || '', v.buyerName || '', v.issueKind === 'free' ? 'Given free' : 'Sold',
        v.issueKind === 'free' ? (v.freeReason || '') : '', valueOf(v), v.amountPaid, isCoupon(v) ? '' : remainingOf(v), isCoupon(v) ? `${v.percentOff}% off` : '',
        STATUS[statusOf(v, today)].label, v.expiryDate, v.issuedDate, v.branchName, v.issuedByName]));
  }, [filtered, seg, need, today]);
  useEffect(() => { if (!review) registerExport({ run: exportCsv, disabled: !vouchers || filtered.length === 0 }); }, [exportCsv, vouchers, filtered.length, registerExport, review]);
  useEffect(() => () => registerExport(null), [registerExport]);

  // ── Sticky + keyboard ────────────────────────────────────────────────────────────────────────────
  const { blockRef, sentinelRef, blockH, stuck, scrollToListTop } = useStickyBlock(stickyTop);
  const listKey = `${seg}|${need}|${matchOnly}|${query}|${sort}|${filters.type}|${filters.kind}|${filters.at}`;
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    if (stuck) scrollToListTop();
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openId || review) return undefined;
    const onKey = (e) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .z-modal-overlay')) return;
      const i = filtered.findIndex((v) => v.id === openId);
      const nxt = i < 0 ? null : filtered[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!nxt) return;
      e.preventDefault();
      onOpen(nxt.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, filtered, onOpen, review]);
  useEffect(() => {
    if (openId) document.querySelector(`tr[data-voucher-id="${openId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [openId]);

  if (review) {
    return (
      <VoucherReview vouchers={all} today={today} stickyTop={stickyTop} onDone={() => patch({ review: '' }, { push: true })}
        onChanged={onChanged} notify={notify} onOpen={onOpen} />
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────────────────────────
  const loading = !vouchers && !error;
  const chipValue = (k) => options[k].find((o) => o.id === filters[k])?.label;
  const chips = (
    <>
      <FilterChip label="Type" value={filters.type} options={options.type} onChange={(v) => patch({ type: v })} selectedLabel={chipValue('type')} />
      <FilterChip label="Sold or free" value={filters.kind} options={options.kind} onChange={(v) => patch({ kind: v })} selectedLabel={chipValue('kind')} />
      <FilterChip label="Sold at" value={filters.at} options={options.at} onChange={(v) => patch({ at: v })} selectedLabel={chipValue('at')} />
      {need && <ClearableChip label={NEED_FILTERS[need].label} onClear={() => patch({ need: '' })} />}
      {matchOnly
        ? <ClearableChip label={MATCH_LABEL} onClear={() => patch({ match: '' })} />
        : matches.size > 0 && (
          <button type="button" onClick={() => patch({ match: '1' }, { push: true })} className="h-7 px-2.5 rounded-full inline-flex items-center gap-[5px] text-[12.5px] font-medium border border-dashed border-[#D3D5D0] text-[#515152] hover:bg-[#FAFAF9]">
            <Icon name="Plus" size={13} />{MATCH_LABEL}
          </button>
        )}
    </>
  );
  const sortMenu = <SortMenu sorts={SORTS} value={sort} onChange={(id) => patch({ sort: id === 'attention' ? '' : id })} />;
  const searchBox = <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search guest, phone or voucher code" ariaLabel="Search vouchers" />;
  const toolbar = isSm
    ? <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">{searchBox}{chips}<div className="ml-auto">{sortMenu}</div></div>
    : <div className="pt-2.5 pb-2">{searchBox}</div>;

  const showFor = isLg;
  const showValid = isMd;
  const showActions = isLg;
  const colCount = 2 + (showFor ? 1 : 0) + (showValid ? 1 : 0) + (isSm ? 1 : 0) + 1;
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const anyFilter = !!(query || filters.type || filters.kind || filters.at || need || matchOnly);
  const clearAll = () => { setSearchText(''); patch({ q: '', type: '', kind: '', at: '', need: '', match: '', seg: '' }, { push: true }); };

  let body = null;
  if (loading) {
    body = Array.from({ length: 7 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = filtered.map((v) => {
      const status = statusOf(v, today);
      const fade = isEnded(status) ? 'opacity-[.55]' : '';
      const selected = v.id === openId;
      const action = showActions ? rowAction(v, status) : null;
      const coupon = isCoupon(v);
      const d = daysUntil(v.expiryDate, today);
      const left = remainingOf(v);
      const match = matches.get(v.id);
      const sub = forSub(v);
      const tag = voucherTag(v);
      let valueNode;
      if (coupon) {
        valueNode = status === 'used'
          ? <><span className="text-[#8A8A90] font-normal">{Number(v.percentOff)}% off</span> <span className="text-[#8A8A90] font-normal">used</span></>
          : <><span className="text-[#4338CA]">{Number(v.percentOff)}% off</span> <span className="text-[#8A8A90] font-normal">one visit</span></>;
      } else if (status === 'usedUp') {
        valueNode = <><span className="text-[#B4B4BA]">NPR 0</span> <span className="text-[#8A8A90] font-normal">fully redeemed</span></>;
      } else {
        const tail = status === 'check' ? 'to check' : status === 'expired' ? 'unused' : Number(v.totalClaimed) > 0 ? `left of ${npr(valueOf(v)).replace('NPR ', '')}` : 'not used yet';
        valueNode = <>{npr(left)} <span className="text-[#8A8A90] font-normal">{tail}</span></>;
      }
      const validMain = status === 'usedUp' ? '—' : status === 'expired' ? `Expired ${shortDate(v.expiryDate, today)}` : longDate(v.expiryDate);
      const reminded = remindedHint(v, today);
      let validSub = null;
      let validTone = 'text-[#8A8A90]';
      if (status === 'usedUp') validSub = v.lastClaimDate ? `Redeemed ${shortDate(v.lastClaimDate, today)}` : null;
      else if (status === 'used') validSub = 'Coupon used';
      else if (status === 'expired') { validSub = coupon ? 'not used' : `${npr(left)} not redeemed`; validTone = 'text-[#991B1B] font-medium'; }
      else {
        validSub = [relativeUntil(v.expiryDate, today), reminded].filter(Boolean).join(' · ');
        if (d != null && d <= EXPIRING_DAYS) validTone = 'text-[#B45309] font-medium';
      }
      return (
        <tr key={v.id} data-voucher-id={v.id} data-status={status} tabIndex={0} aria-selected={selected || undefined}
          onClick={() => onOpen(v.id)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(v.id); }}
          style={{ scrollMarginTop: stickyTop + blockH + 40 }}
          className={`group cursor-pointer focus:outline-none ${selected ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9] focus-visible:bg-[#FAFAF9]'}`}>
          <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${selected ? 'shadow-[inset_3px_0_0_0_#2D5A27]' : ''}`}>
            <div className={`pl-2 min-w-0 ${fade}`}>
              <div className="font-medium text-[13.5px] tracking-[-0.1px] text-text-primary flex items-center gap-1.5 min-w-0">
                <span className="truncate">{v.voucherTypeName}</span>{tag && <KindTag kind={tag} />}
              </div>
              <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">
                <span className="font-data">{v.voucherCode}</span>{!showFor && <> · {v.guestName}</>}
              </div>
            </div>
          </td>
          {showFor && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={`min-w-0 ${fade}`}>
                <div className="text-[13.5px] text-text-primary truncate">{v.guestName}</div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate tabular-nums">
                  {sub}{match && <>{sub ? ' · ' : ''}<span className="text-[#4F46E5] font-medium" data-match>matches a customer</span></>}
                </div>
              </div>
            </td>
          )}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            <div className={`flex flex-col gap-1.5 ${fade}`}>
              <div className="text-[13px] font-semibold text-text-primary tabular-nums whitespace-nowrap truncate" data-value>{valueNode}</div>
              <VoucherMeter v={v} status={status} width={isSm ? 200 : 110} />
            </div>
          </td>
          {showValid && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade}>
                <div className="text-[13px] font-medium text-text-primary tabular-nums whitespace-nowrap">{validMain}</div>
                {validSub && <div className={`text-[12.5px] mt-0.5 whitespace-nowrap truncate ${validTone}`} data-valid-hint>{validSub}</div>}
              </div>
            </td>
          )}
          {isSm && <td className="h-[58px] border-b border-[#F1F1EF] pl-2"><span className={fade}><StatusPill status={status} config={STATUS} /></span></td>}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-1">
            <div className="flex gap-1.5 justify-end items-center text-[#8A8A90]">
              {action && (
                <span className={`${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'} transition-opacity`}>
                  {action.href
                    ? <MiniLink href={action.href} icon={action.icon} data-row-action={action.label} onClick={(e) => { e.stopPropagation(); action.onClick(); }}>{action.label}</MiniLink>
                    : <MiniButton primary={action.label !== 'Check'} data-row-action={action.label} onClick={(e) => { e.stopPropagation(); action.run(); }}>{action.label}</MiniButton>}
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
      <LifecycleStrip segments={segments} stats={stats} selected={seg} loading={loading} ariaLabel="Voucher lifecycle"
        onPick={(id, on) => patch({ seg: on ? '' : id, need: '' }, { push: true })} />
      {!loading && !error && needs.length > 0 && (
        <div className="mt-3 -mb-3"><NeedsYouNow items={needs} active={needActive} onPick={onNeed} quietTail /></div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>{toolbar}</div>
      {!isSm && <div className="flex items-center gap-2 pb-2 flex-wrap">{chips}<div className="ml-auto">{sortMenu}</div></div>}

      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col />
            {showFor && <col style={{ width: '24%' }} />}
            <col style={{ width: isSm ? 224 : 132 }} />
            {showValid && <col style={{ width: 172 }} />}
            {isSm && <col style={{ width: 136 }} />}
            <col style={{ width: showActions ? 120 : 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Voucher</th>
              {showFor && <th scope="col" className={`${th} text-left`} style={thTop}>For</th>}
              <th scope="col" className={`${th} text-left`} style={thTop}>Value left</th>
              {showValid && <th scope="col" className={`${th} text-left`} style={thTop}>Valid until</th>}
              {isSm && <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Status</th>}
              <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (all.length === 0
        ? <EmptyBlock icon="Ticket" title="No vouchers yet" hint={readOnly ? 'Vouchers sold or given away appear here.' : 'Sell or give one with New voucher.'} />
        : <EmptyBlock icon="Ticket" title="No vouchers match" hint={anyFilter ? 'Try a different search or clear a filter.' : `Nothing is in “${segmentById(seg)?.label}” right now.`} action={{ label: 'Clear filters', run: clearAll }} />)}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">{filtered.length} voucher{filtered.length === 1 ? '' : 's'}</div>
      )}
    </div>
  );
};

export default VoucherListPanel;
