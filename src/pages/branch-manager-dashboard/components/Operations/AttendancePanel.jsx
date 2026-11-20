import { friendlyError } from '../../../../utils/friendlyError';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import TransferManagementModal from '../../../../components/ui/TransferManagementModal';
import RowBoundary from '../../../../components/ui/RowBoundary';
import TransferFitText from '../../../../components/ui/TransferFitText';
import TransferPill from '../../../../components/ui/TransferPill';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { DateField } from '../../../../components/ui/PanelFormKit';
import { Menu } from '../../../../components/ui/ListToolbarKit';
import { describeTransfer, toTransferInput, transferState } from '../../../../utils/transferText';
import { nepalNow } from '../../../../utils/customerDirectory';
import { useAuth } from '../../../../contexts/AuthContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import {
  fetchAttendance, fetchAttendanceByTherapistIds, fetchShiftsForRange, fetchPendingTransfers, fetchTherapistTransferStatus,
  fetchVisitingAttendanceToday, saveAttendanceRecord, deleteAttendanceRecord, fetchAttendanceDayStatus,
  fetchAttendancePunches, punchIn, punchOut, savePunch, deletePunch, punchTimeIso,
  fetchAttendanceGaps, fetchAttendanceSettings, fetchBranchesByOrgId, fetchTransfersForTherapists,
} from '../../../../services/api';
import { hmTo12h } from '../../../../services/visitorAttendance';
import { useAvailabilityConflictGuard } from '../../../../hooks/useAvailabilityConflictGuard';
import { leaveChange } from '../../../../services/availabilityConflicts';
import {
  deriveRow, KINDS, ATTENTION_KINDS, bulkPresentTime, durationText, toMin, minToHm, isHalfDayStatus, diffPatch, awayWholeShift, clipVisitWindow, visitWindowOn, summarizePunches, minutesText,
} from '../../../../services/attendanceView';
import { useStickyBlock, SearchBox, useSlashFocus, Avatar, EmptyBlock, ErrorBlock } from '../Area/listKit';
import AttendanceSidePanel from './AttendanceSidePanel';
import { wordBranch } from '../../../../utils/industryTerms';

// therapist_shifts_for_range row -> { start, end, breaks } (null when the person doesn't work that day).
const shiftShape = (r) => (!r || !r.works || !r.start_time ? null : {
  start: String(r.start_time).slice(0, 5),
  end: String(r.end_time) === '23:59:59' ? '23:59' : String(r.end_time).slice(0, 5),
  breaks: r.breaks || [],
});

const TONE = {
  err: { pill: 'bg-[#FDECEC] text-[#B42318]', dot: '#DC2626' },
  warn: { pill: 'bg-[#FEF3E2] text-[#B45309]', dot: '#D97706' },
  in: { pill: 'bg-[#E8F3E6] text-[#2D5A27]', dot: '#2D5A27' },
  out: { pill: 'bg-[#EEF0F2] text-[#515152]', dot: '#8A8A90' },
  none: { pill: 'bg-[#F1F1EF] text-[#6B6B70]', dot: '#B8B8BC' },
};
const Pill = ({ kind, label }) => {
  const k = KINDS[kind] || KINDS.not_scheduled;
  const t = TONE[k.tone];
  return (
    <span className={`h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${t.pill}`}>
      <i className="w-1.5 h-1.5 rounded-full" style={{ background: t.dot }} />{label || k.label}
    </span>
  );
};

const MiniBtn = ({ children, primary, ...props }) => (
  <button type="button" {...props} className={`h-[28px] px-3 rounded-[7px] border text-[12px] font-medium whitespace-nowrap disabled:opacity-50 ${primary ? 'bg-primary border-primary text-white hover:bg-primary/90' : 'bg-white border-border text-text-primary hover:bg-[#FAFAF9]'}`}>{children}</button>
);

// The "no check-in" filter (and the end-of-day Review): nothing recorded yet. ON also counts past unmarked days.
const NO_CHECKIN = (expect, kind) => (expect ? ['not_in_yet', 'later', 'unmarked'].includes(kind) : kind === 'present_default');
const chipsFor = (expect, past) => [
  { id: 'attention', label: 'Needs attention', tone: 'err' },
  { id: 'all', label: 'Everyone' },
  { id: 'notin', label: expect ? (past ? 'No check-in' : 'Not in yet') : 'Not checked in' },
  { id: 'in', label: 'In' },
  { id: 'late', label: 'Late' },
  { id: 'leave', label: 'Leave / off' },
  { id: 'visiting', label: 'Visiting' },
];

const dayWord = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ''); };
// The transfer wording prints '2:00pm'; this page's one time format is '2:00 pm'.
const spaceAmPm = (x) => (typeof x === 'string' ? x.replace(/(\d)(am|pm)\b/gi, '$1 $2') : x);
const spaced = (arr) => (arr || []).map(spaceAmPm);
const minText = (n) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n} min`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return dt.toISOString().slice(0, 10); };

const AttendancePanel = ({ branchId }) => {
  const [clock, setClock] = useState(() => nepalNow());
  const today = clock.today;
  const nowMin = toMin(clock.hm);
  useEffect(() => { const t = setInterval(() => setClock(nepalNow()), 30000); return () => clearInterval(t); }, []);

  const { staffLabel, staffLabelPlural, locationLabel } = useIndustry();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const use24h = (() => { try { return localStorage.getItem(`bookspa_calendar_use24h_${profile?.org_id}_${profile?.id}`) === '1'; } catch { return false; } })();
  const fmt = (hm) => (!hm ? '' : use24h ? String(hm).slice(0, 5) : hmTo12h(hm));
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();

  const [searchParams, setSearchParams] = useSearchParams();
  // ?date=YYYY-MM-DD (from an attendance-gaps notification) opens that day; a day in the future is ignored
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
  });
  const focusTherapistId = searchParams.get('therapist');
  const clearFocusTherapist = () => { const next = new URLSearchParams(searchParams); next.delete('therapist'); setSearchParams(next, { replace: true }); };

  const [therapists, setTherapists] = useState([]);
  const [shiftByTherapist, setShiftByTherapist] = useState({});
  const [settings, setSettings] = useState({ lateGraceMinutes: 10, openCheckoutHours: 4 });
  const [dayClosed, setDayClosed] = useState(false);
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);       // { msg, type, undo? }
  const toastTimer = useRef(null);

  const [pendingByTherapist, setPendingByTherapist] = useState({});
  const [transferStatusByTherapist, setTransferStatusByTherapist] = useState({});
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferredAttendance, setTransferredAttendance] = useState({});
  const [visitors, setVisitors] = useState([]);
  const [branchNameById, setBranchNameById] = useState({});
  const [punchesBy, setPunchesBy] = useState({});             // therapistId -> that day's punches (any branch you can see)
  const [visitTransfers, setVisitTransfers] = useState({});   // therapistId -> staff_transfers rows (for check-ins recorded at another branch)

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [awayOpen, setAwayOpen] = useState(false);
  const [panel, setPanel] = useState(null);       // { therapistId, date, mode, focus, forceReason, person? }
  const [confirmAbsent, setConfirmAbsent] = useState(null);
  const [busyIds, setBusyIds] = useState({});
  const searchRef = useRef(null);
  useSlashFocus(searchRef);

  const showToast = useCallback((msg, type = 'success', undo = null) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── transfers (unchanged rules from the old page) ───────────────────────────────────────────────
  const isIncomingTransferOverdue = useCallback((id) => {
    const s = transferStatusByTherapist[id];
    return !!(s?.applied && !s?.reverted && s?.revertAt && s?.toBranchId === branchId && new Date(s.revertAt) <= new Date());
  }, [transferStatusByTherapist, branchId]);

  const transferredOutBase = useMemo(() => {
    const active = Object.values(transferStatusByTherapist)
      .filter((s) => s.applied && !s.reverted && s.revertAt && s.fromBranchId === branchId && s.toBranchId !== branchId)
      .map((s) => ({ ...s, isPending: false }));
    const pending = Object.values(pendingByTherapist).map((p) => ({ id: p.id, therapistId: p.therapistId, therapistName: p.therapistName, toBranch: p.toBranch, effectiveDate: p.effectiveDate, startTime: p.startTime, revertAt: p.revertAt, isPending: true }));
    return [...active, ...pending];
  }, [transferStatusByTherapist, pendingByTherapist, branchId]);

  useEffect(() => {
    const ids = transferredOutBase.map((s) => s.therapistId);
    if (ids.length === 0) { setTransferredAttendance({}); return undefined; }
    let cancelled = false;
    fetchAttendanceByTherapistIds({ therapistIds: ids, date: selectedDate }).then(({ data }) => { if (!cancelled) setTransferredAttendance(data || {}); });
    return () => { cancelled = true; };
  }, [transferredOutBase, selectedDate]);

  const loadPendingTransfers = useCallback(async () => {
    if (!branchId) return;
    const [{ data }, { data: statusMap }] = await Promise.all([fetchPendingTransfers(branchId), fetchTherapistTransferStatus(branchId)]);
    const map = {};
    (data || []).forEach((t) => { map[t.therapistId] = t; });
    setPendingByTherapist(map);
    setTransferStatusByTherapist(statusMap || {});
  }, [branchId]);

  const loadVisitors = useCallback(async () => {
    if (selectedDate !== today || !branchId || branchId === 'all') { setVisitors([]); return; }
    const { data } = await fetchVisitingAttendanceToday({ branchId });
    setVisitors(Object.values(data || {}));
  }, [selectedDate, today, branchId]);
  useEffect(() => { loadVisitors(); }, [loadVisitors]);

  useEffect(() => {
    if (!profile?.org_id) return;
    fetchBranchesByOrgId(profile.org_id).then(({ data }) => setBranchNameById(Object.fromEntries((data || []).map((b) => [b.id, b.name]))));
  }, [profile?.org_id]);

  // ── load ────────────────────────────────────────────────────────────────────────────────────────
  const hasLoadedRef = useRef(false);
  const loadedKeyRef = useRef('');
  const loadData = useCallback(async () => {
    if (!branchId) return;
    const key = `${branchId}|${selectedDate}`;
    if (loadedKeyRef.current !== key) hasLoadedRef.current = false;
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const [att, shifts, day, set, gp, pun] = await Promise.all([
      fetchAttendance({ branchId, date: selectedDate }),
      fetchShiftsForRange({ branchId, startDate: selectedDate, endDate: selectedDate }),
      fetchAttendanceDayStatus({ branchId, date: selectedDate }),
      fetchAttendanceSettings(branchId),
      fetchAttendanceGaps({ branchId, from: addDays(today, -6), to: today }),
      fetchAttendancePunches({ date: selectedDate }),
      loadPendingTransfers(),
    ]);
    const byP = {}; (pun.data || []).forEach((q) => { (byP[q.therapistId] = byP[q.therapistId] || []).push(q); });
    setPunchesBy(byP);
    setShiftByTherapist(Object.fromEntries((shifts.data || []).map((r) => [r.therapist_id, r])));
    setDayClosed(!!day.data?.isClosed);
    if (set.data) setSettings(set.data);
    setGaps(gp.data || []);
    if (att.error) { setError(friendlyError(att.error, 'Failed to load attendance.')); setLoading(false); hasLoadedRef.current = true; return; }
    setTherapists(att.data || []);
    const elsewhere = Object.keys(byP).filter((id) => byP[id].some((q) => q.branchId !== branchId));
    if (elsewhere.length) {
      const { data: tr } = await fetchTransfersForTherapists(elsewhere);
      const by = {}; (tr || []).forEach((r) => { (by[r.therapist_id] = by[r.therapist_id] || []).push(r); });
      setVisitTransfers(by);
    } else setVisitTransfers({});
    if (!hasLoadedRef.current) setSelectedIds([]);
    hasLoadedRef.current = true;
    loadedKeyRef.current = key;
    setLoading(false);
  }, [branchId, selectedDate, today, loadPendingTransfers]);
  useEffect(() => { loadData(); }, [loadData]);
  useAutoRefresh(loadData, { intervalMs: 60000 });

  // ── row model ───────────────────────────────────────────────────────────────────────────────────
  const gapOf = useMemo(() => {
    // The most recent open check-out on ANOTHER day, per person (shown on today's row so it can't be missed).
    const m = {};
    gaps.filter((g) => g.kind === 'open_checkout' && g.date !== selectedDate).forEach((g) => { if (!m[g.therapistId] || g.date > m[g.therapistId].date) m[g.therapistId] = g; });
    return m;
  }, [gaps, selectedDate]);

  const transferViewpoint = (id) => (transferStatusByTherapist[id]?.toBranchId === branchId ? 'receiving' : 'home');

  // Home staff on a temporary transfer out for their WHOLE shift go to "Away today" (no No show, not counted, not in gaps);
  // partly away (e.g. 2-4 pm) stays a normal row with the transfer pill.
  const awayRowOf = (t, shift) => {
    const st = transferStatusByTherapist[t.therapistId];
    const pend = pendingByTherapist[t.therapistId];
    const tr = st && st.applied && !st.reverted && st.revertAt && st.fromBranchId === branchId && st.toBranchId !== branchId ? st
      : pend ? { ...pend, applied: false, reverted: false } : null;
    return tr && awayWholeShift({ transfer: tr, date: selectedDate, shift }) ? tr : null;
  };

  const { rows, homeAway } = useMemo(() => {
    const keep = []; const away = [];
    therapists
      .filter((t) => (focusTherapistId ? t.therapistId === focusTherapistId : !isIncomingTransferOverdue(t.therapistId)))
      .forEach((t) => {
        const shift = shiftShape(shiftByTherapist[t.therapistId]);
        const tr = focusTherapistId ? null : awayRowOf(t, shift);
        if (tr) { away.push({ ...tr, id: t.therapistId, name: t.therapistName, attendance: { checkInTime: t.checkInTime, checkOutTime: t.checkOutTime } }); return; }
        // The day seen from its punches (first in / last out, open punch here or elsewhere); legacy day times only when there are no punches.
        const sum = summarizePunches(punchesBy[t.therapistId] || [], branchId);
        if (!sum.count && t.checkInTime) { sum.firstIn = t.checkInTime; sum.lastOut = t.checkOutTime || ''; }
        const person = { status: t.status || '', checkIn: sum.firstIn, checkOut: sum.lastOut, openElsewhere: sum.openElsewhere, legacyOpen: sum.legacyOpen };
        // Late = first punch vs the first scheduled block of THAT date, wherever it is: the home shift or a visit window (never today's window for a past day).
        let rowShift = shift; let judgeLate = true; let lateDue = null;
        if (sum.count) {
          const blocks = shift ? [{ start: shift.start, end: shift.end, branchId }] : [];
          sum.elsewhere.forEach((q) => {
            const w = visitWindowOn({ transfers: visitTransfers[t.therapistId], toBranchId: q.branchId, date: selectedDate, checkIn: q.checkIn });
            if (w && !blocks.some((x) => x.start === w.start && x.end === w.end)) blocks.push({ ...w, branchId: q.branchId });
          });
          if (blocks.length) lateDue = [...blocks].sort((x, y) => (x.start < y.start ? -1 : 1))[0];
          if (blocks.length) rowShift = { start: blocks.map((x) => x.start).sort()[0], end: blocks.map((x) => x.end).sort().slice(-1)[0] };
          else judgeLate = false;
        }
        const d = deriveRow({ person, date: selectedDate, today, nowMin, shift: rowShift, settings, visitor: !judgeLate });
        keep.push({ ...t, id: t.therapistId, name: t.therapistName, shift, d, lateDue, gap: gapOf[t.therapistId], support: !t.isServiceStaff,
          checkInTime: sum.firstIn || null, checkOutTime: sum.lastOut || null, punches: punchesBy[t.therapistId] || [], punchCount: sum.count, openHere: sum.openHere, openElsewhere: sum.openElsewhere, elsewhere: sum.elsewhere, workedMin: sum.workedMin });
      });
    return { rows: keep, homeAway: away };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [therapists, shiftByTherapist, settings, selectedDate, today, nowMin, gapOf, focusTherapistId, isIncomingTransferOverdue, branchId, transferStatusByTherapist, pendingByTherapist, visitTransfers, punchesBy]);

  const visitorRows = useMemo(() => visitors.map((v) => {
    const parts = (iso) => ({ date: new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' }), hm: new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5) });
    // The window is clipped to this branch's opening hours (same as availability, mig 363); "all day" when it covers them.
    const win = v.windowFrom && v.windowTo ? clipVisitWindow({ fromParts: parts(v.windowFrom), toParts: parts(v.windowTo), date: selectedDate, openTime: settings.openTime, closeTime: settings.closeTime }) : null;
    const shift = win ? { start: win.start, end: win.end } : null;
    const d = deriveRow({ person: { status: v.checkInTime ? 'Present' : '', checkIn: v.checkInTime || '', checkOut: v.checkOutTime || '' }, date: selectedDate, today, nowMin, shift, settings, visitor: true });
    return { id: v.therapistId, therapistId: v.therapistId, name: v.therapistName, status: v.checkInTime ? 'Present' : '', checkInTime: v.checkInTime, checkOutTime: v.checkOutTime, shift, d, visitor: true, visitAllDay: !!win?.allDay, punchCount: v.punchCount || 0, openHere: v.openPunchId ? { id: v.openPunchId } : null, workedMin: v.checkInTime && v.checkOutTime ? Math.max(0, toMin(v.checkOutTime) - toMin(v.checkInTime)) : 0 };
  }), [visitors, selectedDate, today, nowMin, settings]);

  const awayRows = useMemo(() => {
    if (focusTherapistId) return [];
    const homeIds = new Set(therapists.map((t) => t.therapistId));
    const moved = transferredOutBase.filter((s) => !s.isPending && !homeIds.has(s.therapistId)).map((s) => ({ ...s, id: s.therapistId, name: s.therapistName, attendance: transferredAttendance[s.therapistId] || null }));
    return [...moved, ...homeAway];
  }, [transferredOutBase, therapists, transferredAttendance, focusTherapistId, homeAway]);

  const attentionOf = (r) => ATTENTION_KINDS.includes(r.d.kind) || !!r.gap;
  const counts = useMemo(() => {
    const expected = rows.filter((r) => !['leave', 'off', 'not_scheduled'].includes(r.d.kind));
    const inNow = rows.filter((r) => r.d.checkedIn);
    return {
      attention: rows.filter(attentionOf).length + visitorRows.filter(attentionOf).length,
      all: rows.length + visitorRows.length,
      notin: rows.filter((r) => NO_CHECKIN(settings.expectCheckIn, r.d.kind)).length,
      present: rows.filter((r) => ['present_default', 'present_saved', 'in', 'out', 'half', 'no_checkout'].includes(r.d.kind)).length,
      notChecked: rows.filter((r) => r.d.kind === 'present_default').length,
      confirmed: rows.filter((r) => r.d.kind === 'present_saved').length,
      in: inNow.length + visitorRows.filter((r) => r.d.checkedIn).length,
      visitorsIn: visitorRows.filter((r) => r.d.checkedIn).length,
      late: rows.filter((r) => r.d.lateMin > 0).length,
      leave: rows.filter((r) => ['leave', 'off', 'absent'].includes(r.d.kind)).length,
      visiting: visitorRows.length,
      expected: expected.length,
      noShow: rows.filter((r) => r.d.kind === 'no_show').length + visitorRows.filter((r) => r.d.kind === 'no_show').length,
      onLeave: rows.filter((r) => ['leave', 'off'].includes(r.d.kind)).length,
      later: rows.filter((r) => r.d.kind === 'later').length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visitorRows, settings.expectCheckIn]);

  const q = query.trim().toLowerCase();
  const passChip = (r) => {
    if (chip === 'all') return true;
    if (chip === 'attention') return attentionOf(r);
    if (chip === 'notin') return NO_CHECKIN(settings.expectCheckIn, r.d.kind);
    if (chip === 'in') return r.d.checkedIn;   // visitors included
    if (chip === 'late') return r.d.lateMin > 0;
    if (chip === 'leave') return ['leave', 'off', 'absent'].includes(r.d.kind);
    if (chip === 'visiting') return !!r.visitor;
    return true;
  };
  const passQ = (r) => !q || (r.name || '').toLowerCase().includes(q);
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');

  const groups = useMemo(() => {
    const f = rows.filter((r) => passQ(r) && passChip(r));
    const vf = visitorRows.filter((r) => passQ(r) && passChip(r));
    // Visitor no-shows / open check-outs count at the visited branch like anyone else (still marked "Visiting").
    const attention = [...f.filter(attentionOf), ...vf.filter(attentionOf)].sort(byName);
    const rest = f.filter((r) => !attentionOf(r));
    const service = rest.filter((r) => !r.support).sort(byName);
    const support = rest.filter((r) => r.support).sort(byName);
    const vis = vf.filter((r) => !attentionOf(r)).sort(byName);
    const away = (chip === 'all' || chip === 'leave') ? awayRows.filter(passQ).sort(byName) : [];
    return { attention, service, support, vis, away };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visitorRows, awayRows, q, chip]);
  const shownCount = groups.attention.length + groups.service.length + groups.support.length + groups.vis.length + groups.away.length;

  // End-of-day confirm (both modes): after the last shift ends (or any past, unclosed day), people with nothing saved.
  const noRecordRows = useMemo(() => rows.filter((r) => !r.status && !r.checkInTime && r.shift), [rows]);
  const lastShiftEnd = useMemo(() => Math.max(0, ...rows.filter((r) => r.shift).map((r) => toMin(r.shift.end) || 0)), [rows]);
  const endOfDay = !dayClosed && !loading && !focusTherapistId && (selectedDate < today || (selectedDate === today && lastShiftEnd > 0 && nowMin >= lastShiftEnd));
  const confirmRows = endOfDay ? noRecordRows : [];

  // Switch ON: "Mark all present at shift start" for the attention list (same rules as bulk: never a future time, never overwrites).
  const startPresentRows = useMemo(() => (settings.expectCheckIn && selectedDate === today && !dayClosed
    ? groups.attention.filter((r) => !r.visitor && !r.status && !r.checkInTime && bulkPresentTime({ shift: r.shift, date: selectedDate, today, nowMin })) : []),
  [groups.attention, settings.expectCheckIn, selectedDate, today, dayClosed, nowMin]);

  // Unmarked-day banner (last 7 days, most recent day first).
  const unmarkedBanner = useMemo(() => {
    const by = {};
    if (!settings.expectCheckIn) return null;
    gaps.filter((g) => g.kind === 'unmarked').forEach((g) => { (by[g.date] = by[g.date] || []).push(g); });
    const days = Object.keys(by).sort().reverse();
    if (days.length === 0) return null;
    const date = days[0];
    return { date, list: by[date], moreDays: days.length - 1 };
  }, [gaps, settings.expectCheckIn]);

  // ── writes: always save_attendance / mark_visitor_attendance ───────────────────────────────────
  // The day (not the punches) before a status action; null = there was no day row.
  const snapshotOf = (r) => (r && r.status ? { status: r.status, offStart: r.offStart || null, offEnd: r.offEnd || null } : null);
  const nowIso = () => new Date().toISOString();
  const atIso = (hm) => punchTimeIso(selectedDate, hm);

  const openPanel = (r, extra = {}) => setPanel({ therapistId: r.therapistId || r.id, date: selectedDate, mode: null, focus: null, forceReason: false, ...extra });

  const leaveCheck = (r, status, off) => {
    if (['Absent', 'Annual Leave', 'Sick Leave', 'Day Off'].includes(status)) return { therapistId: r.id, name: r.name, change: leaveChange({ from: selectedDate }) };
    if (isHalfDayStatus(status) && off?.offStart && off?.offEnd) return { therapistId: r.id, name: r.name, change: leaveChange({ from: selectedDate, offStart: off.offStart, offEnd: off.offEnd }) };
    return null;
  };
  const confirmLeaves = (checks) => confirmConflicts({
    checks: checks.filter(Boolean),
    summary: `Marking ${selectedDate} as ${checks.length === 1 ? 'leave' : 'leave for these staff'}.`,
    titleFor: (n) => `${n} upcoming booking${n === 1 ? '' : 's'} ${n === 1 ? 'falls' : 'fall'} during this leave`,
    saveLabel: 'Save anyway',
  });

  const handleWriteError = (r, err, preset) => {
    if (err.code === 'ATTENDANCE_DAY_LOCKED') { setDayClosed(true); showToast("This day is closed. Attendance can't be changed.", 'error'); return; }
    if (err.code === 'ATTENDANCE_REASON_REQUIRED') { openPanel(r, { mode: preset || null, focus: 'reason', forceReason: true }); return; }
    showToast(friendlyError(err, 'Could not save attendance.'), 'error');
  };

  // One quick DAY action (⋯ menu: Absent / Day off) for one person.
  const quickSave = async (r, patch, { source = 'button', message, preset } = {}) => {
    if (busyIds[r.id]) return false;
    setBusyIds((b) => ({ ...b, [r.id]: true }));
    const prev = snapshotOf(r);
    const { error: err } = await saveAttendanceRecord({ therapistId: r.id, date: selectedDate, patch, source });
    setBusyIds((b) => ({ ...b, [r.id]: false }));
    if (err) { handleWriteError(r, err, preset); return false; }
    await loadData();
    if (message) showToast(message, 'success', { items: [{ type: 'day', therapistId: r.id, date: selectedDate, prev }] });
    return true;
  };

  // Check in = a punch at THIS branch (the first punch of the day creates the day, Present).
  const checkIn = async (r) => {
    if (selectedDate !== today) { openPanel(r, { mode: 'present' }); return; }
    if (busyIds[r.id]) return;
    setBusyIds((b) => ({ ...b, [r.id]: true }));
    const dayCreated = !r.status && !r.punchCount;
    const { data, error: err } = await punchIn({ therapistId: r.id, branchId, at: nowIso(), source: 'button' });
    setBusyIds((b) => ({ ...b, [r.id]: false }));
    if (err) { handleWriteError(r, err, 'present'); return; }
    await loadData();
    showToast(`${r.name} checked in at ${fmt(clock.hm)}`, 'success', { items: [{ type: 'punchIn', punchId: data.id, therapistId: r.id, date: selectedDate, dayCreated }] });
  };
  // Check out = close this branch's open punch.
  const checkOutNow = async (r) => {
    if (busyIds[r.id] || !r.openHere) return;
    setBusyIds((b) => ({ ...b, [r.id]: true }));
    const { error: err } = await punchOut({ punchId: r.openHere.id, at: nowIso(), source: 'button' });
    setBusyIds((b) => ({ ...b, [r.id]: false }));
    if (err) { handleWriteError(r, err); return; }
    await loadData();
    showToast(`${r.name} checked out at ${fmt(clock.hm)}`, 'success', { items: [{ type: 'punchOut', punchId: r.openHere.id, checkInIso: atIso(r.openHere.checkIn || r.checkInTime), therapistId: r.id, date: selectedDate }] });
  };
  const markAbsent = async (r) => {
    if (!(await confirmLeaves([leaveCheck(r, 'Absent')]))) return;
    quickSave(r, { status: 'Absent' }, { message: `${r.name} marked absent`, preset: 'absent' });
  };
  const askAbsent = (r) => { if (r.d.checkedIn) setConfirmAbsent(r); else markAbsent(r); };
  const dayOff = async (r) => {
    if (!(await confirmLeaves([leaveCheck(r, 'Day Off')]))) return;
    quickSave(r, { status: 'Day Off' }, { message: `${r.name} marked off`, preset: 'off' });
  };

  const visitorCheck = async (v, which) => {
    if (busyIds[v.id]) return;
    setBusyIds((b) => ({ ...b, [v.id]: true }));
    const { data, error: err } = which === 'in'
      ? await punchIn({ therapistId: v.therapistId, branchId, at: nowIso(), source: 'visitor' })
      : await punchOut({ punchId: v.openHere?.id, therapistId: v.therapistId, branchId, at: nowIso(), source: 'visitor' });
    setBusyIds((b) => ({ ...b, [v.id]: false }));
    if (err) { showToast(friendlyError(err, 'Could not save attendance.'), 'error'); return; }
    await loadVisitors(); await loadData();
    showToast(`${v.name} ${which === 'in' ? 'checked in' : 'checked out'} at ${fmt(clock.hm)}`, 'success',
      which === 'in' ? { items: [{ type: 'punchIn', punchId: data.id, therapistId: v.therapistId, date: selectedDate, dayCreated: false }] } : null);
  };

  // Bulk (today only; never overwrites a saved record).
  const bulk = async (kind) => {
    const picked = rows.filter((r) => selectedIds.includes(r.id));
    const done = []; let skippedSaved = 0; let later = 0;
    const eligible = [];
    for (const r of picked) {
      if (r.status || r.checkInTime) { skippedSaved += 1; continue; }
      if (kind === 'present') {
        const t = bulkPresentTime({ shift: r.shift, date: selectedDate, today, nowMin });
        if (!t) { later += 1; continue; }
        eligible.push({ r, punchAt: t });
      } else eligible.push({ r, patch: { status: kind === 'absent' ? 'Absent' : 'Day Off' } });
    }
    if (kind !== 'present' && eligible.length && !(await confirmLeaves(eligible.map((e) => leaveCheck(e.r, e.patch.status))))) return;
    for (const { r, patch, punchAt } of eligible) {
      if (punchAt) {   // Mark present = a check-in at the shift start (never a time that hasn't happened yet)
        const { data, error: err } = await punchIn({ therapistId: r.id, branchId, at: atIso(punchAt), source: 'bulk' });
        if (err) { if (err.code === 'ATTENDANCE_DAY_LOCKED') { setDayClosed(true); break; } continue; }
        done.push({ type: 'punchIn', punchId: data.id, therapistId: r.id, date: selectedDate, dayCreated: true });
        continue;
      }
      const { error: err } = await saveAttendanceRecord({ therapistId: r.id, date: selectedDate, patch, source: 'bulk' });
      if (err) { if (err.code === 'ATTENDANCE_DAY_LOCKED') { setDayClosed(true); break; } continue; }
      done.push({ type: 'day', therapistId: r.id, date: selectedDate, prev: null });
    }
    setSelectedIds([]);
    await loadData();
    const label = kind === 'present' ? 'present' : kind === 'absent' ? 'absent' : 'off';
    const extra = [skippedSaved ? `${skippedSaved} already marked` : '', later ? `${later} not started yet` : ''].filter(Boolean).join(', ');
    showToast(done.length ? `Marked ${plural(done.length, 'person', 'people')} ${label}${extra ? ` (${extra})` : ''}` : `Nobody changed${extra ? ` (${extra})` : ''}`, done.length ? 'success' : 'error', done.length ? { items: done } : null);
  };

  // Writes a list of { r, patch } with one source / reason; returns the undo items.
  const writeMany = async (list, { source, reason }) => {
    const done = [];
    for (const { r, patch } of list) {
      const { error: err } = await saveAttendanceRecord({ therapistId: r.id, date: selectedDate, patch, reason, source });
      if (err) { if (err.code === 'ATTENDANCE_DAY_LOCKED') { setDayClosed(true); break; } continue; }
      done.push({ type: 'day', therapistId: r.id, date: selectedDate, prev: null });
    }
    await loadData();
    return done;
  };

  const confirmAllPresent = async () => {
    const dayText = dayWord(selectedDate);
    const done = await writeMany(confirmRows.map((r) => ({ r, patch: { status: 'Present' } })), { source: 'bulk', reason: 'Confirmed present at end of day' });
    if (chip === 'notin') setChip('all');
    showToast(done.length ? `Confirmed ${plural(done.length, 'person', 'people')} present for ${dayText}` : 'Nothing was saved', done.length ? 'success' : 'error', done.length ? { items: done } : null);
  };

  const markAttentionPresent = async () => {
    const done = [];
    for (const r of startPresentRows) {
      const t = bulkPresentTime({ shift: r.shift, date: selectedDate, today, nowMin });
      if (!t) continue;
      const { data, error: err } = await punchIn({ therapistId: r.id, branchId, at: atIso(t), source: 'bulk' });
      if (err) { if (err.code === 'ATTENDANCE_DAY_LOCKED') { setDayClosed(true); break; } continue; }
      done.push({ type: 'punchIn', punchId: data.id, therapistId: r.id, date: selectedDate, dayCreated: !r.status });
    }
    await loadData();
    showToast(done.length ? `Marked ${plural(done.length, 'person', 'people')} present at shift start` : 'Nobody changed', done.length ? 'success' : 'error', done.length ? { items: done } : null);
  };

  const undo = async (u) => {
    setToast(null);
    const reason = 'Undone from the toast';
    for (const it of u.items) {
      if (it.type === 'punchIn') {
        await deletePunch({ punchId: it.punchId, reason });
        if (it.dayCreated) await deleteAttendanceRecord({ therapistId: it.therapistId, date: it.date, reason });
      } else if (it.type === 'punchOut') {
        await savePunch({ punchId: it.punchId, checkIn: it.checkInIso, checkOut: null, reason, source: 'button' });
      } else if (!it.prev) {
        await deleteAttendanceRecord({ therapistId: it.therapistId, date: it.date, reason });
      } else {
        await saveAttendanceRecord({ therapistId: it.therapistId, date: it.date, reason, source: 'button', patch: { status: it.prev.status, offStart: it.prev.offStart, offEnd: it.prev.offEnd } });
      }
    }
    await loadData();
    showToast('Undone');
  };

  // The panel's Save.
  const panelPerson = useMemo(() => {
    if (!panel) return null;
    const r = rows.find((x) => x.id === panel.therapistId);
    if (panel.person) return panel.person;
    if (!r) return null;
    return { therapistId: r.id, name: r.name, status: r.status || '', offStart: r.offStart || '', offEnd: r.offEnd || '', notes: r.notes || '', lateMin: r.d.lateMin };
  }, [panel, rows]);
  const panelShift = useMemo(() => {
    if (!panel) return null;
    if (panel.date !== selectedDate) return panel.shift || null;
    return rows.find((x) => x.id === panel.therapistId)?.shift || null;
  }, [panel, rows, selectedDate]);

  const savePanel = async ({ next, reason }) => {
    const existing = panelPerson && panelPerson.status
      ? { status: panelPerson.status, offStart: panelPerson.offStart || null, offEnd: panelPerson.offEnd || null, notes: panelPerson.notes || null } : null;
    const patch = diffPatch(existing, next);
    if (Object.keys(patch).length === 0) { setPanel(null); return {}; }
    const r = rows.find((x) => x.id === panel.therapistId) || { id: panel.therapistId, name: panelPerson.name };
    if ('status' in patch || 'offStart' in patch) {
      if (!(await confirmLeaves([leaveCheck(r, next.status, next)]))) return {};
    }
    const { error: err } = await saveAttendanceRecord({ therapistId: panel.therapistId, date: panel.date, patch, reason, source: 'panel' });
    if (err) {
      if (err.code === 'ATTENDANCE_DAY_LOCKED') setDayClosed(true);
      return { error: err };
    }
    setPanel(null);
    await loadData();
    showToast(`Attendance saved for ${panelPerson.name}`);
    return {};
  };

  // The panel's punches: today's list from the page, another day's (an open check-out from the banner) fetched on open.
  const panelPunches = useMemo(() => {
    if (!panel) return [];
    return panel.date === selectedDate ? (punchesBy[panel.therapistId] || []) : (panel.punches || []);
  }, [panel, punchesBy, selectedDate]);
  const afterPunchWrite = async () => {
    await loadData();
    if (panel && panel.date !== selectedDate) {
      const { data } = await fetchAttendancePunches({ date: panel.date, therapistId: panel.therapistId });
      setPanel((pn) => (pn ? { ...pn, punches: data || [] } : pn));
    }
  };
  const panelPunchOps = {
    onAdd: async ({ checkIn, checkOut, reason }) => {
      const res = await punchIn({ therapistId: panel.therapistId, branchId, at: punchTimeIso(panel.date, checkIn), out: checkOut ? punchTimeIso(panel.date, checkOut) : null, source: 'panel', reason });
      if (!res.error) await afterPunchWrite(); else if (res.error.code === 'ATTENDANCE_DAY_LOCKED') setDayClosed(true);
      return res;
    },
    onSave: async ({ id, checkIn, checkOut, reason }) => {
      const res = await savePunch({ punchId: id, checkIn: punchTimeIso(panel.date, checkIn), checkOut: checkOut ? punchTimeIso(panel.date, checkOut) : null, reason, source: 'panel' });
      if (!res.error) await afterPunchWrite(); else if (res.error.code === 'ATTENDANCE_DAY_LOCKED') setDayClosed(true);
      return res;
    },
    onDelete: async ({ id, reason }) => {
      const res = await deletePunch({ punchId: id, reason });
      if (!res.error) await afterPunchWrite(); else if (res.error.code === 'ATTENDANCE_DAY_LOCKED') setDayClosed(true);
      return res;
    },
  };

  // Open the panel on another day's open check-out (that day's day row + punches, not today's).
  const openGap = async (g, r) => {
    const [{ data }, { data: pun }] = await Promise.all([
      fetchAttendanceByTherapistIds({ therapistIds: [g.therapistId], date: g.date }),
      fetchAttendancePunches({ date: g.date, therapistId: g.therapistId }),
    ]);
    const a = data?.[g.therapistId] || {};
    setPanel({
      therapistId: g.therapistId, date: g.date, mode: null, focus: null, forceReason: true, punches: pun || [],
      shift: g.shiftStart && g.shiftEnd ? { start: g.shiftStart, end: g.shiftEnd } : null,
      person: { therapistId: g.therapistId, name: r?.name || g.therapistName, status: a.status || 'Present', offStart: '', offEnd: '', notes: a.notes || '', lateMin: 0 },
    });
  };

  // ── pieces ──────────────────────────────────────────────────────────────────────────────────────
  const renderTransferTag = (r) => {
    const row = transferStatusByTherapist[r.id];
    const open = row && ['upcoming', 'now', 'permanent-upcoming'].includes(transferState(toTransferInput(row)));
    if (!open) return null;
    const viewpoint = transferViewpoint(r.id);
    const d = describeTransfer(toTransferInput(row), { viewpoint, use24h, short: true, day: selectedDate, labels: { branch: (locationLabel || 'branch').toLowerCase() } });
    return (
      <button type="button" onClick={() => setTransferTarget({ therapistId: r.id, therapistName: r.name })} title={spaceAmPm(d.sentence)} data-transfer-cell={d.state}
        className="flex items-center gap-2 h-6 max-w-full min-w-0 text-left hover:bg-background rounded-spa">
        <TransferPill state={d.state}>{spaceAmPm(d.pill)}</TransferPill>
        <TransferFitText candidates={spaced(d.state === 'now' ? d.afterPills : viewpoint === 'receiving' ? [d.sentence, d.short, d.tiny] : [d.full, d.short, d.tiny])} className="text-[11.5px] text-text-tertiary flex-1 min-w-0 overflow-hidden" />
      </button>
    );
  };

  const subLine = (r) => {
    const bits = [];
    if (r.visitor) {
      const from = r.shift ? (r.visitAllDay ? 'here all day' : `here ${fmt(r.shift.start)} – ${fmt(r.shift.end)}`) : '';
      const why = r.d.kind === 'no_show' ? ` · no check-in ${minText(r.d.minAfterStart)} after start` : r.d.kind === 'no_checkout' ? ' · check-out missing' : r.d.checkedIn && !r.openHere && selectedDate === today ? ` · Done · ${minutesText(r.workedMin || 0)}` : '';
      return <span className="flex items-center gap-1.5 flex-wrap"><span className="px-1.5 rounded bg-[#EEF3FB] text-[#3B5B8C] text-[11px] font-medium">Visiting</span>{from}{why}</span>;
    }
    if (r.gap) bits.push(`${dayWord(r.gap.date)} never checked out`);
    else if (r.d.kind === 'no_show') bits.push(`no check-in ${minText(r.d.minAfterStart)} after shift start`);
    else if (r.d.kind === 'no_checkout') bits.push('check-out missing');
    else if (r.d.kind === 'present_default') bits.push('counts as present');
    else if (r.d.kind === 'present_saved') bits.push('confirmed, no times');
    else if (r.d.lateMin > 0) bits.push(<span key="l" className="px-1.5 rounded bg-[#FEF3E2] text-[#B45309] text-[11px] font-medium">Late {minText(r.d.lateMin)}{r.lateDue ? ` (due ${fmt(r.lateDue.start)} at ${branchNameById[r.lateDue.branchId] || 'this branch'})` : ''}</span>);
    else if (r.d.minAfterStart > 0) bits.push(`${r.d.minAfterStart} min after start · within grace`);
    else if (r.d.kind === 'later' && r.shift) bits.push(`Starts ${fmt(r.shift.start)}`);
    else if (isHalfDayStatus(r.status) && r.offStart) bits.push(`Half day · off ${fmt(r.offStart)} – ${fmt(r.offEnd)}`);
    else if (r.d.kind === 'leave') bits.push(r.status === 'Sick Leave' ? 'Sick leave' : r.status === 'Annual Leave' ? 'Annual leave' : 'Leave');
    if (r.d.kind === 'out' && selectedDate === today) bits.push(`Done · ${r.punchCount ? minutesText(r.workedMin) : durationText(r.checkInTime, r.checkOutTime)}`);
    const role = r.position && !bits.length ? r.position : null;
    // Punches at other branches: "Checked in at Sanepa 6:55 pm – 7:25 pm" when that's the whole day, else "At Sanepa 2:00 pm – 4:00 pm".
    const bn = (id) => branchNameById[id] || `another ${wordBranch()}`;
    const worked = r.elsewhere && r.elsewhere.length
      ? r.elsewhere.slice(0, 2).map((q) => `${r.elsewhere.length === r.punchCount ? 'Checked in at' : 'At'} ${bn(q.branchId)} ${fmt(q.checkIn)}${q.checkOut ? ` – ${fmt(q.checkOut)}` : ' (still in)'}`).join(' · ')
      : null;
    const tag = renderTransferTag(r);
    const parts = [role, ...bits].filter(Boolean);
    if (!parts.length && !tag && !worked) return null;
    return (
      <span className="flex flex-col gap-0.5 min-w-0">
        {parts.length > 0 && <span className="truncate">{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && ' · '}{p}</React.Fragment>)}</span>}
        {worked && <span className="truncate" data-worked-at>{worked}</span>}
        {tag}
      </span>
    );
  };

  const action = (r) => {
    if (dayClosed) return null;
    const busy = !!busyIds[r.id];
    if (r.visitor) {
      if (!r.d.checkedIn) return <MiniBtn primary={r.d.kind !== 'later'} disabled={busy} onClick={() => visitorCheck(r, 'in')}>Check in</MiniBtn>;
      if (r.openHere) return <MiniBtn disabled={busy} onClick={() => visitorCheck(r, 'out')}>Check out</MiniBtn>;
      return selectedDate === today
        ? <MiniBtn disabled={busy} onClick={() => visitorCheck(r, 'in')}>Check in again</MiniBtn>
        : <span className="text-[12px] text-text-tertiary">Done · {minutesText(r.workedMin || 0)}</span>;
    }
    const k = r.d.kind;
    if (r.gap) return <MiniBtn primary disabled={busy} onClick={() => openGap(r.gap, r)}>Add out time</MiniBtn>;
    if (selectedDate !== today) {
      if (['leave', 'off'].includes(k)) return null;
      return <MiniBtn disabled={busy} onClick={() => openPanel(r, { mode: null })}>{k === 'out' ? 'Edit' : 'Edit times'}</MiniBtn>;
    }
    if (k === 'no_show') return <span className="flex gap-1.5 justify-end"><MiniBtn primary disabled={busy} onClick={() => checkIn(r)}>Check in</MiniBtn><MiniBtn disabled={busy} onClick={() => askAbsent(r)}>Absent</MiniBtn></span>;
    if (k === 'present_default' || k === 'present_saved') return <MiniBtn disabled={busy} onClick={() => checkIn(r)}>Check in</MiniBtn>;
    if (['not_in_yet', 'later', 'unmarked'].includes(k)) return <MiniBtn primary={k === 'not_in_yet'} disabled={busy} onClick={() => checkIn(r)}>Check in</MiniBtn>;
    if (k === 'no_checkout') return <MiniBtn primary disabled={busy} onClick={() => openPanel(r, { mode: null })}>Add out time</MiniBtn>;
    if (['in', 'half'].includes(k)) {
      if (r.openHere) return <MiniBtn disabled={busy} onClick={() => checkOutNow(r)}>Check out</MiniBtn>;
      const away = (r.elsewhere || []).find((q) => !q.checkOut);
      if (away) return <span className="text-[12px] text-text-tertiary">At {branchNameById[away.branchId] || `another ${wordBranch()}`}</span>;
      return <MiniBtn disabled={busy} onClick={() => openPanel(r, { mode: null })}>Add out time</MiniBtn>;
    }
    if (k === 'out') return <MiniBtn disabled={busy} onClick={() => checkIn(r)}>Check in again</MiniBtn>;
    return null;
  };

  const rowMenu = (r) => {
    const item = (label, run, extra = '') => ({ label, run, extra });
    let items;
    if (dayClosed) items = [item('Open profile', () => navigate(`/${orgSlug}/staff/${r.id}`))];
    else if (r.visitor) items = [item('Open profile', () => navigate(`/${orgSlug}/staff/${r.id}`))];
    else items = [
      item('Check-ins & times…', () => openPanel(r, { mode: null })),
      item('Add punch…', () => openPanel(r, { mode: null, addPunch: true })),
      item('Half day…', () => openPanel(r, { mode: 'half' })),
      item('Leave…', () => openPanel(r, { mode: 'leave' })),
      item('Day off', () => dayOff(r)),
      item('Mark absent', () => askAbsent(r)),
      item('Add note…', () => openPanel(r, { mode: null, note: true })),
      { divider: true },
      item(`Transfer…`, () => setTransferTarget({ therapistId: r.id, therapistName: r.name })),
      item('Open profile', () => navigate(`/${orgSlug}/staff/${r.id}`)),
    ];
    return (
      <Menu title={`Actions for ${r.name}`} trigger={(open, toggle) => (
        <button type="button" aria-label={`More for ${r.name}`} aria-expanded={open} onClick={toggle} className="w-7 h-7 rounded-md text-text-secondary hover:bg-[#F1F1EF] flex items-center justify-center"><Icon name="MoreHorizontal" size={16} /></button>
      )}>
        {(close) => items.map((it, i) => (it.divider ? <div key={i} className="my-1 border-t border-border" /> : (
          <button key={it.label} type="button" onClick={() => { close(); it.run(); }} className="w-full text-left px-3 py-1.5 text-[13px] text-text-primary hover:bg-[#F6F6F4]">{it.label}</button>
        )))}
      </Menu>
    );
  };

  const th = 'h-[34px] text-[12px] font-medium whitespace-nowrap border-b border-border bg-white text-[#8A8A90] sticky z-[5] text-left';
  const { blockRef, sentinelRef, blockH, stuck } = useStickyBlock(0);
  const thTop = { top: blockH - 16 }; // the block sits 16px up, over the scroller's padding

  const renderRow = (r) => {
    const selectable = !r.visitor && !dayClosed && selectedDate === today;
    const k = KINDS[r.d.kind] || KINDS.not_scheduled;
    const pillKind = r.gap ? 'no_checkout' : r.d.kind;
    const shiftText = r.shift ? `${fmt(r.shift.start)} – ${fmt(r.shift.end)}` : '—';
    const showIn = r.gap ? `${dayWord(r.gap.date).split(' ')[0]} ${fmt(r.gap.checkInTime)}` : fmt(r.checkInTime);
    return (
      <tr className={`border-b border-[#F0F0EE] hover:bg-[#FCFCFB] ${selectedIds.includes(r.id) ? 'bg-primary/[0.04]' : ''}`} data-attendance-row={r.id} data-kind={pillKind}>
        <td className="pl-3 py-2 w-[34px]">{selectable ? <input type="checkbox" aria-label={`Select ${r.name}`} checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30" /> : null}</td>
        <td className="py-2 pr-3 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={r.name} size={28} />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-text-primary">{r.name}</div>
              <div className="text-[12px] text-text-secondary">{subLine(r)}</div>
            </div>
          </div>
        </td>
        <td className="py-2 pr-3 font-data text-[12.5px] text-text-secondary whitespace-nowrap">{shiftText}</td>
        <td className="py-2 pr-3"><Pill kind={pillKind} label={r.d.kind === 'half' ? 'Half day' : undefined} /></td>
        <td className="py-2 pr-3 font-data text-[12.5px] whitespace-nowrap">{showIn || <span className="text-text-tertiary">—</span>}{r.punchCount > 1 && <span className="block font-body text-[11px] text-text-tertiary" data-punch-count>{r.punchCount} punches</span>}</td>
        <td className="py-2 pr-3 font-data text-[12.5px] whitespace-nowrap">{r.checkOutTime ? fmt(r.checkOutTime) : <span className="text-text-tertiary">—</span>}</td>
        <td className="py-2 pr-2 text-right whitespace-nowrap">{action(r)}</td>
        <td className="py-2 pr-2 w-[34px]">{rowMenu(r)}</td>
      </tr>
    );
  };

  const groupHead = ({ key, title, count, note, tone, collapsible, open, onToggle, action: headAction }) => (
    <tr key={key} className={tone === 'err' ? 'bg-[#FDECEC]' : 'bg-[#F6F6F4]'}>
      <td colSpan={8} className="px-3 py-1.5 text-[12px] font-medium">
        <div className="flex items-center gap-3">
          <button type="button" disabled={!collapsible} onClick={onToggle} className={`flex items-center gap-2 ${tone === 'err' ? 'text-[#B42318]' : 'text-text-primary'} ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}>
            {collapsible && <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={13} />}
            {title}<span className="text-[#8A8A90] font-normal">{count}{note ? ` · ${note}` : ''}</span>
          </button>
          {headAction}
        </div>
      </td>
    </tr>
  );

  const renderAway = (s) => {
    const open = ['upcoming', 'now', 'permanent-upcoming'].includes(transferState(toTransferInput(s)));
    const d = describeTransfer(toTransferInput(s), { viewpoint: 'home', use24h, short: true, day: selectedDate, labels: { branch: (locationLabel || 'branch').toLowerCase() } });
    return (
      <tr className="border-b border-[#F0F0EE]" data-attendance-away={s.id}>
        <td />
        <td className="py-2 pr-3">
          <button type="button" onClick={() => setTransferTarget({ therapistId: s.therapistId, therapistName: s.therapistName })} className="flex items-center gap-2.5 min-w-0 text-left">
            <Avatar name={s.name} size={28} />
            <span className="min-w-0"><span className="block text-[13px] font-medium text-text-primary">{s.name}</span>
              {open && (
                <span data-transfer-cell={d.state} className="flex items-center gap-2 h-6 min-w-0">
                  <TransferPill state={d.state}>{spaceAmPm(d.pill)}</TransferPill>
                  <TransferFitText candidates={spaced(d.state === 'now' ? d.afterPills : [d.full, d.short, d.tiny])} className="text-[11.5px] text-text-tertiary min-w-0 overflow-hidden" />
                </span>
              )}
            </span>
          </button>
        </td>
        <td className="py-2 pr-3 text-[12px] text-text-tertiary">Away</td>
        <td className="py-2 pr-3"><Pill kind="not_scheduled" label="Away" /></td>
        <td className="py-2 pr-3 font-data text-[12.5px]">{s.attendance?.checkInTime ? fmt(s.attendance.checkInTime) : '—'}</td>
        <td className="py-2 pr-3 font-data text-[12.5px]">{s.attendance?.checkOutTime ? fmt(s.attendance.checkOutTime) : '—'}</td>
        <td /><td />
      </tr>
    );
  };

  // ── render ─────────────────────────────────────────────────────────────────────────────────────
  const summary = (() => {
    if (selectedDate > today) return <span className="text-text-tertiary">Nothing to mark yet.</span>;
    const firstStart = rows.map((r) => (r.shift ? toMin(r.shift.start) : null)).filter((x) => x != null).sort((a, b) => a - b)[0];
    if (selectedDate === today && counts.in === 0 && firstStart != null && nowMin < firstStart) {
      return <><span><b className="font-semibold">0</b> of {counts.expected} in</span><span className="text-text-tertiary">· first shift starts {fmt(`${String(Math.floor(firstStart / 60)).padStart(2, '0')}:${String(firstStart % 60).padStart(2, '0')}`)}</span></>;
    }
    if (!settings.expectCheckIn) {
      return (
        <>
          {counts.notChecked > 0 && <span><b className="font-semibold">{counts.notChecked}</b> not checked in <span className="text-text-tertiary">(counted present)</span></span>}
          <span><b className="font-semibold">{counts.in}</b> checked in{counts.visitorsIn > 0 ? <span className="text-text-tertiary"> ({counts.visitorsIn} visiting)</span> : null}</span>
          {counts.confirmed > 0 && <span><b className="font-semibold">{counts.confirmed}</b> confirmed present</span>}
          {counts.late > 0 && <span className="text-[#B45309]"><b className="font-semibold">{counts.late}</b> late</span>}
          {counts.onLeave > 0 && <span><b className="font-semibold">{counts.onLeave}</b> on leave</span>}
          {visitorRows.length > counts.visitorsIn && <span><b className="font-semibold">{visitorRows.length}</b> visiting</span>}
          {counts.later > 0 && <span className="text-text-tertiary">· {counts.later} starts later</span>}
        </>
      );
    }
    return (
      <>
        <span><b className="font-semibold">{counts.in}</b> of {counts.expected + visitorRows.length} checked in{counts.visitorsIn > 0 ? <span className="text-text-tertiary"> ({counts.visitorsIn} visiting)</span> : null}</span>
        {counts.noShow > 0 && <span className="text-[#B42318]"><b className="font-semibold">{counts.noShow}</b> no show</span>}
        {counts.late > 0 && <span className="text-[#B45309]"><b className="font-semibold">{counts.late}</b> late</span>}
        {counts.onLeave > 0 && <span><b className="font-semibold">{counts.onLeave}</b> on leave</span>}
        {visitorRows.length > counts.visitorsIn && <span><b className="font-semibold">{visitorRows.length}</b> visiting</span>}
        {counts.later > 0 && <span className="text-text-tertiary">· {counts.later} starts later</span>}
      </>
    );
  })();

  const body = (() => {
    if (error) return <ErrorBlock error={error} onRetry={loadData} />;
    if (loading) {
      return <div className="space-y-2 pt-3 animate-pulse" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 bg-background rounded" />)}</div>;
    }
    if (rows.length === 0 && visitorRows.length === 0 && awayRows.length === 0) {
      return <EmptyBlock icon="Users" title={`No active ${staffLabelPlural.toLowerCase()} found for this ${wordBranch()}.`} />;
    }
    if (shownCount === 0) {
      return (
        <div className="mt-3 px-4 py-3 rounded-lg bg-[#F6F6F4] text-[13px] text-text-secondary flex items-center" data-testid="no-match">
          {q ? <>No one called “{query.trim()}” works here {selectedDate === today ? 'today' : 'that day'}.</> : 'No one matches this filter.'}
          <button type="button" onClick={() => { setQuery(''); setChip('all'); }} className="ml-auto text-primary font-medium">Clear {q ? 'search' : 'filter'}</button>
        </div>
      );
    }
    const allIds = [...groups.attention, ...groups.service, ...groups.support].filter((r) => !dayClosed && selectedDate === today).map((r) => r.id);
    const allOn = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
    return (
      <table className="w-full border-collapse table-fixed mt-2" data-testid="attendance-table">
        <colgroup><col style={{ width: 34 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 130 }} /><col style={{ width: 96 }} /><col style={{ width: 84 }} /><col style={{ width: 166 }} /><col style={{ width: 38 }} /></colgroup>
        <thead>
          <tr>
            <th className={`${th} pl-3`} style={thTop}>{allIds.length > 0 && <input type="checkbox" aria-label="Select everyone" checked={allOn} onChange={() => setSelectedIds(allOn ? [] : allIds)} className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30" />}</th>
            <th className={th} style={thTop}>Name</th><th className={th} style={thTop}>Shift</th><th className={th} style={thTop}>Status</th>
            <th className={th} style={thTop}>In</th><th className={th} style={thTop}>Out</th><th className={th} style={thTop} /><th className={th} style={thTop} />
          </tr>
        </thead>
        <tbody>
          {groups.attention.length > 0 && groupHead({ key: 'h-attention', title: 'Needs attention', tone: 'err', count: groups.attention.length, note: "stays at the top until it's sorted", action: startPresentRows.length > 0 ? <button type="button" onClick={markAttentionPresent} className="ml-auto h-[24px] px-2.5 rounded-[6px] border border-[#F3C6C2] bg-white text-[11.5px] font-medium text-[#B42318] hover:bg-[#FFF6F5]">Mark all present at shift start ({startPresentRows.length})</button> : null })}
          {groups.attention.map((r) => <RowBoundary key={r.id}>{renderRow(r)}</RowBoundary>)}
          {groups.service.length > 0 && groupHead({ key: 'h-service', title: staffLabelPlural, count: groups.service.length })}
          {groups.service.map((r) => <RowBoundary key={r.id}>{renderRow(r)}</RowBoundary>)}
          {groups.vis.length > 0 && groupHead({ key: 'h-vis', title: 'Visiting today', count: groups.vis.length, note: `works here on a temporary transfer, paid by their home ${wordBranch()}` })}
          {groups.vis.map((r) => <RowBoundary key={r.id}>{renderRow(r)}</RowBoundary>)}
          {groups.support.length > 0 && groupHead({ key: 'h-support', title: 'Support staff', count: groups.support.length })}
          {groups.support.map((r) => <RowBoundary key={r.id}>{renderRow(r)}</RowBoundary>)}
          {groups.away.length > 0 && groupHead({ key: 'h-away', title: 'Away today', count: groups.away.length, collapsible: true, open: awayOpen, onToggle: () => setAwayOpen((o) => !o), note: awayOpen ? '' : 'on a transfer' })}
          {groups.away.length > 0 && awayOpen && groups.away.map((s) => <RowBoundary key={`away-${s.id}`}>{renderAway(s)}</RowBoundary>)}
        </tbody>
      </table>
    );
  })();

  const closedLabel = dayWord(selectedDate);
  return (
    <div className="pb-6" data-testid="attendance-page">
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div ref={blockRef} className="sticky -top-4 -mt-4 z-sticky-filter bg-white pt-4 pb-1">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous day" onClick={() => setSelectedDate(addDays(selectedDate, -1))} className="w-8 h-8 rounded-md border border-border bg-white hover:bg-[#FAFAF9] flex items-center justify-center"><Icon name="ChevronLeft" size={15} /></button>
          <div className="w-[170px] [&_button]:h-8"><DateField value={selectedDate} onChange={setSelectedDate} /></div>
          <button type="button" aria-label="Next day" onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="w-8 h-8 rounded-md border border-border bg-white hover:bg-[#FAFAF9] flex items-center justify-center"><Icon name="ChevronRight" size={15} /></button>
          <button type="button" onClick={() => setSelectedDate(today)} disabled={selectedDate === today} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium hover:bg-[#FAFAF9] disabled:opacity-50">Today</button>
        </div>
      </div>
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[13px] text-text-primary mt-2 tabular-nums" data-testid="attendance-summary">{!loading && summary}</div>

      {focusTherapistId && (
        <div className="flex items-center gap-2 pt-2 text-[13px]" data-attendance-focus>
          <span className="text-text-secondary">Showing only <b className="text-text-primary font-medium">{rows.find((r) => r.id === focusTherapistId)?.name || 'one person'}</b></span>
          <button type="button" onClick={clearFocusTherapist} className="text-primary hover:underline">Show everyone</button>
        </div>
      )}

        <div className="flex items-center gap-2 flex-wrap mt-2">
          <SearchBox ref={searchRef} value={query} onChange={setQuery} placeholder={`Search ${staffLabelPlural.toLowerCase()}…`} ariaLabel="Search staff" className="w-full sm:w-[220px]" />
          {chipsFor(!!settings.expectCheckIn, selectedDate < today).map((c) => {
            const n = counts[c.id] ?? 0;
            if (c.id === 'attention' && n === 0 && chip !== 'attention') return null;
            const on = chip === c.id;
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setChip(on && c.id !== 'all' ? 'all' : c.id)}
                className={`h-[30px] px-3 rounded-full border text-[12.5px] font-medium inline-flex items-center gap-1.5 ${on ? 'bg-[#E8F3E6] border-[#CFDCCC] text-primary' : c.tone === 'err' ? 'bg-white border-[#F3C6C2] text-[#B42318]' : 'bg-white border-border text-text-secondary hover:bg-[#FAFAF9]'}`}>
                {c.label}<span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {selectedIds.length > 0 && !dayClosed && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#E8F3E6] border border-[#CFDCCC]" data-testid="bulk-bar">
            <span className="text-[13px] font-medium">{selectedIds.length} selected</span>
            <button type="button" onClick={() => bulk('present')} className="h-[28px] px-3 rounded-[7px] bg-primary text-white text-[12px] font-medium">Mark present</button>
            <button type="button" onClick={() => bulk('absent')} className="h-[28px] px-3 rounded-[7px] border border-border bg-white text-[12px] font-medium">Mark absent</button>
            <button type="button" onClick={() => bulk('off')} className="h-[28px] px-3 rounded-[7px] border border-border bg-white text-[12px] font-medium">Day off</button>
            <button type="button" onClick={() => setSelectedIds([])} className="ml-auto text-[12px] text-text-secondary hover:text-text-primary">Clear</button>
          </div>
        )}
      </div>

      {dayClosed && (
        <div className="mt-2 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-[#F1F1EF] text-[13px] text-text-primary" data-testid="closed-banner">
          <Icon name="Lock" size={14} /> {closedLabel} is closed. Attendance can't be changed.
        </div>
      )}
      {!dayClosed && unmarkedBanner && !loading && (
        <div className="mt-2 flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-[#FEF3E2] border border-[#F6DDB8] text-[13px] text-[#7A4A0B]" data-testid="unmarked-banner">
          <Icon name="AlertTriangle" size={15} />
          <span><b className="font-semibold">{dayWord(unmarkedBanner.date)} has {plural(unmarkedBanner.list.length, 'unmarked person', 'unmarked people')}</b> ({unmarkedBanner.list.slice(0, 2).map((g) => g.therapistName).join(', ')}{unmarkedBanner.list.length > 2 ? ` +${unmarkedBanner.list.length - 2}` : ''}).
            Unmarked days are paid in full.{unmarkedBanner.moreDays > 0 ? ` ${plural(unmarkedBanner.moreDays, 'more day', 'more days')} also need review.` : ''}</span>
          <button type="button" onClick={() => setSelectedDate(unmarkedBanner.date)} className="ml-auto h-[28px] px-3 rounded-[7px] border border-[#E5C791] bg-white text-[12px] font-medium whitespace-nowrap text-text-primary">Review {dayWord(unmarkedBanner.date).split(' ').slice(0, 2).join(' ')}</button>
        </div>
      )}

      {confirmRows.length > 0 && (
        <div className="mt-2 flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-[#F6F6F4] border border-border text-[13px] text-text-primary" data-testid="eod-bar">
          <Icon name="ClipboardCheck" size={15} className="text-text-secondary" />
          <span>{plural(confirmRows.length, 'person has', 'people have')} no attendance saved for {dayWord(selectedDate)}. Confirm present?</span>
          <span className="ml-auto flex items-center gap-2">
            <button type="button" onClick={confirmAllPresent} className="h-[28px] px-3 rounded-[7px] bg-primary text-white text-[12px] font-medium whitespace-nowrap">Confirm all present</button>
            <button type="button" onClick={() => setChip('notin')} className="h-[28px] px-3 rounded-[7px] border border-border bg-white text-[12px] font-medium">Review</button>
          </span>
        </div>
      )}

      {body}

      {conflictModal}
      {panel && panelPerson && (
        <AttendanceSidePanel
          open
          onClose={() => setPanel(null)}
          person={panelPerson}
          date={panel.date}
          today={today}
          shift={panelShift}
          initialMode={panel.note ? 'note' : panel.mode}
          focus={panel.focus}
          forceReason={panel.forceReason}
          initialAdd={!!panel.addPunch}
          canEdit={!dayClosed}
          staffLabel={staffLabel}
          fmt={fmt}
          punches={panelPunches}
          branchId={branchId}
          branchNameById={branchNameById}
          punchOps={panelPunchOps}
          onSave={savePanel}
        />
      )}
      {confirmAbsent && (
        <ConfirmDialog
          title={`Mark ${confirmAbsent.name} absent?`}
          message={`${confirmAbsent.name} is already checked in at ${fmt(confirmAbsent.checkInTime)}. Marking them absent changes their saved record and needs a reason.`}
          confirmLabel="Mark absent"
          requireReason={false}
          confirmVariant="primary"
          tone="warning"
          onClose={() => setConfirmAbsent(null)}
          onConfirm={() => { const r = confirmAbsent; setConfirmAbsent(null); openPanel(r, { mode: 'absent', focus: 'reason', forceReason: true }); }}
        />
      )}
      {transferTarget && (
        <TransferManagementModal
          variant="panel"
          therapistId={transferTarget.therapistId}
          therapistName={transferTarget.therapistName}
          currentBranchId={branchId}
          defaultStartDate={selectedDate}
          onClose={() => setTransferTarget(null)}
          onSuccess={(message) => { setTransferTarget(null); if (message) showToast(message); loadData(); }}
        />
      )}
      {toast && (
        <div role="status" className={`fixed toast-bottom left-1/2 -translate-x-1/2 z-toast px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium flex items-center gap-3 ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-text-primary text-white'}`}>
          <span>{toast.msg}</span>
          {toast.undo && <button type="button" onClick={() => undo(toast.undo)} className="underline text-white/90 hover:text-white">Undo</button>}
        </div>
      )}
    </div>
  );
};

export default AttendancePanel;
