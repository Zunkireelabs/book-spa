import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isReadingViaSafeViews } from '../lib/restrictedReads';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  fetchNotifications, fetchUnreadNotificationCount, fetchNotificationPrefs, markNotificationRead, markAllNotificationsRead,
  markNotificationUnread, saveNotificationPref, saveNotificationSettings,
} from '../services/api';
import { useAuth } from './AuthContext';
import { useBranch } from './BranchContext';
import { useOrg } from './OrgContext';
import {
  categoryOf, evaluateLiveEvent, isBurst, canPlaySound, isSticky, POPUP_VISIBLE_MAX, DEFAULT_SETTINGS, prefFor,
} from '../lib/notificationRules';
import { playSound, installSoundUnlock, isSoundUnlocked, onSoundUnlock } from '../lib/notificationSound';

// One Realtime channel per user for the whole staff app: feed (bell), live pop-up cards, chime, tab title.
const NotificationsContext = createContext(null);

const FEED_LIMIT = 50;
const SOUND_PILL_KEY = 'zennly.notif.soundPillShown';
const DESKTOP_DECLINED_KEY = 'zennly.notif.desktopDeclined';

const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;
const readDeclined = () => { try { return localStorage.getItem(DESKTOP_DECLINED_KEY) === '1'; } catch { return false; } };

const normalize = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  bookingId: row.booking_id,
  branchId: row.branch_id || null,
  actorId: row.actor_id || null,
  category: row.category || categoryOf(row.type),
  read: row.read,
  createdAt: row.created_at,
  // "Seen by Asha" once a teammate has opened the booking (new_online_booking items; from the embedded booking row).
  seenBy: row.booking?.acknowledged_at ? (row.booking.acknowledger?.full_name || 'a teammate') : null,
  seenAt: row.booking?.acknowledged_at || null,
});

export const NotificationsProvider = ({ children }) => {
  const { user, profile } = useAuth();
  const { branches, switchBranch } = useBranch();
  const { org } = useOrg();
  const navigate = useNavigate();
  const userId = user?.id;
  const role = profile?.role;

  const [items, setItems] = useState([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [prefs, setPrefs] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [popups, setPopups] = useState([]);
  const [soundPill, setSoundPill] = useState(false);
  const [desktopPerm, setDesktopPerm] = useState(() => (desktopSupported() ? Notification.permission : 'unsupported'));
  const [desktopDeclined, setDesktopDeclined] = useState(readDeclined);
  const [firstPopupSeen, setFirstPopupSeen] = useState(false);

  const itemsRef = useRef([]);
  const seen = useRef(new Set());
  const prefsRef = useRef({ prefs, settings, branches });
  const lastSoundAt = useRef(0);
  const reloadTimer = useRef(null);
  const arrivals = useRef([]);
  const bc = useRef(null);
  const openItemRef = useRef(null);
  itemsRef.current = items;
  prefsRef.current = { prefs, settings, branches };

  const load = useCallback(async () => {
    if (!userId) { setItems([]); setUnreadTotal(0); return; }
    const [feed, count] = await Promise.all([fetchNotifications(FEED_LIMIT), fetchUnreadNotificationCount()]);
    if (feed.data) {
      seen.current = new Set(feed.data.map((r) => r.id));
      setItems(feed.data.map(normalize));
    }
    if (count.data != null) setUnreadTotal(count.data);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId) return;
    fetchNotificationPrefs().then(({ data }) => {
      if (!data) return;
      setPrefs(data.prefs);
      setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    });
  }, [userId]);

  useEffect(() => installSoundUnlock(), []);
  useEffect(() => onSoundUnlock(() => setSoundPill(false)), []);

  const closePopup = useCallback((key) => setPopups((p) => p.filter((x) => x.key !== key)), []);

  // Live INSERT -> pop-up card and/or chime (never on load: this only runs for events that arrive over Realtime).
  const handleLiveInsert = useCallback((row) => {
    const n = normalize(row);
    const { prefs: pf, settings: st, branches: brs } = prefsRef.current;
    const branch = brs.find((b) => b.id === n.branchId) || null;
    const verdict = evaluateLiveEvent({ row: n, userId, prefs: pf, settings: st, branch });

    if (verdict.popup) {
      setFirstPopupSeen(true);
      // Tab in the background + the person allowed desktop alerts: a browser notification for the same pop-up-eligible events.
      if (desktopSupported() && Notification.permission === 'granted' && document.hidden) {
        try {
          const note = new Notification(n.title, { body: n.body || '', tag: n.id });
          note.onclick = () => { window.focus(); note.close(); openItemRef.current?.(n); };
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
      setPopups((prev) => {
        let next = prev;
        if (n.type === 'new_online_booking') {
          const now = Date.now();
          arrivals.current = [...arrivals.current.filter((t) => now - t <= 60000), now];
          if (isBurst(arrivals.current, now)) {
            const count = arrivals.current.length;
            next = prev.filter((x) => x.type !== 'new_online_booking');
            return [{ key: 'burst', burst: count, type: 'new_online_booking', category: n.category, sticky: false }, ...next];
          }
        }
        return [{ key: n.id, item: n, type: n.type, category: n.category, sticky: isSticky(n.category) }, ...next.filter((x) => x.key !== 'burst' || n.type !== 'new_online_booking')];
      });
    }

    if (verdict.sound && canPlaySound(lastSoundAt.current)) {
      if (!isSoundUnlocked()) {
        let shown = false;
        try { shown = sessionStorage.getItem(SOUND_PILL_KEY) === '1'; } catch { /* storage blocked */ }
        if (!shown) {
          try { sessionStorage.setItem(SOUND_PILL_KEY, '1'); } catch { /* storage blocked */ }
          setSoundPill(true);
        }
      } else {
        // Hold briefly: if another tab already read it, stay quiet.
        setTimeout(() => {
          const cur = itemsRef.current.find((x) => x.id === n.id);
          if (cur?.read) return;
          if (!canPlaySound(lastSoundAt.current)) return;
          lastSoundAt.current = Date.now();
          playSound(prefsRef.current.settings.sound_choice, n.category);
        }, 400);
      }
    }
  }, [userId]);

  // ZNLY-235: a restricted login cannot receive realtime rows (they carry unmasked text), so its bell refreshes by polling the masked view.
  useEffect(() => {
    if (!userId || !isReadingViaSafeViews()) return undefined;
    const t = setInterval(() => { load(); }, 30000);
    return () => clearInterval(t);
  }, [userId, load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new;
        if (!row || seen.current.has(row.id)) return;
        seen.current.add(row.id);
        setItems((prev) => [normalize(row), ...prev].slice(0, FEED_LIMIT));
        if (!row.read) setUnreadTotal((c) => c + 1);
        handleLiveInsert(row);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new;
        if (!row) return;
        seen.current.add(row.id);
        if (row.read) setPopups((p) => p.filter((x) => x.key !== row.id));
        const mine = itemsRef.current.find((n) => n.id === row.id);
        if (mine && mine.read === row.read) return; // nothing changed for us
        setItems((prev) => prev.map((n) => (n.id === row.id ? { ...n, ...normalize(row), seenBy: n.seenBy, seenAt: n.seenAt } : n)));
        // A teammate acknowledging flips `read` on a new_online_booking row and the "seen by" name lives on the booking:
        // one debounced reload picks it up, however many rows flip at once (mark-all-read).
        clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(load, 500);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.old;
        if (!row) return;
        seen.current.delete(row.id);
        setItems((prev) => prev.filter((n) => n.id !== row.id));
        setPopups((p) => p.filter((x) => x.key !== row.id));
      })
      .subscribe();
    return () => { clearTimeout(reloadTimer.current); supabase.removeChannel(channel); };
  }, [userId, load, handleLiveInsert]);

  // Another tab read something -> reflect it here (no chime / card for it).
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined' || !userId) return undefined;
    const ch = new BroadcastChannel(`zennly-notif-${userId}`);
    bc.current = ch;
    ch.onmessage = (e) => {
      const ids = e.data?.all ? null : new Set(e.data?.ids || []);
      setItems((prev) => prev.map((n) => (!ids || ids.has(n.id) ? { ...n, read: true } : n)));
      setPopups((p) => p.filter((x) => (ids ? !ids.has(x.key) : false)));
    };
    return () => { ch.close(); bc.current = null; };
  }, [userId]);

  const markRead = useCallback(async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    const unreadHit = itemsRef.current.filter((n) => list.includes(n.id) && !n.read).length;
    setItems((prev) => prev.map((n) => (list.includes(n.id) ? { ...n, read: true } : n)));
    setPopups((p) => p.filter((x) => !list.includes(x.key)));
    setUnreadTotal((c) => Math.max(0, c - unreadHit));
    bc.current?.postMessage({ ids: list });
    await Promise.all(list.map((id) => markNotificationRead(id)));
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setPopups([]);
    setUnreadTotal(0);
    bc.current?.postMessage({ all: true });
    await markAllNotificationsRead();
  }, []);

  const markUnread = useCallback(async (id) => {
    const wasRead = itemsRef.current.find((n) => n.id === id)?.read;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    if (wasRead !== false) setUnreadTotal((c) => c + 1);
    await markNotificationUnread(id);
  }, []);

  // Settings apply live: state first, then saved (a failed save reloads the stored values).
  const setPref = useCallback(async (category, patch) => {
    const next = { ...prefFor(prefsRef.current.prefs, category), ...patch };
    setPrefs((p) => ({ ...p, [category]: next }));
    const { error } = await saveNotificationPref(category, next);
    if (error) fetchNotificationPrefs().then(({ data }) => data && setPrefs(data.prefs));
    return { error };
  }, []);
  const setSetting = useCallback(async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    const { error } = await saveNotificationSettings(patch);
    if (error) fetchNotificationPrefs().then(({ data }) => data && setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) }));
    return { error };
  }, []);

  // Desktop alerts: asked only after the first pop-up of the session, never on load; a "no" is remembered.
  const allowDesktop = useCallback(async () => {
    if (!desktopSupported()) return 'unsupported';
    const result = await Notification.requestPermission();
    setDesktopPerm(result);
    if (result === 'denied') declineDesktop(); // eslint-disable-line no-use-before-define
    return result;
  }, []);
  const declineDesktop = useCallback(() => {
    try { localStorage.setItem(DESKTOP_DECLINED_KEY, '1'); } catch { /* storage blocked */ }
    setDesktopDeclined(true);
  }, []);
  const askDesktop = desktopPerm === 'default' && !desktopDeclined && firstPopupSeen;

  // Open the thing a notification is about. Bookings open the existing booking side panel on the bookings view.
  // A row whose booking is gone (booking_id null after ON DELETE SET NULL, or a stale id) opens the Inbox, not an empty panel.
  const openItem = useCallback(async (n) => {
    markRead(n.id);
    const base = org?.slug ? `/${org.slug}` : '';
    let exists = false;
    if (n.bookingId) {
      const { data } = await supabase.from('bookings').select('id').eq('id', n.bookingId).maybeSingle();
      exists = !!data;
    }
    if (n.type === 'attendance_gaps') {
      // the digest is about one branch + day: land on Attendance for it
      if (n.branchId) switchBranch?.(n.branchId);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date(n.createdAt));
      navigate(`${base}/dashboard?view=attendance&date=${day}`);
    } else if (n.type === 'discount_big_fyi' && exists) navigate(`${base}/dashboard?view=bookings&open=${n.bookingId}`);
    else if (n.category === 'approvals') navigate(`${base}/inbox?c=approvals&n=${n.id}`); // "Review" lands on the Approvals view with that row open
    else if (exists && n.category === 'bookings') navigate(`${base}/dashboard?view=bookings&open=${n.bookingId}`);
    else navigate(`${base}/inbox${n.category ? `?c=${n.category}` : ''}`);
  }, [markRead, navigate, org?.slug, switchBranch]);

  openItemRef.current = openItem;
  const inboxPath = org?.slug ? `/${org.slug}/inbox` : '/inbox';

  const unreadCount = unreadTotal;

  // Tab title: "(N) " + whatever title the page sets (Helmet changes it, so watch <title>).
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\)\s/, '');
      const want = unreadCount > 0 ? `(${unreadCount > 99 ? '99+' : unreadCount}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    const el = document.querySelector('title');
    if (!el) return undefined;
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => { mo.disconnect(); document.title = document.title.replace(/^\(\d+\+?\)\s/, ''); };
  }, [unreadCount]);

  const value = useMemo(() => ({
    items, unreadCount, role, popups, soundPill, inboxPath, branches, prefs, settings,
    visibleCount: POPUP_VISIBLE_MAX,
    desktopPerm, askDesktop, allowDesktop, declineDesktop,
    markRead, markUnread, markAllRead, openItem, closePopup, setPref, setSetting, reload: load,
  }), [items, unreadCount, role, popups, soundPill, inboxPath, branches, prefs, settings, desktopPerm, askDesktop, allowDesktop, declineDesktop, markRead, markUnread, markAllRead, openItem, closePopup, setPref, setSetting, load]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

// Outside the provider (public pages, tests) the feed is simply empty.
const EMPTY = { items: [], unreadCount: 0, role: null, popups: [], soundPill: false, inboxPath: '/inbox', branches: [], visibleCount: POPUP_VISIBLE_MAX, prefs: {}, settings: DEFAULT_SETTINGS, desktopPerm: 'unsupported', askDesktop: false, allowDesktop() {}, declineDesktop() {}, markRead() {}, markUnread() {}, markAllRead() {}, openItem() {}, closePopup() {}, setPref() {}, setSetting() {}, reload() {} };
export const useNotifications = () => useContext(NotificationsContext) || EMPTY;
