import React, { useState } from 'react';
import CustomerPickRow from './CustomerPickRow';
import CountryCodeSelect from './CountryCodeSelect';
import Icon from '../AppIcon';
import { linkWalkInClient } from '../../services/api';
import { friendlyError } from '../../utils/friendlyError';
import { phoneProblem } from '../../utils/phone';
import { seedFromSearch } from '../../utils/customerPick';
import { format12h } from '../../utils/timeInput';

// ZNLY-327: the booking-panel header line for a walk-in that has no client yet: "＋ Add client · No customer profile yet".
// "＋ Add client" opens the shared customer list WITHOUT the Walk-in row. Pick an existing customer: linked at once. New customer: name + a valid
// phone (same validator as New booking), then linked. The booking stays a walk-in (history). `openSignal` opens the list from outside (Payment tab).
const FIELD = 'w-full h-9 px-2.5 rounded-spa border border-border bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 min-w-0';

const WalkInClientLine = ({ booking, canAdd, openSignal = 0, onLinked }) => {
  const [form, setForm] = useState(null); // { name, phone, dial } while a new client is being typed
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const when = [booking?.date ? new Date(`${booking.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '', booking?.startTime ? format12h(String(booking.startTime).slice(0, 5)) : ''].filter(Boolean).join(' · ');

  const link = async (args) => {
    setSaving(true); setError('');
    const { error: err } = await linkWalkInClient({ bookingId: booking.bookingId, ...args });
    setSaving(false);
    if (err) { setError(friendlyError(err, "Couldn't add the client. Please try again.")); return false; }
    setForm(null);
    onLinked?.();
    return true;
  };
  const onPick = (choice) => {
    if (choice.kind === 'existing') link({ customerId: choice.customer.id });
    else { const s = seedFromSearch(choice.seed); setError(''); setForm({ name: s.name, phone: s.phone, dial: '+977' }); }
  };
  const submitNew = () => {
    if (!form.name.trim()) { setError("Enter the client's name."); return; }
    if (!form.phone.replace(/\D/g, '')) { setError("Enter the client's phone number."); return; }
    const bad = phoneProblem(form.dial, form.phone);
    if (bad) { setError(bad); return; }
    link({ customerName: form.name.trim(), customerPhone: form.dial + form.phone.replace(/\D/g, '') });
  };

  return (
    <div className="px-5 pb-3 -mt-1">
      <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-text-secondary">
        {canAdd && (
          <CustomerPickRow kind={null} branchId={booking?.branchId} showWalkIn={false} title="Add client to this booking" sub={when} onPick={onPick} openSignal={openSignal}
            renderTrigger={({ open, toggle, btnRef }) => (
              <button ref={btnRef} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} data-add-client
                className="relative inline-flex items-center gap-1 h-7 text-[13px] font-medium text-primary hover:underline before:content-[''] before:absolute before:-inset-x-1 before:-inset-y-2">
                <Icon name="Plus" size={13} className="flex-shrink-0" />Add client
              </button>)} />
        )}
        <span className="inline-flex items-center h-7">No customer profile yet</span>
      </div>
      {form && (
        <div className="mt-2.5 p-2.5 rounded-lg border border-border bg-background space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">New client</p>
          <input type="text" aria-label="Client name" placeholder="Name" value={form.name} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setError(''); }} className={FIELD} />
          <div className="flex">
            <CountryCodeSelect value={form.dial} onChange={(dial) => { setForm((f) => ({ ...f, dial })); setError(''); }} />
            <input type="tel" inputMode="numeric" aria-label="Client phone" placeholder="Phone number" value={form.phone}
              onChange={(e) => { setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') })); setError(''); }}
              className="flex-1 min-w-0 px-3 py-2 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={submitNew} disabled={saving} className="h-9 px-3 rounded-spa text-[13px] font-medium bg-primary text-white disabled:opacity-60">{saving ? 'Saving…' : 'Add client'}</button>
            <button type="button" onClick={() => { setForm(null); setError(''); }} disabled={saving} className="h-9 px-3 rounded-spa text-[13px] font-medium border border-border bg-surface text-text-primary">Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1.5 text-xs text-error">{error}</p>}
    </div>
  );
};

export default WalkInClientLine;
