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
import { useIndustry } from '../../hooks/useIndustry';
import {
  buildInboxFilter, categoriesForRole, categoryOf, groupByDayLabel, INBOX_PAGE_SIZE,
} from '../../lib/notificationRules';
import { fetchInbox, fetchInboxCounts, fetchLastNotificationAt, markInboxFilterRead } from '../../services/api';
import InboxBookingPanel from './InboxBookingPanel';
import NotificationSettingsContent, { CATEGORY_META } from './NotificationSettingsPanel';

const TYPE_ICON = {
  new_online_booking: 'Globe', booking_cancelled_by_guest: 'CalendarX', booking_rescheduled_by_guest: 'CalendarClock',
  discount_request: 'Percent', discount_big_fyi: 'Percent', discount_approved: 'Check', discount_declined: 'X', low_stock: 'Package',
  attendance_gap: 'Clock', attendance_gaps: 'Clock', transferred_staff_reminder: 'ArrowLeftRight', outreach_review_pending: 'Heart', renewal_due: 'Heart',
};
const ICON_STYLE = { bookings: 'bg-primary/10 text-primary', approvals: 'bg-warning/10 text-warning', team: 'bg-blue-50 text-blue-600', stock: 'bg-gray-100 text-gray-600', guests: 'bg-pink-50 text-pink-600' };
// Where a non-booking item leads (the panel offers it as a link).
const DESTINATION = { stock: ['products', 'Open products'], team: ['attendance', 'Open attendance'], guests: ['outreach-review', 'Open outreach review'] };

const timeOf = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const dateTimeOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

const normalizeRow = (r) => ({
  id: r.id, type: r.type, title: r.title, body: r.body, bookingId: r.booking_id, branchId: r.branch_id || null, actorId: r.actor_id || null,
  category: r.category || categoryOf(r.type), read: r.read, createdAt: r.created_at,
});

const InboxBody = () => {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { org } = useOrg();
  const { branchName } = useBranch();
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
  const branchOptions = [{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))];
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

  const scope = branchId ? branches.find((b) => b.id === branchId)?.name || 'This branch' : (multiBranch ? 'All branches' : (branchName || branches[0]?.name || 'This branch'));
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
            {search || branchId ? 'Try a different search or branch.' : lastAt ? `Last notification: ${dateTimeOf(lastAt)}` : 'Nothing has come in yet.'}
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
          <ul className="border-y border-border rounded-none bg-surface overflow-clip">
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
                  </p>
                  {n.body && <p className={`text-[13px] mt-0.5 leading-snug truncate ${n.read ? 'text-text-tertiary' : 'text-text-secondary'}`}>{n.body}</p>}
                </div>
                <span className="text-[12px] text-text-tertiary tabular-nums flex-shrink-0 pt-0.5">{timeOf(n.createdAt)}</span>
                <div className="absolute right-4 sm:right-6 lg:right-8 bottom-1.5 hidden group-hover:flex gap-1 bg-white/95 rounded" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => toggleUnread(n)} className="text-[11.5px] px-2 py-0.5 rounded border border-border hover:bg-gray-50">{n.read ? 'Mark unread' : 'Mark read'}</button>
                  <button type="button" onClick={() => mute(n)} className="text-[11.5px] px-2 py-0.5 rounded border border-border hover:bg-gray-50">Mute this kind</button>
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

  const hasBookingPanel = openItem && openItem.bookingId && (openItem.category === 'bookings' || openItem.category === 'approvals');
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
            {openItem.category === 'bookings' || openItem.category === 'approvals' ? (
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
      {muted && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-toast bg-text-primary text-white text-[13px] rounded-full px-4 py-2 shadow-spa-elevated">
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
