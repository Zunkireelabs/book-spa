import React, { useEffect, useState } from 'react';
import { updateCustomerProfileDetails, fetchCustomerDateOfBirth } from '../../services/api';
import { friendlyError } from '../../utils/friendlyError';
import { nepalNow } from '../../utils/customerDirectory';
import { parseDobParts, splitIsoDob, formatBirthdayShort, birthdaySoonLabel, MONTH_NAMES } from '../../utils/dobInput';
import { formatPhoneGrouped } from '../../utils/phone';
import CustomSelect from './CustomSelect';
import Icon from '../AppIcon';

const MONTH_OPTIONS = MONTH_NAMES.map((n, i) => ({ value: String(i + 1), label: n.slice(0, 3) }));
// One compact size on every screen; phones only get an invisible 44px tap area (the ::before).
const CHIP = "relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] font-medium border before:content-[''] before:absolute before:-inset-x-1 before:-inset-y-2 cursor-pointer";
const BTN = "relative inline-flex items-center justify-center h-9 px-3 rounded-spa text-[13px] font-medium border before:content-[''] before:absolute before:-inset-1 disabled:opacity-60";
const FIELD = 'w-full h-9 px-2.5 rounded-spa border bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 min-w-0';

// Panel header subline: phone · View profile · birthday chip, plus the inline Birthday editor.
// Restricted viewers never reach this component's data: nothing is rendered and no DOB is fetched.
const BookingCustomerLine = ({ booking, restricted, canEdit, onViewProfile, onSaved }) => {
  const customerId = booking?.customerId || null;
  const [dob, setDob] = useState('');           // stored ISO date or ''
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState({ month: '', day: '', year: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false); setError(''); setDob('');
    if (restricted || !customerId) return undefined;
    let live = true;
    fetchCustomerDateOfBirth(customerId).then(({ data }) => { if (live) setDob(data || ''); });
    return () => { live = false; };
  }, [customerId, restricted]);

  if (restricted) return null;

  const phone = booking.customerPhone ? formatPhoneGrouped(booking.customerPhone) : '';
  const copy = (v) => { try { navigator.clipboard?.writeText(v); } catch (_) { /* clipboard unavailable */ } };
  const soon = birthdaySoonLabel(dob, nepalNow().today);

  const open = () => {
    const p = splitIsoDob(dob);
    setParts(p ? { month: String(p.month), day: String(p.day), year: String(p.year) } : { month: '', day: '', year: '' });
    setError(''); setEditing(true);
  };
  const save = async () => {
    const r = parseDobParts(parts, new Date(`${nepalNow().today}T00:00:00`));
    if (r.error) { setError(r.error); return; }
    setSaving(true); setError('');
    try {
      const { data, error: err } = await updateCustomerProfileDetails(customerId, { dateOfBirth: r.iso });
      if (err) { setError(friendlyError(err, "Couldn't save the date of birth. Please try again.")); return; }
      setDob(data?.date_of_birth || r.iso || '');
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(friendlyError(e, "Couldn't save the date of birth. Please try again."));
    } finally { setSaving(false); }
  };

  const chip = !customerId || editing ? null : dob ? (
    <button type="button" onClick={open} title="Tap to change" className={`${CHIP} ${soon ? 'bg-[#FBF1D4] text-[#8A5A00] border-[#EBD38A]' : 'bg-background text-text-secondary border-border'}`}>
      <span aria-hidden="true">🎂</span>{soon || formatBirthdayShort(dob)}
    </button>
  ) : canEdit ? (
    <button type="button" onClick={open} className={`${CHIP} bg-surface text-text-secondary border-dashed border-[#C9CBCE] hover:border-primary hover:text-primary`}>
      <Icon name="Cake" size={14} className="flex-shrink-0" />Add date of birth
    </button>
  ) : null;

  const bad = !!error;
  return (
    <div className="px-5 pb-3 -mt-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0 text-[13px] text-text-secondary">
        {phone && (
          <span className="group inline-flex items-center gap-1 h-7 leading-none">
            <Icon name="Phone" size={13} className="text-text-tertiary flex-shrink-0" />
            <a href={`tel:${String(booking.customerPhone).replace(/\s/g, '')}`} className="text-primary font-medium hover:underline tabular-nums whitespace-nowrap">{phone}</a>
            <button type="button" onClick={() => copy(String(booking.customerPhone))} aria-label="Copy phone" title="Copy phone"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-spa text-text-tertiary hover:text-primary hover:bg-background spa-transition-fast">
              <Icon name="Copy" size={12} />
            </button>
          </span>
        )}
        {customerId && (
          <>
            {phone && <span className="text-border h-7 inline-flex items-center" aria-hidden="true">·</span>}
            <button type="button" onClick={onViewProfile} className="relative h-7 inline-flex items-center text-primary font-medium hover:underline leading-none whitespace-nowrap before:content-[''] before:absolute before:-inset-x-1 before:-inset-y-2">View profile</button>
          </>
        )}
        {chip}
      </div>
      {editing && (
        <div className="mt-2.5 p-2.5 rounded-lg border border-border bg-background">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-1.5">Birthday</p>
          <div className="grid grid-cols-3 gap-2">
            <CustomSelect size="sm" value={parts.month} options={MONTH_OPTIONS} placeholder="Month" error={bad}
              onChange={(v) => { setParts((p) => ({ ...p, month: String(v) })); setError(''); }} />
            <input type="text" inputMode="numeric" autoComplete="off" maxLength={2} placeholder="Day" aria-label="Day" value={parts.day}
              onChange={(e) => { setParts((p) => ({ ...p, day: e.target.value.replace(/\D/g, '').slice(0, 2) })); setError(''); }}
              className={`${FIELD} ${bad ? 'border-error' : 'border-border'}`} />
            <input type="text" inputMode="numeric" autoComplete="off" maxLength={4} placeholder="Year" aria-label="Year" value={parts.year}
              onChange={(e) => { setParts((p) => ({ ...p, year: e.target.value.replace(/\D/g, '').slice(0, 4) })); setError(''); }}
              className={`${FIELD} ${bad ? 'border-error' : 'border-border'}`} />
          </div>
          {error && (
            <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-error"><Icon name="AlertCircle" size={13} className="flex-shrink-0" />{error}</p>
          )}
          <div className="flex gap-2 mt-2.5">
            <button type="button" onClick={save} disabled={saving} className={`${BTN} bg-primary border-primary text-white`}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setError(''); }} disabled={saving} className={`${BTN} bg-surface border-border text-text-primary`}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingCustomerLine;
