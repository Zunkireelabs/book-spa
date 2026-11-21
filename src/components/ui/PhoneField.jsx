import React, { useMemo, useState, useCallback } from 'react';
import CountryCodeSelect, { parsePhone } from './CountryCodeSelect';
import { phoneProblem, phoneToSave } from '../../utils/phone';

// ZNLY-331: the ONE phone input. Country-code picker + national digits (numeric keypad, 16px on a phone so iOS does not zoom: the
// ZNLY-294 rule), one validator (utils/phone.js, ZNLY-327) and the inline reason under the field. Forms keep their own required /
// optional rule and save path; only the input, the split and the validation are shared.
//
// Controlled by parts (`dial` + `national`), because forms keep them apart and a stored "+91…" string cannot be re-split reliably
// while the user is still typing. `original` is the stored value being edited: an untouched number is never re-checked and is saved
// exactly as stored (phoneFieldValue).

export const PHONE_INPUT_CLASS = 'flex-1 min-w-0 px-3 py-2 text-base sm:text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

const untouched = ({ dial, national, original }) => {
  if (original === undefined || original === null) return false;
  const o = parsePhone(original);
  return dial === o.dial && national === o.national;
};

/** The reason to block this form's submit ('' = fine). Empty is the caller's "required" rule; an untouched stored number always passes. */
export function phoneFieldProblem({ dial, national, original, walkInHint = false, kind = 'person' }) {
  if (untouched({ dial, national, original })) return '';
  return phoneProblem(dial, national, { walkInHint, kind });
}

/** The value to save: dial + digits, or the stored string exactly as it was when the number was not touched; null when empty. */
export function phoneFieldValue({ dial, national, original }) {
  const o = parsePhone(original);
  return phoneToSave({ dial, national, initialDial: o.dial, initialNational: o.national, original });
}

/**
 * State for a form that has one phone field and no dial/national of its own: `reset(stored)` loads a stored value (or '' for a new
 * entry), `value` is what to save, `problem` is what blocks the submit. Spread `field` onto <PhoneField {...field} />.
 */
export function usePhoneState(stored = '', { walkInHint = false, kind = 'person' } = {}) {
  const [st, setSt] = useState(() => ({ ...parsePhone(stored), original: stored || '' }));
  const reset = useCallback((next = '') => setSt({ ...parsePhone(next), original: next || '' }), []);
  const onChange = useCallback(({ dial, national }) => setSt((s) => ({ ...s, dial, national })), []);
  const value = phoneFieldValue(st);
  const problem = phoneFieldProblem({ ...st, walkInHint, kind });
  return { dial: st.dial, national: st.national, original: st.original, onChange, walkInHint, reset, value, problem, field: { dial: st.dial, national: st.national, original: st.original, onChange, walkInHint, kind } };
}

/**
 * `renderInput({ id, value, onValueChange, placeholder, className, inputMode })` swaps the plain input for a typeahead
 * (New booking's customer search) while keeping the picker, digits-only rule and message.
 */
const PhoneField = ({
  dial = '+977', national = '', onChange, original,
  label, required = false, id, name, placeholder = '98XXXXXXXX', ariaLabel,
  walkInHint = false, kind = 'person', showProblem = true, error, disabled = false,
  onBlur, autoFocus = false, dataPhMask = false, renderInput, className = '', inputClassName,
}) => {
  const problem = useMemo(
    () => phoneFieldProblem({ dial, national, original, walkInHint, kind }),
    [dial, national, original, walkInHint, kind]
  );
  const shown = error || (showProblem ? problem : '');
  const cls = `${inputClassName || PHONE_INPUT_CLASS}${shown ? ' !border-error' : ''}`;
  const setNational = (v) => onChange?.({ dial, national: String(v ?? '').replace(/\D/g, '') });
  const msgId = id ? `${id}-problem` : undefined;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
          {label} {required && <span className="text-error">*</span>}
        </label>
      )}
      <div className="flex">
        <CountryCodeSelect value={dial} onChange={(d) => onChange?.({ dial: d, national })} disabled={disabled} />
        {renderInput ? renderInput({ id, value: national, onValueChange: setNational, placeholder, className: cls, inputMode: 'numeric' }) : (
          <input
            id={id} name={name} type="tel" inputMode="numeric" autoComplete="tel-national"
            value={national} onChange={(e) => setNational(e.target.value)} onBlur={onBlur} disabled={disabled} autoFocus={autoFocus}
            placeholder={placeholder} aria-label={ariaLabel || (label ? undefined : 'Phone number')}
            aria-invalid={shown ? true : undefined} aria-describedby={shown ? msgId : undefined}
            {...(dataPhMask ? { 'data-ph-mask': true } : {})}
            className={cls}
          />
        )}
      </div>
      {shown && <p id={msgId} className="mt-1.5 text-xs text-error" role="alert">{shown}</p>}
    </div>
  );
};

export default PhoneField;
