import React, { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { visitRemoveService } from '../../services/visitApi';
import { friendlyError } from '../../utils/friendlyError';

// ZNLY-402 piece 5 (screen D / U12): remove ONE service of a booking. The dry run decides which of the three dialogs shows:
//   verdict 'change' -> "Remove X?" with the new total and a reason;  'last' -> offer to cancel the whole booking;  anything else -> why it cannot be removed.
const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;

const RemoveServiceFlow = ({ row, newTotal, canViewPrices = true, reasonOptions, onClose, onDone, onCancelWhole }) => {
  const [verdict, setVerdict] = useState(null); // { verdict, reason }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    visitRemoveService({ bookingId: row.id, dryRun: true }).then(({ data, error: e }) => {
      if (off) return;
      // The server answers a refusal as an error with the per-row verdict: LAST_SERVICE = the only live service (offer to cancel the booking).
      if (e) {
        if (e.code === 'LAST_SERVICE' || (e.rows || []).some((x) => x.verdict === 'last')) { setVerdict({ verdict: 'last', reason: e.message }); return; }
        setVerdict({ verdict: 'block', reason: e.rows?.[0]?.reason || friendlyError(e, `${row.name} can't be removed right now.`) });
        return;
      }
      const r = (data?.rows || []).find((x) => x.booking_id === row.id) || data?.rows?.[0] || {};
      setVerdict({ verdict: data?.verdict || r.verdict || 'change', reason: r.reason || '' });
    });
    return () => { off = true; };
  }, [row.id, row.name]);
  if (!verdict) return null;

  if (verdict.verdict === 'last') {
    return (
      <ConfirmDialog title="Remove this service?" message="This is the only service. Cancel the whole booking instead?"
        requireReason={false} confirmLabel="Cancel booking" onClose={onClose} onConfirm={() => { onClose(); onCancelWhole?.(); }} />
    );
  }
  if (verdict.verdict !== 'change') {
    return (
      <ConfirmDialog title={`Can't remove ${row.name}`}
        message={verdict.reason || `${row.name} has already started, so it can't be removed.`}
        requireReason={false} confirmLabel="OK" confirmVariant="primary" hideBack onClose={onClose} onConfirm={onClose} />
    );
  }
  return (
    <ConfirmDialog
      title={`Remove ${row.name}?`}
      message={canViewPrices ? `${npr(row.final)} comes off the total. The new total is ${npr(newTotal)}.` : 'This service comes off the booking.'}
      confirmLabel="Remove"
      reasonOptions={reasonOptions}
      isSubmitting={busy}
      error={error}
      onClose={onClose}
      onConfirm={async (reason) => {
        setBusy(true); setError(null);
        const { error: e } = await visitRemoveService({ bookingId: row.id, reason });
        setBusy(false);
        if (e) { setError(friendlyError(e, 'Nothing was changed. Try again.')); return; }
        onDone();
      }}
    />
  );
};

export default RemoveServiceFlow;
