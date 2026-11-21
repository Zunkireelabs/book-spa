import { friendlyError } from '../../utils/friendlyError';
import React, { useState } from 'react';
import { closePastBooking } from '../../services/api';
import { shortDate } from '../../utils/customerDirectory';

// Quiet amber row for past bookings that were never closed (still Pending/Confirmed), plus visits left In-Progress from an earlier day.
// "Mark completed" and "Mark no-show" go through the normal status path, so locks, roles and the no-show reason rule all apply.
// Hidden actions for read-only users; closed days say "Closed day: can't be changed".
const UnclosedNudge = ({ unclosed = [], stale = [], readOnly, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState('');
  const items = [...unclosed, ...stale.map((x) => ({ ...x, stale: true }))];
  if (!items.length) return null;
  const first = items[0];
  const more = items.length - 1;

  const run = async (outcome, why) => {
    setBusy(true); setError(null);
    const { error: err } = await closePastBooking({ bookingId: first.id, outcome, reason: why });
    setBusy(false);
    if (err) {
      setError(friendlyError(err, 'Could not update this booking.'));
      if (err.code === 'PARTIAL') onChanged?.(); // the booking is mid-way: refresh so the panel shows its real state
      return;
    }
    setAskReason(false); setReason('');
    onChanged?.();
  };

  return (
    <div role="group" aria-label="Past visit not closed" className="border border-[#F5D9A8] bg-[#FFFAF0] rounded-lg px-3.5 py-3 text-[13px]">
      <p className="text-[#7A4A06]">
        <span className="font-medium">{first.stale ? 'Visit still in progress' : items.length === 1 ? '1 past visit isn’t closed' : `${items.length} past visits aren’t closed`}</span>
        <span className="text-[#8A6A2E]"> · {first.stale ? `since ${shortDate(first.date)} · ${first.service}` : `${shortDate(first.date)} ${first.service} (${first.status})`}</span>
        {more > 0 && <span className="text-[#8A6A2E]"> · +{more} more</span>}
      </p>
      {first.isLocked && <p className="mt-1 text-[12.5px] text-[#8A6A2E]">Closed day: can’t be changed.</p>}
      {!readOnly && !first.isLocked && !askReason && (
        <div className="flex gap-2 mt-2">
          <button type="button" disabled={busy} onClick={() => run('completed')} className="h-7 px-2.5 rounded-md border border-[#E8C98C] bg-white text-[12.5px] font-medium disabled:opacity-60 hover:bg-[#FFF5E0]">Mark completed</button>
          {!first.stale && <button type="button" disabled={busy} onClick={() => setAskReason(true)} className="h-7 px-2.5 rounded-md border border-[#E8C98C] bg-white text-[12.5px] font-medium disabled:opacity-60 hover:bg-[#FFF5E0]">Mark no-show</button>}
        </div>
      )}
      {!readOnly && !first.isLocked && askReason && (
        <div className="mt-2 flex gap-2 items-center">
          <input aria-label="No-show reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="h-7 flex-1 min-w-0 border border-[#E8C98C] rounded-md px-2 text-[12.5px] bg-white" />
          <button type="button" disabled={busy || !reason.trim()} onClick={() => run('no_show', reason.trim())} className="h-7 px-2.5 rounded-md bg-[#0E0D0C] text-white text-[12.5px] font-medium disabled:opacity-50">Confirm</button>
          <button type="button" onClick={() => setAskReason(false)} className="text-[12.5px] text-[#8A6A2E]">Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-[#B42318]">{error}</p>}
    </div>
  );
};

export default UnclosedNudge;
