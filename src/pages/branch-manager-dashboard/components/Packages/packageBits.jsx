import React from 'react';
import { DISPLAY_STATUS } from '../../../../services/packagesView';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { StatusPill as BaseStatusPill } from '../Area/listKit';

// Package-only row bits (V20). The generic ones (dates, avatar, buttons, CSV) live in Area/listKit and are re-exported here.
export { longDate, shortDate, tileDate, npr, initialsOf, Avatar, MiniButton, csvDownload, relativeUntil, timeLeft } from '../Area/listKit';

export const phoneOf = (p) => p.customerPhone || (/\d{6,}/.test(String(p.guestInfo || '').replace(/\D/g, '')) ? p.guestInfo : '') || '';
export const phoneLabel = (p) => { const raw = phoneOf(p); return raw ? (formatPhoneGrouped(raw) || raw) : ''; };

export const StatusPill = ({ status }) => <BaseStatusPill status={status} config={DISPLAY_STATUS} />;

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
