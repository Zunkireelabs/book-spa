import React, { useState, useEffect } from 'react';
import Button from './Button';
import ModalShell from './ModalShell';
import { RadioCards, InlineError } from './PanelFormKit';
import { issueInvoice, recordInvoicePrint, fetchInvoiceDialogInfo, fetchBillUnit, fixBillNumber } from '../../services/api';
import { buildBill, billSource } from '../../utils/buildBill';
import { printBill } from './Bill/Bill';
import { useBillOrg } from './Bill/useBillOrg';

const LAYOUT_OPTIONS = [
  { value: 'a4', title: 'A4 page', detail: 'Full page. For a customer who asks for a bill with PAN.' },
  { value: 'thermal', title: 'Receipt printer (80 mm)', detail: 'Narrow roll printer at the desk.' },
];

const maskPhone = (phone) => {
  const d = String(phone || '').replace(/\s/g, '');
  return d.length > 5 ? `${d.slice(0, 2)}${'•'.repeat(d.length - 5)}${d.slice(-3)}` : d;
};

// The three failures the board names, in plain words. The raw database text ("issue_invoice: ...") never reaches the screen.
const friendlyError = (message) => {
  const m = String(message || '');
  if (/not set|tax mode|billing/i.test(m)) return 'Billing is not set up. Ask an admin to complete Settings → Billing.';
  if (/not fully paid/i.test(m)) return 'This booking is not fully paid yet, so no invoice can be issued.';
  return "Couldn't issue the invoice. Nothing was printed. Try again.";
};

const FieldLabel = ({ children }) => (
  <span className="block mb-2 text-xs font-body font-body-medium uppercase tracking-[0.05em] text-text-secondary">{children}</span>
);

const InvoicePrintModal = ({ bookingId, onClose, initialLayout = 'a4' }) => {
  const { orgInfo } = useBillOrg();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [layout, setLayout] = useState(initialLayout);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await fetchInvoiceDialogInfo(bookingId);
      if (!alive) return;
      if (result.error) setError("Couldn't load this booking. Close and try again.");
      else setInfo(result.data);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [bookingId]);

  const invoice = info?.invoice;
  const isDuplicate = (info?.printCount || 0) > 0;
  const buyerName = invoice?.buyer_name || info?.booking?.customer_name || '';
  const buyerPhone = invoice?.buyer_phone || info?.booking?.customer_phone || '';

  // The first click issues the invoice (issue_invoice is idempotent: an existing one is returned) and fixes its number, lines and tax;
  // record_invoice_print then decides Original vs copy. footer_text is frozen onto the invoice at issue time, so a reprint never shows
  // terms that were not on what the customer was handed.
  const handlePrint = async () => {
    setWorking(true);
    setError(null);
    const issued = await issueInvoice(bookingId);
    if (issued.error) { setError(friendlyError(issued.error.message)); setWorking(false); return; }
    const inv = issued.data;
    const recorded = await recordInvoicePrint({ invoiceId: inv.id, printType: layout });
    if (recorded.error) { setError("Couldn't record the print. Nothing was printed. Try again."); setWorking(false); return; }
    // The invoice stays one per booking row (frozen at issue); only the drawing is the shared bill. fix_bill_number adds the booking number.
    const [unit, num] = await Promise.all([fetchBillUnit({ bookingId, single: true }), fixBillNumber(bookingId, true)]);
    if (!unit.data) { setError("Couldn't prepare the invoice for printing. It was issued and logged: print it again from the booking."); setWorking(false); return; }
    const ok = await printBill(buildBill(billSource({ ...unit.data, billNumber: num.data }, orgInfo, recorded.data.copyLabel)), layout);
    setWorking(false);
    if (!ok) { setError('The print window was blocked. Allow pop-ups for this site and try again.'); return; }
    onClose();
  };

  return (
    <ModalShell onClose={working ? undefined : onClose} className="max-w-md" aria-label="Print invoice">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">Print invoice</h3>
        <span className="text-[13px] text-text-secondary">{info?.booking?.booking_number ? `Session ${info.booking.booking_number}` : ''}</span>
      </div>

      <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Preparing invoice...</p>
          </div>
        ) : (
          <>
            <div>
              <FieldLabel>Layout</FieldLabel>
              <RadioCards label="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={setLayout} />
            </div>

            <div>
              <FieldLabel>Copy</FieldLabel>
              <div className="flex gap-2" role="group" aria-label="Copy">
                {[['Original', !isDuplicate], ['Duplicate', isDuplicate]].map(([label, on]) => (
                  <span key={label} aria-current={on ? 'true' : undefined} className={`inline-flex items-center h-[30px] px-3.5 rounded-full text-xs ${on ? 'bg-primary/10 text-primary font-body-medium' : 'bg-background text-text-secondary'}`}>{label}</span>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-text-secondary">The first print issues the invoice and fixes its number, lines and tax. Later prints are marked as copies. Nothing on it changes after that.</p>
            </div>

            <div>
              <FieldLabel>Bill to</FieldLabel>
              <div className="border border-border rounded-spa px-3 py-2.5">
                <p className="text-[13px] font-body-medium text-text-primary">{buyerName || 'Customer'}</p>
                <p className="text-xs text-text-secondary">{[maskPhone(buyerPhone), invoice?.buyer_pan ? `PAN: ${invoice.buyer_pan}` : ''].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          </>
        )}
        <InlineError message={error} />
      </div>

      <div className="flex justify-end gap-2 p-5 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={working}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handlePrint} loading={working} disabled={loading || !info}>
          {invoice ? 'Print' : 'Issue and print'}
        </Button>
      </div>
    </ModalShell>
  );
};

export default InvoicePrintModal;
