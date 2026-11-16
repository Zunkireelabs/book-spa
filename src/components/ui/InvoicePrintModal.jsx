import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../AppIcon';
import { issueInvoice, recordInvoicePrint } from '../../services/api';
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
    timeZone: 'Asia/Kathmandu',
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
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

const InvoicePrintModal = ({ bookingId, onClose }) => {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [printing, setPrinting] = useState(null); // 'a4' | 'thermal'

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // footer_text (settings-panel label: "footer text... and any terms") is
    // frozen onto the invoice at issue time, same as every other printed
    // field — a reprint must never show terms that weren't on what the
    // customer was handed.
    const result = await issueInvoice(bookingId);
    if (result.error) {
      setError(result.error.message || 'Could not issue the invoice.');
    } else {
      setInvoice(result.data);
    }
    setLoading(false);
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = async (printType) => {
    if (!invoice) return;
    setPrinting(printType);
    const result = await recordInvoicePrint({ invoiceId: invoice.id, printType });
    if (result.error) {
      setError(result.error.message || 'Could not record the print.');
      setPrinting(null);
      return;
    }
    const html = printType === 'a4' ? buildA4Html(invoice, result.data.copyLabel) : buildThermalHtml(invoice, result.data.copyLabel);
    const printWindow = window.open('', '_blank', printType === 'a4' ? 'width=900,height=1000' : 'width=400,height=700');
    setPrinting(null);
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 150);
  };

  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Print invoice</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-background"><Icon name="X" size={18} className="text-text-secondary" /></button>
        </div>

        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Preparing invoice...</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {invoice && !loading && (
          <>
            <div className="bg-background border border-border rounded-spa p-3 text-sm">
              <div className="font-body-medium text-text-primary">{invoice.invoice_number}</div>
              <div className="text-text-secondary text-xs mt-0.5">{formatNPR(invoice.total_amount)} · {invoice.buyer_name}</div>
            </div>
            <div className="flex gap-2">
              <Button80mm label="Print A4" onClick={() => handlePrint('a4')} loading={printing === 'a4'} />
              <Button80mm label="Print thermal (80mm)" onClick={() => handlePrint('thermal')} loading={printing === 'thermal'} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Button80mm = ({ label, onClick, loading }) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="flex-1 py-2 rounded-spa bg-primary text-white text-sm font-body-medium hover:bg-primary/90 disabled:opacity-60"
  >
    {loading ? 'Opening…' : label}
  </button>
);

export default InvoicePrintModal;
