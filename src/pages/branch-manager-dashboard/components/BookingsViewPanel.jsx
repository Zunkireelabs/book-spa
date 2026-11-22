import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { CreateBookingHost } from '../../dashboard-home/DashboardPanels';
import { newBookingSlot } from './calendar/newBookingSlot';
import UnlinkedLoginNotice from '../../../components/ui/UnlinkedLoginNotice';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import BookingActionModal from '../../../components/ui/BookingActionModal';
import { Menu, FilterChip } from '../../../components/ui/ListToolbarKit';
import { useAuth } from '../../../contexts/AuthContext';
import { viewerAccess } from '../../../services/dataMasking';
import { useBranch } from '../../../contexts/BranchContext';
import { supabase } from '../../../lib/supabase';
import {
  fetchBookingsForList, fetchBookingById, fetchServices, fetchTherapists, 
  fetchAttendance, fetchBlocksForRange, fetchTransferOccurrences, fetchShiftsForRange, fetchServiceEligibility, fetchRenderedVisitTherapists,
  updateBookingStatus, updateBookingDetails, fetchRooms, assignTherapist, recordPayment, recordTip, applyDiscount,
} from '../../../services/api';
import { transformBooking, toDbStatus } from '../../../services/bookingTransformers';
import { nepalNow } from '../../../utils/customerDirectory';
import { friendlyError } from '../../../utils/friendlyError';
import { useAvailabilityGuard } from '../../../contexts/AvailabilityOverrideContext';
import {
  makeRange, VIEWS, SORTS, inView, viewCounts, matchesBookingSearch, matchesFilters, sortBookings, groupByDay, dayHeading, nowLineIndex,
  isDimmed, lateMinutes, formatLate, clockLabel, amountCell, nextAction, moneyOf,
} from '../../../utils/bookingsList';
import {
  toMin, fromMin, clock, shiftSource, availabilityNow, nextSlot10, suggestTherapist, usualTherapistId, needsYouNow, matchesNeed, isUnseen, needsTherapist,
} from '../../../utils/freeNow';
import { hoursFromShiftRow } from '../../../utils/staffDay';
import DateNavigator from './Bookings/DateNavigator';
import NeedsYouNow from './Bookings/NeedsYouNow';
import { isClosedByBlocks } from '../../../utils/todayStatusLine';
import FreeNowChip from './Bookings/FreeNowChip';
import BookingRow, { COLUMN_DEFS } from './Bookings/BookingRow';
import { useIndustry } from '../../../hooks/useIndustry';
import { teamMemberCap, teamMemberLower, teamMemberWord } from '../../../utils/industryTerms';
import ScrollRow from '../../../components/ui/ScrollRow';

const COLS_KEY = 'zennly.bookings.columns';
const readCols = () => { try { return { service: true, therapist: true, amount: true, ...JSON.parse(localStorage.getItem(COLS_KEY) || '{}') }; } catch { return { service: true, therapist: true, amount: true }; } };
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const rangeFromParams = (sp, today) => {
  const mode = sp.get('r') || 'day';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('d') || '') ? sp.get('d') : today;
  if (mode === 'custom') {
    const f = sp.get('from'); const t = sp.get('to');
    if (/^\d{4}-\d{2}-\d{2}$/.test(f || '') && /^\d{4}-\d{2}-\d{2}$/.test(t || '')) return makeRange('custom', d, { from: f, to: t });
  }
  return makeRange(['week', 'month'].includes(mode) ? mode : 'day', d);
};

const BookingsViewPanel = ({ branchId }) => {
  const { profile } = useAuth();
  const access = viewerAccess(profile);
  const { guard } = useAvailabilityGuard();
  const { isOverall } = useBranch();
  const role = profile?.role || 'staff';
  const readOnly = !profile?.role || role === 'admin_viewer'; // no write affordances until the role is known
  const canExport = role === 'manager' || role === 'admin';
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();

  // Nepal-local clock; ticks every 30s so the Now line, Late flags and dimming stay current (and the date can roll over).
  const [clock, setClock] = useState(() => nepalNow());
  useEffect(() => { const t = setInterval(() => setClock(nepalNow()), 30000); return () => clearInterval(t); }, []);
  const { today, hm: nowHM } = clock;
  const ctx = useMemo(() => ({ today, nowHM, hidePrices: !access.canViewPrices }), [today, nowHM, access.canViewPrices]);

  // ── URL state (the dashboard's own `view=` param is preserved) ───────────────────────────────────────────────────────
  const range = useMemo(() => rangeFromParams(sp, today), [sp, today]);
  const viewChip = VIEWS.some((v) => v.id === sp.get('bv')) ? sp.get('bv') : 'all';
  const sort = SORTS[sp.get('sort')] ? sp.get('sort') : 'time';
  const need = ['online', 'late', 'unpaid', 'assign'].includes(sp.get('nf')) ? sp.get('nf') : '';
  const isTodayView = range.from === range.to && range.from === today && !isOverall;
  const nowMin = toMin(nowHM);
  const needCtx = useMemo(() => ({ date: today, nowMin }), [today, nowMin]);
  const { enableRooms, locationLabel } = useIndustry();
  const filters = { therapist: sp.get('th') || '', service: sp.get('sv') || '', room: sp.get('rm') || '' };
  const query = sp.get('q') || '';
  const paramsRef = useRef(sp);
  paramsRef.current = sp;
  const patch = useCallback((changes) => {
    const next = new URLSearchParams(paramsRef.current);
    Object.entries(changes).forEach(([k, v]) => { if (v === '' || v == null) next.delete(k); else next.set(k, v); });
    paramsRef.current = next;
    setSp(next, { replace: true });
  }, [setSp]);
  const setRange = (r) => patch({
    r: r.mode === 'day' ? '' : r.mode,
    d: r.mode === 'custom' || (r.mode === 'day' && r.from === today) ? '' : r.from,
    from: r.mode === 'custom' ? r.from : '',
    to: r.mode === 'custom' ? r.to : '',
  });

  const [searchText, setSearchText] = useState(query);
  useEffect(() => { const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText.trim() }); }, 200); return () => clearTimeout(t); }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) { e.preventDefault(); searchRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const mq = (q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true);
  const [bp, setBp] = useState(() => ({ sm: mq('(min-width: 640px)'), md: mq('(min-width: 768px)'), lg: mq('(min-width: 1024px)') }));
  useEffect(() => {
    const qs = { sm: '(min-width: 640px)', md: '(min-width: 768px)', lg: '(min-width: 1024px)' };
    const lists = Object.entries(qs).map(([k, q]) => [k, window.matchMedia(q)]);
    const on = () => setBp(Object.fromEntries(lists.map(([k, l]) => [k, l.matches])));
    lists.forEach(([, l]) => l.addEventListener('change', on));
    return () => lists.forEach(([, l]) => l.removeEventListener('change', on));
  }, []);
  // Columns follow the width of the LIST (real window/container size only — the booking panel overlays and never changes it).
  const rootRef = useRef(null);
  const [cw, setCw] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const content = () => Math.round(el.clientWidth - parseFloat(getComputedStyle(el).paddingRight || '0') - parseFloat(getComputedStyle(el).paddingLeft || '0'));
    const ro = new ResizeObserver(() => setCw(content())); // content box: the reserved panel padding doesn't count
    ro.observe(el);
    setCw(content());
    return () => ro.disconnect();
  }, []);
  const isSm = cw ? cw >= 560 : bp.sm;
  const isMd = cw ? cw >= 700 : bp.md;
  const isLg = cw ? cw >= 900 : bp.lg;
  const [columnPrefs, setColumns] = useState(readCols);
  const columns = useMemo(() => ({ ...columnPrefs, amount: columnPrefs.amount && access.canViewPrices }), [columnPrefs, access.canViewPrices]); // ZNLY-235: no price column for a login that cannot see prices
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(columnPrefs)); } catch { /* ignore */ } }, [columnPrefs]);

  // ── Data ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [services, setServices] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [live, setLive] = useState('connecting');
  const [busyId, setBusyId] = useState(null);
  const loadedKeyRef = useRef('');
  const reqRef = useRef(0);
  const rangeKey = `${branchId}|${range.from}|${range.to}`;

  const load = useCallback(async () => {
    if (!branchId) return;
    const req = ++reqRef.current;
    if (loadedKeyRef.current !== rangeKey) setLoading(true); // skeleton only when there is nothing valid to show
    setError(null);
    const res = await fetchBookingsForList(branchId, { dateFrom: range.from, dateTo: range.to });
    if (req !== reqRef.current) return; // a newer request superseded this one
    if (res.error) setError(friendlyError(res.error, "Couldn't load bookings."));
    else { setRows(res.data.map(transformBooking)); loadedKeyRef.current = rangeKey; }
    setLoading(false);
  }, [branchId, range.from, range.to, rangeKey]);
  useEffect(() => { load(); }, [load]);

  // A new calendar day while looking at "today" (no ?d=) re-keys the range, which refetches by itself.

  useEffect(() => {
    let alive = true;
    fetchServices(branchId).then((r) => { if (alive && r.data) setServices(r.data); });
    return () => { alive = false; };
  }, [branchId]);
  const [rooms, setRooms] = useState([]);
  const [branchHours, setBranchHours] = useState(undefined);
  useEffect(() => {
    if (isOverall || !branchId) { setRooms([]); setBranchHours(undefined); return undefined; }
    let alive = true;
    fetchRooms(branchId).then((r) => { if (alive && r.data) setRooms(r.data); });
    supabase.from('branches').select('open_time, close_time').eq('id', branchId).maybeSingle().then(({ data }) => {
      if (alive && data) setBranchHours({ openTime: data.open_time || '09:00:00', closeTime: data.close_time || '21:00:00' });
    });
    return () => { alive = false; };
  }, [branchId, isOverall]);
  // The assign dropdown inside the booking dialog: the people on shift on the day being looked at.
  useEffect(() => {
    let alive = true;
    fetchTherapists(branchId, { date: range.from }).then((r) => {
      if (alive && r.data) setTherapists(r.data.map((t) => ({ id: t.id, name: t.name, gender: t.gender, specialties: t.specialties || [], room: null, status: 'available', currentBooking: null })));
    });
    return () => { alive = false; };
  }, [branchId, range.from]);

  // Realtime: any booking change in this branch refreshes the list in place.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!branchId || isOverall) { setLive('idle'); return undefined; }
    let alive = true;
    let timer;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => loadRef.current(), 400); };
    const channel = supabase
      .channel(`bookings-list-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `branch_id=eq.${branchId}` }, bump)
      .subscribe((status) => {
        if (!alive) return;
        if (status === 'SUBSCRIBED') setLive('connected');
        else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLive('disconnected');
      });
    return () => { alive = false; clearTimeout(timer); supabase.removeChannel(channel); };
  }, [branchId, isOverall]);

  // ── Today-only signals: who is free, who to suggest, what needs attention ────────────────────────────────────────────
  const [signals, setSignals] = useState(null);   // attendance / blocks / transfers for today (refetched with the bookings)
  const [roster, setRoster] = useState(null);     // { shifts, eligibility }: today's shift per person from the availability rule (rarely changes)
  const [usual, setUsual] = useState({});         // customerId -> usual therapist id
  useEffect(() => {
    if (!isTodayView) { setSignals(null); return undefined; }
    let alive = true;
    Promise.all([fetchAttendance({ branchId, date: today }), fetchBlocksForRange(branchId, today, today), fetchTransferOccurrences(branchId, today, today)])
      .then(([att, blocks, transfers]) => { if (alive) setSignals({ attendance: att.data || [], blocks: blocks.data || [], transfers: transfers.data || [] }); });
    return () => { alive = false; };
  }, [branchId, today, isTodayView, rows]);
  const therapistKey = therapists.map((t) => t.id).join(',');
  useEffect(() => {
    if (!isTodayView || !therapistKey) { setRoster(null); return undefined; }
    let alive = true;
    Promise.all([fetchShiftsForRange({ branchId, startDate: today, endDate: today }), fetchServiceEligibility()])
      .then(([sh, el]) => { if (alive) setRoster({ shifts: Object.fromEntries((sh.data || []).map((r) => [r.therapist_id, hoursFromShiftRow(r)])), eligibility: el.data || {} }); });
    return () => { alive = false; };
  }, [isTodayView, therapistKey, today, branchId]);
  const fnCtx = useMemo(() => {
    if (!signals || !roster) return null;
    return {
      date: today, nowMin, branchClosed: isClosedByBlocks(signals.blocks, today), source: shiftSource(signals.attendance), bookings: rows, blocks: signals.blocks, transfers: signals.transfers,
      attendanceById: Object.fromEntries(signals.attendance.map((a) => [a.therapistId, a])), shiftById: roster.shifts,
    };
  }, [signals, roster, today, nowMin, rows]);
  const availability = useMemo(() => (fnCtx ? availabilityNow(therapists, fnCtx) : null), [fnCtx, therapists]);
  const eligibility = useMemo(() => new Map(Object.entries(roster?.eligibility || {}).map(([sid, ids]) => [sid, new Set(ids)])), [roster]);
  const unassignedToday = useMemo(() => (isTodayView && !readOnly ? rows.filter((b) => needsTherapist(b, needCtx)) : []), [isTodayView, readOnly, rows, needCtx]);
  const customerKey = [...new Set(unassignedToday.map((b) => b.customerId).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!customerKey) { setUsual({}); return undefined; }
    let alive = true;
    fetchRenderedVisitTherapists(customerKey.split(',')).then((r) => { if (alive && r.data) setUsual(Object.fromEntries(Object.entries(r.data).map(([cid, v]) => [cid, usualTherapistId(v)]))); });
    return () => { alive = false; };
  }, [customerKey]);
  const suggestions = useMemo(() => {
    const out = {};
    if (!fnCtx) return out;
    // Each suggestion is treated as taken for the next ones, so two overlapping unassigned bookings are not offered the same person.
    const held = [];
    for (const b of unassignedToday) {
      const s = suggestTherapist(b, therapists, { ...fnCtx, bookings: [...fnCtx.bookings, ...held] }, { eligibility, usualId: usual[b.customerId] || null });
      if (!s) continue;
      out[b.bookingId] = s;
      held.push({ bookingId: `held-${b.bookingId}`, status: 'pending', date: today, time: fromMin(s.start), endTime: fromMin(s.end), therapists: [{ id: s.therapist.id }] });
    }
    return out;
  }, [fnCtx, unassignedToday, therapists, eligibility, usual, today]);
  const needsItems = isTodayView && !readOnly && !loading && !error ? needsYouNow(rows, needCtx) : null;
  const serviceNamesFor = (therapistId) => {
    const names = [];
    eligibility.forEach((set, sid) => { if (set.has(therapistId)) { const n = serviceOptions.find((o) => o.id === sid)?.label; if (n) names.push(n); } });
    return names.slice(0, 2).join(', ');
  };
  const bookTherapist = (therapistId) => navigate(`?view=calendar&newBooking=1&bt=${therapistId}&btime=${fromMin(nextSlot10(nowMin))}`);

  const showToast = (msg, type = 'success', action = null) => { setToast({ msg, type, action }); setTimeout(() => setToast(null), action ? 7000 : 3000); };

  // ── Derived ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const therapistOptions = useMemo(() => {
    const m = new Map();
    rows.forEach((b) => (b.therapists || []).forEach((t) => m.set(t.id, t.name)));
    return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
  const serviceOptions = useMemo(() => {
    const m = new Map(services.map((s) => [s.id, s.name]));
    rows.forEach((b) => { if (b.serviceId && !m.has(b.serviceId)) m.set(b.serviceId, b.service); });
    return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [services, rows]);
  const roomOptions = useMemo(() => {
    const m = new Map();
    rows.forEach((b) => { if (b.roomId && b.roomName) m.set(b.roomId, b.roomName); });
    return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const base = useMemo(() => rows.filter((b) => matchesBookingSearch(b, query) && matchesFilters(b, filters) && (!need || matchesNeed(b, need, needCtx))), [rows, query, need, needCtx, filters.therapist, filters.service, filters.room]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => viewCounts(base, ctx), [base, ctx]);
  const visible = useMemo(() => sortBookings(base.filter((b) => inView(b, viewChip, ctx)), sort, ctx), [base, viewChip, sort, ctx]);
  const groups = useMemo(() => groupByDay(visible), [visible]);
  const multiDay = range.from !== range.to;
  const showNow = !multiDay && range.from === today && sort === 'time';
  const anyFilter = !!(query || need || filters.therapist || filters.service || filters.room);

  // ── Actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // The open booking lives in the URL (?open=<id>) so it survives reload and the bell can deep-link to it; the full record is fetched by id.
  const openId = sp.get('open') || '';
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const [selected, setSelected] = useState(null);
  const guardRef = useRef(null); // the open panel registers its dirty guard here (same pattern as the calendar)
  // Clicking another row (or ↑/↓, or a "view" link inside the panel) switches the panel through its dirty guard.
  const openBooking = (b) => {
    const id = b?.bookingId || b?.id;
    if (!id || id === openIdRef.current) return;
    const go = () => patch({ open: id });
    if (guardRef.current) guardRef.current(go); else go();
  };
  const closePanel = useCallback(() => { patch({ open: '' }); setSelected(null); load(); }, [patch, load]);
  useEffect(() => {
    if (!openId) { setSelected(null); return undefined; }
    let alive = true;
    setSelected((cur) => (cur && cur.bookingId === openId ? cur : null)); // panel opens at once on the row's known data
    fetchBookingById(openId).then((r) => {
      if (!alive) return;
      if (r.error) { showToast(friendlyError(r.error, "Couldn't open that booking."), 'error'); patch({ open: '' }); return; }
      setSelected(transformBooking(r.data));
    });
    return () => { alive = false; };
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The panel acknowledges an unopened online booking for the whole team (fire-and-forget); clear the dot here right away.
  useEffect(() => {
    if (!selected || readOnly || !isUnseen(selected)) return;
    setRows((rs) => rs.map((r) => (r.bookingId === selected.bookingId ? { ...r, acknowledgedAt: new Date().toISOString() } : r)));
  }, [selected?.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleViewBooking = (bookingId) => openBooking({ bookingId });
  // Re-fetch the open booking in place after an action (never closes the panel or shows a skeleton).
  const refreshSelected = async (bookingId) => {
    if (!bookingId || bookingId !== openIdRef.current) return;
    const r = await fetchBookingById(bookingId);
    if (!r.error && bookingId === openIdRef.current) setSelected(transformBooking(r.data));
  };
  // ↑/↓ with the panel open moves to the previous/next booking in the list (through the guard), like Customers.
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || e.target.closest?.('tr[data-booking-id], [role="listbox"], [role="menu"]')) return; // a focused row handles its own arrows
      const i = visible.findIndex((b) => b.bookingId === openId);
      const nxt = i < 0 ? null : visible[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!nxt) return;
      e.preventDefault();
      openBooking(nxt);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the open row visible below the sticky stack when it changes (rows carry scroll-margin-top).
  useEffect(() => {
    if (openId) document.querySelector(`tr[data-booking-id="${openId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [openId, rows.length]);

  const handleStatusUpdate = async (bookingId, newStatus, reason, opts) => {
    const result = await updateBookingStatus({ bookingId, newStatus: toDbStatus(newStatus), reason });
    if (result.error && opts?.inline) return { error: result.error };
    if (result.error) { showToast(friendlyError(result.error, 'Failed to update status.'), 'error'); return; }
    showToast(`Status updated to ${newStatus}`);
    await load();
    await refreshSelected(bookingId); // a row button (or the panel itself) changed the booking the panel may be showing
  };
  const runNext = async (b, action) => {
    if (action.id === 'assign') { openBooking(b); return; }
    setBusyId(b.bookingId);
    await handleStatusUpdate(b.bookingId, action.to);
    setBusyId(null);
  };
  // Same signature the booking dialog calls it with (bookingId, therapistIds[], notes, roomId, overrides, companion…); a single id also works.
  const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId, therapistRoomOverrides, companionName, companionPhone, opts) => {
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const result = await guard((overrideReason) => assignTherapist({
      bookingId, therapistIds: ids, roomId: roomId !== undefined ? (roomId || null) : undefined, therapistRoomOverrides, companionName, companionPhone, overrideReason,
    }));
    if (result.error && opts?.inline) return { error: result.error };
    if (result.error) { showToast(friendlyError(result.error, `Failed to assign ${teamMemberLower()}.`), 'error'); return; }
    showToast(`${teamMemberCap()} assigned successfully`);
    await load();
    await refreshSelected(bookingId);
  };
  const handleRecordPayment = async (bookingId, opts) => {
    const { tipSplits, ...paymentOpts } = opts;
    const result = await recordPayment({ bookingId, ...paymentOpts });
    if (result.error) return { error: result.error };
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }
    showToast('Payment recorded successfully');
    await load();
    await refreshSelected(bookingId);
    return { error: null };
  };
  // Tail-only counterpart for the atomic recordGroupPayment path (the write already happened in one transaction).
  const handleGroupPaymentRecorded = async () => {
    showToast('Payment recorded successfully');
    load();
    await refreshSelected(openIdRef.current);
  };
  const handleApplyDiscount = async (bookingId, { discountType, discountValue, discountReason, requestedTo }) => {
    const result = await applyDiscount({ bookingId, discountType, discountValue, discountReason, requestedTo });
    if (result.error) return { error: result.error };
    showToast(result.data?.isPending ? 'Discount request sent for approval' : 'Discount applied successfully');
    await load();
    await refreshSelected(bookingId);
    return { data: result.data };
  };
  const handleEditBooking = async (bookingId, updates, opts) => {
    const result = await guard((overrideReason) => updateBookingDetails({ bookingId, ...updates, overrideReason }));
    if (result.error) { if (!opts?.inline) showToast(friendlyError(result.error, 'Failed to update booking.'), 'error'); return { error: result.error }; }
    showToast('Booking updated successfully');
    await load();
    await refreshSelected(bookingId);
    return { error: null };
  };

  const exportCsv = () => {
    const head = ['Date', 'Time', 'Booking', 'Customer', 'Phone', 'Service', teamMemberWord(), ...(enableRooms ? [locationLabel] : []), 'Status', 'Price', 'Paid', 'Due'];
    const lines = visible.map((b) => {
      const m = moneyOf(b, ctx);
      return [b.date, b.time, b.id, b.customerName, b.customerPhone, b.service, (b.therapists || []).map((t) => t.name).join(' + '), ...(enableRooms ? [b.roomName] : []), b.status, m.price, m.paid, m.due].map(csvEscape).join(',');
    });
    const blob = new Blob([[head.map(csvEscape).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookings-${range.from}${range.to !== range.from ? `_to_${range.to}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── New booking (ZNLY-301): the one New booking panel opens on top of this list ─────────────────────────────────────
  // `?view=new-booking` (⌘K, Customers / Memberships / Packages / customer-detail "Book") opens it too, prefilled from location.state.
  const viewParam = sp.get('view');
  const navLoc = useLocation();
  const navState = navLoc.state;
  const canCreate = !isOverall && !readOnly && ['staff', 'manager', 'admin'].includes(role);
  const [createSlot, setCreateSlot] = useState(null);
  const [hoursWaited, setHoursWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setHoursWaited(true), 1200); return () => clearTimeout(t); }, []);
  const openCreate = (prefill) => setCreateSlot(newBookingSlot({ today, nowHM, branchHours, prefill }));
  const handledNewRef = useRef(null);
  useEffect(() => {
    if (viewParam !== 'new-booking' || !canCreate || !branchId || (branchHours === undefined && !hoursWaited)) return;
    const key = navLoc.key || 'x';
    if (handledNewRef.current === key) return;
    handledNewRef.current = key;
    openCreate(navState?.prefill);
  }, [viewParam, canCreate, branchId, branchHours, hoursWaited]); // eslint-disable-line react-hooks/exhaustive-deps
  // "View" on the created-booking toast: open it by id whatever day the list shows (the panel fetches it, so it need not be in
  // the loaded rows) and move the list to the booking's day so it appears in context. One patch, straight to the URL (no dirty guard:
  // nothing is open at this point).
  const viewCreated = (info) => {
    const d = info.bookingDate;
    patch({ open: info.bookingId, ...(d && (d < range.from || d > range.to) ? { r: '', d: d === today ? '' : d, from: '', to: '' } : {}) });
  };
  const closeCreate = () => {
    setCreateSlot(null);
    if (viewParam === 'new-booking') navigate('?view=bookings', { replace: true }); // no Back trap
  };

  // ── Header actions (portaled into the area header) ──────────────────────────────────────────────────────────────────
  const [actionsEl, setActionsEl] = useState(null);
  useEffect(() => { setActionsEl(document.getElementById('area-header-actions')); }, []);
  const liveBadge = live === 'connected'
    ? <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8A90]" title="This list updates by itself"><i className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />Live</span>
    : live === 'idle' ? <span className="text-[12px] text-[#8A8A90]">Updated {clockLabel(nowHM)}</span>
      : <span className="inline-flex items-center gap-1.5 text-[12px] text-[#B45309]" role="status"><i className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />{live === 'connecting' ? 'Connecting…' : 'Offline'}</span>;
  const headerActions = actionsEl && createPortal(
    <>
      {liveBadge}
      {canCreate && <button type="button" onClick={() => openCreate()} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-primary/90 whitespace-nowrap"><Icon name="Plus" size={14} /><span className="sm:hidden">New</span><span className="hidden sm:inline">New booking</span></button>}
      {canExport && <button type="button" onClick={exportCsv} disabled={!visible.length} className="h-8 px-3 border border-border rounded-md bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] disabled:opacity-50 disabled:cursor-not-allowed"><Icon name="Download" size={14} />Export</button>}
    </>, actionsEl);

  // ── Sticky header (V13 pattern): control bar + view chips + column headings stick inside the area's own scroller ─────
  const sentinelRef = useRef(null);
  const blockRef = useRef(null);
  const [scroller, setScroller] = useState(null);
  const [stickyTop, setStickyTop] = useState(-16);
  const [blockH, setBlockH] = useState(0);
  const headRef = useRef(null);
  const [headH, setHeadH] = useState(35);
  const navType = useNavigationType();
  const location = useLocation();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sc = sentinelRef.current?.closest('.content-scroll') || null;
    setScroller(sc);
    if (sc) setStickyTop(-parseFloat(getComputedStyle(sc).paddingTop || '0'));
  }, []);
  useEffect(() => {
    const el = blockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => { setBlockH(Math.ceil(el.getBoundingClientRect().height)); if (headRef.current) setHeadH(Math.ceil(headRef.current.getBoundingClientRect().height)); };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (headRef.current) ro.observe(headRef.current);
    measure();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      const rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < rootTop);
    }, { root: scroller, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [scroller]);
  const stuckRef = useRef(false);
  stuckRef.current = stuck;
  // Scroll so the list's natural top (where the sticky block begins to stick) is at the top edge.
  const scrollToListTop = useCallback(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !scroller) return;
    scroller.scrollTo({ top: scroller.scrollTop + sentinel.getBoundingClientRect().top - scroller.getBoundingClientRect().top });
  }, [scroller]);
  // Range / view / sort / search / filter change → back to the list top, but only if the list is scrolled past it.
  const listKey = `${range.from}|${range.to}|${viewChip}|${sort}|${query}|${need}|${filters.therapist}|${filters.service}|${filters.room}`;
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    if (stuckRef.current) scrollToListTop();
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Remember the scroll position per list URL (sessionStorage) and restore it on back / reload, not on a fresh visit.
  const scrollKey = `zennly.bookings.scroll:${location.pathname}${location.search}`;
  const savedOnMount = useRef(undefined);
  if (savedOnMount.current === undefined) { try { savedOnMount.current = sessionStorage.getItem(scrollKey); } catch { savedOnMount.current = null; } }
  const persist = useCallback(() => { try { if (scroller) sessionStorage.setItem(scrollKey, String(scroller.scrollTop)); } catch { /* storage unavailable */ } }, [scrollKey, scroller]);
  useEffect(() => {
    if (!scroller) return undefined;
    let t;
    const save = () => { clearTimeout(t); t = setTimeout(persist, 120); };
    scroller.addEventListener('scroll', save, { passive: true });
    return () => { clearTimeout(t); scroller.removeEventListener('scroll', save); };
  }, [scroller, persist]);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading || !scroller) return;
    restored.current = true;
    if (navType !== 'POP' || savedOnMount.current == null) return;
    const y = Number(savedOnMount.current);
    requestAnimationFrame(() => { scroller.scrollTop = y; });
  }, [loading, scroller]); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑/↓ moves between rows; the rows carry scroll-margin-top so a focused row is never hidden under the sticky stack.
  const navRows = (dir, from) => {
    const all = [...(from.closest('[data-bookings-root]')?.querySelectorAll('tr[data-booking-id]') || [])];
    const i = all.indexOf(from);
    const nxt = all[i + dir];
    if (!nxt) return;
    nxt.focus();
    // With the panel open, ↑/↓ on a row moves the panel along with the focus.
    if (openIdRef.current) openBooking(rows.find((r) => r.bookingId === nxt.getAttribute('data-booking-id')));
  };

  // ── Render ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const setFilter = (k) => (v) => patch({ [k]: v });
  const dateNav = <DateNavigator range={range} today={today} onChange={setRange} />;
  const searchBox = (
    <div className="relative w-full sm:w-[280px]">
      <Icon name="Search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A8A90]" />
      <input ref={searchRef} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, phone, booking"
        aria-label="Search bookings" className="w-full h-[34px] pl-8 pr-8 border border-border rounded-[7px] text-[13px] bg-white placeholder:text-[#8A8A90] focus:outline-none focus:border-[#cfd2cc] focus:shadow-[0_0_0_3px_rgba(45,90,39,.08)]" />
      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] font-medium text-[#8A8A90] border border-border rounded px-[5px] py-px bg-white">/</kbd>
    </div>
  );
  const chips = (
    <>
      <FilterChip label={teamMemberWord()} value={filters.therapist} options={therapistOptions} onChange={setFilter('th')} selectedLabel={therapistOptions.find((o) => o.id === filters.therapist)?.label} />
      <FilterChip label="Service" value={filters.service} options={serviceOptions} onChange={setFilter('sv')} selectedLabel={serviceOptions.find((o) => o.id === filters.service)?.label} />
      {enableRooms && <FilterChip label={locationLabel} value={filters.room} options={roomOptions} onChange={setFilter('rm')} selectedLabel={roomOptions.find((o) => o.id === filters.room)?.label} />}
    </>
  );
  const sortCols = (
    <div className="flex items-center gap-2 sm:ml-auto">
      <Menu title="Sort by" trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="h-7 px-2 rounded-md text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:bg-[#FAFAF9]">
          Sort <b className="text-text-primary font-medium">{SORTS[sort].label}</b><Icon name="ChevronDown" size={13} />
        </button>)}>
        {(close) => Object.entries(SORTS).map(([id, s]) => (
          <button key={id} type="button" onClick={() => { patch({ sort: id === 'time' ? '' : id }); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${sort === id ? 'font-medium' : ''}`}>
            {s.label}{sort === id && <Icon name="Check" size={13} />}
          </button>))}
      </Menu>
      <Menu title="Columns" trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-label="Columns" aria-haspopup="menu" aria-expanded={open} className="w-[30px] h-[30px] border border-border rounded-md grid place-items-center text-[#515152] hover:bg-[#FAFAF9]"><Icon name="Columns" size={15} /></button>)}>
        {() => COLUMN_DEFS.map((c) => (
          <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] cursor-pointer">
            <input type="checkbox" checked={columns[c.id]} onChange={() => setColumns((s) => ({ ...s, [c.id]: !s[c.id] }))} />{c.label}
          </label>))}
      </Menu>
    </div>
  );

  // View chips degrade gracefully: what doesn't fit moves into a "More ▾" menu (with counts); the active chip always stays visible.
  const tabsBoxRef = useRef(null);
  const tabsMeasureRef = useRef(null);
  const [tabsAvail, setTabsAvail] = useState(0);
  const [tabWidths, setTabWidths] = useState([]);
  const countsKey = VIEWS.map((v) => counts[v.id]).join(',');
  useLayoutEffect(() => {
    const m = tabsMeasureRef.current;
    if (m) setTabWidths([...m.children].map((c) => Math.ceil(c.getBoundingClientRect().width)));
  }, [countsKey]);
  useEffect(() => {
    const el = tabsBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTabsAvail(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    setTabsAvail(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  const tabGap = isSm ? 22 : 20;
  const MORE_W = 74;
  const visibleIds = (() => {
    const ids = VIEWS.map((v) => v.id);
    if (!tabsAvail || tabWidths.length !== ids.length) return ids;
    const total = tabWidths.reduce((n, w) => n + w, 0) + tabGap * (ids.length - 1);
    if (total <= tabsAvail) return ids;
    const budget = tabsAvail - MORE_W - tabGap;
    const activeIdx = ids.indexOf(viewChip);
    const keep = new Set([activeIdx]);
    let used = tabWidths[activeIdx];
    for (let i = 0; i < ids.length; i += 1) {
      if (keep.has(i)) continue;
      if (used + tabGap + tabWidths[i] <= budget) { keep.add(i); used += tabGap + tabWidths[i]; } else break; // once one doesn't fit, later ones go to More
    }
    return ids.filter((_, i) => keep.has(i));
  })();
  const hiddenViews = VIEWS.filter((v) => !visibleIds.includes(v.id));
  const tabButton = (v, measure = false) => {
    const active = viewChip === v.id;
    return (
      <button key={v.id} type="button" role={measure ? undefined : 'tab'} aria-selected={measure ? undefined : active} tabIndex={measure ? -1 : undefined}
        onClick={measure ? undefined : () => patch({ bv: v.id === 'all' ? '' : v.id })}
        className={`h-[38px] inline-flex items-center gap-[7px] text-[13px] font-medium relative flex-shrink-0 ${active ? 'text-text-primary' : 'text-[#515152] hover:text-text-primary'}`}>
        {v.color && <i className="w-1.5 h-1.5 rounded-full" style={{ background: v.color }} />}
        {v.label}<span className="text-[#8A8A90] tabular-nums" data-count={measure ? undefined : v.id}>{counts[v.id]}</span>
        {active && !measure && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded-sm" />}
      </button>
    );
  };
  const viewTabs = (
    <div ref={tabsBoxRef} className="relative flex items-center whitespace-nowrap min-w-0 flex-1" style={{ gap: tabGap }} role="tablist" aria-label="Booking views">
      {VIEWS.filter((v) => visibleIds.includes(v.id)).map((v) => tabButton(v))}
      {hiddenViews.length > 0 && (
        <Menu title="Show bookings" trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} data-views-more
            className="h-[38px] inline-flex items-center gap-1 text-[13px] font-medium text-[#515152] hover:text-text-primary flex-shrink-0">
            More<Icon name="ChevronDown" size={13} />
          </button>)}>
          {(close) => hiddenViews.map((v) => (
            <button key={v.id} type="button" role="menuitem" onClick={() => { patch({ bv: v.id === 'all' ? '' : v.id }); close(); }}
              className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex items-center gap-2 whitespace-nowrap">
              {v.color && <i className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: v.color }} />}
              <span className="flex-1">{v.label}</span><span className="text-[#8A8A90] tabular-nums">{counts[v.id]}</span>
            </button>))}
        </Menu>
      )}
      {/* Off-screen copy used only to measure every chip's natural width. */}
      {/* Clipped (h-0 overflow-hidden) so its natural width (wider than a phone) never adds page scroll width, which iOS Safari counts even for invisible absolutes. */}
      <div aria-hidden="true" className="absolute left-0 top-0 w-full h-0 overflow-hidden invisible pointer-events-none">
        <div ref={tabsMeasureRef} className="flex w-max whitespace-nowrap" style={{ gap: tabGap }}>
          {VIEWS.map((v) => tabButton(v, true))}
        </div>
      </div>
    </div>
  );
  const viewRow = (
    <div className="flex items-center border-b border-border">
      {viewTabs}
      {isTodayView && availability && therapists.length > 0 && (
        <FreeNowChip availability={availability} nowLabel={clockLabel(nowHM)} serviceNamesFor={serviceNamesFor} onBook={readOnly ? undefined : bookTherapist} />
      )}
    </div>
  );
  const needsLine = needsItems && <NeedsYouNow items={needsItems} active={need} onPick={(id) => patch({ nf: id })} />;

  const th = 'h-[34px] text-[12px] font-medium whitespace-nowrap border-b border-border bg-white text-[#8A8A90]';
  // colSpan must equal the number of columns actually showing (hidden ones are display:none), or the fixed layout grows a phantom column.
  const colCount = 3 + (isSm ? (columns.amount ? 2 : 1) : 0) + (isMd && columns.service ? 1 : 0) + (isLg && columns.therapist ? 1 : 0);

  // The right column (action button + chevron) is one fixed width sized for the longest label ("Complete"), so no row ever pushes its chevron off the edge.
  const ACTION_COL_W = 112;
  // One <colgroup> shared by the heading table and every day table so their columns line up exactly.
  const colgroup = (
    <colgroup>
      <col style={{ width: isSm ? 104 : 92 }} />
      <col />
      {isMd && columns.service && <col style={{ width: '18%' }} />}
      {isLg && columns.therapist && <col style={{ width: '16%' }} />}
      {isSm && <col style={{ width: 132 }} />}
      {isSm && columns.amount && <col style={{ width: 112 }} />}
      <col style={{ width: ACTION_COL_W }} />
    </colgroup>
  );
  const rowProps = (b) => ({
    b, all: rows, columns, ctx, unread: isUnseen(b), selected: b.bookingId === openId,
    dim: viewChip !== 'done' && viewChip !== 'void' && isDimmed(b, ctx), late: lateMinutes(b, ctx), amount: amountCell(b, ctx),
    suggestion: suggestions[b.bookingId], onSuggest: (tid) => { setBusyId(b.bookingId); handleAssignTherapist(b.bookingId, tid).finally(() => setBusyId(null)); },
    bp: { sm: isSm, md: isMd, lg: isLg }, action: nextAction(b, { readOnly }), busy: busyId === b.bookingId, onOpen: () => openBooking(b), onAction: (a) => runNext(b, a), onNav: navRows,
    scrollMargin: stickyTop + blockH + headH + (multiDay ? 36 : 6),
  });
  let body;
  if (loading) {
    body = (
      <table className="w-full border-collapse table-fixed">
        {colgroup}
        <tbody>
          {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i}><td colSpan={colCount} className="h-14 border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    const lineAt = showNow ? nowLineIndex(groups[0]?.rows || [], nowHM) : -1;
    // One table per day: a sticky day heading is bounded by its own table, so the next day's heading pushes it out.
    body = groups.map((g) => {
      const out = [];
      g.rows.forEach((b, i) => {
        if (showNow && i === lineAt) out.push(<NowLine key="now" label={clockLabel(nowHM)} colSpan={colCount} />);
        out.push(<BookingRow key={b.bookingId} {...rowProps(b)} />);
      });
      if (showNow && lineAt >= g.rows.length) out.push(<NowLine key="now" label={clockLabel(nowHM)} colSpan={colCount} />);
      return (
        <table key={g.date} className="w-full border-collapse table-fixed" data-day-table={g.date}>
          {colgroup}
          {multiDay && (
            <thead>
              <tr data-day={g.date}>
                <th colSpan={colCount} className="h-[34px] bg-[#FAFAF9] border-b border-border text-left text-[12px] font-semibold text-[#515152] pl-2" style={{ position: 'sticky', top: stickyTop + blockH + headH, zIndex: 4 }}>
                  {dayHeading(g.date, today)} <span className="font-medium text-[#8A8A90]">· {g.rows.length} booking{g.rows.length === 1 ? '' : 's'}</span>
                </th>
              </tr>
            </thead>
          )}
          <tbody>{out}</tbody>
        </table>
      );
    });
  }

  const emptyCopy = anyFilter ? ['No bookings match', 'Try a different search or clear a filter.']
    : { all: ['No bookings in this period', multiDay ? 'Bookings made for these dates appear here.' : 'Bookings made for this day appear here.'],
      done: ['Nothing completed yet', 'Completed visits appear here.'], spa: ['Nobody is in a service right now', 'Visits that have started appear here.'],
      come: ['Nothing still to come', 'Pending and confirmed bookings that haven\'t started appear here.'], unpaid: ['Nothing unpaid', 'Visits with a balance to collect appear here.'],
      void: ['No cancellations or no-shows', 'Cancelled and no-show bookings appear here.'] }[viewChip];
  const clearAll = () => { setSearchText(''); patch({ q: '', th: '', sv: '', rm: '', bv: '', nf: '' }); };

  return (
    <div ref={rootRef} className="pb-6" style={{ '--bk-top': `${stickyTop}px` }}>
      {headerActions}
      <UnlinkedLoginNotice />
      {toast && (
        <div className={`fixed toast-top left-1/2 -translate-x-1/2 z-toast px-5 py-3 rounded-lg shadow-lg flex items-center gap-2 ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          <span className="text-sm font-medium">{toast.msg}</span>
          {toast.action && <button type="button" onClick={() => { toast.action.run(); setToast(null); }} className="ml-2 min-h-[32px] px-2 text-sm font-semibold underline">{toast.action.label}</button>}
        </div>
      )}
      {needsLine}
      <div ref={sentinelRef} aria-hidden="true" className="h-px -mb-px" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>
        <div className="flex items-center gap-2 pt-3.5 pb-3 flex-wrap">
          {dateNav}{searchBox}
          {isMd && <>{chips}</>}
          {isMd && sortCols}
        </div>
        {viewRow}
      </div>
      {!isMd && <ScrollRow className="py-2.5" wrapperClassName="py-0">{chips}{sortCols}</ScrollRow>}
      <div data-bookings-root>
        {error ? (
          <div className="border border-error/20 bg-error/5 rounded-lg p-4 mt-3 flex items-center gap-3 text-[13px] text-error">
            <Icon name="AlertCircle" size={16} />{error}
            <button type="button" onClick={load} className="ml-auto underline font-medium">Retry</button>
          </div>
        ) : (
          <>
            <div ref={headRef} className={`sticky z-[5] bg-white ${stuck ? 'shadow-[0_8px_8px_-8px_rgba(14,13,12,.14)]' : ''}`} style={{ top: stickyTop + blockH }}>
              <table className="w-full border-collapse table-fixed">
                {colgroup}
                <thead>
                  <tr>
                    <th className={`${th} text-left pl-2`}>Time</th>
                    <th className={`${th} text-left`}>Customer</th>
                    {isMd && columns.service && <th className={`${th} text-left`}>Service</th>}
                    {isLg && columns.therapist && <th className={`${th} text-left`}>{teamMemberWord()}</th>}
                    {isSm && <th className={`${th} text-left`}>Status</th>}
                    {isSm && columns.amount && <th className={`${th} text-right pr-4`}>Amount</th>}
                    <th className={th} />
                  </tr>
                </thead>
              </table>
            </div>
            {body}
          </>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="text-center py-16">
            <Icon name="Calendar" size={28} className="text-[#B4B4BA] mx-auto mb-3" />
            <p className="text-[14px] font-medium text-text-primary">{emptyCopy[0]}</p>
            <p className="text-[13px] text-[#8A8A90] mt-1">{emptyCopy[1]}</p>
            {(anyFilter || viewChip !== 'all') && <button type="button" onClick={clearAll} className="mt-3 text-[13px] font-medium text-primary hover:underline">Clear search, filters and view</button>}
          </div>
        )}
      </div>
      {!loading && !error && visible.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] border-t border-border tabular-nums">{visible.length} booking{visible.length === 1 ? '' : 's'}</div>
      )}

      <BookingActionModal
        variant="panel"
        canViewCustomerDetails={access.canViewCustomerDetails}
        isOpen={!!openId}
        previewBooking={rows.find((r) => r.bookingId === openId) || null}
        onRefreshBooking={refreshSelected}
        guardRef={guardRef}
        onClose={closePanel}
        booking={selected}
        therapists={therapists}
        rooms={rooms}
        services={services}
        branchHours={branchHours}
        onAssignTherapist={handleAssignTherapist}
        onUpdateStatus={handleStatusUpdate}
        onRecordPayment={handleRecordPayment}
        onGroupPaymentRecorded={handleGroupPaymentRecorded}
        onApplyDiscount={handleApplyDiscount}
        onEditBooking={readOnly ? undefined : handleEditBooking}
        userRole={role}
        onViewBooking={handleViewBooking}
      />
      {createSlot && (
        <CreateBookingHost
          slot={createSlot}
          branchId={branchId}
          onClose={closeCreate}
          onCreated={(t, info) => {
            closeCreate();
            load();
            const msg = info?.bookingNumber && t?.type !== 'error' ? `Booking ${info.bookingNumber} created` : (t?.msg || 'Booking created');
            showToast(msg, t?.type || 'success', info?.bookingId ? { label: 'View', run: () => viewCreated(info) } : null);
          }}
        />
      )}
    </div>
  );
};

const NowLine = ({ label, colSpan }) => (
  <tr data-now-line aria-label={`Now ${label}`}>
    <td colSpan={colSpan} className="p-0 border-0 h-5 relative">
      <div className="absolute left-0 right-0 top-1/2 border-t-[1.5px] border-[#DC2626]" />
      <span className="absolute left-2 top-1/2 -translate-y-1/2 bg-[#DC2626] text-white text-[10.5px] font-semibold rounded-full px-2 py-0.5">Now · {label}</span>
    </td>
  </tr>
);

export default BookingsViewPanel;
