import React from 'react';
import { DISPLAY_STATUS, daysUntil } from '../../../../services/packagesView';
import { formatPhoneGrouped } from '../../../../utils/phone';

// Small pieces shared by the Packages page's list, types tab and detail panel (V20).

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (iso) => String(iso).slice(0, 10).split('-').map(Number);
/** "3 Nov 2026" */
export const longDate = (iso) => { if (!iso) return '—'; const [y, m, d] = ymd(iso); return `${d} ${MON[m - 1]} ${y}`; };
/** "2 Oct" this year, "2 Oct 2025" otherwise. */
export const shortDate = (iso, today) => { if (!iso) return '—'; const [y, m, d] = ymd(iso); return `${d} ${MON[m - 1]}${String(y) !== String(today).slice(0, 4) ? ` ${y}` : ''}`; };
export const tileDate = (iso) => { const [, m, d] = ymd(iso); return { day: d, mon: MON[m - 1] }; };

/** "in 15 days" / "in 6 months" / "today" (future), or null when past / no date. */
export function relativeUntil(iso, today) {
  const d = daysUntil(iso, today);
  if (d == null || d < 0) return null;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 90) return `in ${d} days`;
  return `in ${Math.round(d / 30.44)} months`;
}
/** "15 days left" / "6 months left" / "Ends today". */
export function timeLeft(iso, today) {
  const d = daysUntil(iso, today);
  if (d == null || d < 0) return null;
  if (d === 0) return 'Ends today';
  if (d === 1) return '1 day left';
  if (d < 90) return `${d} days left`;
  return `${Math.round(d / 30.44)} months left`;
}

export const npr = (n) => `NPR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
export const phoneOf = (p) => p.customerPhone || (/\d{6,}/.test(String(p.guestInfo || '').replace(/\D/g, '')) ? p.guestInfo : '') || '';
export const phoneLabel = (p) => { const raw = phoneOf(p); return raw ? (formatPhoneGrouped(raw) || raw) : ''; };
export const initialsOf = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

export const Avatar = ({ name, size = 32 }) => (
  <div className="rounded-full bg-[#F1F1EF] text-[#4A4A4F] font-semibold grid place-items-center flex-shrink-0" style={{ width: size, height: size, fontSize: size >= 40 ? 15 : 11.5 }}>
    {initialsOf(name)}
  </div>
);

export const StatusPill = ({ status }) => {
  const s = DISPLAY_STATUS[status] || DISPLAY_STATUS.active;
  return (
    <span className={`h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${s.pill}`}>
      <i className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />{s.label}
    </span>
  );
};

// Tick meter: one tick per session (used = grey, left = green, the last one gold), or one continuous bar past 12 sessions.
const TICK = { used: '#E4E4E1', left: '#6E9A66', last: '#E7B93E' };
export const SessionMeter = ({ total, remaining, status, width = 150 }) => {
  const n = Math.max(0, Number(total) || 0);
  const left = Math.max(0, Math.min(n, Number(remaining) || 0));
  const done = status === 'usedUp' || status === 'expired';
  const leftColor = status === 'lastSession' ? TICK.last : TICK.left;
  if (n === 0) return null;
  if (n > 12) {
    return (
      <div className="h-[5px] rounded-sm overflow-hidden" style={{ width, background: TICK.used }} aria-hidden="true">
        {!done && <div className="h-full rounded-sm ml-auto" style={{ width: `${(left / n) * 100}%`, background: leftColor }} />}
      </div>
    );
  }
  return (
    <div className="flex gap-[3px]" style={{ width }} aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <i key={i} className="flex-1 h-[5px] rounded-[2px]" style={{ background: !done && i >= n - left ? leftColor : TICK.used }} />
      ))}
    </div>
  );
};

// The small bordered row button ("Remind", "Renew", "Book session", "Sell").
export const MiniButton = ({ children, primary = false, icon = null, ...props }) => (
  <button type="button" {...props}
    className={`h-[26px] px-[9px] rounded-md border bg-white text-[12px] font-medium inline-flex items-center gap-[5px] whitespace-nowrap hover:bg-[#FAFAF9] ${primary ? 'text-primary border-[#CFDCCC]' : 'text-text-primary border-border'}`}>
    {icon}{children}
  </button>
);

export const csvDownload = (name, head, rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
