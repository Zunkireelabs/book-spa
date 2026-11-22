import { NEPAL_TZ } from '../../utils/nepalTime';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './BottomSheet';
import { Link } from 'react-router-dom';
import Icon from '../AppIcon';
import { useIndustry } from '../../hooks/useIndustry';
import {
  categoryOf, categoriesForRole, groupNotifications, groupUnread, badgeText,
} from '../../lib/notificationRules';

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

// Nepal-day boundary for the Today / Earlier split.
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: NEPAL_TZ });

export const bookingWords = ({ industryType, sessionLabel, sessionLabelPlural }) => (
  industryType === 'spa' || !sessionLabel
    ? { one: 'booking', many: 'bookings' }
    : { one: sessionLabel.toLowerCase(), many: (sessionLabelPlural || `${sessionLabel}s`).toLowerCase() }
);

const CAT_LABEL = { approvals: 'Approvals', team: 'Team', stock: 'Stock', guests: 'Guests' };

const CAT_STYLE = {
  bookings: { icon: 'Globe', wrap: 'bg-primary/10', color: 'text-primary' },
  approvals: { icon: 'Percent', wrap: 'bg-warning/10', color: 'text-warning' },
  team: { icon: 'Users', wrap: 'bg-gray-100', color: 'text-text-primary' },
  stock: { icon: 'Package', wrap: 'bg-gray-100', color: 'text-text-secondary' },
  guests: { icon: 'Heart', wrap: 'bg-gray-100', color: 'text-text-secondary' },
};
const typeStyle = (n) => {
  if (n.type === 'discount_declined') return { icon: 'X', wrap: 'bg-error/10', color: 'text-error' };
  if (n.type === 'booking_group_stuck') return { icon: 'AlertTriangle', wrap: 'bg-error/10', color: 'text-error' };
  if (n.type === 'discount_approved') return { icon: 'Check', wrap: 'bg-success/10', color: 'text-success' };
  return CAT_STYLE[n.category] || CAT_STYLE.bookings;
};

const guestName = (n) => String(n.body || '').split(' · ')[0] || 'Guest';

const BranchChip = ({ name }) => (name ? (
  <span className="inline-flex items-center gap-1 text-[11px] font-body-medium text-text-secondary bg-gray-100 rounded px-1.5 py-px">
    <Icon name="Building2" size={10} />{name}
  </span>
) : null);

const Row = ({ n, branchName, onClick }) => {
  const st = typeStyle(n);
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 spa-transition-fast ${n.read ? '' : 'bg-primary/5'}`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${st.wrap}`}>
        <Icon name={st.icon} size={15} className={st.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm text-gray-900 flex items-center gap-1.5 flex-wrap ${n.read ? '' : 'font-body-medium'}`}>
          <span>{n.title}</span><BranchChip name={branchName} />
        </p>
        {n.body && <p className="text-xs text-gray-500 line-clamp-2">{n.body}</p>}
        <p className="text-[11px] text-gray-400 mt-0.5">
          {n.seenBy ? <span className="text-gray-500">Seen by {n.seenBy} · {timeAgo(n.seenAt)}</span> : timeAgo(n.createdAt)}
        </p>
      </div>
      {!n.read && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 bg-primary" />}
    </button>
  );
};

const GroupRow = ({ entry, branchName, words, expanded, onToggle }) => {
  const unread = groupUnread(entry);
  const names = entry.items.map(guestName).join(', ');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 spa-transition-fast ${unread ? 'bg-primary/5' : ''}`}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-primary/10">
        <Icon name="Globe" size={15} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm text-gray-900 flex items-center gap-1.5 flex-wrap ${unread ? 'font-body-medium' : ''}`}>
          <span>{entry.items.length} new online {words.many}</span><BranchChip name={branchName} />
        </p>
        <p className="text-xs text-gray-500 line-clamp-2">{names}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(entry.createdAt)} · tap to see each</p>
      </div>
      {unread > 0 && <span className="text-[10px] font-bold text-white bg-primary rounded-full px-1.5 py-px flex-shrink-0 mt-0.5">{unread}</span>}
    </button>
  );
};

const NotificationBell = ({
  notifications = [], unreadCount = 0, totalUnread, role, branches = [], inboxPath = '/inbox', onMarkAllRead, onItemClick,
}) => {
  const industry = useIndustry();
  const words = bookingWords(industry);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  const [coords, setCoords] = useState({ top: 0, left: 8, right: 8 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const updateCoords = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Left edge stays where the old 440px panel started; the right edge lines up with the profile menu (the avatar's right edge).
    const avatar = document.querySelector('[data-profile-anchor]')?.getBoundingClientRect();
    const rightEdge = Math.min(avatar ? avatar.right : r.right, window.innerWidth - 8);
    setCoords({ top: r.bottom + 12, left: Math.max(8, Math.min(r.right - 440, rightEdge - 320)), right: window.innerWidth - rightEdge });
  }, []);

  useBodyScrollLock(open);
  const toggle = () => {
    if (!open) updateCoords();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', updateCoords, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [open, updateCoords]);

  const items = useMemo(() => notifications.map((n) => ({ ...n, category: n.category || categoryOf(n.type) })), [notifications]);
  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id) => map.get(id) || null;
  }, [branches]);
  // Branch chips only for people who see more than one branch.
  const multiBranch = branches.length > 1 || new Set(items.map((i) => i.branchId).filter(Boolean)).size > 1;

  const tabs = useMemo(() => {
    // Only categories this role can receive AND that have at least one item in the feed.
    const allowed = new Set(categoriesForRole(role));
    const have = new Set(items.map((i) => i.category));
    return ['all', ...['bookings', 'approvals', 'team', 'stock', 'guests'].filter((c) => allowed.has(c) && have.has(c))];
  }, [items, role]);
  const tabLabel = (t) => (t === 'all' ? 'All' : t === 'bookings' ? words.many.replace(/^./, (c) => c.toUpperCase()) : CAT_LABEL[t]);
  const unreadIn = (t) => items.filter((i) => !i.read && (t === 'all' || i.category === t)).length;

  const visible = tab === 'all' ? items : items.filter((i) => i.category === tab);
  const entries = useMemo(() => groupNotifications(visible), [visible]);
  const today = dayKey(new Date());
  const entryDay = (e) => dayKey(e.kind === 'group' ? e.createdAt : e.item.createdAt);
  const todays = entries.filter((e) => entryDay(e) === today);
  const earlier = entries.filter((e) => entryDay(e) !== today);

  const click = (n) => { onItemClick?.(n); setOpen(false); };
  const toggleGroup = (id) => setExpanded((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  const renderEntry = (e) => {
    if (e.kind === 'single') return <Row key={e.item.id} n={e.item} branchName={multiBranch ? branchName(e.item.branchId) : null} onClick={click} />;
    const isOpen = expanded.has(e.id);
    return (
      <React.Fragment key={e.id}>
        <GroupRow entry={e} words={words} branchName={multiBranch ? branchName(e.branchId) : null} expanded={isOpen} onToggle={() => toggleGroup(e.id)} />
        {isOpen && e.items.map((n) => <Row key={n.id} n={n} branchName={multiBranch ? branchName(n.branchId) : null} onClick={click} />)}
      </React.Fragment>
    );
  };

  const shownUnread = items.filter((i) => !i.read).length;
  const total = totalUnread ?? unreadCount;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-700 spa-transition-fast"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Icon name="Bell" size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-error text-white rounded-full text-[10px] font-bold flex items-center justify-center">
            {badgeText(unreadCount)}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, right: coords.right, '--panel-top': `${coords.top}px`, '--panel-gap': '64px' }}
          className="panel-fit panel-fit-nav flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 z-notification overflow-hidden overscroll-contain"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button onClick={onMarkAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
              )}
              <Link to={`${inboxPath}?c=settings`} onClick={() => setOpen(false)} aria-label="Notification settings" title="Notification settings" className="text-gray-400 hover:text-gray-700">
                <Icon name="Settings" size={15} />
              </Link>
            </div>
          </div>

          <div className="flex gap-0.5 px-2 pt-2 border-b border-gray-100 overflow-x-auto" role="tablist">
            {tabs.map((t) => {
              const c = unreadIn(t);
              const on = tab === t;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t)}
                  className={`px-2 py-2 text-xs whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 ${on ? 'border-primary text-primary font-body-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                >
                  {tabLabel(t)}
                  {c > 0 && <span className={`rounded-full px-1.5 text-[10px] font-bold ${on ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>{c}</span>}
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {entries.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Icon name="BellOff" size={28} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : (
              <>
                {todays.length > 0 && <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-400">Today</p>}
                {todays.map(renderEntry)}
                {earlier.length > 0 && <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-400">Earlier</p>}
                {earlier.map(renderEntry)}
              </>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
            <span>{shownUnread} of {total} unread shown</span>
            <Link to={tab === 'all' ? inboxPath : `${inboxPath}?c=${tab}`} onClick={() => setOpen(false)} className="text-primary font-body-medium hover:underline">Open Inbox →</Link>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default NotificationBell;
