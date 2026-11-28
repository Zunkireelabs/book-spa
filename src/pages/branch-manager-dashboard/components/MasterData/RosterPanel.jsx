import { nepalLocalDate } from '../../../../utils/nepalTime';
import { friendlyError } from '../../../../utils/friendlyError';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import {
  fetchTherapistsForManagement,
  fetchBranchWorkingHours,
  fetchRosterOverrides,
  fetchBlocksForRange,
} from '../../../../services/api';
import { SHADE_STYLES } from '../../../../services/availabilityShading';
import RosterDayDialog from '../../../../components/ui/RosterDayDialog';
import { weekDates, cellKind } from '../../../../utils/rosterWeek';
import { wordBranch } from '../../../../utils/industryTerms';
import { useClock } from '../../../../hooks/useUse24h';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AVATAR_PALETTE = ['bg-primary', 'bg-secondary', 'bg-accent', 'bg-blue-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600'];

function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// JS Date#getDay() is 0=Sunday..6=Saturday; therapist_working_hours.day_of_week (migration-275)
// is 0=Monday..6=Sunday. This converts between the two.
function isoDayOfWeek(d) {
  return (d.getDay() + 6) % 7;
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

// Staff rows x day columns, each cell showing that day's working hours (the staff member's usual weekly hours,
// migration-275, unless that date has its own hours, migration-287). Opens on the week starting today; a click opens
// the one day box, which saves that day on its own. "Usual weekly hours" links to the staff page instead of duplicating it.
const RosterPanel = ({ branchId }) => {
  const clock = useClock();
  const navigate = useNavigate();
  const { orgSlug } = useParams();

  const now = nepalLocalDate(); // the spa's day, not the device's
  const todayStr = toLocalISO(now);
  const [view, setView] = useState('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [staffFilter, setStaffFilter] = useState('all');

  const [therapists, setTherapists] = useState([]);
  const [defaultHours, setDefaultHours] = useState(new Map()); // therapistId -> [{dayOfWeek,startTime,endTime,isDayOff}]
  const [overrides, setOverrides] = useState(new Map());       // cellKey -> {startTime,endTime,isDayOff,breaks}
  const [closedDates, setClosedDates] = useState(new Set());    // dates with a whole-location Calendar block ("Business closed")
  const [editTarget, setEditTarget] = useState(null);           // { therapist, dateInfo } the day box is open for

  const [staffLoading, setStaffLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const days = useMemo(() => {
    const mk = (date) => ({ date: toLocalISO(date), day: date.getDate(), weekday: WEEKDAY_SHORT[date.getDay()], dayOfWeek: isoDayOfWeek(date) });
    if (view === 'week') {
      return weekDates(todayStr, weekOffset).map((iso) => { const [y, m, d] = iso.split('-').map(Number); return mk(new Date(y, m - 1, d)); });
    }
    const total = new Date(year, month, 0).getDate();
    return Array.from({ length: total }, (_, i) => mk(new Date(year, month - 1, i + 1)));
  }, [view, weekOffset, todayStr, month, year]);

  const rangeLabel = useMemo(() => {
    const f = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ''); };
    return `${f(days[0].date)} – ${f(days[days.length - 1].date)}`;
  }, [days]);

  const loadStaffAndDefaults = useCallback(async () => {
    setStaffLoading(true);
    const [{ data: staffData, error: staffErr }, { data: hoursMap, error: hoursErr }] = await Promise.all([
      fetchTherapistsForManagement(branchId),
      fetchBranchWorkingHours(branchId),
    ]);
    if (staffErr) { setError(friendlyError(staffErr, 'Failed to load staff.')); setStaffLoading(false); return; }
    if (hoursErr) { setError(friendlyError(hoursErr, 'Failed to load working hours.')); setStaffLoading(false); return; }
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
      setError(friendlyError(fetchErr, 'Failed to load roster.'));
    } else if (blocksErr) {
      setError(friendlyError(blocksErr, 'Failed to load calendar blocks.'));
    } else {
      setOverrides(data || new Map());
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

  // Month view: today's column sits right after the sticky name column. The tick starts at 1 so it also fires on
  // open (not only on the Today click); the effect waits a frame so it runs after the day columns have rendered.
  const todayColRef = useRef(null);
  const [scrollToTodayTick, setScrollToTodayTick] = useState(1);
  const jumpToToday = () => {
    setWeekOffset(0);
    setMonth(now.getMonth() + 1);
    setYear(now.getFullYear());
    setScrollToTodayTick(t => t + 1);
  };
  const scrollContainerRef = useRef(null);
  const STICKY_NAME_COL_WIDTH = 200; // matches the sticky name column's width below
  useEffect(() => {
    if (view !== 'month' || staffLoading) return undefined;
    const raf = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const col = todayColRef.current;
      if (!container || !col) return;
      // scrollIntoView's "start" would hide today's column behind the sticky name column; offset it ourselves.
      const delta = col.getBoundingClientRect().left - container.getBoundingClientRect().left - STICKY_NAME_COL_WIDTH;
      container.scrollBy({ left: delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToTodayTick, days, view, staffLoading]);

  const defaultForCell = useCallback((therapistId, dayOfWeek) => {
    const rows = defaultHours.get(therapistId);
    const row = rows?.find(r => r.dayOfWeek === dayOfWeek);
    return row || { startTime: null, endTime: null, isDayOff: true, breaks: [], noHours: !rows?.length };
  }, [defaultHours]);

  const visibleTherapists = staffFilter === 'all' ? therapists : therapists.filter(t => t.id === staffFilter);
  const shift = (delta) => {
    if (view === 'week') { setWeekOffset(w => w + delta); return; }
    const d = new Date(year, month - 1 + delta, 1);
    setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
  };
  const arrow = 'w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-spa border border-border bg-surface text-text-secondary hover:border-primary hover:text-primary spa-transition-fast';

  return (
    <div className="space-y-5">
      <p className="font-body text-sm text-text-secondary">
        Change one day's hours here. This doesn't change the person's usual weekly hours.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm animate-fade-in">
          <Icon name="AlertCircle" size={16} className="flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto flex-shrink-0"><Icon name="X" size={14} /></button>
        </div>
      )}

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

          <button type="button" onClick={() => shift(-1)} aria-label={view === 'week' ? 'Previous week' : 'Previous month'} className={arrow}>
            <Icon name="ChevronLeft" size={15} />
          </button>
          {view === 'week' ? (
            <span data-testid="roster-range" className="font-body font-body-medium text-sm text-text-primary px-1 whitespace-nowrap">{rangeLabel}</span>
          ) : (
            <>
              <div className="w-32">
                <CustomSelect value={month} onChange={(v) => setMonth(Number(v))} options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))} size="sm" />
              </div>
              <div className="w-[88px]">
                <CustomSelect value={year} onChange={(v) => setYear(Number(v))} options={[year - 1, year, year + 1].map(y => ({ value: y, label: String(y) }))} size="sm" />
              </div>
            </>
          )}
          <button type="button" onClick={() => shift(1)} aria-label={view === 'week' ? 'Next week' : 'Next month'} className={arrow}>
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
          <div className="inline-flex h-9 rounded-spa border border-border overflow-hidden" role="group" aria-label="Roster range">
            {[['week', 'Week'], ['month', 'Month']].map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => { setView(v); if (v === 'month') setScrollToTodayTick(t => t + 1); }}
                className={`px-3 text-sm font-body font-body-medium spa-transition-fast ${view === v ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-primary'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary font-caption">
            <Icon name="Loader2" size={13} className="animate-spin" />
            Refreshing…
          </span>
        )}
      </div>

      <div className="border border-border rounded-spa-lg shadow-spa-resting overflow-hidden bg-surface">
        <div ref={scrollContainerRef} className="overflow-auto max-h-[62vh]">
          {/* border-separate (not border-collapse): collapsed borders break solid background painting on sticky cells. */}
          <table className={`border-separate border-spacing-0 min-w-full ${view === 'week' ? 'table-fixed w-full' : ''}`} style={view === 'week' ? { minWidth: 200 + days.length * 92 } : undefined}>
            <thead>
              <tr>
                {/* Sticky on BOTH axes: outranks the top-sticky date headers it passes over while scrolling sideways. */}
                <th className="sticky left-0 top-0 z-header bg-background border-b border-r border-border px-4 py-3 text-left font-body font-body-semibold text-sm text-text-primary w-[200px] min-w-[200px]">
                  {view === 'week' ? 'Staff' : `${MONTH_NAMES[month - 1]} ${year}`}
                </th>
                {days.map(d => {
                  const isToday = d.date === todayStr;
                  const isWeekend = d.weekday === 'Sat' || d.weekday === 'Sun';
                  return (
                    <th
                      key={d.date}
                      ref={isToday ? todayColRef : null}
                      className={`sticky top-0 z-sticky-filter border-b border-border px-1.5 py-2.5 text-center ${view === 'month' ? 'min-w-[76px]' : ''} spa-transition-fast ${
                        // Solid colors only: alpha would let scrolled rows ghost through this sticky header.
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
                    <td className="sticky left-0 z-sticky-filter bg-surface border-r border-b border-border px-4 py-3">
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
                    <p className="font-body text-sm text-text-secondary">No staff found for this {wordBranch()}.</p>
                  </td>
                </tr>
              ) : (
                visibleTherapists.map(t => (
                  <tr key={t.id} className="group/row">
                    <td className="sticky left-0 z-sticky-filter bg-surface border-r border-b border-border px-4 py-2.5 align-middle">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full ${avatarColor(t.name)} text-white flex items-center justify-center font-body font-body-semibold text-xs`}>
                          {initials(t.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-body font-body-medium text-sm text-text-primary truncate">{t.name}</div>
                          <button
                            type="button"
                            onClick={() => navigate(`/${orgSlug}/staff/${t.id}#working-hours`)}
                            className="font-caption text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
                          >
                            Usual weekly hours ›
                          </button>
                        </div>
                      </div>
                    </td>
                    {days.map(d => {
                      const key = cellKey(t.id, d.date);
                      const usual = defaultForCell(t.id, d.dayOfWeek);
                      const override = overrides.get(key);
                      const { kind, changed } = cellKind({ closed: closedDates.has(d.date), override, usual });
                      const eff = override || usual;
                      const tdCls = `border-b border-border text-center align-middle p-1 ${d.date === todayStr ? 'bg-primary/5' : ''}`;

                      if (kind === 'closed') {
                        return (
                          <td key={d.date} className={tdCls}>
                            <div
                              className="w-full h-16 flex items-center justify-center rounded-spa text-text-tertiary text-[11px] font-body font-body-medium gap-1 border border-border"
                              style={{ background: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 6px,#e5e7eb 6px,#e5e7eb 12px)' }}
                              title="Business closed"
                              data-cell="closed"
                            >
                              <Icon name="Lock" size={11} />
                              <span>Closed</span>
                            </div>
                          </td>
                        );
                      }

                      const brk = eff.breaks || [];
                      return (
                        <td key={d.date} className={tdCls}>
                          <button
                            type="button"
                            data-cell={kind}
                            data-changed={changed || undefined}
                            onClick={() => setEditTarget({ therapist: t, dateInfo: d })}
                            title="Change hours for this day"
                            className={`w-full h-16 flex flex-col items-center justify-center gap-0.5 rounded-spa border text-center spa-transition-fast hover:shadow-spa-resting ${
                              changed ? 'border-amber-400 bg-amber-50' : kind === 'off' ? 'border-dashed border-border bg-background/60' : 'border-border bg-surface'
                            }`}
                          >
                            {kind === 'off' ? (
                              <span className="font-body text-[11px] text-text-tertiary">{usual.noHours && !override ? 'No set hours' : 'Off'}</span>
                            ) : (
                              <span className="px-2 font-data text-[10.5px] leading-tight text-text-secondary">{clock(String(eff.startTime).slice(0, 5))}–<wbr />{clock(String(eff.endTime).slice(0, 5))}</span>
                            )}
                            {kind === 'usual' && brk.length > 0 && (
                              <span
                                data-testid="roster-cell-breaks"
                                title={brk.map((b) => `${b.name || 'Break'} ${b.startTime}–${b.endTime}`).join(', ')}
                                className="inline-flex items-center rounded px-1 font-data text-[9px] leading-4 whitespace-nowrap"
                                style={{ background: SHADE_STYLES.break.solid, color: SHADE_STYLES.break.color }}
                              >
                                {brk.length === 1 ? `${brk[0].name ? `${brk[0].name} ` : ''}${brk[0].startTime}–${brk[0].endTime}` : `${brk.length} breaks`}
                              </span>
                            )}
                            {changed && <span className="font-caption text-[9.5px] font-caption-medium text-amber-700">Changed</span>}
                          </button>
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

      {editTarget && (() => {
        const { therapist, dateInfo } = editTarget;
        const usual = defaultForCell(therapist.id, dateInfo.dayOfWeek);
        const override = overrides.get(cellKey(therapist.id, dateInfo.date));
        return (
          <RosterDayDialog
            therapist={therapist}
            date={dateInfo.date}
            current={override || usual}
            usual={usual}
            changed={!!override}
            onClose={() => setEditTarget(null)}
            onSaved={() => { setEditTarget(null); loadOverrides(); }}
          />
        );
      })()}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-caption font-caption-medium text-[11px] uppercase tracking-wide text-text-tertiary mr-1">Key</span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full border border-border bg-surface inline-block" /> Usual hours
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full border border-amber-400 bg-amber-50 inline-block" /> Changed for that day
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full border border-dashed border-border bg-background inline-block" /> Off
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-text-secondary">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" /> Business closed
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
      <p className="font-caption text-[11px] text-text-tertiary">Click any day to change its hours. Each day saves on its own.</p>
    </div>
  );
};

export default RosterPanel;
