import { NEPAL_TZ } from '../../utils/nepalTime';
import React, { useState, useEffect } from 'react';
import Button from './Button';
import ModalShell from './ModalShell';
import { RadioCards, InlineError } from './PanelFormKit';
import { issueInvoice, recordInvoicePrint, fetchInvoiceDialogInfo } from '../../services/api';
import { formatNPR } from '../../services/bookingTransformers';

// Same posture as calendar/PrintReportModal.jsx: no PDF library, no
// server-side rendering. "Print to PDF" is just the browser's own print
// destination — this builds a clean HTML document in a new window and calls
// window.print() on it. Two layouts off the same frozen invoice snapshot.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatIssuedAt(isoString) {
  return new Date(isoString).toLocaleString('en-GB', {
    timeZone: NEPAL_TZ,
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, // customer-facing: always 12h, never the staff setting
  });
}

const TAX_MODE_LABEL = { inclusive: 'VAT included', addon: 'VAT added', none: 'No VAT' };

function buildA4Html(invoice, copyLabel) {
  const lines = (invoice.line_items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td class="num">${formatNPR(item.amount)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #111827; padding: 40px; }
    .copy-label { text-align: right; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #6B7280; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 16px; }
    .seller h1 { font-size: 20px; }
    .seller .meta { font-size: 12px; color: #4B5563; margin-top: 4px; line-height: 1.5; }
    .invoice-meta { text-align: right; font-size: 12px; color: #4B5563; }
    .invoice-meta .num { font-size: 16px; font-weight: 700; color: #111827; }
    .buyer { margin-bottom: 20px; font-size: 13px; }
    .buyer .label { font-size: 11px; text-transform: uppercase; color: #9CA3AF; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: #6B7280; border-bottom: 1px solid #E5E7EB; padding: 8px 0; }
    td { padding: 8px 0; border-bottom: 1px solid #F3F4F6; font-size: 13px; }
    .num { text-align: right; font-family: ui-monospace, monospace; }
    .totals { margin-left: auto; width: 280px; font-size: 13px; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals-row.total { border-top: 1px solid #111827; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 15px; }
    .footer { margin-top: 32px; font-size: 12px; color: #6B7280; white-space: pre-wrap; }
    @media print { body { padding: 0 24px; } }
  </style>
</head>
<body>
  <div class="copy-label">${copyLabel}</div>
  <div class="header">
    <div class="seller">
      <h1>${escapeHtml(invoice.seller_name)}</h1>
      <div class="meta">
        ${invoice.seller_address ? `${escapeHtml(invoice.seller_address)}<br/>` : ''}
        ${invoice.seller_phone ? `${escapeHtml(invoice.seller_phone)} ` : ''}${invoice.seller_email ? escapeHtml(invoice.seller_email) : ''}<br/>
        PAN: ${escapeHtml(invoice.seller_pan)}<br/>
        ${invoice.branch_name ? `Branch: ${escapeHtml(invoice.branch_name)}${invoice.branch_address ? ` — ${escapeHtml(invoice.branch_address)}` : ''}` : ''}
      </div>
    </div>
    <div class="invoice-meta">
      <div class="num">TAX INVOICE</div>
      <div>${escapeHtml(invoice.invoice_number)}</div>
      <div>${escapeHtml(formatIssuedAt(invoice.issued_at))}</div>
      <div>${escapeHtml(TAX_MODE_LABEL[invoice.tax_mode] || invoice.tax_mode)}</div>
    </div>
  </div>

  <div class="buyer">
    <div class="label">Billed to</div>
    <div>${escapeHtml(invoice.buyer_name)}</div>
    ${invoice.buyer_phone ? `<div>${escapeHtml(invoice.buyer_phone)}</div>` : ''}
    ${invoice.buyer_pan ? `<div>PAN: ${escapeHtml(invoice.buyer_pan)}</div>` : ''}
  </div>

  <table>
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>${formatNPR(invoice.subtotal)}</span></div>
    ${Number(invoice.discount_amount) > 0 ? `<div class="totals-row"><span>Discount</span><span>-${formatNPR(invoice.discount_amount)}</span></div>` : ''}
    <div class="totals-row"><span>Taxable</span><span>${formatNPR(invoice.taxable_amount)}</span></div>
    ${invoice.tax_mode !== 'none' ? `<div class="totals-row"><span>VAT ${invoice.vat_rate}%</span><span>${formatNPR(invoice.vat_amount)}</span></div>` : ''}
    <div class="totals-row total"><span>TOTAL</span><span>${formatNPR(invoice.total_amount)}</span></div>
    ${invoice.payment_mode ? `<div class="totals-row"><span>Paid via</span><span>${escapeHtml(invoice.payment_mode)}</span></div>` : ''}
  </div>

  ${invoice.footer_text ? `<div class="footer">${escapeHtml(invoice.footer_text)}</div>` : ''}
</body>
</html>`;
}

// 80mm thermal — ~42 characters per line, monospace, no page chrome.
function buildThermalHtml(invoice, copyLabel) {
  const lines = (invoice.line_items || []).map((item) => `
    <div class="row"><span class="desc">${escapeHtml(item.description)}</span><span class="amt">${formatNPR(item.amount)}</span></div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 11px; width: 80mm; padding: 6px 8px; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .hr { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .row .desc { flex: 1; word-break: break-word; }
    .row .amt { flex-shrink: 0; text-align: right; }
    .copy-label { text-align: center; font-weight: 700; margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="copy-label">${copyLabel}</div>
  <div class="center bold">${escapeHtml(invoice.seller_name)}</div>
  ${invoice.seller_address ? `<div class="center">${escapeHtml(invoice.seller_address)}</div>` : ''}
  ${invoice.seller_phone ? `<div class="center">${escapeHtml(invoice.seller_phone)}</div>` : ''}
  <div class="center">PAN: ${escapeHtml(invoice.seller_pan)}</div>
  ${invoice.branch_name ? `<div class="center">${escapeHtml(invoice.branch_name)}</div>` : ''}
  <div class="hr"></div>
  <div>Invoice: ${escapeHtml(invoice.invoice_number)}</div>
  <div>${escapeHtml(formatIssuedAt(invoice.issued_at))}</div>
  <div>Bill to: ${escapeHtml(invoice.buyer_name)}</div>
  <div class="hr"></div>
  ${lines}
  <div class="hr"></div>
  <div class="row"><span>Subtotal</span><span>${formatNPR(invoice.subtotal)}</span></div>
  ${Number(invoice.discount_amount) > 0 ? `<div class="row"><span>Discount</span><span>-${formatNPR(invoice.discount_amount)}</span></div>` : ''}
  <div class="row"><span>Taxable</span><span>${formatNPR(invoice.taxable_amount)}</span></div>
  ${invoice.tax_mode !== 'none' ? `<div class="row"><span>VAT ${invoice.vat_rate}%</span><span>${formatNPR(invoice.vat_amount)}</span></div>` : ''}
  <div class="hr"></div>
  <div class="row bold"><span>TOTAL</span><span>${formatNPR(invoice.total_amount)}</span></div>
  ${invoice.payment_mode ? `<div>Paid via: ${escapeHtml(invoice.payment_mode)}</div>` : ''}
  ${invoice.footer_text ? `<div class="hr"></div><div class="center">${escapeHtml(invoice.footer_text)}</div>` : ''}
</body>
</html>`;
}

const LAYOUT_OPTIONS = [
  { value: 'a4', title: 'A4 tax invoice', detail: 'Full page. For a customer who asks for a bill with PAN.' },
  { value: 'thermal', title: 'Thermal receipt (80 mm)', detail: 'Narrow roll printer at the desk.' },
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

const InvoicePrintModal = ({ bookingId, onClose }) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [layout, setLayout] = useState('a4');
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
    const html = layout === 'a4' ? buildA4Html(inv, recorded.data.copyLabel) : buildThermalHtml(inv, recorded.data.copyLabel);
    const printWindow = window.open('', '_blank', layout === 'a4' ? 'width=900,height=1000' : 'width=400,height=700');
    setWorking(false);
    if (!printWindow) { setError('The print window was blocked. Allow pop-ups for this site and try again.'); return; }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 150);
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
