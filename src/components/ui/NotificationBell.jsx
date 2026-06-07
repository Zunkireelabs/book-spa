import React, { useState, useRef, useEffect } from 'react';
import Icon from '../AppIcon';

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m === 1) return '1 min ago';
  if (m < 60) return `${m} mins ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return '1 hour ago';
  if (h < 24) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

const NotificationBell = ({ notifications = [], unreadCount = 0, onMarkAllRead, onItemClick }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-700 spa-transition-fast"
        title="Notifications"
        aria-label="Notifications"
      >
        <Icon name="Bell" size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-error text-white rounded-full text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-dropdown overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={onMarkAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Icon name="BellOff" size={28} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const isDiscount = n.type === 'discount';
                return (
                  <button
                    key={n.id}
                    onClick={() => { onItemClick?.(n); setOpen(false); }}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 spa-transition-fast ${n.read ? '' : 'bg-primary/5'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isDiscount ? 'bg-amber-50' : 'bg-primary/10'}`}>
                      <Icon name={isDiscount ? 'Percent' : 'Calendar'} size={15} className={isDiscount ? 'text-amber-600' : 'text-primary'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {isDiscount ? (
                        <>
                          <p className="text-sm text-gray-900">
                            Discount approval{n.customerName ? ` — ${n.customerName}` : ''}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {n.discountPercent}% off{n.requestedByName ? ` · by ${n.requestedByName}` : ''}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {n.bookingNumber || 'Awaiting your approval'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-gray-900">
                            New booking{n.customerName ? ` — ${n.customerName}` : ''}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {n.bookingNumber ? `${n.bookingNumber} · ` : ''}{n.date}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                        </>
                      )}
                    </div>
                    {!n.read && <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${isDiscount ? 'bg-amber-500' : 'bg-primary'}`} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
