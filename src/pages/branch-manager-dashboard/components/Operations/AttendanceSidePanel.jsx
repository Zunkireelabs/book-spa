import { NEPAL_TZ } from '../../../../utils/nepalTime';
import { friendlyError } from '../../../../utils/friendlyError';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SidePanel from '../../../../components/ui/SidePanel';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { Field, Segmented, TimeField, TextInput, InlineError, InlineWarning, formatShortDate } from '../../../../components/ui/PanelFormKit';
import { fetchAttendanceChanges, fetchAttendancePayContext } from '../../../../services/api';
import { defaultHalfDayOff, validateHalfDay } from '../../../../services/availabilityConflicts';
import { diffPatch, needsReason, payEffect, isHalfDayStatus, LEAVE_STATUSES } from '../../../../services/attendanceView';
import { Avatar } from '../Area/listKit';
import { wordBranch } from '../../../../utils/industryTerms';

const MODES = [['present', 'Present'], ['half', 'Half day'], ['leave', 'Leave'], ['off', 'Off'], ['absent', 'Absent']];
const LEAVE_TYPES = [{ value: 'Annual Leave', label: 'Annual leave' }, { value: 'Sick Leave', label: 'Sick leave' }];
const HALF_PARTS = [['1st-Half Day', 'First half'], ['2nd-Half Day', 'Second half'], ['custom', 'Custom']];

const modeOf = (status) => {
  if (!status || status === 'Present') return 'present';
  if (isHalfDayStatus(status)) return 'half';
  if (LEAVE_STATUSES.includes(status)) return 'leave';
  if (status === 'Day Off') return 'off';
  return 'absent';
};

const STATUS_TEXT = { '1st-Half Day': 'half day (first half)', '2nd-Half Day': 'half day (second half)', 'Day Off': 'off' };
const statusWord = (v) => STATUS_TEXT[v] || String(v).toLowerCase();
const hmFromIso = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const nowHM = () => hmFromIso(new Date().toISOString());
const toMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const floorStep = (hm, step) => { const t = toMin(hm); const f = t - (t % step); return `${String(Math.floor(f / 60)).padStart(2, '0')}:${String(f % 60).padStart(2, '0')}`; };
const UNDO_REASON = 'Undone from the toast';

// One history line per save (rows written in the same statement share a timestamp).
function groupHistory(rows) {
  const groups = [];
  rows.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.changedBy === r.changed_by && Math.abs(new Date(last.at) - new Date(r.changed_at)) < 2000) last.rows.push(r);
    else groups.push({ at: r.changed_at, changedBy: r.changed_by, name: r.changedByName, reason: r.reason, source: r.source, rows: [r] });
  });
  return groups;
}
// "1:46 → 2:00 pm": the first time drops its am/pm when both share it.
const arrow = (a, b) => { const m = /\s?(am|pm)$/i.exec(a); return m && b.toLowerCase().endsWith(m[1].toLowerCase()) ? `${a.slice(0, m.index)} → ${b}` : `${a} → ${b}`; };
// Plain words: "Check-out 1:46 → 2:00 pm, check-in 1:46 pm → 10:30 am", "Check-in 1:00 pm removed", "Marked present".
export const lineOf = (g, fmt) => {
  const tm = (v) => fmt(hmFromIso(v));
  const parts = [];
  const byPunch = {};
  g.rows.forEach((r) => {
    const f = r.field === 'check_in_time' ? 'check_in' : r.field === 'check_out_time' ? 'check_out' : r.field;   // the old day-level record
    if (f === 'check_in' || f === 'check_out') { const k = r.punch_id || 'day'; (byPunch[k] = byPunch[k] || { old: r.field.endsWith('_time') || r.source === 'legacy' })[f] = r; }
    else if (r.field === 'status') parts.push(r.old_value == null ? `Marked ${statusWord(r.new_value)}` : r.new_value == null ? 'Day record removed' : `Changed from ${statusWord(r.old_value)} to ${statusWord(r.new_value)}`);
    else if (r.field === 'notes') parts.push(r.new_value == null ? 'Note removed' : r.old_value == null ? `Note added: ${r.new_value}` : `Note changed: ${r.new_value}`);
    else if (r.field === 'off_start' || r.field === 'off_end') {
      const label = r.field === 'off_start' ? 'Off from' : 'Off until';
      const t = (v) => fmt(String(v).slice(0, 5));
      parts.push(r.new_value == null ? `${label} cleared` : r.old_value == null ? `${label} ${t(r.new_value)}` : `${label} ${arrow(t(r.old_value), t(r.new_value))}`);
    }
  });
  Object.values(byPunch).forEach(({ check_in: i, check_out: o, old }) => {
    if (old && i && i.old_value == null && i.new_value != null) { parts.push(`Imported check-in ${tm(i.new_value)}${o && o.new_value ? ` – ${tm(o.new_value)}` : ''} (from the old record)`); return; }
    if (i && i.new_value == null) { parts.push(`Check-in ${tm(i.old_value)}${o && o.old_value ? ` – ${tm(o.old_value)}` : ''} removed`); return; }
    if (i && i.old_value == null) { parts.push(`Check-in ${tm(i.new_value)}${o && o.new_value ? ` – ${tm(o.new_value)}` : ''}`); return; }
    const bits = [];
    if (o) bits.push(o.old_value == null ? `check-out ${tm(o.new_value)}` : o.new_value == null ? 'check-out removed' : `check-out ${arrow(tm(o.old_value), tm(o.new_value))}`);
    if (i) bits.push(`check-in ${arrow(tm(i.old_value), tm(i.new_value))}`);
    parts.push(bits.join(', ').replace(/^./, (c) => c.toUpperCase()));
  });
  return parts.join(', ') || 'Record updated';
};

/**
 * Right-hand panel for one person + date: status, times, half-day split, leave type, pay effect, reason and history.
 * `person`: { therapistId, name, status, checkIn, checkOut, offStart, offEnd, notes, lateMin }; `shift`: { start, end } | null.
 * `onSave({ next, reason })` resolves { error } — the page does the write (save_attendance) and the leave/booking check.
 */
const AttendanceSidePanel = ({ open, onClose, person, date, today, shift, initialMode, initialAdd = false, focus, forceReason, onSave, staffLabel = 'Therapist', canEdit = true, fmt = (t) => t, punches = [], branchId = null, branchNameById = {}, punchOps = null }) => {
  const existing = useMemo(() => (person && person.status ? {
    status: person.status || '', offStart: person.offStart || null, offEnd: person.offEnd || null, notes: person.notes || null,
  } : null), [person]);

  const [mode, setMode] = useState('present');
  // punches: inline edit of one, or a new one
  const [editId, setEditId] = useState(null);
  const [pIn, setPIn] = useState('');
  const [pOut, setPOut] = useState('');
  const [adding, setAdding] = useState(false);
  const [delId, setDelId] = useState(null);
  const [pReason, setPReason] = useState('');
  const [pReasonShown, setPReasonShown] = useState(false);
  const [pError, setPError] = useState('');
  const pReasonRef = useRef(null);
  const [punchBusy, setPunchBusy] = useState(false);
  const [halfPart, setHalfPart] = useState('2nd-Half Day');
  const [offStart, setOffStart] = useState('');
  const [offEnd, setOffEnd] = useState('');
  const [leaveType, setLeaveType] = useState('Annual Leave');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [reasonShown, setReasonShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ctx, setCtx] = useState(null);
  const [history, setHistory] = useState(null);
  const reasonRef = useRef(null);
  const noteRef = useRef(null);

  const personId = person?.therapistId;
  // Load fresh whenever the panel opens for a person/date.
  useEffect(() => {
    if (!open || !person) return;
    const st = person.status || '';
    setMode(initialMode && initialMode !== 'times' && initialMode !== 'note' ? initialMode : modeOf(st));
    setEditId(null); setDelId(null); setPReason(''); setPReasonShown(false); setPError('');
    if (initialAdd) { setAdding(true); setPIn(date === today ? floorStep(nowHM(), 5) : (shift?.start || '')); } else { setAdding(false); setPIn(''); }
    setPOut('');
    const half = isHalfDayStatus(st) ? st : '2nd-Half Day';
    const d = defaultHalfDayOff({ status: half, shift: shift ? { ...shift, breaks: shift.breaks || [] } : null });
    setHalfPart(isHalfDayStatus(st) ? (person.offStart && d && (person.offStart !== d.start || person.offEnd !== d.end) ? 'custom' : st) : '2nd-Half Day');
    setOffStart(person.offStart || d?.start || '');
    setOffEnd(person.offEnd || d?.end || '');
    setLeaveType(st === 'Sick Leave' ? 'Sick Leave' : 'Annual Leave');
    setNote(person.notes || '');
    setReason('');
    setReasonShown(!!forceReason);
    setError('');
    setCtx(null);
    setHistory(null);
    let cancelled = false;
    fetchAttendancePayContext({ therapistId: personId, date }).then(({ data }) => { if (!cancelled) setCtx(data); });
    fetchAttendanceChanges({ therapistId: personId, date }).then(({ data }) => { if (!cancelled) setHistory(data || []); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId, date]);

  // The page asked for the Reason field (save bounced with ATTENDANCE_REASON_REQUIRED) or a Note.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      if (focus === 'reason') reasonRef.current?.focus();
      else if (initialMode === 'note') noteRef.current?.focus();
    }, 260);
    return () => clearTimeout(t);
  }, [open, focus, initialMode, personId, forceReason]);
  useEffect(() => { if (forceReason) setReasonShown(true); }, [forceReason]);

  const status = useMemo(() => {
    if (mode === 'present') return 'Present';
    if (mode === 'half') return halfPart === 'custom' ? '2nd-Half Day' : halfPart;
    if (mode === 'leave') return leaveType;
    if (mode === 'off') return 'Day Off';
    return 'Absent';
  }, [mode, halfPart, leaveType]);

  // What would be saved (times only matter for a present / half day).
  const next = useMemo(() => {
    const n = { status, notes: note.trim() || null };
    n.offStart = mode === 'half' ? (offStart || null) : null;
    n.offEnd = mode === 'half' ? (offEnd || null) : null;
    return n;
  }, [status, mode, offStart, offEnd, note]);

  const reasonRequired = !!existing && needsReason({ existing, next, date, today }) || (!existing && date < today);
  const dirty = Object.keys(diffPatch(existing, next)).length > 0;
  const halfErr = mode === 'half' ? validateHalfDay({ offStart, offEnd, shift: shift ? { ...shift, breaks: shift.breaks || [] } : null }) : null;
  const pay = ctx ? payEffect({ status, date, ctx, lateMin: person?.lateMin || 0 }) : null;

  const pickHalf = (v) => {
    setHalfPart(v);
    if (v !== 'custom') {
      const d = defaultHalfDayOff({ status: v, shift: shift ? { ...shift, breaks: shift.breaks || [] } : null });
      setOffStart(d?.start || ''); setOffEnd(d?.end || '');
    }
  };

  const reloadHistory = () => fetchAttendanceChanges({ therapistId: personId, date }).then(({ data }) => setHistory(data || []));
  const maxTime = date === today ? floorStep(nowHM(), 5) : '23:59';
  const resetBox = () => { setPReason(''); setPReasonShown(false); setPError(''); };
  const startEdit = (q) => { setEditId(q.id); setAdding(false); setDelId(null); resetBox(); setPIn(q.checkIn || ''); setPOut(q.checkOut || ''); };
  const startAdd = () => { setAdding(true); setEditId(null); setDelId(null); resetBox(); setPIn(date === today ? floorStep(nowHM(), 5) : (shift?.start || '')); setPOut(''); };
  const startDelete = (q) => { setDelId(q.id); setEditId(null); setAdding(false); resetBox(); };
  const cancelPunch = () => { setEditId(null); setAdding(false); setDelId(null); resetBox(); };
  const boxOpen = editId != null || adding || delId != null;
  const bn = (id) => branchNameById[id] || `This ${wordBranch()}`;
  // A rejected punch, in plain words about this person's day (never the raw error).
  const plainPunchError = (err, skipId, inHM, outHM) => {
    if (err.code === 'PUNCH_FUTURE') return `A ${/check-out/.test(err.message) ? 'check-out' : 'check-in'} can't be later than now (${fmt(nowHM())})`;
    if (err.code === 'PUNCH_OVERLAP') {
      const a = toMin(inHM); const z = outHM ? toMin(outHM) : Infinity;
      const o = punches.find((q) => q.id !== skipId && a < (q.checkOut ? toMin(q.checkOut) : Infinity) && toMin(q.checkIn) < z);
      return o ? `Overlaps ${fmt(o.checkIn)} – ${o.checkOut ? fmt(o.checkOut) : 'still in'}` : 'That time overlaps another check-in.';
    }
    if (err.code === 'PUNCH_OPEN_EXISTS') {
      const o = punches.find((q) => !q.checkOut && q.id !== skipId);
      return o ? `Already checked in at ${bn(o.branchId)} since ${fmt(o.checkIn)}` : 'Already checked in. Check out first.';
    }
    return friendlyError(err, 'Could not save.');
  };
  // Run one punch write from its own box. Editing / deleting needs a reason, adding only on a past day.
  const runPunch = async (needsReasonHere, fn, skipId = null) => {
    setPError('');
    if (needsReasonHere && !pReason.trim()) { setPReasonShown(true); setPError('Add a reason to save this change.'); setTimeout(() => pReasonRef.current?.focus(), 30); return; }
    if (!delId && date === today) {
      const n = nowHM();
      if (pIn > n) { setPError(`A check-in can't be later than now (${fmt(n)})`); return; }
      if (pOut && pOut > n) { setPError(`A check-out can't be later than now (${fmt(n)})`); return; }
    }
    if (!delId && pOut && pOut <= pIn) { setPError('Check-out must be after check-in'); return; }
    setPunchBusy(true);
    const res = await fn(pReason.trim() || null);
    setPunchBusy(false);
    if (res?.error) {
      if (res.error.code === 'ATTENDANCE_REASON_REQUIRED') { setPReasonShown(true); setPError('Add a reason to save this change.'); setTimeout(() => pReasonRef.current?.focus(), 30); }
      else setPError(plainPunchError(res.error, skipId, pIn, pOut));
      return;
    }
    cancelPunch();
    reloadHistory();
  };
  const savePunchEdit = (q) => runPunch(true, (why) => punchOps.onSave({ id: q.id, checkIn: pIn, checkOut: pOut || null, reason: why }), q.id);
  const addPunch = () => runPunch(date < today, (why) => punchOps.onAdd({ checkIn: pIn, checkOut: pOut || null, reason: why }));
  const removePunch = (q) => runPunch(true, (why) => punchOps.onDelete({ id: q.id, reason: why }), q.id);
  // The Reason field of a punch box: right above the box's own button.
  const punchReason = (required) => (required || pReasonShown) && (
    <Field label={<>Reason <span className="text-text-tertiary font-normal">· required</span></>} error={pError && /reason/i.test(pError) ? pError : ''}>
      <TextInput ref={pReasonRef} value={pReason} onChange={(e) => { setPReason(e.target.value); setPError(''); }} placeholder="e.g. Forgot to check out" error={!!pError && /reason/i.test(pError)} />
    </Field>
  );
  const punchErr = pError && !/reason/i.test(pError) ? <InlineError message={pError} /> : null;
  const timeFields = (
    <div className="grid grid-cols-2 gap-2">
      <TimeField formatTime={fmt} value={pIn} onChange={(v) => { setPIn(v); setPError(''); }} step={5} fromTime="00:00" toTime={maxTime} />
      <TimeField formatTime={fmt} value={pOut} onChange={(v) => { setPOut(v); setPError(''); }} step={5} fromTime="00:00" toTime={maxTime} />
    </div>
  );

  const submit = async () => {
    setError('');
    if (halfErr) { setError(halfErr); return; }
    if (reasonRequired && !reason.trim()) { setReasonShown(true); setError('Add a reason to save this change.'); reasonRef.current?.focus(); return; }
    setSaving(true);
    const res = await onSave({ next, reason: reason.trim() || null });
    setSaving(false);
    if (res?.error) {
      if (res.error.code === 'ATTENDANCE_REASON_REQUIRED') { setReasonShown(true); setError('Add a reason to save this change.'); setTimeout(() => reasonRef.current?.focus(), 30); }
      else setError(friendlyError(res.error, 'Could not save.'));
    }
  };

  if (!person) return null;
  const groups = groupHistory(history || []);
  const sub = `${formatShortDate(date)} · ${shift ? `shift ${fmt(shift.start)} – ${fmt(shift.end)}` : 'no shift this day'}`;

  return (
    <SidePanel
      isOpen={open}
      onClose={onClose}
      width="min(460px, 100vw)"
      header={(
        <div className="flex items-center gap-3 px-5 h-[68px] border-b border-border">
          <Avatar name={person.name} size={32} />
          <div className="min-w-0 flex-1">
            <h3 id="attendance-panel-title" className="text-[15px] font-semibold text-text-primary truncate">{person.name}</h3>
            <p className="text-[12px] text-text-secondary truncate">{sub}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background text-lg leading-none">×</button>
        </div>
      )}
      titleId="attendance-panel-title"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-spa border border-border text-[13px] font-medium text-text-secondary hover:bg-background">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !canEdit || !dirty || boxOpen} className="h-9 px-5 rounded-spa bg-primary text-white text-[13px] font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    >
      <div className="px-5 py-4 space-y-4" data-testid="attendance-panel">
        <Field label="Status">
          <div className="[&_button]:whitespace-nowrap [&_button]:px-1"><Segmented options={MODES} value={mode} onChange={setMode} disabled={!canEdit} /></div>
        </Field>

        {mode === 'half' && (
          <>
            <Field label="Off for"><Segmented options={HALF_PARTS} value={halfPart} onChange={pickHalf} disabled={!canEdit} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Off from"><TimeField formatTime={fmt} value={offStart} onChange={(v) => { setOffStart(v); setHalfPart('custom'); }} disabled={!canEdit} step={10} fromTime="00:00" toTime="23:50" /></Field>
              <Field label="Off until"><TimeField formatTime={fmt} value={offEnd} onChange={(v) => { setOffEnd(v); setHalfPart('custom'); }} disabled={!canEdit} step={10} fromTime="00:00" toTime="23:50" /></Field>
            </div>
            <InlineError message={halfErr} />
          </>
        )}

        {mode === 'leave' && (
          <Field label="Leave type"><CustomSelect value={leaveType} onChange={setLeaveType} options={LEAVE_TYPES} disabled={!canEdit} /></Field>
        )}

        {punchOps && (
          <div data-testid="attendance-punches">
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[13px] font-medium text-text-primary">Check-ins{punches.length > 1 ? ` · ${punches.length} punches` : ''}</p>
              {canEdit && !boxOpen && <button type="button" onClick={startAdd} className="text-[12px] text-primary font-medium hover:underline">Add punch</button>}
            </div>
            {punches.length === 0 && !adding && <p className="text-[12.5px] text-text-tertiary">No check-in recorded.</p>}
            <ul className="space-y-1.5">
              {punches.map((q) => (editId === q.id ? (
                <li key={q.id} className="rounded-spa border border-border p-2.5 space-y-2" data-testid="edit-punch">
                  {timeFields}
                  {punchReason(true)}
                  {punchErr}
                  <div className="flex items-center gap-2 text-[12px]">
                    <button type="button" disabled={punchBusy || !pIn} onClick={() => savePunchEdit(q)} className="h-7 px-3 rounded-spa bg-primary text-white font-medium disabled:opacity-50">Save punch</button>
                    <button type="button" onClick={cancelPunch} className="h-7 px-2 text-text-secondary">Cancel</button>
                    {pOut && <button type="button" onClick={() => setPOut('')} className="ml-auto text-text-secondary underline">Clear check-out</button>}
                  </div>
                </li>
              ) : delId === q.id ? (
                <li key={q.id} className="rounded-spa border border-border p-2.5 space-y-2" data-testid="delete-punch">
                  <p className="text-[12.5px] text-text-secondary">Delete <b className="font-medium text-text-primary">{bn(q.branchId)}</b> · {fmt(q.checkIn)} – {q.checkOut ? fmt(q.checkOut) : 'still in'}?</p>
                  {punchReason(true)}
                  {punchErr}
                  <div className="flex items-center gap-2 text-[12px]">
                    <button type="button" disabled={punchBusy} onClick={() => removePunch(q)} className="h-7 px-3 rounded-spa bg-error text-white font-medium disabled:opacity-50">Delete punch</button>
                    <button type="button" onClick={cancelPunch} className="h-7 px-2 text-text-secondary">Cancel</button>
                  </div>
                </li>
              ) : (
                <li key={q.id} className="flex items-center gap-2 text-[12.5px] text-text-secondary" data-punch-row>
                  <span className="flex-1 min-w-0 truncate"><b className="font-medium text-text-primary">{bn(q.branchId)}</b> · {fmt(q.checkIn)} – {q.checkOut ? fmt(q.checkOut) : 'still in'}</span>
                  {canEdit && <button type="button" disabled={boxOpen} onClick={() => startEdit(q)} className="text-primary hover:underline disabled:opacity-40">Edit</button>}
                  {canEdit && <button type="button" disabled={boxOpen} onClick={() => startDelete(q)} className="text-error hover:underline disabled:opacity-40">Delete</button>}
                </li>
              )))}
              {adding && (
                <li className="rounded-spa border border-border p-2.5 space-y-2" data-testid="add-punch">
                  <p className="text-[12px] text-text-secondary">New check-in at <b className="font-medium text-text-primary">{bn(branchId)}</b></p>
                  {timeFields}
                  {punchReason(date < today)}
                  {punchErr}
                  <div className="flex items-center gap-2 text-[12px]">
                    <button type="button" disabled={punchBusy || !pIn} onClick={addPunch} className="h-7 px-3 rounded-spa bg-primary text-white font-medium disabled:opacity-50">Add punch</button>
                    <button type="button" onClick={cancelPunch} className="h-7 px-2 text-text-secondary">Cancel</button>
                  </div>
                </li>
              )}
            </ul>
          </div>
        )}

        {pay?.text && (
          <div className="rounded-spa bg-background border border-border px-3 py-2.5 text-[12.5px] text-text-secondary leading-relaxed" data-testid="pay-effect">
            <b className="text-text-primary font-medium">Pay: </b>{pay.text}
          </div>
        )}

        {(initialMode === 'note' || note) && (
          <Field label="Note"><TextInput ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" disabled={!canEdit} /></Field>
        )}

        {!boxOpen && dirty && (reasonRequired || reasonShown) && (
          <Field label={<>Reason <span className="text-text-tertiary font-normal">· required when changing a saved record</span></>} error={error && /reason/i.test(error) ? error : ''}>
            <TextInput ref={reasonRef} value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} placeholder="e.g. Felt unwell, went home after lunch" disabled={!canEdit} error={!!error && /reason/i.test(error)} />
          </Field>
        )}
        {error && !/reason/i.test(error) && <InlineError message={error} />}
        {!reasonRequired && !reasonShown && !canEdit && <InlineWarning message="This day is closed. Attendance can't be changed." />}

        <div>
          <p className="text-[13px] font-medium text-text-primary mb-1.5">History</p>
          {history == null ? <p className="text-[12.5px] text-text-tertiary">Loading…</p>
            : groups.length === 0 ? <p className="text-[12.5px] text-text-tertiary">No changes recorded yet.</p>
              : (
                <ul className="space-y-1.5" data-testid="attendance-history">
                  {groups.map((g) => (
                    <li key={g.at + g.changedBy} className="text-[12.5px] text-text-secondary leading-snug">
                      <b className="text-text-primary font-medium">{fmt(hmFromIso(g.at))}</b>
                      {' · '}{lineOf(g, fmt)}{g.reason === UNDO_REASON ? ' (undo)' : ''}{' · '}{g.name || 'a manager'}{g.reason && g.reason !== UNDO_REASON ? ` · “${g.reason}”` : ''}
                    </li>
                  ))}
                </ul>
              )}
        </div>
        <p className="text-[11.5px] text-text-tertiary">Attendance history can't be edited or deleted.</p>
      </div>
    </SidePanel>
  );
};

export default AttendanceSidePanel;
