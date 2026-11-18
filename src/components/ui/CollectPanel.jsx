import React, { useMemo, useState } from 'react';
import PaymentModal from './PaymentModal';
import { PanelShell, FormBody, InfoRows } from './PanelFormKit';
import { submitCheckout } from '../../services/checkoutSubmit';
import { recordPayment, recordTip, recordBundledAllocations } from '../../services/api';
import { shortDate } from '../../utils/customerDirectory';

// The ONE "collect what a customer owes" flow. Used by the Customers side panel and the customer page, so the
// amount, the closed-day line, the submit path and the success/error text can never drift between them.
// Only owed visits that already happened are listed (the customer's `owed` rows); the payment window opens next.

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;

// ZNLY-234: closed-day balances are collectable too, so nothing is locked out today. Kept as one shared
// definition so the amount on the button and the closed-day line stay in step wherever they render.
export const COLLECT_LOCKED_DUE = 0;
export const collectableAmount = (balance, lockedDue = COLLECT_LOCKED_DUE) => Math.round(((balance || 0) - lockedDue) * 100) / 100;

export const ClosedDayNote = ({ lockedDue = COLLECT_LOCKED_DUE }) => (
  lockedDue > 0 ? <p className="mt-2 text-[12.5px] text-[#8A6A2E]">{npr(lockedDue)} on closed days can’t be collected here.</p> : null
);

const CollectPanel = ({ customer, owed, branchId, onBack, onClose, onNotice, onChanged }) => {
  const [ticked, setTicked] = useState(() => new Set((owed || []).map((o) => o.bookingId)));
  const [paying, setPaying] = useState(null); // { primary, others }
  const [paySubmitting, setPaySubmitting] = useState(false);
  const chosen = useMemo(() => (owed || []).filter((o) => ticked.has(o.bookingId)), [owed, ticked]);
  const chosenTotal = Math.round(chosen.reduce((s, o) => s + o.amountDue, 0) * 100) / 100;

  // ZNLY-233: every checkout goes through the one shared submit, so products on the bill are saved (never dropped); no products => the treatment-only path below.
  const handleRecordPayment = (payload) => submitCheckout({ bookingId: paying?.primary?.bookingId, payload, treatment: recordTreatmentOnly, onSaved: () => { onNotice?.(`Payment recorded for ${customer.fullName}.`); onChanged?.(); } });
  const recordTreatmentOnly = async ({ tenders, additionalAllocations, dueHolderName, notes, tipSplits }) => {
    setPaySubmitting(true);
    const result = await recordPayment({ bookingId: paying.primary.bookingId, tenders, dueHolderName, notes });
    if (result.error) { setPaySubmitting(false); return { error: result.error }; }
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId: paying.primary.bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }
    // Every bundled booking is its own payment: check each one and name any that was NOT recorded (never swallow a failure).
    const failures = await recordBundledAllocations({ allocations: additionalAllocations, notes, bookings: paying.others });
    const primaryNumber = paying.primary.bookingNumber;
    setPaySubmitting(false);
    // Checkout stays open on its success state; onClose (Done) returns to the caller's main view.
    onNotice?.(failures.length ? `Payment recorded for ${primaryNumber}, but NOT recorded for: ${failures.join('; ')}. Those bookings still show as owed.` : `Payment recorded for ${customer.fullName}.`);
    onChanged?.();
    return { error: null };
  };

  return (
    <>
      <PanelShell
        variant="panel" width="460px" title={`Collect from ${customer.fullName}`} onClose={onClose} onBack={onBack}
        reason={chosen.length === 0 ? 'Tick at least one visit' : ''}
        primary={{ label: chosen.length ? `Collect ${npr(chosenTotal)}` : 'Collect', disabled: chosen.length === 0, onClick: () => setPaying({ primary: chosen[0], others: chosen.slice(1) }) }}
      >
        <FormBody>
          <p className="text-[13px] text-text-secondary">Unpaid visits that have already happened. Untick any you are not collecting now; the payment window opens next.</p>
          <ul className="border border-border rounded-spa divide-y divide-border">
            {(owed || []).map((o) => (
              <li key={o.bookingId}>
                <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-background">
                  <input type="checkbox" className="w-4 h-4 rounded text-primary" checked={ticked.has(o.bookingId)}
                    onChange={(e) => setTicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(o.bookingId); else n.delete(o.bookingId); return n; })} />
                  <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{shortDate(o.date)}</span><span className="text-[#515152]"> · {o.serviceName}</span></span>
                  <span className="text-[13px] tabular-nums font-medium">{npr(o.amountDue)}</span>
                </label>
              </li>
            ))}
          </ul>
          <InfoRows rows={[['Selected', `${chosen.length} of ${(owed || []).length} visit${(owed || []).length === 1 ? '' : 's'}`], ['To collect', npr(chosenTotal), 'total']]} />
        </FormBody>
      </PanelShell>
      {paying && (
        <PaymentModal
          booking={{
            bookingId: paying.primary.bookingId, booking_number: paying.primary.bookingNumber, branchId: paying.primary.branchId || branchId,
            finalAmount: paying.primary.finalAmount, amountPaid: paying.primary.amountPaid, service: paying.primary.serviceName, dueHolderName: '',
          }}
          additionalBookings={paying.others}
          onConfirm={handleRecordPayment}
          savesProducts
          onClose={(res) => { if (paySubmitting) return; setPaying(null); if (res?.paid) onBack?.(); }}
          isSubmitting={paySubmitting}
        />
      )}
    </>
  );
};

export default CollectPanel;
