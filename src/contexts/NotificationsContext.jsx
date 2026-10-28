import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  fetchNotifications, fetchUnreadNotificationCount, fetchNotificationPrefs, markNotificationRead, markAllNotificationsRead,
} from '../services/api';
import { useAuth } from './AuthContext';
import { useBranch } from './BranchContext';
import { useOrg } from './OrgContext';
import {
  categoryOf, evaluateLiveEvent, isBurst, canPlaySound, isSticky, POPUP_VISIBLE_MAX, DEFAULT_SETTINGS,
} from '../lib/notificationRules';
import { playChime, installSoundUnlock, isSoundUnlocked, onSoundUnlock } from '../lib/notificationSound';

// One Realtime channel per user for the whole staff app: feed (bell), live pop-up cards, chime, tab title.
const NotificationsContext = createContext(null);

const FEED_LIMIT = 50;
const SOUND_PILL_KEY = 'zennly.notif.soundPillShown';

const normalize = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  bookingId: row.booking_id,
  branchId: row.branch_id || null,
  category: row.category || categoryOf(row.type),
  read: row.read,
  createdAt: row.created_at,
  // "Seen by Asha" once a teammate has opened the booking (new_online_booking items; from the embedded booking row).
  seenBy: row.booking?.acknowledged_at ? (row.booking.acknowledger?.full_name || 'a teammate') : null,
  seenAt: row.booking?.acknowledged_at || null,
});

export const NotificationsProvider = ({ children }) => {
  const { user, profile } = useAuth();
  const { branches } = useBranch();
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

  const itemsRef = useRef([]);
  const seen = useRef(new Set());
  const prefsRef = useRef({ prefs, settings, branches });
  const lastSoundAt = useRef(0);
  const reloadTimer = useRef(null);
  const arrivals = useRef([]);
  const bc = useRef(null);
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
          playChime(n.category);
        }, 400);
      }
    }
  }, [userId]);

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
    if (exists && (n.category === 'bookings' || n.type === 'discount_request')) navigate(`${base}/dashboard?view=bookings&open=${n.bookingId}`);
    else if (exists && n.category === 'approvals') navigate(`${base}/dashboard?view=bookings`);
    else navigate(`${base}/inbox`);
  }, [markRead, navigate, org?.slug]);

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
    items, unreadCount, role, popups, soundPill, inboxPath, branches,
    visibleCount: POPUP_VISIBLE_MAX,
    markRead, markAllRead, openItem, closePopup, reload: load,
  }), [items, unreadCount, role, popups, soundPill, inboxPath, branches, markRead, markAllRead, openItem, closePopup, load]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

// Outside the provider (public pages, tests) the feed is simply empty.
const EMPTY = { items: [], unreadCount: 0, role: null, popups: [], soundPill: false, inboxPath: '/inbox', branches: [], visibleCount: POPUP_VISIBLE_MAX, markRead() {}, markAllRead() {}, openItem() {}, closePopup() {}, reload() {} };
export const useNotifications = () => useContext(NotificationsContext) || EMPTY;
