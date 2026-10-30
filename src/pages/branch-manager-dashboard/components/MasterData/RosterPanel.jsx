import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import {
  fetchTherapistsForManagement,
  fetchBranchWorkingHours,
  fetchRosterOverrides,
  upsertRosterOverrides,
  fetchBlocksForRange,
} from '../../../../services/api';
import { isoDayOfWeek } from '../../../../services/rosterSchedule';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AVATAR_PALETTE = ['bg-primary', 'bg-secondary', 'bg-accent', 'bg-blue-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600'];

function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function to12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

const cellKey = (therapistId, date) => `${therapistId}_${date}`;

// Timely-style monthly roster: staff rows x date columns, each cell showing that day's
// working hours (default from the staff member's recurring weekly hours, migration-275,
// unless overridden for that specific date via migration-287's staff_roster_overrides).
// "Set normal hours" deep-links to that staff member's weekly-hours editor instead of
// duplicating it here — this grid only handles per-date exceptions.
const RosterPanel = ({ branchId }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();

  const now = new Date();
  const todayStr = toLocalISO(now);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [staffFilter, setStaffFilter] = useState('all');

  const [therapists, setTherapists] = useState([]);
  const [defaultHours, setDefaultHours] = useState(new Map()); // therapistId -> [{dayOfWeek,startTime,endTime,isDayOff}]
  const [overrides, setOverrides] = useState(new Map());       // cellKey -> {startTime,endTime,isDayOff}
  const [pending, setPending] = useState(new Map());            // cellKey -> {startTime,endTime,isDayOff} (unsaved)
  const [closedDates, setClosedDates] = useState(new Set());    // dates with a whole-location Calendar block ("Business closed")
  const [editingKey, setEditingKey] = useState(null);
  const [editDraft, setEditDraft] = useState({ startTime: '', endTime: '' });

  const [staffLoading, setStaffLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const days = useMemo(() => {
    const result = [];
    const total = new Date(year, month, 0).getDate();
    for (let d = 1; d <= total; d++) {
      const date = new Date(year, month - 1, d);
      result.push({ date: toLocalISO(date), day: d, weekday: WEEKDAY_SHORT[date.getDay()], dayOfWeek: isoDayOfWeek(date) });
    }
    return result;
  }, [month, year]);

  const loadStaffAndDefaults = useCallback(async () => {
    setStaffLoading(true);
    const [{ data: staffData, error: staffErr }, { data: hoursMap, error: hoursErr }] = await Promise.all([
      fetchTherapistsForManagement(branchId),
      fetchBranchWorkingHours(branchId),
    ]);
    if (staffErr) { setError(staffErr.message || 'Failed to load staff.'); setStaffLoading(false); return; }
    if (hoursErr) { setError(hoursErr.message || 'Failed to load working hours.'); setStaffLoading(false); return; }
    setTherapists(staffData || []);
    setDefaultHours(hoursMap || new Map());
    setStaffLoading(false);
  }, [branchId]);

  const loadOverrides = useCallback(async () => {
    if (days.length === 0) return;
    setLoading(true);
    setError(null);
    const startDate = days[0].date;
    const endDate = days[days.length - 1].date;

    const [{ data, error: fetchErr }, { data: blockOccurrences, error: blocksErr }] = await Promise.all([
      fetchRosterOverrides({ branchId, startDate, endDate }),
      fetchBlocksForRange(branchId, startDate, endDate),
    ]);
    if (fetchErr) {
      setError(fetchErr.message || 'Failed to load roster.');
    } else if (blocksErr) {
      setError(blocksErr.message || 'Failed to load calendar blocks.');
    } else {
      setOverrides(data || new Map());
      setPending(new Map());
      // "Business closed" = a whole-location Calendar block (no specific therapist/room —
      // see AddBlockModal's "Whole location" + "Closed all day" options) touching that date.
      const closed = new Set((blockOccurrences || []).filter(occ => !occ.therapistId && !occ.roomId).map(occ => occ.date));
      setClosedDates(closed);
    }
    setLoading(false);
  }, [branchId, days]);

  useEffect(() => { loadStaffAndDefaults(); }, [loadStaffAndDefaults]);
  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  const shiftMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
  };

  // Scrolls today's column to sit right after the sticky name column. A tick counter
  // (rather than calling scrollIntoView directly) lets this fire even when the month/year
  // don't actually change — e.g. clicking Today while already viewing the current month —
  // and the effect below waits a frame so it runs after any month switch has re-rendered
  // the day columns (and refreshed todayColRef) first.
  const todayColRef = useRef(null);
  const [scrollToTodayTick, setScrollToTodayTick] = useState(0);
  const jumpToToday = () => {
    setMonth(now.getMonth() + 1);
    setYear(now.getFullYear());
    setScrollToTodayTick(t => t + 1);
  };
  const scrollContainerRef = useRef(null);
  const STICKY_NAME_COL_WIDTH = 200; // matches the sticky name column's min-w-[200px] below
  useEffect(() => {
    if (scrollToTodayTick === 0) return;
    const raf = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const col = todayColRef.current;
      if (!container || !col) return;
      // scrollIntoView's "start" would land today's column flush with the scroll
      // container's own left edge — i.e. hidden behind the sticky name column, not
      // after it. Compute the offset ourselves so today lands right past it instead.
      const delta = col.getBoundingClientRect().left - container.getBoundingClientRect().left - STICKY_NAME_COL_WIDTH;
      container.scrollBy({ left: delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToTodayTick, days]);

  const defaultForCell = useCallback((therapistId, dayOfWeek) => {
    const rows = defaultHours.get(therapistId);
    const row = rows?.find(r => r.dayOfWeek === dayOfWeek);
    return row || { startTime: null, endTime: null, isDayOff: true };
  }, [defaultHours]);

  // Effective state for a cell, preferring an unsaved edit, then a saved override, then
  // falling back to the staff member's normal weekly hours for that weekday.
  const stateForCell = useCallback((therapistId, dateInfo) => {
    const key = cellKey(therapistId, dateInfo.date);
    if (pending.has(key)) return { ...pending.get(key), source: 'pending' };
    if (overrides.has(key)) return { ...overrides.get(key), source: 'override' };
    return { ...defaultForCell(therapistId, dateInfo.dayOfWeek), source: 'default' };
  }, [pending, overrides, defaultForCell]);

  const setCell = (therapistId, date, patch) => {
    setPending(prev => {
      const next = new Map(prev);
      const current = next.get(cellKey(therapistId, date)) || {};
      next.set(cellKey(therapistId, date), { ...current, ...patch });
      return next;
    });
    setEditingKey(null);
  };

  const toggleCell = (therapistId, dateInfo, state) => {
    if (state.isDayOff) {
      setCell(therapistId, dateInfo.date, {
        isDayOff: false,
        startTime: state.startTime || '09:00',
        endTime: state.endTime || '17:00',
      });
    } else {
      setCell(therapistId, dateInfo.date, { isDayOff: true, startTime: null, endTime: null });
    }
  };

  const startEditing = (therapistId, dateInfo, state) => {
    setEditingKey(cellKey(therapistId, dateInfo.date));
    setEditDraft({ startTime: state.startTime || '09:00', endTime: state.endTime || '17:00' });
  };

  const commitEdit = (therapistId, dateInfo) => {
    if (!editDraft.startTime || !editDraft.endTime || editDraft.startTime >= editDraft.endTime) {
      setError('Start time must be before end time.');
      setEditingKey(null);
      return;
    }
    setCell(therapistId, dateInfo.date, { isDayOff: false, startTime: editDraft.startTime, endTime: editDraft.endTime });
  };

  const handleSave = async () => {
    if (pending.size === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = Array.from(pending.entries()).map(([key, value]) => {
      const [therapistId, date] = [key.slice(0, key.indexOf('_')), key.slice(key.indexOf('_') + 1)];
      return { therapistId, date, isDayOff: value.isDayOff, startTime: value.startTime, endTime: value.endTime };
    });

    const { error: saveErr } = await upsertRosterOverrides(payload);
    if (saveErr) {
      setError(saveErr.message || 'Failed to save roster.');
      setSaving(false);
      return;
    }

    setSaving(false);
    setNotice('Roster saved.');
    loadOverrides();
  };

  const visibleTherapists = staffFilter === 'all' ? therapists : therapists.filter(t => t.id === staffFilter);
  const hasPending = pending.size > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-accent text-3xl text-text-primary leading-tight">Roster</h3>
          <p className="font-body text-sm text-text-secondary mt-1">
            Per-date working hours — overrides each staff member's normal weekly schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasPending || saving}
          className={`relative inline-flex items-center gap-2 px-5 py-2.5 rounded-spa text-sm font-body font-body-semibold spa-transition-fast ${
            hasPending && !saving
              ? 'bg-primary text-white shadow-spa-resting hover:shadow-spa-elevated hover:bg-primary/90'
              : 'bg-background text-text-tertiary border border-border cursor-not-allowed'
          }`}
        >
          {saving ? (
            <>
              <Icon name="Loader2" size={15} className="animate-spin" />
              <span>Saving…</span>
            </>
          ) : (
            <>
              <Icon name="Save" size={15} />
              <span>Save roster</span>
              {hasPending && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-white/20 text-[11px] font-data font-data-medium">
                  {pending.size}
                </span>
              )}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm animate-fade-in">
          <Icon name="AlertCircle" size={16} className="flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto flex-shrink-0"><Icon name="X" size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-spa text-success text-sm animate-fade-in">
          <Icon name="CheckCircle2" size={16} className="flex-shrink-0" />
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="ml-auto flex-shrink-0"><Icon name="X" size={14} /></button>
        </div>
      )}

      {/* Toolbar card — every control is exactly h-9, one flat row, so nothing
          visually bobbles up or down against its neighbors. */}
      <div className="flex items-center justify-between gap-3 flex-wrap p-3 border border-border rounded-spa-lg bg-surface shadow-spa-resting">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-48">
            <CustomSelect
              value={staffFilter}
              onChange={setStaffFilter}
              options={[{ value: 'all', label: 'All Staff' }, ...therapists.map(t => ({ value: t.id, label: t.name }))]}
              size="sm"
              searchable
            />
          </div>

          <div className="w-px h-6 bg-border mx-0.5" />

          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-spa border border-border bg-surface text-text-secondary hover:border-primary hover:text-primary spa-transition-fast"
          >
            <Icon name="ChevronLeft" size={15} />
          </button>
          <div className="w-32">
            <CustomSelect
              value={month}
              onChange={(v) => setMonth(Number(v))}
              options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))}
              size="sm"
            />
          </div>
          <div className="w-[88px]">
            <CustomSelect
              value={year}
              onChange={(v) => setYear(Number(v))}
              options={[year - 1, year, year + 1].map(y => ({ value: y, label: String(y) }))}
              size="sm"
            />
          </div>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-spa border border-border bg-surface text-text-secondary hover:border-primary hover:text-primary spa-transition-fast"
          >
            <Icon name="ChevronRight" size={15} />
          </button>

          <div className="w-px h-6 bg-border mx-0.5" />

          <button
            type="button"
            onClick={jumpToToday}
            className="h-9 px-3.5 rounded-spa border border-border bg-surface text-sm font-body font-body-medium text-text-primary hover:border-primary hover:text-primary spa-transition-fast"
          >
            Today
          </button>
        </div>

        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary font-caption">
            <Icon name="Loader2" size={13} className="animate-spin" />
            Refreshing…
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="border border-border rounded-spa-lg shadow-spa-resting overflow-hidden bg-surface">
        <div ref={scrollContainerRef} className="overflow-auto max-h-[62vh]">
          {/* border-separate (not border-collapse) — collapsed borders break solid
              background painting on sticky cells in Chrome/Safari, which is what was
              letting the scrolled-under columns ghost through the sticky name column
              and header corner. */}
          <table className="border-separate border-spacing-0 min-w-full">
            <thead>
              <tr>
                {/* Sticky on BOTH axes — needs to outrank the plain top-sticky date headers
                    (z-sticky-filter) it passes over while the grid scrolls horizontally, or
                    their background briefly wins the paint order and ghosts through it. */}
                <th className="sticky left-0 top-0 z-header bg-background border-b border-r border-border px-4 py-3 text-left font-body font-body-semibold text-sm text-text-primary min-w-[200px]">
                  {MONTH_NAMES[month - 1]} {year}
                </th>
                {days.map(d => {
                  const isToday = d.date === todayStr;
                  const isWeekend = d.weekday === 'Sat' || d.weekday === 'Sun';
                  return (
                    <th
                      key={d.date}
                      ref={isToday ? todayColRef : null}
                      className={`sticky top-0 z-sticky-filter border-b border-border px-1.5 py-2.5 text-center min-w-[76px] spa-transition-fast ${
                        // Solid colors only — any alpha here would let the vertically-scrolled
                        // body rows ghost through this sticky header, same bug as the corner cell.
                        isToday ? 'bg-green-50' : isWeekend ? 'bg-stone-100' : 'bg-background'
                      }`}
                    >
                      <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-data text-sm mx-auto ${
                        isToday ? 'bg-primary text-white font-data-medium' : 'text-text-primary'
                      }`}>
                        {d.day}
                      </div>
                      <div className={`font-caption text-[10px] uppercase tracking-wide mt-0.5 ${isToday ? 'text-primary font-caption-medium' : 'text-text-tertiary'}`}>
                        {d.weekday}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {staffLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="sticky left-0 z-sticky-filter bg-surface border-r border-b border-border px-4 py-3 min-w-[200px]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-background animate-pulse" />
                        <div className="h-3 w-24 rounded bg-background animate-pulse" />
                      </div>
                    </td>
                    {days.map(d => (
                      <td key={d.date} className="border-b border-border p-1.5">
                        <div className="h-16 rounded-spa bg-background animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : visibleTherapists.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 1} className="px-4 py-14 text-center">
                    <Icon name="Users" size={28} className="text-text-tertiary mx-auto mb-2" />
                    <p className="font-body text-sm text-text-secondary">No staff found for this branch.</p>
                  </td>
                </tr>
              ) : (
                visibleTherapists.map(t => (
                  <tr key={t.id} className="group/row hover:bg-background/40 spa-transition-fast">
                    <td className="sticky left-0 z-sticky-filter bg-surface group-hover/row:bg-background border-r border-b border-border px-4 py-2.5 align-middle min-w-[200px] spa-transition-fast">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full ${avatarColor(t.name)} text-white flex items-center justify-center font-body font-body-semibold text-xs`}>
                          {initials(t.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-body font-body-medium text-sm text-text-primary truncate">{t.name}</div>
                          <button
                            type="button"
                            onClick={() => navigate(`/${orgSlug}/staff/${t.id}#working-hours`)}
                            className="font-caption text-[11px] text-primary opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:underline spa-transition-fast inline-flex items-center gap-0.5"
                          >
                            <Icon name="Clock" size={10} />
                            <span>Set normal hours</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    {days.map(d => {
                      const isToday = d.date === todayStr;

                      if (closedDates.has(d.date)) {
                        return (
                          <td key={d.date} className={`border-b border-border text-center align-middle p-1.5 ${isToday ? 'bg-primary/5' : ''}`}>
                            <div
                              className="w-full h-16 flex items-center justify-center rounded-spa bg-slate-700 text-white text-[10px] font-body font-body-medium gap-1"
                              title="Business closed"
                            >
                              <Icon name="Lock" size={11} />
                              <span>Closed</span>
                            </div>
                          </td>
                        );
                      }

                      const state = stateForCell(t.id, d);
                      const key = cellKey(t.id, d.date);
                      const isModified = state.source !== 'default';
                      const isEditing = editingKey === key;

                      // Shared segmented ✕/✓ pill — always visible (not a hover-only corner
                      // badge) so the undo path for a toggle is never a mystery. The active
                      // side is filled solid; the inactive side is the click target.
                      const renderToggle = (onCardTone) => (
                        <div className={`mt-1.5 inline-flex items-center gap-0.5 rounded-full p-0.5 ${onCardTone ? 'bg-white/15' : 'bg-surface border border-border shadow-sm'}`}>
                          <span
                            title={state.isDayOff ? 'Not working' : 'Working'}
                            className={`w-5 h-5 rounded-full flex items-center justify-center ${
                              state.isDayOff
                                ? (onCardTone ? 'bg-white/25 text-white' : 'bg-text-tertiary/15 text-text-secondary')
                                : (onCardTone ? 'bg-white/25 text-white' : 'bg-primary text-white')
                            }`}
                          >
                            <Icon name={state.isDayOff ? 'X' : 'Check'} size={10} />
                          </span>
                          <button
                            type="button"
                            title={state.isDayOff ? 'Mark as working' : 'Mark as not working'}
                            onClick={(e) => { e.stopPropagation(); toggleCell(t.id, d, state); }}
                            className={`w-5 h-5 rounded-full flex items-center justify-center spa-transition-fast ${
                              onCardTone ? 'text-white/70 hover:bg-white/25 hover:text-white' : 'text-text-tertiary hover:bg-primary hover:text-white'
                            }`}
                          >
                            <Icon name={state.isDayOff ? 'Check' : 'X'} size={10} />
                          </button>
                        </div>
                      );

                      if (state.isDayOff) {
                        return (
                          <td key={d.date} className={`border-b border-border text-center align-middle p-1.5 ${isToday ? 'bg-primary/5' : ''}`}>
                            <div
                              className={`flex flex-col items-center justify-center h-16 rounded-spa border spa-transition-fast ${
                                isModified
                                  ? 'bg-amber-50 border-amber-200'
                                  : 'border-dashed border-border/70 bg-background/30 hover:bg-background/70 hover:border-border'
                              }`}
                            >
                              <span className={`font-caption text-[10px] font-caption-medium ${isModified ? 'text-amber-700' : 'text-text-tertiary'}`}>
                                {isModified ? 'Day off' : 'Off'}
                              </span>
                              {renderToggle(false)}
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={d.date} className={`border-b border-border text-center align-middle p-1.5 ${isToday ? 'bg-primary/5' : ''}`}>
                          {isEditing ? (
                            <div
                              className="flex flex-col gap-1 p-1.5 rounded-spa bg-surface border-2 border-primary shadow-spa-elevated animate-fade-in"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="time"
                                autoFocus
                                value={editDraft.startTime}
                                onChange={(e) => setEditDraft(prev => ({ ...prev, startTime: e.target.value }))}
                                onBlur={() => commitEdit(t.id, d)}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(t.id, d); if (e.key === 'Escape') setEditingKey(null); }}
                                className="w-full text-[10px] text-text-primary border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <input
                                type="time"
                                value={editDraft.endTime}
                                onChange={(e) => setEditDraft(prev => ({ ...prev, endTime: e.target.value }))}
                                onBlur={() => commitEdit(t.id, d)}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(t.id, d); if (e.key === 'Escape') setEditingKey(null); }}
                                className="w-full text-[10px] text-text-primary border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          ) : (
                            <div
                              className={`flex flex-col items-center justify-center h-16 rounded-spa spa-transition-fast hover:shadow-spa-resting ${
                                isModified
                                  ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white'
                                  : 'bg-gradient-to-br from-primary to-primary/85 text-white'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => startEditing(t.id, d, state)}
                                title="Click to change hours"
                                className="flex flex-col items-center leading-tight hover:underline"
                              >
                                <span className="font-data text-[11px] font-data-medium">{to12h(state.startTime)}</span>
                                <span className="font-data text-[11px] opacity-90">{to12h(state.endTime)}</span>
                              </button>
                              {renderToggle(true)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-caption font-caption-medium text-[11px] uppercase tracking-wide text-text-tertiary mr-1">Key</span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <Icon name="Check" size={11} /> Working
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <Icon name="X" size={11} /> Not working
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-primary to-primary/85 inline-block" /> Normal hours
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 inline-block" /> Modified date
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-700 inline-block" /> Business closed
          <button
            type="button"
            onClick={() => navigate(`/${orgSlug}/dashboard?view=closed-dates`)}
            className="text-primary hover:underline inline-flex items-center gap-0.5 font-body-medium"
          >
            <Icon name="Pencil" size={10} />
            <span>Edit</span>
          </button>
        </span>
      </div>
      <p className="font-caption text-[11px] text-text-tertiary">
        Click a cell to adjust its hours for that date. Hover the check mark to mark a working day off, or the ✕ to reopen it.
      </p>
    </div>
  );
};

export default RosterPanel;
