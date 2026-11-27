import { NEPAL_TZ } from '../../utils/nepalTime';
import React, { useEffect, useState } from 'react';
import Icon from '../AppIcon';
import { fetchAuditLogs } from '../../services/api';
import { humanizePaymentMethod } from '../../services/paymentMethods';
import { describeClientAdded, describeDetailsChanged } from '../../utils/bookingHistoryText';
import { formatStampNow } from '../../utils/clockTime';

// Booking history (managers/admins; audit_logs is not readable by staff). Shows the staff-availability override rows
// written by migration-353's guard: what was skipped, the reason the manager gave, who and when (panel C, right).
const when = (iso) => {
  try {
    return formatStampNow(iso, false);
  } catch { return ''; }
};

const npr = (n) => `NPR ${Number(n).toLocaleString('en-IN')}`;

const describe = (log) => {
  const d = log.new_data || {};
  if (log.table_name === 'payments' && log.action_type === 'ADMIN_CORRECTION') {
    const o = log.old_data || {};
    if (d.payment_mode !== undefined) return { icon: 'PenLine', title: `Payment method corrected: ${humanizePaymentMethod(o.payment_mode)} → ${humanizePaymentMethod(d.payment_mode)}`, reason: log.reason };
    if (d.amount !== undefined) return { icon: 'PenLine', title: `Payment amount corrected: ${npr(o.amount)} → ${npr(d.amount)}`, reason: log.reason };
  }
  switch (log.action_type) {
    case 'AVAILABILITY_OVERRIDE':
      // ZNLY-418: booked someone who is not on the service's staff list (same audit action, distinct code)
      if (d.code === 'THERAPIST_NOT_ELIGIBLE') return { icon: 'ShieldAlert', title: 'Booked with someone who doesn\'t usually do this service', detail: [d.therapist_name, d.service_name].filter(Boolean).join(' · '), reason: d.override_reason };
      return { icon: 'ShieldAlert', title: `Booked outside availability (${d.message || d.code})`, reason: d.override_reason };
    case 'ADMIN_CORRECTION':
      return { icon: 'PenLine', title: 'Corrected by admin', reason: log.reason };
    case 'STATUS_CHANGE':
      return { icon: 'Repeat', title: `Status ${log.old_data?.status || '?'} → ${d.status || '?'}` };
    case 'CLIENT_ADDED':
      return { icon: 'UserPlus', title: describeClientAdded(d) };
    case 'DETAILS_CHANGED':
      return { icon: 'PenLine', title: describeDetailsChanged(log.old_data, d) };
    default:
      return null;
  }
};

const BookingHistory = ({ bookingId, paymentIds = [], reloadKey = 0 }) => {
  const [rows, setRows] = useState([]);
  const paymentKey = paymentIds.join(',');

  useEffect(() => {
    let cancelled = false;
    if (!bookingId) return undefined;
    // The booking's own rows, plus any admin correction on one of its payments (those are logged against the payment).
    Promise.all([
      fetchAuditLogs({ tableName: 'bookings', recordId: bookingId, limit: 30 }),
      ...paymentKey.split(',').filter(Boolean).map((id) => fetchAuditLogs({ tableName: 'payments', recordId: id, limit: 10 })),
    ]).then((results) => {
      if (cancelled) return;
      const all = results.flatMap((r) => r.data || []);
      all.sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));
      setRows(all);
    });
    return () => { cancelled = true; };
  }, [bookingId, paymentKey, reloadKey]);

  const entries = rows.map((log) => ({ log, info: describe(log) })).filter((e) => e.info);
  if (entries.length === 0) return null;

  return (
    <div data-testid="booking-history" className="pt-3 border-t border-border">
      <p className="font-body font-body-medium text-xs text-text-secondary mb-2">History</p>
      <ul className="space-y-2">
        {entries.map(({ log, info }) => (
          <li key={log.id} className="flex items-start gap-2 text-xs text-text-secondary">
            <Icon name={info.icon} size={13} className="mt-0.5 shrink-0 text-text-tertiary" />
            <div className="min-w-0">
              <p className="text-text-primary">{info.title}</p>
              {info.detail && <p>{info.detail}</p>}
              {info.reason && <p>Reason: “{info.reason}”</p>}
              <p className="text-text-tertiary">{log.changed_by_name || 'System'} · {when(log.changed_at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BookingHistory;
