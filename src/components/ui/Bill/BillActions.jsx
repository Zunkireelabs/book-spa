// ZNLY-410 step 1: the ONE bill control — View · Print ▾ (A4 page / Receipt printer (80 mm)) — used on the checkout success screen, the booking
// panel and the profile Bills list, so the words are the same everywhere. Send to ▾ arrives with step 2.
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../AppIcon';
import SidePanel from '../SidePanel';
import InvoicePrintModal from '../InvoicePrintModal';
import { useBillOrg } from './useBillOrg';
import { fetchBillUnit, fixBillNumber } from '../../../services/api';
import { buildBill, billSource } from '../../../utils/buildBill';
import { Bill, BILL_CSS, printBill } from './Bill';
import { useMenuNav } from '../useMenuNav';

export const PRINT_CHOICES = [['a4', 'A4 page'], ['thermal', 'Receipt printer (80 mm)']];

const PrintMenu = ({ onPick, busy, up, className = '' }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  useMenuNav({ open, onClose: () => setOpen(false), menuRef, triggerRef });
  return (
    <span className="relative inline-block">
      <button ref={triggerRef} type="button" onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}
        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-spa border border-border text-xs font-medium text-text-primary hover:bg-background disabled:opacity-50 ${className}`}>
        <Icon name="Printer" size={13} />{busy ? 'Printing…' : 'Print'}<Icon name="ChevronDown" size={11} />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Print" className={`absolute right-0 z-dropdown min-w-[200px] bg-surface border border-border rounded-spa spa-shadow-modal py-1 ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {PRINT_CHOICES.map(([v, label]) => (
            <button key={v} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(v); }} className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-background focus:bg-background outline-none">{label}</button>
          ))}
        </div>
      )}
    </span>
  );
};

const BillPanel = ({ bookingId, extraIds, onClose, onPrint, busy, above }) => {
  const { multi, billingOn, orgInfo } = useBillOrg();
  const [state, setState] = useState({ loading: true, bill: null, error: false });
  useEffect(() => {
    let alive = true;
    fetchBillUnit({ bookingId, multi, single: billingOn, extraIds }).then(({ data }) => {
      if (!alive) return;
      setState(data ? { loading: false, bill: buildBill(billSource(data, orgInfo)), error: false } : { loading: false, bill: null, error: true });
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);
  const { bill } = state;
  return (
    <SidePanel isOpen above={above} title={bill ? `${bill.title === 'Tax invoice' ? 'Tax invoice' : 'Bill'} ${bill.number}` : 'Bill'} onClose={onClose}
      width="min(560px, 100vw)"
      footer={<div className="flex items-center justify-end gap-2 w-full"><PrintMenu onPick={onPrint} busy={busy} up /></div>}>
      <style data-bill-panel>{BILL_CSS}</style>
      {state.loading && <p className="p-6 text-sm text-text-secondary">Preparing the bill…</p>}
      {state.error && <p className="p-6 text-sm text-text-secondary">Couldn&apos;t load this bill. Close and try again.</p>}
      {bill && <div className="border border-border rounded-spa m-4 overflow-hidden"><Bill bill={bill} layout="a4" /></div>}
    </SidePanel>
  );
};

const BillActions = ({ bookingId, extraIds, up = false, above = false, className = '' }) => {
  const { multi, billingOn, orgInfo } = useBillOrg();
  const [viewing, setViewing] = useState(false);
  const [invoiceLayout, setInvoiceLayout] = useState(null); // set = the tax-invoice dialog is open (issue + Original/Copy logging stay exactly as before)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const print = async (layout) => {
    setError('');
    if (billingOn) { setInvoiceLayout(layout); return; }
    setBusy(true);
    try {
      const { data, error: err } = await fetchBillUnit({ bookingId, multi, extraIds });
      if (err || !data) throw err || new Error('load');
      if (data.invoice) { setInvoiceLayout(layout); return; } // billed before Billing was switched off: still the tax invoice
      // A checkout of several bookings is one bill: its number is the first booking number among them, fixed on that booking.
      const bundled = (extraIds || []).length > 0;
      const anchor = bundled ? [...data.rows].sort((a, b) => String(a.bookingNumber).localeCompare(String(b.bookingNumber)))[0].id : bookingId;
      const { data: number, error: numErr } = await fixBillNumber(anchor, bundled);
      if (numErr) throw numErr;
      const ok = await printBill(buildBill(billSource({ ...data, billNumber: number }, orgInfo)), layout);
      if (!ok) setError('The print window was blocked. Allow pop-ups for this site and try again.');
    } catch {
      setError("Couldn't print this bill. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`} data-bill-actions>
      <button type="button" onClick={() => setViewing(true)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-spa border border-border text-xs font-medium text-text-primary hover:bg-background"><Icon name="Eye" size={13} />View</button>
      <PrintMenu onPick={print} busy={busy} up={up} />
      {error && <span role="alert" className="basis-full text-xs text-error">{error}</span>}
      {viewing && <BillPanel bookingId={bookingId} extraIds={extraIds} onClose={() => setViewing(false)} onPrint={print} busy={busy} above={above} />}
      {invoiceLayout && <InvoicePrintModal bookingId={bookingId} initialLayout={invoiceLayout} onClose={() => setInvoiceLayout(null)} />}
    </span>
  );
};

export default BillActions;
