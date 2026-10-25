import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import { checkLegacyVoucher, undoLegacyCheck } from '../../../../services/api';
import { isCoupon, valueOf, longDate, shortName, matchesVoucherSearch, forPhone } from '../../../../services/vouchersView';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { friendlyError } from '../../../../utils/friendlyError';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, MiniButton, shortDate, npr, EmptyBlock } from '../Area/listKit';
import { KindTag } from './voucherBits';

// Review mode (V23, `?view=vouchers&review=1`): the one-off check of free vouchers and coupons given before values were kept
// (migration-291 flagged the ones still in date with needs_check). Each row: Already used (closes it with a legacy claim for the
// full value, never counted as redeemed) or Still valid (clears the flag). Both can be undone the same day. Rows checked in this
// visit stay listed so they can be undone; "X of N checked" counts them.
const VoucherReview = ({ vouchers, today, stickyTop, onDone, onChanged, notify, onOpen }) => {
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const [done, setDone] = useState(() => new Map()); // voucherId → 'used' | 'valid' (checked in this visit)
  const [busy, setBusy] = useState(null);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState('');
  const searchRef = useRef(null);
  useSlashFocus(searchRef);
  const { blockRef, sentinelRef, blockH, stuck } = useStickyBlock(stickyTop);

  const rows = useMemo(() => (vouchers || []).filter((v) => v.needsCheck || done.has(v.id)).sort((a, b) => String(a.issuedDate).localeCompare(String(b.issuedDate))), [vouchers, done]);
  const branches = useMemo(() => {
    const m = new Map();
    rows.forEach((v) => v.branchId && m.set(v.branchId, v.branchName));
    return [...m].map(([id, label]) => ({ id, label }));
  }, [rows]);
  const shown = rows.filter((v) => (!at || v.branchId === at) && matchesVoucherSearch(v, query));
  const checked = rows.filter((v) => done.has(v.id)).length;
  const total = rows.length;

  const mark = async (v, used) => {
    setBusy(v.id);
    const { error } = await checkLegacyVoucher({ voucherId: v.id, used });
    setBusy(null);
    if (error) { notify(friendlyError(error, 'Could not save the check.'), 'error'); return; }
    setDone((m) => new Map(m).set(v.id, used ? 'used' : 'valid'));
    onChanged();
  };
  const undo = async (v) => {
    setBusy(v.id);
    const { error } = await undoLegacyCheck({ voucherId: v.id });
    setBusy(null);
    if (error) { notify(friendlyError(error, 'Could not undo the check.'), 'error'); return; }
    setDone((m) => { const n = new Map(m); n.delete(v.id); return n; });
    onChanged();
  };

  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  return (
    <div>
      <div className="mt-4 rounded-[10px] border border-[#C7D2FE] bg-[#EEF2FF]/70 px-4 py-3 flex items-start gap-3 flex-wrap" role="region" aria-label="Check old free vouchers" data-review-banner>
        <Icon name="AlertTriangle" size={16} className="text-[#4338CA] mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-[240px]">
          <p className="text-[13px] font-semibold text-text-primary">Check {total} free voucher{total === 1 ? '' : 's'} given before the update</p>
          <p className="text-[12.5px] text-[#515152] mt-0.5">
            These were saved as worth NPR 0, so the app couldn&apos;t redeem them and staff may have honoured them by hand. They&apos;re still in date.
            Mark each one: <b className="font-semibold">Already used</b> closes it, <b className="font-semibold">Still valid</b> keeps its value so the guest can use it.
          </p>
        </div>
        <div className="w-full sm:w-[160px] flex-shrink-0 sm:text-right">
          <b className="text-[13px] font-semibold tabular-nums" data-review-progress>{checked} of {total} checked</b>
          <div className="h-[5px] rounded-full bg-white mt-1.5 overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} /></div>
        </div>
      </div>

      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>
        <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">
          <SearchBox ref={searchRef} value={query} onChange={setQuery} placeholder="Search guest or voucher code" ariaLabel="Search vouchers to check" />
          {branches.length > 1 && <FilterChip label="Given at" value={at} options={branches} onChange={setAt} selectedLabel={branches.find((b) => b.id === at)?.label} />}
          <button type="button" onClick={onDone} className="ml-auto h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9]" data-done-checking>
            <Icon name="X" size={14} />Done checking
          </button>
        </div>
      </div>

      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col />
          {isMd && <col style={{ width: '20%' }} />}
          <col style={{ width: 104 }} />
          {isMd && <col style={{ width: 150 }} />}
          {isSm && <col style={{ width: 124 }} />}
          <col style={{ width: isSm ? 212 : 132 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Voucher</th>
            {isMd && <th scope="col" className={`${th} text-left`} style={thTop}>For</th>}
            <th scope="col" className={`${th} text-left`} style={thTop}>Worth</th>
            {isMd && <th scope="col" className={`${th} text-left`} style={thTop}>Given</th>}
            {isSm && <th scope="col" className={`${th} text-left`} style={thTop}>Valid until</th>}
            <th scope="col" className={`${th} text-right pr-1.5`} style={thTop}>Was it used?</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => {
            const state = done.get(v.id);
            const coupon = isCoupon(v);
            const phone = forPhone(v);
            return (
              <tr key={v.id} data-review-id={v.id} data-review-state={state || 'open'} className="hover:bg-[#FAFAF9]">
                <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
                  <button type="button" onClick={() => onOpen(v.id)} className={`pl-2 min-w-0 text-left w-full ${state ? 'opacity-[.55]' : ''}`}>
                    <div className="font-medium text-[13.5px] text-text-primary flex items-center gap-1.5 min-w-0"><span className="truncate">{v.voucherTypeName}</span><KindTag kind={coupon ? 'coupon' : 'free'} /></div>
                    <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate"><span className="font-data">{v.voucherCode}</span>{!isMd && <> · {v.guestName}</>}</div>
                  </button>
                </td>
                {isMd && (
                  <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${state ? 'opacity-[.55]' : ''}`}>
                    <div className="text-[13.5px] text-text-primary truncate">{v.guestName}</div>
                    <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate tabular-nums">{phone ? (formatPhoneGrouped(phone) || phone) : (v.guestInfo || '—')}</div>
                  </td>
                )}
                <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] font-semibold tabular-nums whitespace-nowrap">{coupon ? `${Number(v.percentOff)}% off` : npr(valueOf(v))}</td>
                {isMd && (
                  <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
                    <div className="text-[13px] text-text-primary">{shortDate(v.issuedDate, today)}</div>
                    <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{[v.issuedByName && v.issuedByName !== '—' ? shortName(v.issuedByName) : null, v.branchName].filter(Boolean).join(' · ')}</div>
                  </td>
                )}
                {isSm && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] tabular-nums whitespace-nowrap">{longDate(v.expiryDate)}</td>}
                <td className="h-[58px] border-b border-[#F1F1EF] pr-1.5">
                  <div className={`flex justify-end items-center gap-1.5 ${isSm ? 'flex-wrap' : ''}`}>
                    {state ? (
                      <>
                        <span className={`h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${state === 'used' ? 'bg-[#F3F4F6] text-[#4B5563]' : 'bg-[#EEF3EC] text-[#2D5A27]'}`}>
                          <i className="w-1.5 h-1.5 rounded-full" style={{ background: state === 'used' ? '#9CA3AF' : '#3E7A35' }} />{state === 'used' ? 'Marked used' : 'Still valid'}
                        </span>
                        <MiniButton disabled={busy === v.id} onClick={() => undo(v)} data-review-undo>Undo</MiniButton>
                      </>
                    ) : (
                      <>
                        <MiniButton disabled={busy === v.id} onClick={() => mark(v, true)} aria-label="Already used" data-review-used>{isSm ? 'Already used' : 'Used'}</MiniButton>
                        <MiniButton primary disabled={busy === v.id} onClick={() => mark(v, false)} icon={<Icon name="Check" size={13} />} aria-label="Still valid" data-review-valid>{isSm ? 'Still valid' : 'Valid'}</MiniButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyBlock icon="CheckCircle2" title="Nothing left to check" hint="Every old free voucher has been checked." action={{ label: 'Back to vouchers', run: onDone }} />}
      {rows.length > 0 && shown.length === 0 && <EmptyBlock icon="Ticket" title="No vouchers match" hint="Try a different search." action={{ label: 'Clear', run: () => { setQuery(''); setAt(''); } }} />}
      <p className="text-[12.5px] text-[#8A8A90] mt-4 leading-relaxed">
        &quot;Already used&quot; closes the voucher with a redemption for its full value, dated today and labelled &quot;used before the app tracked it&quot;.
        It doesn&apos;t touch cash or the daily closing. Both choices can be undone the same day and are saved in the voucher&apos;s history.
      </p>
    </div>
  );
};

export default VoucherReview;
