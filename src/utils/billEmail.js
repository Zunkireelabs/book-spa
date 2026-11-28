// The bill email (ZNLY-445): business name on top, the customer's message, a green "View bill" button, phone + address below.
// Inline styles + a table layout so mail apps render it. No amount can appear: only the message text (three placeholders, no money) and the link.
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildBillEmailHtml({ business, message, url, phone, address }) {
  const foot = [phone, address].map((s) => String(s ?? '').trim()).filter(Boolean).map(esc).join('<br>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9;padding:24px 0;font-family:Arial,Helvetica,sans-serif"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid #E1E3E5;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #E1E3E5;font-size:20px;font-weight:bold;color:#2D5A27">${esc(business)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5;color:#1F2937">${esc(message).replace(/\n/g, '<br>')}</td></tr>
<tr><td style="padding:0 24px 28px"><a href="${esc(url)}" style="display:inline-block;background:#2D5A27;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:6px">View bill</a></td></tr>${foot ? `
<tr><td style="padding:16px 24px;border-top:1px solid #E1E3E5;font-size:13px;line-height:1.5;color:#6B7280">${foot}</td></tr>` : ''}
</table></td></tr></table>`;
}
