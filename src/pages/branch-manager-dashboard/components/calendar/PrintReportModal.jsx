import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { formatClockTime } from './timeFormat';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Confirmed', label: 'Confirmed' },
  { value: 'In-Progress', label: 'In-Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'No Show', label: 'No Show' },
];

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// First print feature in the app — no PDF library, no server-side report
// generation. "Print format: PDF" is just the browser's own print-to-PDF
// destination, not a generated file — this builds a clean HTML report in a
// new window and calls window.print() on it, same posture as
// attendance-calendar's handleExportHTML but printed instead of downloaded.
const PrintReportModal = ({ date, bookings = [], onClose, use24h = false }) => {
  const [hideNotes, setHideNotes] = useState(false);
  const [addStaffNotesSpace, setAddStaffNotesSpace] = useState(false);
  const [onePerPage, setOnePerPage] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const dayBookings = bookings
    .filter(b => b.date === date)
    .filter(b => statusFilter === 'all' || b.status === statusFilter)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  const handlePrint = () => {
    const rows = dayBookings.map((b, i) => `
      <div class="appt" style="${onePerPage && i < dayBookings.length - 1 ? 'break-after: page;' : ''}">
        <div class="appt-time">${formatClockTime(b.startTime, use24h)}</div>
        <div class="appt-body">
          <div class="appt-title">${escapeHtml(b.customerName)} — ${escapeHtml(b.serviceName)}</div>
          <div class="appt-meta">
            ${escapeHtml(b.therapistName || 'Unassigned')}${b.roomName ? ` · ${escapeHtml(b.roomName)}` : ''} · ${escapeHtml(b.status)}
          </div>
          ${!hideNotes && b.specialRequests ? `<div class="appt-notes">Notes: ${escapeHtml(b.specialRequests)}</div>` : ''}
          ${addStaffNotesSpace ? `<div class="staff-notes">Staff notes: ____________________________________________</div>` : ''}
        </div>
      </div>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Day Sheet · ${escapeHtml(formatDateLabel(date))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #111827; padding: 32px; }
    h1 { font-size: 20px; font-weight: 700; }
    .subtitle { font-size: 13px; color: #6B7280; margin-top: 4px; margin-bottom: 20px; }
    .appt { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #E5E7EB; }
    .appt-time { width: 80px; flex-shrink: 0; font-weight: 600; font-size: 13px; color: #111827; }
    .appt-title { font-weight: 600; font-size: 14px; }
    .appt-meta { font-size: 12px; color: #6B7280; margin-top: 2px; }
    .appt-notes { font-size: 12px; color: #374151; margin-top: 4px; font-style: italic; }
    .staff-notes { font-size: 12px; color: #9CA3AF; margin-top: 8px; }
    .empty { color: #9CA3AF; font-size: 13px; padding: 24px 0; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Day Sheet Report</h1>
  <p class="subtitle">${escapeHtml(formatDateLabel(date))} · ${statusFilter === 'all' ? 'All statuses' : escapeHtml(statusFilter)}</p>
  ${dayBookings.length > 0 ? rows : '<p class="empty">No appointments for this day.</p>'}
</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    // Give the new window a tick to lay out before invoking print.
    setTimeout(() => printWindow.print(), 150);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="print-report-title">
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <h2 id="print-report-title" className="font-heading font-heading-semibold text-base text-text-primary">Print report</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
            <Icon name="X" size={16} className="text-text-secondary" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="font-body font-body-medium text-sm text-text-primary">
            The current calendar view will be printed as a day sheet report for {formatDateLabel(date)}.
          </p>

          <div className="space-y-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hideNotes} onChange={(e) => setHideNotes(e.target.checked)} className="w-4 h-4 text-primary rounded focus:ring-primary" />
              <span className="font-body text-sm text-text-primary">Don't show notes entered about the customer</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={addStaffNotesSpace} onChange={(e) => setAddStaffNotesSpace(e.target.checked)} className="w-4 h-4 text-primary rounded focus:ring-primary" />
              <span className="font-body text-sm text-text-primary">Add a space for staff to write in their own notes</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={onePerPage} onChange={(e) => setOnePerPage(e.target.checked)} className="w-4 h-4 text-primary rounded focus:ring-primary" />
              <span className="font-body text-sm text-text-primary">Print each appointment on its own page</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Appointment status</label>
              <CustomSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} size="sm" />
            </div>
            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Print format</label>
              <div className="h-9 flex items-center px-3 text-sm border border-border rounded-spa bg-background text-text-secondary">
                PDF (via browser print)
              </div>
            </div>
          </div>

          <p className="font-caption text-[11px] text-text-tertiary">
            {dayBookings.length} appointment{dayBookings.length === 1 ? '' : 's'} will be included.
          </p>
        </div>

        <div className="border-t border-border px-5 py-3 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-spa border border-border text-sm font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast">
            Cancel
          </button>
          <button type="button" onClick={handlePrint} className="px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 spa-transition-fast inline-flex items-center gap-1.5">
            <Icon name="Printer" size={14} />
            <span>Print</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintReportModal;
