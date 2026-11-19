import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { isCoupon, remainingOf, valueOf, npr } from '../../../../services/vouchersView';

// Voucher-only bits (V23), next to the shared list kit in Area/listKit.

/** FREE (pink) / % OFF (indigo) / USUALLY FREE tag after a voucher or type name. */
export const KindTag = ({ kind, className = '' }) => {
  const label = { free: 'FREE', coupon: '% OFF', usuallyFree: 'USUALLY FREE', givenFree: 'GIVEN FREE' }[kind];
  if (!label) return null;
  const tone = kind === 'coupon' ? 'bg-[#EEF2FF] text-[#4338CA]' : 'bg-[#FDF2F8] text-[#BE185D]';
  return <span className={`h-[18px] rounded-[5px] px-1.5 text-[10.5px] font-semibold tracking-[.02em] inline-flex items-center whitespace-nowrap flex-shrink-0 ${tone} ${className}`} data-kind-tag={kind}>{label}</span>;
};
export const voucherTag = (v) => (isCoupon(v) ? 'coupon' : v.issueKind === 'free' ? 'free' : null);

/** Value-left meter: green; amber while expiring; striped blue while it needs a check; pale when expired. No meter for coupons. */
export const VoucherMeter = ({ v, status, width }) => {
  if (isCoupon(v)) return null;
  const value = valueOf(v);
  const share = value > 0 ? Math.min(1, remainingOf(v) / value) : 0;
  const fill = status === 'check'
    ? { backgroundImage: 'repeating-linear-gradient(45deg,#93C5FD 0 4px,#BFDBFE 4px 8px)' }
    : { background: status === 'soon' ? '#E7B93E' : status === 'expired' ? '#9DBF96' : '#6E9A66' };
  return (
    <div className="h-[5px] rounded-full bg-[#E4E4E1] overflow-hidden" style={{ width }} aria-hidden="true">
      {share > 0 && <div className="h-full rounded-full" style={{ width: `${status === 'check' ? 100 : Math.max(share * 100, 3)}%`, ...fill }} />}
    </div>
  );
};

/** Copy-to-clipboard button showing "Copied" for a moment. */
export const useCopy = () => {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
};

/**
 * The voucher as a paper ticket: type, code (copy), the big value left (or "25% off"), a sub-line, the meter, a perforation and a
 * footer line (left / right with a tone). A FREE ribbon for free vouchers.
 */
export const TicketCard = ({ v, sub, left, right, rightTone = '' }) => {
  const { copied, copy } = useCopy();
  const coupon = isCoupon(v);
  const value = valueOf(v);
  const share = value > 0 ? Math.min(1, remainingOf(v) / value) : 0;
  return (
    <div className="relative rounded-[14px] pt-[18px] pb-4 px-5 border border-[#EBDDB6] overflow-hidden tabular-nums" style={{ background: 'linear-gradient(135deg,#FFFDF7 0%,#FBF3DF 100%)' }} data-ticket>
      {v.issueKind === 'free' && (
        <span className="absolute top-[14px] -right-[34px] rotate-45 bg-[#BE185D] text-white text-[10px] font-semibold tracking-[.12em] w-[120px] text-center py-[3px] shadow-sm" data-free-ribbon>FREE</span>
      )}
      <div className={`flex justify-between items-center gap-3 text-[11px] tracking-[.08em] uppercase text-[#9A6B0B] font-semibold ${v.issueKind === 'free' ? 'pr-10' : ''}`}>
        <span className="truncate">{v.voucherTypeName}</span>
        <button type="button" onClick={() => copy(v.voucherCode)} className="inline-flex items-center gap-1.5 font-data tracking-[.06em] normal-case text-[#6B5413] hover:text-text-primary flex-shrink-0" aria-label="Copy voucher code" title={copied ? 'Copied' : 'Copy code'}>
          {v.voucherCode}<Icon name={copied ? 'Check' : 'Copy'} size={12} />
        </button>
      </div>
      <p className="text-[28px] font-semibold tracking-[-0.8px] mt-3 text-text-primary" data-ticket-value>{coupon ? `${Number(v.percentOff)}% off` : npr(remainingOf(v))}</p>
      <p className="text-[12.5px] text-[#7A6A45] mt-0.5">{sub}</p>
      {!coupon && (
        <div className="h-[5px] rounded-full bg-[#EFE3C2] mt-3 overflow-hidden"><div className="h-full rounded-full bg-[#C9971C]" style={{ width: `${share * 100}%` }} /></div>
      )}
      <div className="relative border-t border-dashed border-[#E2CF9C] mt-3.5 -mx-5">
        <span className="absolute -left-[9px] -top-[9px] w-[18px] h-[18px] rounded-full bg-white border border-[#EBDDB6]" />
        <span className="absolute -right-[9px] -top-[9px] w-[18px] h-[18px] rounded-full bg-white border border-[#EBDDB6]" />
      </div>
      <div className="flex justify-between gap-3 mt-3 text-[12px] text-[#7A6A45]">
        <span className="truncate">{left}</span>
        <span className={`whitespace-nowrap ${rightTone === 'red' ? 'text-[#991B1B] font-semibold' : rightTone === 'amber' ? 'text-[#B45309] font-semibold' : ''}`} data-ticket-valid>{right}</span>
      </div>
    </div>
  );
};
