// ZNLY-410: the ONE bill drawing. `bill` comes from utils/buildBill.js; `layout` is 'a4' (also the on-screen View) or 'thermal' (80 mm).
// Plain classes + BILL_CSS (not Tailwind) so the exact same markup prints from a new window (printBill) and shows in the side panel.
import React from 'react';
import { formatNPR } from '../../../services/bookingTransformers';

export const BILL_CSS = `
.zbill{font:13px/1.5 Inter,system-ui,-apple-system,sans-serif;color:#0E0D0C;background:#fff;padding:28px 28px 22px}
.zbill *{box-sizing:border-box}
.zbill .hd{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 16px;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #0E0D0C}
.zbill .biz{display:flex;gap:12px;align-items:flex-start;min-width:0;flex:1 1 200px}
.zbill .logo{width:44px;height:44px;border-radius:10px;background:#EEF2EC;color:#2D5A27;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden}
.zbill .logo img{width:100%;height:100%;object-fit:contain}
.zbill .biz b{font-size:16px;display:block}
.zbill .muted{color:#6b6b70;font-size:12px}
.zbill .ttl{text-align:right;flex:none}
.zbill .ttl .t{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b70;font-weight:700}
.zbill .ttl .n{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.zbill .chip{display:inline-block;margin-top:4px;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;background:#E7F5EC;color:#0B6B3A}
.zbill .chip.due{background:#FFF3DC;color:#9A5B00}.zbill .chip.refunded{background:#EEE;color:#555}
.zbill .meta{display:flex;justify-content:space-between;gap:16px;margin:14px 0}
.zbill .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9a9aa0}
.zbill table{width:100%;border-collapse:collapse;margin:6px 0 12px}
.zbill th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b70;font-weight:600;padding:6px 0;border-bottom:1px solid #E5E7EB}
.zbill td{padding:8px 0;border-bottom:1px solid #F1F1F1;vertical-align:top}
.zbill .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.zbill tr.x td{color:#9a9aa0}.zbill tr.x .s{text-decoration:line-through}
.zbill .tot{margin-left:auto;width:min(100%,300px)}
.zbill .row{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.zbill .row.grand{border-top:1px solid #0E0D0C;margin-top:6px;padding-top:8px;font-weight:700;font-size:15px}
.zbill .row.due{font-weight:700;color:#9A5B00}
.zbill .tip{margin-top:10px;font-size:12px;color:#6b6b70}
.zbill .ft{margin-top:20px;padding-top:12px;border-top:1px solid #E5E7EB;text-align:center;color:#6b6b70;font-size:12px;white-space:pre-wrap}
.zbill .ft small{display:block;margin-top:4px;color:#b0b0b5;font-size:10px}
.zbill--thermal{width:80mm;padding:8px 10px;font-size:11px}
.zbill--thermal .hd{display:block;text-align:center;border-bottom:1px dashed #000}
.zbill--thermal .biz{justify-content:center}.zbill--thermal .logo{display:none}
.zbill--thermal .ttl{text-align:center;margin-top:6px}.zbill--thermal .meta{display:block}
.zbill--thermal .tot{width:100%}.zbill--thermal td,.zbill--thermal th{padding:3px 0}
.zbill--thermal .staff{display:block;color:#6b6b70}
@media (max-width:480px){.zbill{padding:18px 14px}.zbill .ttl{text-align:left;flex:1 1 100%}.zbill .meta{flex-wrap:wrap}}
@media print{.zbill{padding:0}.zbill--thermal{padding:2mm}}
`;

const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const STATUS = { paid: ['Paid', ''], due: ['', 'due'], refunded: ['', 'refunded'] };

export const Bill = ({ bill, layout = 'a4' }) => {
  const { org, branch, customer } = bill;
  const thermal = layout === 'thermal';
  const chipText = bill.status.kind === 'due' ? `${formatNPR(bill.status.amount)} still to pay` : bill.status.kind === 'refunded' ? `Refunded ${formatNPR(bill.status.amount)}` : 'Paid';
  const place = [branch.name, branch.address].filter(Boolean).join(' · ');
  return (
    <div className={`zbill ${thermal ? 'zbill--thermal' : ''}`} data-bill>
      <div className="hd">
        <div className="biz">
          <span className="logo">{org.logoUrl ? <img src={org.logoUrl} alt="" /> : initials(org.name)}</span>
          <div>
            <b>{org.legalName || org.name}</b>
            {place && <span className="muted">{place}</span>}
            {(branch.phone || org.phone) && <span className="muted" style={{ display: 'block' }}>{branch.phone || org.phone}</span>}
            {org.pan && <span className="muted" style={{ display: 'block' }}>PAN {org.pan}</span>}
          </div>
        </div>
        <div className="ttl">
          <div className="t">{bill.title}{bill.copyLabel ? ` · ${bill.copyLabel}` : ''}</div>
          <div className="n">{bill.number}</div>
          {bill.title === 'Tax invoice' && bill.bookingNumber && <div className="muted">Booking {bill.bookingNumber}</div>}
          <div className="muted">{bill.dateLabel}{bill.tax ? ` · ${bill.tax.mode === 'addon' ? 'VAT added' : 'VAT included'}` : ''}</div>
          <span className={`chip ${STATUS[bill.status.kind][1]}`}>{chipText}</span>
        </div>
      </div>

      <div className="meta">
        <div><div className="lbl">Billed to</div><b>{customer.name || 'Customer'}</b>{customer.phone && <div className="muted">{customer.phone}</div>}{customer.pan && <div className="muted">PAN {customer.pan}</div>}</div>
        <div style={thermal ? { marginTop: 6 } : { textAlign: 'right' }}><div className="lbl">Visit</div><b>{bill.dateRange}</b>{bill.visitTimes && <div className="muted">{bill.visitTimes}</div>}</div>
      </div>

      <table>
        <thead><tr><th>Service</th>{!thermal && <th>Staff · time</th>}<th className="r">Price</th></tr></thead>
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={i} className={l.cancelled ? 'x' : ''}>
              <td><span className="s">{l.service}{l.qty ? ` × ${l.qty}` : ''}</span>{l.cancelled && <span className="muted" style={{ display: 'block' }}>Cancelled · not charged</span>}{thermal && (l.staff || l.time) && <span className="staff">{[l.staff, l.time].filter(Boolean).join(' · ')}</span>}</td>
              {!thermal && <td className="muted">{[l.staff, l.time].filter(Boolean).join(' · ')}</td>}
              <td className="r">{formatNPR(l.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tot">
        <div className="row"><span>Subtotal</span><span>{formatNPR(bill.subtotal)}</span></div>
        {bill.discount && <div className="row"><span>Discount{bill.discount.pct ? ` ${bill.discount.pct}%` : ''}</span><span>− {formatNPR(bill.discount.amount)}</span></div>}
        {bill.tax && <div className="row"><span>Taxable</span><span>{formatNPR(bill.tax.taxable)}</span></div>}
        {bill.tax && <div className="row"><span>VAT {bill.tax.rate}%</span><span>{formatNPR(bill.tax.vat)}</span></div>}
        <div className="row grand"><span>Total</span><span>{formatNPR(bill.total)}</span></div>
        {bill.paid.map((p, i) => <div className="row" key={i}><span>Paid · {p.label}</span><span>{formatNPR(p.amount)}</span></div>)}
        {bill.refunded > 0 && <div className="row"><span>Refunded</span><span>− {formatNPR(bill.refunded)}</span></div>}
        {bill.stillToPay > 0 && <div className="row due"><span>Still to pay</span><span>{formatNPR(bill.stillToPay)}</span></div>}
      </div>
      {bill.tip > 0 && <p className="tip">Tip {formatNPR(bill.tip)} was given to staff and is not part of this bill.</p>}

      <div className="ft">{bill.footer || 'Thank you for visiting.'}<small>Bill made with Zennly</small></div>
    </div>
  );
};

/** Print the bill: the same <Bill/> rendered to static markup in a new window (no PDF library, same posture as the old invoice print). */
export async function printBill(bill, layout) {
  const w = window.open('', '_blank', layout === 'thermal' ? 'width=400,height=700' : 'width=900,height=1000');
  if (!w) return false;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(<Bill bill={bill} layout={layout} />);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${bill.title} ${bill.number}</title><style>body{margin:0}${layout === 'thermal' ? '@page{size:80mm auto;margin:0}' : ''}${BILL_CSS}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}
