// Single source of truth for booking status colours (calendar cards, popover, legend).
// bar = left accent / dot, fill = soft card background, text = label colour on fill.
// Palette is Zennly's existing card status colours (bar/fill from CalendarBookingCard); text is the matching dark shade.
export const BOOKING_STATUS_COLORS = {
  'Pending':     { bar: '#f59e0b', fill: '#fef3c7', text: '#92400e' },
  'Confirmed':   { bar: '#3b82f6', fill: '#dbeafe', text: '#1e40af' },
  'In-Progress': { bar: '#6366f1', fill: '#e0e7ff', text: '#3730a3' },
  'Completed':   { bar: '#22c55e', fill: '#dcfce7', text: '#166534' },
  'No Show':     { bar: '#6b7280', fill: '#f3f4f6', text: '#374151' },
  'Cancelled':   { bar: '#dc2626', fill: '#fee2e2', text: '#991b1b' },
};

export const UNPAID_DOT_COLOR = '#facc15';

export const getBookingStatusColors = (status) =>
  BOOKING_STATUS_COLORS[status] || BOOKING_STATUS_COLORS['Pending'];
