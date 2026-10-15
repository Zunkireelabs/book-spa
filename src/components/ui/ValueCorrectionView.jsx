import React, { useEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import { PanelShell, FormBody, Field, TextInput, MoneyInput, InfoRows, InlineError, controlA11y } from './PanelFormKit';
import { friendlyError } from '../../utils/friendlyError';

const REASON_MIN = 10;

// Admin-only "retype the correct figure" form as a stacked sub-view of a detail panel (replaces AdminValueCorrectionModal).
// Generic over the *value*: the caller supplies `onSubmit` so each entity keeps its own RPC and refusal messages.
//   kind 'integer' | 'number'; `afterRows(value)` → InfoRows rows previewing the result; `blocked(value)` → string reason to
//   stop (e.g. below the sessions already redeemed). `onDone()` runs after a successful save.
const ValueCorrectionView = ({ title, label, currentLabel, kind = 'number', warning, onSubmit, afterRows, blocked, onBack, onClose, onDone }) => {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const submitRef = useRef(null);

  const num = value === '' ? null : Number(value);
  const reasonLen = reason.trim().length;
  const blockedMsg = num != null && !Number.isNaN(num) ? blocked?.(num) : null;
  const disabledReason = value === '' ? 'Enter the corrected value' : blockedMsg || (reasonLen < REASON_MIN ? `Reason needs ${REASON_MIN - reasonLen} more character${REASON_MIN - reasonLen === 1 ? '' : 's'}` : '');

  const submit = async () => {
    if (busyRef.current) return;
    const e = {};
    if (value === '' || Number.isNaN(num)) e.value = 'Enter the corrected value.';
    else if (kind === 'integer' && !Number.isInteger(num)) e.value = 'Enter a whole number.';
    else if (num < 0) e.value = 'Value cannot be negative.';
    else if (blockedMsg) e.value = blockedMsg;
    if (reasonLen < REASON_MIN) e.reason = `A reason of at least ${REASON_MIN} characters is required.`;
    setErrors(e);
    setServerError(null);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`corr-${first}`)?.focus({ preventScroll: true }); return; }
    busyRef.current = true;
    setBusy(true);
    const { error } = await onSubmit({ value: num, reason: reason.trim() });
    busyRef.current = false;
    setBusy(false);
    if (error) { setServerError(friendlyError(error, 'Correction failed.')); return; }
    onDone();
  };
  submitRef.current = submit;

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('corr-value')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  const rows = num != null && !Number.isNaN(num) && afterRows ? afterRows(num) : null;
  return (
    <PanelShell
      variant="panel" title={title} onBack={onBack} onClose={onClose} dirty={!!(value || reason)} busy={busy} reason={disabledReason}
      primary={{ label: busy ? 'Applying…' : 'Apply correction', onClick: submit, disabled: !!disabledReason, loading: busy }}
    >
      <FormBody>
        <p className="flex items-start gap-2 text-[13px] text-text-secondary"><Icon name="AlertTriangle" size={14} className="text-warning mt-0.5 flex-shrink-0" /><span>{warning}</span></p>
        <InlineError message={serverError} />
        <Field label={label} required id="corr-value" error={errors.value} hint={`Currently: ${currentLabel}`}>
          {kind === 'integer' ? (
            <TextInput {...controlA11y('corr-value', errors.value)} error={!!errors.value} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
          ) : (
            <MoneyInput {...controlA11y('corr-value', errors.value)} error={!!errors.value} value={value} onChange={setValue} />
          )}
        </Field>
        <Field label="Reason" required id="corr-reason" error={errors.reason} hint={`At least ${REASON_MIN} characters. Explain what was wrong and why this figure is correct.`}>
          <textarea
            {...controlA11y('corr-reason', errors.reason)} value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className={`w-full px-3 py-2 text-[13px] border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y ${errors.reason ? 'border-error' : 'border-border'}`}
          />
        </Field>
        {rows && <InfoRows rows={rows} />}
      </FormBody>
    </PanelShell>
  );
};

export default ValueCorrectionView;
