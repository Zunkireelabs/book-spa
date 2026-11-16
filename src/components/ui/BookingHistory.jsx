import React, { useEffect, useState } from 'react';
import Icon from '../AppIcon';
import { fetchAuditLogs } from '../../services/api';

// Booking history (managers/admins; audit_logs is not readable by staff). Shows the staff-availability override rows
// written by migration-353's guard: what was skipped, the reason the manager gave, who and when (panel C, right).
const when = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
  } catch { return ''; }
};

const describe = (log) => {
  const d = log.new_data || {};
  switch (log.action_type) {
    case 'AVAILABILITY_OVERRIDE':
      return { icon: 'ShieldAlert', title: `Booked outside availability (${d.message || d.code})`, reason: d.override_reason };
    case 'ADMIN_CORRECTION':
      return { icon: 'PenLine', title: 'Corrected by admin', reason: log.reason };
    case 'STATUS_CHANGE':
      return { icon: 'Repeat', title: `Status ${log.old_data?.status || '?'} → ${d.status || '?'}` };
    default:
      return null;
  }
};

const BookingHistory = ({ bookingId }) => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!bookingId) return undefined;
    fetchAuditLogs({ tableName: 'bookings', recordId: bookingId, limit: 30 }).then(({ data }) => {
      if (!cancelled) setRows(data || []);
    });
    return () => { cancelled = true; };
  }, [bookingId]);

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
