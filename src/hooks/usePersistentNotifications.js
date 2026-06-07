import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../services/api';

/**
 * Loads the current user's persistent in-app notifications and keeps them live
 * via a realtime subscription on INSERTs addressed to this user.
 *
 * Returns feed items normalized to the NotificationBell shape
 * ({ id, type, title, body, bookingId, read, createdAt }).
 */
export function usePersistentNotifications(userId) {
  const [items, setItems] = useState([]);
  const seen = useRef(new Set());

  const normalize = useCallback((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    bookingId: row.booking_id,
    read: row.read,
    createdAt: row.created_at,
  }), []);

  const load = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    const { data } = await fetchNotifications(30);
    if (data) {
      seen.current = new Set(data.map((r) => r.id));
      setItems(data.map(normalize));
    }
  }, [userId, normalize]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const row = payload.new;
        if (!row || seen.current.has(row.id)) return;
        seen.current.add(row.id);
        setItems((prev) => [normalize(row), ...prev].slice(0, 30));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, normalize]);

  const markRead = useCallback(async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllNotificationsRead();
  }, []);

  return { items, reload: load, markRead, markAllRead };
}
