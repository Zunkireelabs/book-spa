import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../AppIcon';
import PickShell from './PickShell';
import { useMediaQuery } from './BottomSheet';
import { fetchCustomersLightweight, fetchRecentCustomerIds } from '../../services/api';
import { PICK_REASON, searchCustomers } from '../../utils/customerPick';
import { formatPhoneGrouped } from '../../utils/phone';

// Leading circle (mockup scenes 3-4): ＋ tinted = new customer, 🚶 amber = walk-in, initial on green = a customer.
const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
const Avatar = ({ type, name }) => (
  <span aria-hidden="true" className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-semibold ${type === 'walkin' ? 'bg-warning/15 text-warning' : type === 'new' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>
    {type === 'walkin' ? '🚶' : type === 'new' ? '＋' : initial(name)}
  </span>
);
const grouped = (p) => (p ? formatPhoneGrouped(p) : '');

// ONE customer control (ZNLY-327), like ServicePickRow / StaffPickRow: a closed row → desktop popover / phone sheet.
// List order: New customer · Walk-in · customers (search by name or phone narrows it). `onPick` gets
// { kind: 'new', seed: '<typed search text>' } | { kind: 'walkin' } | { kind: 'existing', customer }.
// `kind` = what is picked now (null = nothing yet). Walk-in = no profile at all; the caller shows its optional Name field.
const SHOWN = 8;

const CustomerPickRow = ({ kind = null, name = '', phone = '', branchId = null, customers: preloaded = null, onPick, invalid = false, required = true, disabled = false, title = 'Customer for the booking', sub = '' }) => {
  const [fetched, setFetched] = useState([]);
  const customers = preloaded || fetched;
  useEffect(() => {
    if (!branchId || preloaded) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error } = await fetchCustomersLightweight(branchId);
      if (error) { console.error('[CustomerPickRow] Failed to load customers:', error.message || error); return; }
      if (!cancelled && data) setFetched(data);
    })();
    return () => { cancelled = true; };
  }, [branchId, preloaded]);

  const [recentIds, setRecentIds] = useState([]);
  useEffect(() => {
    if (!branchId) return undefined;
    let cancelled = false;
    (async () => {
      const { data } = await fetchRecentCustomerIds(branchId, SHOWN);
      if (!cancelled && data) setRecentIds(data);
    })();
    return () => { cancelled = true; };
  }, [branchId]);
  const recent = useMemo(() => recentIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean), [recentIds, customers]);

  const empty = !kind;
  const tone = invalid && empty ? 'border-error ring-2 ring-error/20 bg-surface' : empty && !required ? 'border-dashed border-border bg-surface' : 'border-border bg-surface';
  const renderPicker = (close) => (
    <CustomerList kind={kind} customers={customers} recent={recent} title={title} sub={sub} onPick={(c) => { onPick(c); close(); }} />
  );
  return (
    <PickShell tone={tone} title={title} renderPicker={renderPicker} disabled={disabled}
      belowRow={invalid && empty ? <p className="mt-1.5 px-0.5 text-xs text-error" role="alert">{PICK_REASON}</p> : null}>
      {empty ? <span className={`flex-1 text-sm ${required ? 'text-text-primary' : 'text-text-secondary'}`}>＋ Pick a customer or Walk-in</span>
        : kind === 'walkin' ? (
          <>
            <Avatar type="walkin" />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-sm font-body-medium text-text-primary">Walk-in</span>
              <span className="block truncate text-xs text-text-secondary">No customer profile</span>
            </span>
          </>
        ) : kind === 'existing' ? (
          <>
            <Avatar type="existing" name={name} />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-sm font-body-medium text-text-primary">{name || 'Customer'}</span>
              {phone && <span className="block truncate text-xs text-text-secondary">{grouped(phone)}</span>}
            </span>
          </>
        ) : (
          <>
            <Avatar type="new" />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-sm font-body-medium text-text-primary">{name.trim() || 'New customer'}</span>
              <span className="block truncate text-xs text-text-secondary">{name.trim() ? 'New customer' : 'Enter the details below'}</span>
            </span>
          </>
        )}
    </PickShell>
  );
};

const CustomerList = ({ kind, customers, recent, title, sub, onPick }) => {
  const [q, setQ] = useState('');
  const isPhone = useMediaQuery('(max-width: 767.98px)');
  const inputRef = useRef(null);
  useEffect(() => { if (!isPhone) inputRef.current?.focus(); }, [isPhone]); // never auto-focus on a phone: the keyboard would cover the list
  const searching = q.trim().length > 0;
  const hits = useMemo(() => (searching ? searchCustomers(customers, q, SHOWN) : recent), [searching, recent, customers, q]);
  // Mockup rows: avatar · name / sub · ✓ on the picked row (tinted background). A button, not a radio: no selection circle.
  const Row = ({ id, label, sub, checked, onChange, avatar }) => (
    <button type="button" data-pick-none data-pick-id={id} aria-label={typeof label === 'string' ? label : id} aria-pressed={checked} onClick={onChange}
      className={`w-full flex items-center gap-2.5 px-4 py-2 min-h-[54px] border-t border-[#EEF0F1] text-left ${checked ? 'bg-primary/5' : 'hover:bg-background'}`}>
      {avatar}
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm text-text-primary">{label}</span>
        {sub && <span className="block truncate text-xs text-text-secondary">{sub}</span>}
      </span>
      {checked && <Icon name="Check" size={16} className="flex-shrink-0 text-primary" />}
    </button>
  );
  return (
    <div>
      <div className="px-4 pt-4 pb-3 pr-14 md:pr-4">
        <h3 className="font-heading font-heading-semibold text-[17px] leading-snug text-text-primary">{title}</h3>
        {sub && <p className="text-[13.5px] text-text-secondary">{sub}</p>}
      </div>
      <div className="px-4 pt-2 pb-2 sticky top-0 bg-surface z-10">
        <input ref={inputRef} type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" aria-label="Search customers"
          className="w-full h-10 px-3 border border-border rounded-spa text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      <Row id="new" avatar={<Avatar type="new" />} label="New customer" sub={searching ? `Add “${q.trim()}” as a new customer` : 'Name and phone'} checked={kind === 'new'} onChange={() => onPick({ kind: 'new', seed: q.trim() })} />
      <Row id="walkin" avatar={<Avatar type="walkin" />} label="Walk-in" sub="No customer profile" checked={kind === 'walkin'} onChange={() => onPick({ kind: 'walkin' })} />
      <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{searching ? 'Matches' : 'Recent customers'}</div>
      {hits.length === 0
        ? <p className="px-4 py-6 text-sm text-text-secondary text-center">{searching ? `No customer matches “${q.trim()}”.` : 'No recent customers yet. Search to find one.'}</p>
        : hits.map((c) => <Row key={c.id} id={c.id} avatar={<Avatar type="existing" name={c.full_name} />} label={c.full_name} sub={c.phone ? grouped(c.phone) : (c.email || '')} checked={false} onChange={() => onPick({ kind: 'existing', customer: c })} />)}
    </div>
  );
};

export default CustomerPickRow;
