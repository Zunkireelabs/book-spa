import { NEPAL_TZ } from '../../utils/nepalTime';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/ui/AppShell';
import AreaLayout, { menuRow } from '../branch-manager-dashboard/components/Area/AreaLayout';
import Icon from '../../components/AppIcon';
import CustomSelect from '../../components/ui/CustomSelect';
import SidePanel from '../../components/ui/SidePanel';
import { bookingWords } from '../../components/ui/NotificationBell';
import { AIAssistantPanel } from '../../components/ui/AIAssistant';
import { useAIAssistant } from '../../contexts/AIAssistantContext';
import { useOrg } from '../../contexts/OrgContext';
import { useBranch } from '../../contexts/BranchContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useIndustry } from '../../hooks/useIndustry';
import { friendlyError } from '../../utils/friendlyError';
import { toDbStatus } from '../../services/bookingTransformers';
import { actionFor, statusChipFor, isRemovedBooking, OPEN_LABEL, createDelayedSaver, CONFIRM_UNDO_MS } from '../../lib/inboxActions';
import {
  buildInboxFilter, categoriesForRole, categoryOf, groupByDayLabel, INBOX_PAGE_SIZE,
} from '../../lib/notificationRules';
import { fetchInbox, fetchInboxCounts, fetchLastNotificationAt, markInboxFilterRead, updateBookingStatus, acknowledgeBooking } from '../../services/api';
import InboxBookingPanel from './InboxBookingPanel';
import NotificationSettingsContent, { CATEGORY_META } from './NotificationSettingsPanel';
import { wordBranch, wordBranches } from '../../utils/industryTerms';
import { formatClockIsoNow, formatStampNow } from '../../utils/clockTime';

const TYPE_ICON = {
  new_online_booking: 'Globe', booking_cancelled_by_guest: 'CalendarX', booking_rescheduled_by_guest: 'CalendarClock',
  discount_request: 'Percent', discount_big_fyi: 'Percent', discount_approved: 'Check', discount_declined: 'X', booking_group_stuck: 'AlertTriangle', low_stock: 'Package',
  attendance_gap: 'Clock', attendance_gaps: 'Clock', transferred_staff_reminder: 'ArrowLeftRight', outreach_review_pending: 'Heart', renewal_due: 'Heart',
};
const ICON_STYLE = { bookings: 'bg-primary/10 text-primary', approvals: 'bg-warning/10 text-warning', team: 'bg-blue-50 text-blue-600', stock: 'bg-gray-100 text-gray-600', guests: 'bg-pink-50 text-pink-600' };
// Where a non-booking item leads (the panel offers it as a link).
const DESTINATION = { stock: ['products', 'Open products'], team: ['attendance', 'Open attendance'], guests: ['outreach-review', 'Open outreach review'] };

const timeOf = (iso) => formatClockIsoNow(iso);
const dateTimeOf = (iso) => formatStampNow(iso);

const normalizeRow = (r) => ({
  id: r.id, type: r.type, title: r.title, body: r.body, bookingId: r.booking_id, branchId: r.branch_id || null, actorId: r.actor_id || null, booking: r.booking || null,
  category: r.category || categoryOf(r.type), read: r.read, createdAt: r.created_at,
});

const InboxBody = () => {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { org } = useOrg();
  const { branchName, switchBranch } = useBranch();
  const { user } = useAuth();
  const words = bookingWords(useIndustry());
  const {
    role, branches, items: feedItems, unreadCount, markRead, markUnread, setPref, reload: reloadFeed,
  } = useNotifications();
  const base = org?.slug ? `/${org.slug}` : '';
  const allowed = useMemo(() => categoriesForRole(role), [role]);
  const multiBranch = branches.length > 1;

  // ?c=<category> | settings. (?settings=1 from older links still opens the settings page.)
  const cParam = sp.get('c');
  const settingsView = cParam === 'settings' || sp.get('settings') === '1';
  const category = allowed.includes(cParam) ? cParam : null;
  const openId = sp.get('n') || '';
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [branchId, setBranchId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [counts, setCounts] = useState({ byCategory: {}, approvalRequests: 0 });
  const [lastAt, setLastAt] = useState(null);
  const [muted, setMuted] = useState(null);
  const reqRef = useRef(0);
  const sentinelRef = useRef(null);
  const scrollerRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => setSearch(searchText), 250); return () => clearTimeout(t); }, [searchText]);
  const patch = useCallback((changes) => {
    const next = new URLSearchParams(sp);
    Object.entries(changes).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const filter = useMemo(
    () => buildInboxFilter({ unreadOnly, category, branchId, search, allowed }),
    [unreadOnly, category, branchId, search, allowed],
  );

  const loadFirst = useCallback(async () => {
    const req = ++reqRef.current;
    const r = await fetchInbox(filter);
    if (req !== reqRef.current) return;
    if (r.error) { setError("Couldn't load your notifications."); setLoading(false); return; }
    setError(null);
    setRows(r.data.map(normalizeRow));
    setHasMore(r.data.length >= INBOX_PAGE_SIZE);
    setLoading(false);
  }, [filter]);

  const loadCounts = useCallback(async () => {
    const [c, l] = await Promise.all([fetchInboxCounts(), fetchLastNotificationAt()]);
    if (c.data) setCounts(c.data);
    if (l.data !== undefined) setLastAt(l.data);
  }, []);

  useEffect(() => { setLoading(true); loadFirst(); }, [loadFirst]);
  // A live notification (or a read elsewhere) changes the feed's head / unread total: refresh page one and the counts.
  const liveKey = `${feedItems[0]?.id || ''}|${unreadCount}`;
  useEffect(() => { loadCounts(); }, [loadCounts, liveKey]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    loadFirst();
  }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !rows.length) return;
    setLoadingMore(true);
    const req = reqRef.current;
    const r = await fetchInbox({ ...filter, before: rows[rows.length - 1].createdAt });
    setLoadingMore(false);
    if (req !== reqRef.current || r.error) return;
    setRows((prev) => [...prev, ...r.data.map(normalizeRow).filter((n) => !prev.some((p) => p.id === n.id))]);
    setHasMore(r.data.length >= INBOX_PAGE_SIZE);
  }, [filter, hasMore, loadingMore, rows]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore(); }, { root: scrollerRef.current || null, rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, rows.length, settingsView]);

  const setRead = (id, read) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, read } : r)));
  const [openCache, setOpenCache] = useState(null); // the clicked row, kept even if a reload drops it from the Unread list
  const openRow = (n) => {
    setOpenCache({ ...n, read: true });
    if (!n.read) { setRead(n.id, true); markRead([n.id]); }
    patch({ n: n.id });
  };
  const toggleUnread = (n) => { setRead(n.id, !n.read); if (n.read) markUnread(n.id); else markRead([n.id]); };
  const mute = async (n) => {
    await setPref(n.category, { popup: false, sound: false });
    setMuted(CATEGORY_META[n.category]?.label || n.category);
    setTimeout(() => setMuted(null), 3500);
  };

  // ── Quick actions (ZNLY-140) ──
  // Confirm shows at once and is really saved after 5 s (Gmail-style): the state machine has no Confirmed -> Pending, so Undo just cancels the save.
  const [undoStack, setUndoStack] = useState([]); // [{ id, bookingNo, guest }] pending confirms, newest last
  const [flash, setFlash] = useState(null);
  const originals = useRef(new Map()); // notification id -> the row before the optimistic confirm
  const reloadRef = useRef(null);
  reloadRef.current = () => { loadFirst(); loadCounts(); };
  const saveConfirm = useCallback(async (id, { bookingId }) => {
    setUndoStack((s) => s.filter((x) => x.id !== id));
    originals.current.delete(id);
    const r = await updateBookingStatus({ bookingId, newStatus: toDbStatus('confirmed') });
    if (r.error) {
      setFlash(friendlyError(r.error, "Couldn't confirm that booking."));
      setTimeout(() => setFlash(null), 4000);
      reloadRef.current?.();
      return;
    }
    await acknowledgeBooking(bookingId);
    markRead([id]);
    reloadRef.current?.();
  }, [markRead]);
  const saveRef = useRef(saveConfirm);
  saveRef.current = saveConfirm; // the saver is built once; its save always goes through the latest callback
  const saverRef = useRef(null);
  if (!saverRef.current) saverRef.current = createDelayedSaver({ save: (id, payload) => saveRef.current(id, payload) });
  useEffect(() => {
    const flush = () => saverRef.current.flush();
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  const confirmRow = (n) => {
    originals.current.set(n.id, n);
    const me = user?.id;
    setRows((rs) => rs.map((r) => (r.id === n.id
      ? { ...r, read: true, booking: { ...r.booking, status: 'Confirmed', acknowledged_by: me, acknowledged_at: new Date().toISOString(), acknowledger: { full_name: 'you' } } }
      : r)));
    markRead([n.id]);
    setUndoStack((s) => [...s, { id: n.id, bookingNo: n.booking?.booking_number, guest: n.booking?.customer_name }]);
    saverRef.current.schedule(n.id, { bookingId: n.bookingId });
  };
  const undoConfirm = useCallback((id) => {
    if (!saverRef.current.undo(id)) return;
    const orig = originals.current.get(id);
    originals.current.delete(id);
    setUndoStack((s) => s.filter((x) => x.id !== id));
    if (orig) {
      setRows((rs) => rs.map((r) => (r.id === id ? orig : r)));
      if (!orig.read) markUnread(id);
    }
  }, [markUnread]);
  const topUndo = undoStack[undoStack.length - 1] || null;
  useEffect(() => {
    if (!topUndo) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') undoConfirm(topUndo.id); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topUndo, undoConfirm]);
  const [barOn, setBarOn] = useState(false);
  useEffect(() => { setBarOn(false); if (!topUndo) return undefined; const t = setTimeout(() => setBarOn(true), 30); return () => clearTimeout(t); }, [topUndo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const goThere = (n, dest) => {
    markRead([n.id]); setRead(n.id, true);
    if (dest === 'attendance') {
      if (n.branchId) switchBranch?.(n.branchId);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: NEPAL_TZ }).format(new Date(n.createdAt));
      navigate(`${base}/dashboard?view=attendance&date=${day}`);
    } else navigate(`${base}/dashboard?view=${dest}`);
  };
  const muteTip = (n) => `Mute ${n.type === 'new_online_booking' ? `new online ${words.many}` : (CATEGORY_META[n.category]?.label || n.category).toLowerCase()}`;
  const iconBtn = (label, icon, onClick, last = false) => (
    <span className="relative group/tip">
      <button type="button" aria-label={label} onClick={onClick}
        className="w-7 h-7 rounded-lg border border-border bg-white text-text-secondary flex items-center justify-center hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <Icon name={icon} size={14} />
      </button>
      <span className={`pointer-events-none hidden group-hover/tip:block group-focus-within/tip:block absolute bottom-full mb-1.5 ${last ? 'right-0' : 'left-1/2 -translate-x-1/2'} bg-gray-900 text-white text-[11px] rounded-md px-2 py-0.5 whitespace-nowrap z-dropdown`}>
        {label}
        <span className={`absolute top-full ${last ? 'right-2.5' : 'left-1/2 -translate-x-1/2'} border-4 border-transparent border-t-gray-900`} />
      </span>
    </span>
  );
  const typeAction = (n, act) => {
    if (act === 'confirm') {
      return <button type="button" onClick={(e) => { e.stopPropagation(); confirmRow(n); }} className="text-[12.5px] font-medium px-3 h-7 rounded-lg bg-primary text-white hover:bg-primary/90 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">Confirm</button>;
    }
    if (act === 'open') {
      return <button type="button" onClick={(e) => { e.stopPropagation(); openRow(n); }} className="text-[12.5px] font-medium px-3 h-7 rounded-lg border border-border bg-white text-text-primary hover:bg-gray-50 whitespace-nowrap">Open</button>;
    }
    if (act.startsWith('open:')) {
      const dest = act.slice(5);
      return <button type="button" onClick={(e) => { e.stopPropagation(); goThere(n, dest); }} className="text-[12.5px] font-medium px-3 h-7 rounded-lg border border-border bg-white text-text-primary hover:bg-gray-50 whitespace-nowrap">{OPEN_LABEL[dest] || 'Open →'}</button>;
    }
    return null;
  };

  const markAll = async () => {
    setRows((rs) => rs.map((r) => ({ ...r, read: true })));
    await markInboxFilterRead(filter);
    reloadFeed();
    loadCounts();
  };

  const open = rows.find((r) => r.id === openId) || null;
  const [openFetched, setOpenFetched] = useState(null);
  // ?n= can point at a row that is not in the loaded page (e.g. the pop-up's Review button): take it from the bell's feed.
  useEffect(() => { setOpenFetched(openId && !open ? feedItems.find((f) => f.id === openId) || null : null); }, [openId, open, feedItems]);
  const openItem = open || (openCache?.id === openId ? openCache : null) || openFetched;
  const closePanel = () => patch({ n: '' });

  const totalUnread = allowed.reduce((n, c) => n + (counts.byCategory[c] || 0), 0);
  const groups = useMemo(() => groupByDayLabel(rows), [rows]);
  const branchLabel = (id) => (multiBranch ? branches.find((b) => b.id === id)?.name : null);
  const branchOptions = [{ value: '', label: `All ${wordBranches()}` }, ...branches.map((b) => ({ value: b.id, label: b.name }))];
  const goTo = (c) => patch({ c: c === 'all' ? '' : c, settings: '', n: '' });

  // ── Menu (shared AreaLayout) ──
  const activeView = settingsView ? 'settings' : (category || 'all');
  const menuTop = (
    <>
      <button type="button" className={menuRow(activeView === 'all')} onClick={() => goTo('all')} aria-current={activeView === 'all' ? 'page' : undefined}>
        <Icon name="Inbox" size={15} className="flex-shrink-0" />
        <span className="flex-1">All</span>
        {totalUnread > 0 && <span className="text-[11px] text-text-tertiary tabular-nums">{totalUnread}</span>}
      </button>
      <div className="h-px bg-border my-3" />
    </>
  );
  const menuCategories = [
    { id: 'categories', label: 'Categories', items: allowed.map((c) => ({ id: c, view: c, title: CATEGORY_META[c].label, icon: CATEGORY_META[c].icon, count: counts.byCategory[c] || 0 })) },
    { id: 'prefs', label: 'Preferences', items: [{ id: 'settings', view: 'settings', title: 'Notification settings', icon: 'Settings' }] },
  ];

  const scope = branchId ? branches.find((b) => b.id === branchId)?.name || `This ${wordBranch()}` : (multiBranch ? `All ${wordBranches()}` : (branchName || branches[0]?.name || `This ${wordBranch()}`));
  const chipCount = category ? (counts.byCategory[category] || 0) : totalUnread;
  const emptyAllRead = !loading && !error && rows.length === 0;
  const unreadAny = totalUnread > 0 || rows.some((r) => !r.read);
  const showApprovals = role !== 'staff' && counts.approvalRequests > 0;

  const header = (reopen) => (
    <div className="px-4 sm:px-6 lg:px-8 pt-5 flex-shrink-0">
      <div className="flex items-center gap-2">
        {reopen}
        <h1 className="font-heading font-heading-semibold text-xl text-text-primary">
          {settingsView ? 'Notification settings' : (category ? CATEGORY_META[category].label : 'All notifications')}
        </h1>
        {!settingsView && <span className="px-2 py-0.5 rounded-full bg-black/[0.05] text-[11px] font-medium text-text-secondary tabular-nums">{chipCount} unread</span>}
      </div>
      <p className="mt-1 text-[13px] text-text-secondary">
        {settingsView ? 'What interrupts you. Everything always lands in the Inbox.' : (
          <>{scope}{showApprovals && <> · <b className="font-medium text-warning">{counts.approvalRequests} need{counts.approvalRequests === 1 ? 's' : ''} your approval</b></>}</>
        )}
      </p>
      {/* Below lg the menu is hidden: a scrolling tab strip stands in for it. */}
      <div className="lg:hidden mt-3 -mx-1 flex gap-1 overflow-x-auto" role="tablist" aria-label="Inbox categories">
        {[['all', 'All', totalUnread], ...allowed.map((c) => [c, CATEGORY_META[c].label, counts.byCategory[c] || 0]), ['settings', 'Settings', 0]].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={activeView === k} onClick={() => goTo(k)}
            className={`px-3 h-8 rounded-full text-[13px] whitespace-nowrap ${activeView === k ? 'bg-white shadow-[0_0_0_1px_#E9E9EC] font-medium text-text-primary' : 'text-text-secondary'}`}>
            {l}{n > 0 ? ` ${n}` : ''}
          </button>
        ))}
      </div>
    </div>
  );

  // Fixed above the scroller, so it stays put and nothing shows through it; the hairline spans the pane.
  const toolbar = (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-4 border-b border-border flex-shrink-0 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search guest, #, staff"
          aria-label="Search notifications"
          className="h-9 w-64 sm:w-[300px] pl-9 pr-3 rounded-spa-lg border border-border bg-surface text-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div className="inline-flex rounded-spa-lg border border-border bg-surface p-0.5 text-[12.5px]" role="group" aria-label="Show">
        {[[true, 'Unread'], [false, 'All']].map(([v, l]) => (
          <button key={l} type="button" onClick={() => setUnreadOnly(v)} aria-pressed={unreadOnly === v}
            className={`px-3 h-8 rounded-spa ${unreadOnly === v ? 'bg-black/[0.06] font-medium text-text-primary' : 'text-text-secondary'}`}>{l}</button>
        ))}
      </div>
      {multiBranch && (
        <div className="w-44"><CustomSelect size="sm" value={branchId} onChange={setBranchId} options={branchOptions} /></div>
      )}
      <button type="button" onClick={markAll} disabled={!unreadAny}
        className="ml-auto h-9 px-3 text-[13px] border border-border rounded-spa-lg bg-surface inline-flex items-center gap-1.5 hover:bg-black/[0.03] disabled:opacity-40">
        <Icon name="CheckCheck" size={14} /> Mark all read
      </button>
    </div>
  );

  const list = (
    <>
      {error && <p className="py-10 text-center text-sm text-error">{error} <button type="button" className="underline" onClick={loadFirst}>Try again</button></p>}
      {loading && !error && <div className="py-16 text-center text-sm text-text-tertiary">Loading…</div>}
      {emptyAllRead && (
        <div className="py-16 text-center">
          <Icon name="CheckCircle2" size={30} className="text-gray-300 mx-auto mb-2" />
          <p className="text-[14px] font-medium text-text-primary">{search || branchId ? 'Nothing matches' : "You're all caught up"}</p>
          <p className="text-[13px] text-text-tertiary mt-1">
            {search || branchId ? `Try a different search or ${wordBranch()}.` : lastAt ? `Last notification: ${dateTimeOf(lastAt)}` : 'Nothing has come in yet.'}
          </p>
          {unreadOnly && !search && !branchId && lastAt && (
            <button type="button" onClick={() => setUnreadOnly(false)} className="mt-3 text-[13px] font-medium text-primary hover:underline">Show read ones too</button>
          )}
        </div>
      )}
      {!loading && groups.map((g) => (
        <section key={g.label}>
          {/* Date label: outside the card, sticky and opaque. */}
          <h2 className="sticky top-0 z-sticky-filter bg-surface-dim px-4 sm:px-6 lg:px-8 pt-4 pb-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{g.label}</h2>
          <ul className="border-y border-border rounded-none bg-surface ">
            {g.items.map((n) => (
              <li key={n.id}
                className={`group relative flex items-start gap-3 pl-4 sm:pl-6 lg:pl-8 pr-4 sm:pr-6 lg:pr-8 py-3 cursor-pointer border-b border-border last:border-b-0 hover:bg-black/[0.02] ${n.read ? '' : 'bg-primary/5'} ${openId === n.id ? 'shadow-[inset_3px_0_0_#2D5A27]' : ''}`}
                onClick={() => openRow(n)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openRow(n); }}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${n.type === 'booking_cancelled_by_guest' ? 'bg-red-50 text-red-600' : ICON_STYLE[n.category]}`}><Icon name={TYPE_ICON[n.type] || 'Bell'} size={15} /></span>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13.5px] text-text-primary flex items-center gap-2 flex-wrap ${n.read ? '' : 'font-semibold'}`}>
                    <span>{n.title}</span>
                    {branchLabel(n.branchId) && <span className="text-[11px] font-normal bg-gray-100 text-text-secondary rounded px-1.5 py-px">{branchLabel(n.branchId)}</span>}
                    {(() => {
                      const chip = statusChipFor(n, { userId: user?.id, saving: saverRef.current.has(n.id), word: words.one });
                      if (!chip.kind) return null;
                      return <span className={`text-[11px] font-normal rounded px-1.5 py-px ${chip.kind === 'pending' ? 'bg-warning/10 text-warning' : chip.kind === 'late' ? 'bg-error/10 text-error' : 'bg-gray-100 text-text-secondary'}`}>{chip.text}</span>;
                    })()}
                  </p>
                  {n.body && <p className={`text-[13px] mt-0.5 leading-snug truncate ${n.read ? 'text-text-tertiary' : 'text-text-secondary'}`}>{n.body}</p>}
                  {/* Phone / touch: the type action sits under the text; read/mute live in the panel. */}
                  {(() => { const a = actionFor(n, { role }); return a === 'none' ? null : <div className="mt-2 hidden max-sm:block [@media(hover:none)]:block" onClick={(e) => e.stopPropagation()}>{typeAction(n, a)}</div>; })()}
                </div>
                <span className="text-[12px] text-text-tertiary tabular-nums flex-shrink-0 pt-0.5 [@media(hover:hover)]:group-hover:sm:hidden [@media(hover:hover)]:group-focus-within:sm:hidden">{timeOf(n.createdAt)}</span>
                {/* Hover / keyboard focus: the time gives way to [type action] [read/unread] [mute]. Never on touch. */}
                <div className="relative hidden flex-shrink-0 items-center gap-1.5 self-center [@media(hover:hover)]:sm:group-hover:flex [@media(hover:hover)]:sm:group-focus-within:flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {typeAction(n, actionFor(n, { role }))}
                  {iconBtn(n.read ? 'Mark unread' : 'Mark read', n.read ? 'Mail' : 'MailOpen', () => toggleUnread(n))}
                  {iconBtn(muteTip(n), 'BellOff', () => mute(n), true)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div ref={sentinelRef} className="h-4" />
      {loadingMore && <p className="py-3 text-center text-xs text-text-tertiary">Loading more…</p>}
      {!loading && !hasMore && rows.length > 0 && !unreadOnly && <p className="py-3 text-center text-xs text-text-tertiary">That's everything from the last 90 days.</p>}
      <div className="h-6" />
    </>
  );

  const removedOpen = openItem && isRemovedBooking(openItem);
  const hasBookingPanel = openItem && openItem.bookingId && !removedOpen && (openItem.category === 'bookings' || openItem.category === 'approvals');
  return (
    <>
      <AreaLayout title="Inbox" menuStorageKey="zennly.inbox.menu" menuTop={menuTop} categories={menuCategories} activeView={activeView} onNavigate={goTo}>
        {({ reopen }) => (
          <>
            {header(reopen)}
            {settingsView ? (
              <div className="content-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 pt-4 pb-8"><NotificationSettingsContent /></div>
            ) : (
              <>
                {toolbar}
                <div ref={scrollerRef} className="content-scroll flex-1 min-h-0 overflow-y-auto">{list}</div>
              </>
            )}
          </>
        )}
      </AreaLayout>

      {!settingsView && hasBookingPanel && (
        <InboxBookingPanel bookingId={openItem.bookingId} onClose={closePanel} onChanged={() => { loadFirst(); loadCounts(); }} />
      )}
      {!settingsView && openItem && !hasBookingPanel && (
        <SidePanel isOpen title={openItem.title} onClose={closePanel}>
          <div className="px-5 py-4">
            {removedOpen ? (
              <>
                {openItem.body && <p className="text-[13px] text-text-secondary mb-3">{openItem.body}</p>}
                <p className="text-[13px] text-text-secondary">This {words.one} was deleted.</p>
              </>
            ) : openItem.category === 'bookings' || openItem.category === 'approvals' ? (
              <p className="text-[13px] text-text-secondary mb-3">This {words.one} no longer exists. The notification stays here as a record.</p>
            ) : (
              <>
                {openItem.body && <p className="text-[13px] text-text-secondary mb-3">{openItem.body}</p>}
                {DESTINATION[openItem.category] && (
                  <button type="button" onClick={() => navigate(`${base}/dashboard?view=${DESTINATION[openItem.category][0]}`)} className="h-8 px-3 text-[13px] bg-primary text-white rounded-md font-medium">
                    {DESTINATION[openItem.category][1]}
                  </button>
                )}
              </>
            )}
            <p className="text-[12px] text-text-tertiary mt-4">{dateTimeOf(openItem.createdAt)}</p>
          </div>
        </SidePanel>
      )}
      {topUndo && (
        <div role="status" className="fixed toast-bottom left-1/2 -translate-x-1/2 z-toast bg-gray-900 text-white text-[13.5px] rounded-xl pl-4 pr-3.5 pt-2.5 pb-3 shadow-spa-elevated overflow-hidden flex items-center gap-4">
          <span>{words.one.charAt(0).toUpperCase() + words.one.slice(1)} {topUndo.bookingNo || ''} confirmed{topUndo.guest ? ` · ${topUndo.guest}` : ''}</span>
          <button type="button" onClick={() => undoConfirm(topUndo.id)} className="font-semibold text-accent rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">Undo</button>
          <span className="absolute left-0 bottom-0 h-[3px] bg-accent" style={{ width: barOn ? '0%' : '100%', transition: barOn ? `width ${CONFIRM_UNDO_MS}ms linear` : 'none' }} />
        </div>
      )}
      {flash && <div role="alert" className="fixed toast-bottom left-1/2 -translate-x-1/2 z-toast bg-error text-white text-[13px] rounded-full px-4 py-2 shadow-spa-elevated">{flash}</div>}
      {muted && (
        <div className="fixed toast-bottom left-1/2 -translate-x-1/2 z-toast bg-text-primary text-white text-[13px] rounded-full px-4 py-2 shadow-spa-elevated">
          {muted} will no longer pop up or play a sound. <Link to="?c=settings" className="underline ml-1">Settings</Link>
        </div>
      )}
    </>
  );
};

const InboxPage = () => {
  const { isOpen: isAssistantOpen, toggleAssistant } = useAIAssistant();
  return (
    <AppShell
      variant="fill"
      sidebar={{}}
      header={{ realtimeStatus: 'connected', onToggleAssistant: toggleAssistant, assistantOpen: isAssistantOpen }}
      aside={<AIAssistantPanel />}
      asideOpen={isAssistantOpen}
    >
      <InboxBody />
    </AppShell>
  );
};

export default InboxPage;
