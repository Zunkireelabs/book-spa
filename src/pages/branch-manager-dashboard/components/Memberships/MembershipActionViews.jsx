import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import {
  PanelShell, FormBody, Field, SelectField, Segmented, DateField, MoneyInput, InfoRows, InlineError, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { buildPaymentMethodTree } from '../../../../services/paymentMethods';
import {
  topUpMembership, renewMembership, extendMembership, adjustMembership, giftBirthdayPerk, fetchMembershipTiers, MEMBERSHIP_DEPOSIT_MODES,
} from '../../../../services/api';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';

// The membership actions as stacked sub-views of the detail panel. Each one keeps the logic of the modal it replaces and the same
// props: `membership`, `branchId`, `onBack()` (also the back arrow, through the dirty guard), `onClose()` (×) and `onDone(message)`.
const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const longDate = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const plusDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return toDateInputValue(d); };

function firstLeafValue(tree) {
  for (const item of tree) {
    if (!item.subMethods || item.subMethods.length === 0) return item.value;
    return item.subMethods[0].value;
  }
  return undefined;
}

// Shared frame: panel shell + body + the ⌘/Ctrl+Enter shortcut + autofocus of the first field.
const ActionFrame = ({ title, icon, onBack, onClose, dirty, busy, reason, primary, onSubmit, focusId, serverError, children }) => {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!focusId) return undefined;
    const t = setTimeout(() => document.getElementById(focusId)?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [focusId]);
  return (
    <PanelShell variant="panel" title={title} onBack={onBack} onClose={onClose} dirty={dirty} busy={busy} reason={reason} primary={primary}>
      <FormBody>
        <InlineError message={serverError} />
        {children}
      </FormBody>
    </PanelShell>
  );
};

const NotesField = ({ value, onChange, show, setShow, required, placeholder = 'Optional' }) => (
  show || required ? (
    <Field label="Notes" required={required} id="mem-notes">
      <textarea
        id="mem-notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
      />
    </Field>
  ) : (
    <button type="button" onClick={() => setShow(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add note</button>
  )
);

// Submit helper: guards double-submits and turns errors into friendly copy.
const useAction = (run, onDone) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);
  const submit = async (fallback) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await run();
    busyRef.current = false;
    setBusy(false);
    if (result.error) { setError(friendlyError(result.error, fallback)); return; }
    onDone(result.message);
  };
  return { busy, error, setError, submit };
};

// ── Top up ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TopUpView = ({ membership, branchId, onBack, onClose, onDone }) => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [backdatedAt, setBackdatedAt] = useState('');
  const [showBackdate, setShowBackdate] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const today = toDateInputValue(new Date());

  const amountNum = Number(amount) || 0;
  const advance = membership.tierAdvanceAmount || 0;
  const deposited = membership.totalDeposited || 0;
  const pending = membership.status === 'pending';
  const willActivate = pending && deposited + amountNum >= advance;
  const remaining = Math.max(0, advance - deposited - amountNum);

  const { busy, error, submit } = useAction(async () => {
    const { error: rpcError } = await topUpMembership({
      membershipId: membership.id, amount: amountNum, paymentMode, notes: notes.trim() || null, branchId, backdatedAt: (isAdmin && backdatedAt) || null,
    });
    return { error: rpcError, message: pending && willActivate ? `Top up recorded — ${membership.customerName}'s membership is now active.` : `Top up recorded: ${formatNPR(amountNum)} added.` };
  }, onDone);

  const reason = amountNum > 0 ? '' : 'Enter the amount';
  const onSubmit = () => {
    if (reason) return;
    submit('Failed to record the top up.');
  };

  const rows = [['Balance', `${formatNPR(membership.balance)} → ${formatNPR(membership.balance + amountNum)}`, 'total']];
  if (pending) rows.unshift(['Deposited', `${formatNPR(deposited)} → ${formatNPR(deposited + amountNum)} of ${formatNPR(advance)}`]);

  return (
    <ActionFrame
      title="Top up" onBack={onBack} onClose={onClose} dirty={!!(amount || notes || backdatedAt)} busy={busy} reason={reason} onSubmit={onSubmit}
      focusId="mem-amount" serverError={error || fieldError}
      primary={{ label: busy ? 'Recording…' : (amountNum > 0 ? `Top up · ${formatNPR(amountNum)}` : 'Top up'), onClick: onSubmit, disabled: !!reason, loading: busy }}
    >
      <Field label="Amount" required id="mem-amount">
        <MoneyInput {...controlA11y('mem-amount')} value={amount} onChange={(v) => { setAmount(v); setFieldError(null); }} />
      </Field>
      <Field label="Payment mode" required>
        <SelectField value={paymentMode} onChange={setPaymentMode} options={MEMBERSHIP_DEPOSIT_MODES.map((m) => ({ value: m, label: m }))} />
      </Field>
      {isAdmin && (showBackdate ? (
        <DateField label="Backdate" value={backdatedAt || today} max={today} onChange={setBackdatedAt} hint="Admin only. Records the top up on an earlier date." />
      ) : (
        <button type="button" onClick={() => setShowBackdate(true)} className="block text-[13px] font-body-medium text-primary hover:underline">Backdate</button>
      ))}
      <NotesField value={notes} onChange={setNotes} show={showNotes} setShow={setShowNotes} />
      <InfoRows rows={rows} />
      {pending && amountNum > 0 && (
        willActivate ? (
          <p className="flex items-start gap-2 text-[13px] text-success" aria-live="polite"><Icon name="Check" size={14} className="mt-0.5 flex-shrink-0" /><span>This top up activates the membership</span></p>
        ) : (
          <p className="flex items-start gap-2 text-[13px] text-warning" aria-live="polite"><Icon name="Clock" size={14} className="mt-0.5 flex-shrink-0" /><span>Still pending — {formatNPR(remaining)} more to activate</span></p>
        )
      )}
    </ActionFrame>
  );
};

// ── Renew ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RenewView = ({ membership, branchId, onBack, onClose, onDone }) => {
  const { profile } = useAuth();
  const { paymentMethods } = useOrg();
  const orgId = profile?.org_id;
  const paymentTree = useMemo(() => buildPaymentMethodTree(paymentMethods), [paymentMethods]);
  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState(membership.tierId || '');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState(() => firstLeafValue(paymentTree));
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => { const { data } = await fetchMembershipTiers(orgId); if (!cancelled && data) setTiers(data); })();
    return () => { cancelled = true; };
  }, [orgId]);

  const amountNum = Number(amount) || 0;
  const tier = tiers.find((t) => t.id === tierId) || null;
  const tierChanged = !!tierId && tierId !== membership.tierId;
  const today = toDateInputValue(new Date());
  const validUntil = tier ? plusDays(today, tier.validity_days) : null;

  const { busy, error, submit } = useAction(async () => {
    const { error: rpcError } = await renewMembership({
      membershipId: membership.id, amount: amountNum, paymentMode, tierId: tierChanged ? tierId : null, notes: notes.trim() || null, branchId,
    });
    return { error: rpcError, message: `Membership renewed${tierChanged && tier ? ` on ${tier.name}` : ''}: ${formatNPR(amountNum)} deposited.` };
  }, onDone);

  const reason = amountNum > 0 ? '' : 'Enter the renewal amount';
  const onSubmit = () => { if (!reason) submit('Failed to renew the membership.'); };
  const rows = [];
  if (tierChanged && tier) rows.push(['Plan', `${membership.tierName} → ${tier.name}`]);
  if (validUntil) rows.push(['Valid until', `${longDate(membership.expiryDate)} → ${longDate(validUntil)}`]);
  rows.push(['Balance', `${formatNPR(membership.balance)} → ${formatNPR(membership.balance + amountNum)}`, 'total']);

  return (
    <ActionFrame
      title="Renew membership" onBack={onBack} onClose={onClose} dirty={!!(amount || notes || tierChanged)} busy={busy} reason={reason} onSubmit={onSubmit}
      focusId="mem-amount" serverError={error}
      primary={{ label: busy ? 'Renewing…' : (amountNum > 0 ? `Renew · ${formatNPR(amountNum)}` : 'Renew'), onClick: onSubmit, disabled: !!reason, loading: busy }}
    >
      <p className="text-[13px] text-text-secondary">The wallet is empty. Renewing starts a fresh cycle from today on this same card; the history stays.</p>
      <Field label="Plan" required>
        <SelectField value={tierId} onChange={setTierId} options={tiers.map((t) => ({ value: t.id, label: `${t.name} — ${formatNPR(t.advance_amount)} advance` }))} placeholder="Select a plan" />
      </Field>
      <Field label="Renewal amount" required id="mem-amount">
        <MoneyInput {...controlA11y('mem-amount')} value={amount} onChange={setAmount} />
      </Field>
      <Field label="Payment method" required>
        <PaymentMethodSelector value={paymentMode} onChange={setPaymentMode} paymentMethods={paymentMethods} />
      </Field>
      <NotesField value={notes} onChange={setNotes} show={showNotes} setShow={setShowNotes} />
      <InfoRows rows={rows} />
    </ActionFrame>
  );
};

// ── Extend (lapsed with balance: no payment) ────────────────────────────────────────────────────────────────────────────────────
export const ExtendView = ({ membership, branchId, onBack, onClose, onDone }) => {
  const today = toDateInputValue(new Date()); // Nepal date
  const tomorrow = plusDays(today, 1);
  const suggested = plusDays(today, Number(membership.tierValidityDays) > 0 ? Number(membership.tierValidityDays) : 365);
  const [newExpiry, setNewExpiry] = useState(suggested);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [expiryError, setExpiryError] = useState(null);

  const { busy, error, submit } = useAction(async () => {
    const { error: rpcError } = await extendMembership({ membershipId: membership.id, newExpiryDate: newExpiry, notes: notes.trim() || null, branchId });
    return { error: rpcError, message: `Membership extended to ${longDate(newExpiry)}.` };
  }, onDone);

  const onSubmit = () => {
    if (!newExpiry || newExpiry <= today) { setExpiryError('The new expiry date must be after today.'); document.getElementById('mem-expiry')?.focus({ preventScroll: true }); return; }
    submit('Failed to extend the membership.');
  };

  return (
    <ActionFrame
      title="Extend membership" onBack={onBack} onClose={onClose} dirty={!!notes || newExpiry !== suggested} busy={busy} reason="" onSubmit={onSubmit}
      focusId="mem-expiry" serverError={error}
      primary={{ label: busy ? 'Extending…' : 'Extend', onClick: onSubmit, disabled: false, loading: busy }}
    >
      <p className="text-[13px] text-text-secondary">This membership has lapsed, but the balance is still available. Extend the validity to keep using it; no new payment is needed.</p>
      <DateField label="New expiry date" required id="mem-expiry" value={newExpiry} min={tomorrow} error={expiryError} onChange={(d) => { setNewExpiry(d); setExpiryError(null); }} />
      <NotesField value={notes} onChange={setNotes} show={showNotes} setShow={setShowNotes} />
      <InfoRows rows={[['Valid until', `${longDate(membership.expiryDate)} → ${longDate(newExpiry)}`], ['Balance', `${formatNPR(membership.balance)} (unchanged)`]]} />
    </ActionFrame>
  );
};

// ── Adjust (admin) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AdjustView = ({ membership, branchId, onBack, onClose, onDone }) => {
  const today = toDateInputValue(new Date());
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [backdatedAt, setBackdatedAt] = useState('');
  const [showBackdate, setShowBackdate] = useState(false);

  const amountNum = Number(amount) || 0;
  const signed = direction === 'credit' ? amountNum : -amountNum;
  const balance = Number(membership.balance || 0);
  const tooBig = direction === 'debit' && amountNum > balance;

  const { busy, error, submit } = useAction(async () => {
    const { error: rpcError } = await adjustMembership({ membershipId: membership.id, amount: signed, notes: notes.trim(), branchId, backdatedAt: backdatedAt || null });
    return { error: rpcError, message: `${direction === 'credit' ? 'Added' : 'Deducted'} ${formatNPR(amountNum)} (adjustment recorded).` };
  }, onDone);

  const reason = !(amountNum > 0) ? 'Enter the amount' : tooBig ? `Only ${formatNPR(balance)} available to deduct` : !notes.trim() ? 'Enter the reason' : '';
  const onSubmit = () => { if (!reason) submit('Failed to record the adjustment.'); };

  return (
    <ActionFrame
      title="Adjust balance" onBack={onBack} onClose={onClose} dirty={!!(amount || notes || backdatedAt)} busy={busy} reason={reason} onSubmit={onSubmit}
      focusId="mem-amount" serverError={error}
      primary={{ label: busy ? 'Saving…' : (amountNum > 0 ? `${direction === 'credit' ? 'Add' : 'Deduct'} ${formatNPR(amountNum)}` : 'Adjust'), onClick: onSubmit, disabled: !!reason, loading: busy }}
    >
      <p className="text-[13px] text-text-secondary">A manual correction. It is recorded in the ledger with your name and the reason below.</p>
      <Field label="Change">
        <Segmented options={[['credit', 'Add'], ['debit', 'Deduct']]} value={direction} onChange={setDirection} />
      </Field>
      <Field label="Amount" required id="mem-amount">
        <MoneyInput {...controlA11y('mem-amount')} value={amount} onChange={setAmount} />
      </Field>
      <Field label="Reason" required id="mem-notes">
        <textarea
          id="mem-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Why is this adjustment being made?"
          className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
        />
      </Field>
      {showBackdate ? (
        <DateField label="Backdate" value={backdatedAt || today} max={today} onChange={setBackdatedAt} hint="Admin only. Records the adjustment on an earlier date." />
      ) : (
        <button type="button" onClick={() => setShowBackdate(true)} className="block text-[13px] font-body-medium text-primary hover:underline">Backdate</button>
      )}
      <InfoRows rows={[['Balance', `${formatNPR(balance)} → ${formatNPR(balance + signed)}`, tooBig ? 'error' : 'total']]} />
    </ActionFrame>
  );
};

// ── Birthday perk ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const BirthdayView = ({ membership, branchId, onBack, onClose, onDone }) => {
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const { busy, error, submit } = useAction(async () => {
    const { error: rpcError } = await giftBirthdayPerk({ membershipId: membership.id, notes: notes.trim() || null, branchId });
    return { error: rpcError, message: `Birthday gift recorded for ${membership.customerName}.` };
  }, onDone);
  const onSubmit = () => submit('Failed to record the birthday perk.');
  return (
    <ActionFrame
      title="Birthday perk" onBack={onBack} onClose={onClose} dirty={!!notes} busy={busy} reason="" onSubmit={onSubmit} focusId={null} serverError={error}
      primary={{ label: busy ? 'Recording…' : 'Record gift', onClick: onSubmit, disabled: false, loading: busy }}
    >
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0"><Icon name="Gift" size={16} /></span>
        <p className="text-[13px] text-text-secondary">
          Records a one-time birthday gift for <span className="font-body-medium text-text-primary">{membership.customerName}</span> on their {membership.tierName}.
          It doesn't move any money: the gift is delivered as a free 60-min Massage with Sauna/Jacuzzi.
        </p>
      </div>
      <NotesField value={notes} onChange={setNotes} show={showNotes} setShow={setShowNotes} placeholder="e.g. Booked for 14 June, served by Asha." />
    </ActionFrame>
  );
};
