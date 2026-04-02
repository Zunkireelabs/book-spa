import React, { useState, useRef, useEffect, useCallback } from 'react';

const STATUS_COLORS = {
  'Pending':     { bg: '#f59e0b', text: '#fff', light: '#fef3c7' },
  'Confirmed':   { bg: '#3b82f6', text: '#fff', light: '#dbeafe' },
  'In-Progress': { bg: '#6366f1', text: '#fff', light: '#e0e7ff' },
  'Completed':   { bg: '#22c55e', text: '#fff', light: '#dcfce7' },
  'No Show':     { bg: '#991b1b', text: '#fff', light: '#fee2e2' },
};

const UNPAID_BORDER = '#facc15';

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAmount(amount) {
  if (amount == null) return null;
  return Number(amount).toLocaleString('en-IN');
}

const CalendarBookingCard = ({ booking, style, onClick, columnMode = 'therapist' }) => {
  const colors = STATUS_COLORS[booking.status] || STATUS_COLORS['Pending'];
  const isUnpaid = booking.paymentStatus === 'unpaid';
  const isLocked = booking.isLocked;
  const cardRef = useRef(null);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverSide, setPopoverSide] = useState('right'); // right | left
  const hoverTimer = useRef(null);

  const durationMins = (() => {
    if (!booking.startTime || !booking.endTime) return null;
    const [sh, sm] = booking.startTime.split(':').map(Number);
    const [eh, em] = booking.endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  })();

  const timeLabel = booking.startTime && booking.endTime
    ? `${booking.startTime.slice(0, 5)} – ${booking.endTime.slice(0, 5)}`
    : '';

  const handleMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => {
      // Determine side based on card position
      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        // If card is in the right half of the screen, show popover on left
        setPopoverSide(rect.right > viewportWidth * 0.6 ? 'left' : 'right');
      }
      setShowPopover(true);
    }, 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setShowPopover(false);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hoverTimer.current);
  }, []);

  return (
    <div
      ref={cardRef}
      className="absolute left-1 right-1 rounded-md cursor-pointer overflow-visible transition-all duration-150 ease-out hover:shadow-lg hover:z-dropdown"
      style={{
        ...style,
        backgroundColor: colors.light,
        borderLeft: `3px solid ${colors.bg}`,
        borderTop: isUnpaid ? `2px solid ${UNPAID_BORDER}` : 'none',
        borderRight: isUnpaid ? `1px solid ${UNPAID_BORDER}` : `1px solid ${colors.bg}20`,
        borderBottom: isUnpaid ? `1px solid ${UNPAID_BORDER}` : `1px solid ${colors.bg}20`,
      }}
      onClick={(e) => { e.stopPropagation(); onClick(booking); }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Card content */}
      <div className="px-2 py-1.5 h-full flex flex-col overflow-hidden">
        {timeLabel && (
          <div className="font-data text-[10px] text-text-secondary leading-none mb-0.5 flex-shrink-0">
            {timeLabel}
          </div>
        )}
        <div className="font-body font-semibold text-xs text-text-primary leading-tight truncate flex-shrink-0">
          {booking.customerName}
        </div>
        <div className="font-body text-[11px] text-text-secondary leading-tight truncate flex-shrink-0">
          {booking.serviceName}
        </div>
        {columnMode === 'room' && booking.therapistName && (
          <div className="font-caption text-[10px] text-primary/70 leading-tight truncate flex-shrink-0">
            {booking.therapistName}
          </div>
        )}
        {columnMode === 'therapist' && booking.roomName && (
          <div className="font-caption text-[10px] text-secondary/70 leading-tight truncate flex-shrink-0">
            {booking.roomName}
          </div>
        )}
        {durationMins && (
          <div className="font-caption text-[10px] text-text-secondary/70 mt-auto flex-shrink-0">
            {durationMins} mins
          </div>
        )}
        {(isUnpaid || isLocked) && (
          <div className="flex items-center gap-1 mt-0.5 flex-shrink-0">
            {isUnpaid && (
              <span className="inline-flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                <span className="text-[9px] text-yellow-600 font-medium">Unpaid</span>
              </span>
            )}
            {isLocked && <span className="text-[9px]">🔒</span>}
          </div>
        )}
      </div>

      {/* Rich hover popover */}
      {showPopover && (
        <div
          className={`absolute z-[9999] pointer-events-none ${
            popoverSide === 'right'
              ? 'left-full ml-2 top-0'
              : 'right-full mr-2 top-0'
          }`}
          style={{ width: 280 }}
        >
          <div className="bg-surface rounded-lg border border-border spa-shadow-elevated overflow-hidden animate-fade-in">
            {/* Status banner */}
            <div
              className="px-3 py-1.5 text-center text-xs font-body font-semibold"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              {booking.status}
            </div>

            {/* Customer info */}
            <div className="px-3 pt-2.5 pb-2 border-b border-border">
              <div className="flex items-start justify-between">
                <div className="font-body font-semibold text-sm text-text-primary">
                  {booking.customerName}
                </div>
                {booking.bookingNumber && (
                  <span className="font-data text-[10px] text-text-secondary bg-background px-1.5 py-0.5 rounded">
                    #{booking.bookingNumber}
                  </span>
                )}
              </div>
              {booking.customerPhone && (
                <div className="font-caption text-xs text-text-secondary mt-0.5">
                  📞 {booking.customerPhone}
                </div>
              )}
            </div>

            {/* Booking details table */}
            <div className="px-3 py-2 space-y-1.5 border-b border-border">
              <DetailRow label="Service" value={booking.serviceName} />
              <DetailRow
                label="Date"
                value={`${formatDateLabel(booking.date)}, ${timeLabel}`}
              />
              <DetailRow
                label="Duration"
                value={durationMins ? `${durationMins} mins` : (booking.serviceDuration ? `${booking.serviceDuration} mins` : null)}
              />
              <DetailRow label="Therapist" value={booking.therapistName || '—'} />
              <DetailRow label="Room" value={booking.roomName || '—'} />
            </div>

            {/* Financial info */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-1">
                  <span className="font-caption text-[10px] text-text-secondary uppercase tracking-wider">Amount</span>
                  {booking.finalAmount != null ? (
                    <span className="font-data text-sm text-text-primary font-semibold">
                      NPR {formatAmount(booking.finalAmount)}
                    </span>
                  ) : booking.baseAmount != null ? (
                    <span className="font-data text-sm text-text-primary font-semibold">
                      NPR {formatAmount(booking.baseAmount)}
                    </span>
                  ) : (
                    <span className="font-body text-xs text-text-secondary">—</span>
                  )}
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    isUnpaid
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {isUnpaid ? 'Unpaid' : 'Paid'}
                </span>
              </div>
              {booking.discountAmount > 0 && (
                <div className="font-caption text-[10px] text-text-secondary mt-0.5">
                  Discount: NPR {formatAmount(booking.discountAmount)}
                </div>
              )}
            </div>

            {/* Special requests */}
            {booking.specialRequests && (
              <div className="px-3 py-2 border-b border-border">
                <div className="font-caption text-[10px] text-text-secondary uppercase tracking-wider mb-0.5">Notes</div>
                <div className="font-body text-xs text-text-primary italic leading-snug">
                  "{booking.specialRequests}"
                </div>
              </div>
            )}

            {/* CTA hint */}
            <div className="px-3 py-1.5 bg-background/50">
              <div className="font-caption text-[10px] text-text-secondary text-center">
                Click for full details →
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DetailRow = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="font-caption text-[10px] text-text-secondary uppercase tracking-wider w-16 flex-shrink-0 pt-px">
        {label}
      </span>
      <span className="font-body text-xs text-text-primary leading-snug">
        {value}
      </span>
    </div>
  );
};

export default CalendarBookingCard;
