import { formatClockNow } from './clockTime';
// Plain-language lines for the booking History panel (ZNLY-330). Rows come from log_booking_changes() (migration-408).
const clock = (hhmm) => (Number.isNaN(Number(String(hhmm || '').split(':')[0])) ? String(hhmm || '') : formatClockNow(String(hhmm)));
const day = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const shown = (v) => (v == null || v === '' ? 'none' : `“${v}”`);

export function describeClientAdded(newData) {
  return `Client added: ${newData?.customer_name || 'client'}`;
}

export function describeDetailsChanged(oldData, newData) {
  const o = oldData || {}; const n = newData || {};
  const parts = [];
  if ('customer_name' in n) parts.push(`name ${o.customer_name || 'none'} → ${n.customer_name || 'none'}`);
  if ('service_name' in n) parts.push(`service ${o.service_name || 'none'} → ${n.service_name || 'none'}`);
  if ('date' in n) parts.push(`date ${day(o.date)} → ${day(n.date)}`);
  if ('start_time' in n) parts.push(`time ${clock(o.start_time)} → ${clock(n.start_time)}`);
  if ('customer_phone' in n) parts.push('phone updated');
  if ('special_requests' in n) parts.push(`notes ${shown(o.special_requests)} → ${shown(n.special_requests)}`);
  if ('referred_by' in n) parts.push(`referred by ${o.referred_by || 'none'} → ${n.referred_by || 'none'}`);
  return parts.length ? `Details changed: ${parts.join(' · ')}` : 'Details changed';
}
