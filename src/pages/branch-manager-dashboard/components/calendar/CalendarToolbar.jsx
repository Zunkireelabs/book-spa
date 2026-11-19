import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import MiniMonthCalendar from './MiniMonthCalendar';
import { addDays, addMonths } from './calendarDates';
import CalendarMobileHeader from './CalendarMobileHeader';
import { teamFilterLabel, isTeamFilterActive, teamAllLabel, staffInitials } from './calendarFilter';

function formatDateTitle(dateStr, viewMode) {
  const d = new Date(dateStr + 'T00:00:00');
  if (viewMode === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (viewMode === '4day' || viewMode === 'week') {
    const end = new Date(d);
    end.setDate(end.getDate() + (viewMode === 'week' ? 6 : 3));
    const startStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).replace(',', '');
}

const STEP_NOUN = { day: 'day', '4day': '4 days', week: 'week', month: 'month' };

const VIEW_MODE_OPTIONS = [
  { key: 'day', label: 'Day', hint: 'D' },
  { key: '4day', label: '4 Day', hint: 'F' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

// Symmetrical jump chips in the date picker (two even rows of six): sign * amount of unit from the current date.
const JUMP_CHIPS = [
  { label: '−1 yr', sign: -1, unit: 'year', amount: 1 }, { label: '−6 mo', sign: -1, unit: 'month', amount: 6 },
  { label: '−8w', sign: -1, unit: 'week', amount: 8 }, { label: '−4w', sign: -1, unit: 'week', amount: 4 },
  { label: '−2w', sign: -1, unit: 'week', amount: 2 }, { label: '−1w', sign: -1, unit: 'week', amount: 1 },
  { label: '+1w', sign: 1, unit: 'week', amount: 1 }, { label: '+2w', sign: 1, unit: 'week', amount: 2 },
  { label: '+4w', sign: 1, unit: 'week', amount: 4 }, { label: '+8w', sign: 1, unit: 'week', amount: 8 },
  { label: '+6 mo', sign: 1, unit: 'month', amount: 6 }, { label: '+1 yr', sign: 1, unit: 'year', amount: 1 },
];


// Desktop (>= md) toolbar. LEFT: Today, prev/next, date title (picker + jump chips), team filter (shows its current value).
// RIGHT: view dropdown, a ⋮ menu (Group by, Tools, Display, Away today, Tips), New booking. The phone header is CalendarMobileHeader.
// Popover state is local; the shortcuts tip state lives in the caller because the "?" shortcut toggles it (anchored under the ⋮ button).
const CalendarToolbar = ({
  staffLabel, staffLabelPlural, locationLabel, enableRooms,
  columnMode, setColumnMode, awayList,
  currentDate, setCurrentDate, viewMode, setViewMode, goToday, goPrev, goNext,
  tipOpen, setTipOpen,
  showServiceOnly, setShowServiceOnly, selectedPositions, setSelectedPositions, calendarPositionOptions,
  onNewBooking, onOpenWaitlist, waitlistCount = 0, branchId,
  userRole, onPrint, onEditRoster, onBlockWholeCalendar, onCalendarSettings, onClosedDates,
  zoomScale, onZoomChange, minZoom, maxZoom, use24h, setUse24h, hideSensitive, setHideSensitive,
  onGroupByChange, staffOptions = [], selectedStaffIds = [], setSelectedStaffIds = () => {},
}) => {
  const ZOOM_STEP = 0.2;
  const [open, setOpen] = useState(null); // 'date' | 'filter' | 'view' | 'menu' | null
  const [awayExpanded, setAwayExpanded] = useState(false);
  const refs = { date: useRef(null), filter: useRef(null), view: useRef(null), menu: useRef(null) };
  const toggle = (k) => setOpen((p) => (p === k ? null : k));
  const close = () => setOpen(null);

  const applyJump = (j) => {
    setCurrentDate(j.unit === 'week' ? addDays(currentDate, j.sign * j.amount * 7) : addMonths(currentDate, j.sign * j.amount * (j.unit === 'year' ? 12 : 1)));
  };

  // Close popovers on outside click / Esc (the tip popover is controlled by the caller).
  useEffect(() => {
    if (!open && !tipOpen) return undefined;
    const onDown = (e) => {
      const inside = (r) => r.current && r.current.contains(e.target);
      if (open && !inside(refs[open])) close();
      if (tipOpen && !inside(refs.menu)) setTipOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // claimed: the panel / rebook handlers must not also act on this Esc
      close();
      setTipOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, tipOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamAll = teamAllLabel(staffLabel, staffLabelPlural);
  const filterLabel = teamFilterLabel({ selectedStaffIds, selectedPositions, staffOptions, allLabel: teamAll });
  const filterActive = isTeamFilterActive({ selectedStaffIds, selectedPositions });
  const [teamQuery, setTeamQuery] = useState('');
  const shownStaff = staffOptions.filter((p) => p.name.toLowerCase().includes(teamQuery.trim().toLowerCase()));
  const clearFilter = () => { setSelectedPositions([]); setSelectedStaffIds([]); };
  const viewLabel = (VIEW_MODE_OPTIONS.find((v) => v.key === viewMode) || VIEW_MODE_OPTIONS[0]).label;

  const btn = 'h-9 min-w-[36px] flex items-center justify-center gap-1.5 px-3 text-[13px] font-body font-body-medium text-text-primary border border-border rounded-spa bg-surface hover:bg-background spa-transition-fast whitespace-nowrap';
  const iconBtn = 'h-9 w-9 flex items-center justify-center border border-border rounded-spa bg-surface hover:bg-background spa-transition-fast';
  const item = 'w-full min-h-[36px] flex items-center gap-2.5 text-left px-3 text-[13px] text-text-primary hover:bg-background spa-transition-fast';
  const heading = 'px-3 pt-2 pb-1 text-[10.5px] font-body font-medium uppercase tracking-wider text-text-tertiary';
  const menuItem = (icon, label, onClick, value) => (
    <button type="button" onClick={() => { close(); onClick?.(); }} className={item}>
      <Icon name={icon} size={15} className="text-text-secondary" />
      <span>{label}</span>
      {value != null && <span className="ml-auto text-xs text-text-tertiary">{value}</span>}
    </button>
  );
  const seg = (options, value, onChange) => (
    <div className="flex items-center p-0.5 bg-background border border-border rounded-spa">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`px-2.5 h-7 text-xs font-body font-body-medium rounded spa-transition-fast ${value === o.key ? 'bg-surface text-primary shadow-spa-resting' : 'text-text-secondary hover:text-text-primary'}`}>{o.label}</button>
      ))}
    </div>
  );
  const roleManagerUp = ['manager', 'admin'].includes(userRole);

  return (
    <>
    <CalendarMobileHeader
      staffLabel={staffLabel} locationLabel={locationLabel} enableRooms={enableRooms}
      columnMode={columnMode} onGroupByChange={onGroupByChange || setColumnMode} awayList={awayList}
      currentDate={currentDate} setCurrentDate={setCurrentDate} viewMode={viewMode} setViewMode={setViewMode}
      goToday={goToday} goPrev={goPrev} goNext={goNext} setTipOpen={setTipOpen}
      showServiceOnly={showServiceOnly} setShowServiceOnly={setShowServiceOnly}
      selectedPositions={selectedPositions} setSelectedPositions={setSelectedPositions} calendarPositionOptions={calendarPositionOptions}
      staffOptions={staffOptions} selectedStaffIds={selectedStaffIds} setSelectedStaffIds={setSelectedStaffIds} staffLabelPlural={staffLabelPlural}
      onNewBooking={onNewBooking} onOpenWaitlist={onOpenWaitlist} waitlistCount={waitlistCount} branchId={branchId}
      userRole={userRole} onPrint={onPrint} onEditRoster={onEditRoster} onBlockWholeCalendar={onBlockWholeCalendar}
      onCalendarSettings={onCalendarSettings} onClosedDates={onClosedDates}
      zoomScale={zoomScale} onZoomChange={onZoomChange} minZoom={minZoom} maxZoom={maxZoom}
      use24h={use24h} setUse24h={setUse24h} hideSensitive={hideSensitive} setHideSensitive={setHideSensitive}
    />
    <div className="max-md:hidden flex items-center gap-2 px-4 h-[52px] border-b border-border bg-surface flex-shrink-0 overflow-x-clip">
      {/* Left */}
      <div className="flex items-center gap-1.5 min-w-0">
        <button onClick={goToday} title="Today (T)" aria-keyshortcuts="t" className={btn}>Today</button>
        <button onClick={goPrev} className={iconBtn} aria-label="Previous" title={`Previous ${STEP_NOUN[viewMode] || 'day'} (J or ←)`} aria-keyshortcuts="j ArrowLeft">
          <Icon name="ChevronLeft" size={16} className="text-text-secondary" />
        </button>
        <button onClick={goNext} className={iconBtn} aria-label="Next" title={`Next ${STEP_NOUN[viewMode] || 'day'} (K or →)`} aria-keyshortcuts="k ArrowRight">
          <Icon name="ChevronRight" size={16} className="text-text-secondary" />
        </button>
        <div className="relative" ref={refs.date}>
          <button onClick={() => toggle('date')} aria-haspopup="dialog" aria-expanded={open === 'date'}
            className={`h-9 flex items-center gap-1.5 px-2.5 rounded-spa font-heading font-heading-semibold text-[15px] text-text-primary hover:bg-background spa-transition-fast whitespace-nowrap ${open === 'date' ? 'bg-background' : ''}`}>
            <span>{formatDateTitle(currentDate, viewMode)}</span>
            <Icon name="ChevronDown" size={14} className={`text-text-secondary spa-transition-fast ${open === 'date' ? 'rotate-180' : ''}`} />
          </button>
          {open === 'date' && (
            <div className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-3 w-[340px] max-w-[calc(100vw-16px)]">
              <MiniMonthCalendar selectedDate={currentDate} branchId={branchId} onDateSelect={(d) => { setCurrentDate(d); close(); }} />
              <div className="mt-2 pt-2 border-t border-border">
                <p className="mb-1.5 text-[10.5px] font-body font-medium uppercase tracking-wider text-text-tertiary">Jump</p>
                <div className="grid grid-cols-6 gap-1.5">
                  {JUMP_CHIPS.map((j) => (
                    <button key={j.label} type="button" onClick={() => applyJump(j)} className="h-8 text-xs font-body font-body-medium text-text-primary border border-border rounded-full hover:bg-background spa-transition-fast">{j.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {columnMode === 'therapist' && (
          <div className="relative" ref={refs.filter}>
            <button onClick={() => toggle('filter')} aria-haspopup="true" aria-expanded={open === 'filter'} title={`Filter ${(staffLabelPlural || 'staff').toLowerCase()}`}
              className={`h-9 flex items-center gap-1.5 px-3 text-[13px] font-body font-body-medium border rounded-spa spa-transition-fast whitespace-nowrap ${filterActive ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-text-primary hover:bg-background'}`}>
              <Icon name="Filter" size={14} />
              <span>{filterLabel}</span>
              <Icon name="ChevronDown" size={14} className={`spa-transition-fast ${open === 'filter' ? 'rotate-180' : ''}`} />
            </button>
            {open === 'filter' && (
              <div className="absolute left-0 top-full mt-1 w-64 max-h-[calc(100vh-120px)] flex flex-col bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown">
                <label className="flex items-center gap-2 px-3 min-h-[36px] border-b border-border cursor-pointer hover:bg-background flex-shrink-0">
                  <input type="checkbox" checked={showServiceOnly} onChange={(e) => setShowServiceOnly(e.target.checked)} className="text-primary focus:ring-primary w-3.5 h-3.5 rounded" />
                  <span className="text-[13px] text-text-primary">Show only service staff</span>
                </label>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {staffOptions.length > 0 && (
                    <>
                      <div className={heading}>{staffLabelPlural}</div>
                      {staffOptions.length > 8 && (
                        <div className="px-3 pb-1.5">
                          <input type="search" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} placeholder={`Search ${(staffLabelPlural || 'staff').toLowerCase()}`} aria-label="Search team"
                            className="w-full h-8 px-2.5 text-[13px] border border-border rounded-spa bg-background focus:outline-none focus:border-primary" />
                        </div>
                      )}
                      <div className="px-1.5 pb-1.5 space-y-0.5">
                        {shownStaff.map((p) => {
                          const on = selectedStaffIds.includes(p.id);
                          return (
                            <label key={p.id} className={`flex items-center gap-2 px-2 min-h-[36px] rounded cursor-pointer hover:bg-background ${on ? 'bg-background' : ''}`}>
                              <input type="checkbox" checked={on} onChange={(e) => setSelectedStaffIds((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))} className="text-primary focus:ring-primary w-3.5 h-3.5 rounded" />
                              <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center text-[10px] font-medium flex-shrink-0">{staffInitials(p.name)}</span>
                              <span className="text-[13px] text-text-primary truncate">{p.name}</span>
                            </label>
                          );
                        })}
                        {shownStaff.length === 0 && <p className="px-2 py-2 text-xs text-text-tertiary">No match</p>}
                      </div>
                    </>
                  )}
                  {calendarPositionOptions.length > 0 && (
                    <>
                      <div className={`${heading} border-t border-border`}>Position</div>
                      <div className="px-1.5 pb-1.5 space-y-0.5">
                        {calendarPositionOptions.map((pos) => (
                          <label key={pos} className={`flex items-center gap-2 px-2 min-h-[34px] rounded cursor-pointer hover:bg-background ${selectedPositions.includes(pos) ? 'bg-background' : ''}`}>
                            <input type="checkbox" checked={selectedPositions.includes(pos)}
                              onChange={(e) => setSelectedPositions((prev) => (e.target.checked ? [...prev, pos] : prev.filter((p) => p !== pos)))}
                              className="text-primary focus:ring-primary w-3.5 h-3.5 rounded" />
                            <span className="text-[13px] text-text-primary">{pos}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="p-1.5 border-t border-border flex-shrink-0">
                  <button onClick={clearFilter} disabled={!filterActive} className="w-full text-left px-2 min-h-[32px] text-[13px] text-primary hover:bg-primary/5 rounded disabled:opacity-40">Clear all</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Right: waitlist button only below lg (the docked panel's edge icon carries the count at lg+) */}
      <div className="flex items-center gap-1.5">
        {onOpenWaitlist && (
          <button type="button" onClick={onOpenWaitlist} className={`lg:hidden ${btn}`} aria-label={`Waitlist${waitlistCount ? `, ${waitlistCount} waiting` : ''}`}>
            Waitlist
            {waitlistCount > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-xs flex items-center justify-center">{waitlistCount}</span>}
          </button>
        )}
        <div className="relative" ref={refs.view}>
          <button onClick={() => toggle('view')} aria-haspopup="menu" aria-expanded={open === 'view'} title="View (D day · F 4-day)" className={`${btn} min-w-[84px]`}>
            {viewLabel}
            <Icon name="ChevronDown" size={14} className={`text-text-secondary spa-transition-fast ${open === 'view' ? 'rotate-180' : ''}`} />
          </button>
          {open === 'view' && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-44 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown py-1">
              {VIEW_MODE_OPTIONS.map((v) => (
                <button key={v.key} role="menuitemradio" aria-checked={viewMode === v.key} onClick={() => { setViewMode(v.key); close(); }}
                  aria-keyshortcuts={v.hint ? v.hint.toLowerCase() : undefined} className={item}>
                  <span className="w-3.5">{viewMode === v.key && <Icon name="Check" size={14} className="text-primary" />}</span>
                  <span>{v.label}</span>
                  {v.hint && <kbd className="ml-auto px-1.5 py-0.5 rounded-[4px] border border-border bg-background font-data text-[11px] text-text-primary">{v.hint}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
        {setUse24h && (
          <div className="relative" ref={refs.menu}>
            <button type="button" onClick={() => toggle('menu')} title="Calendar options" aria-label="Calendar options" aria-expanded={open === 'menu'} className={`${iconBtn} text-text-secondary ${open === 'menu' ? 'bg-background' : ''}`}>
              <Icon name="MoreVertical" size={16} />
            </button>
            {open === 'menu' && (
              <div className="absolute right-0 top-full mt-1 w-72 max-h-[calc(100vh-96px)] overflow-y-auto bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown py-1">
                {enableRooms && (
                  <>
                    <div className={heading}>Group by</div>
                    <div className="px-3 pb-2">
                      <div className="flex items-center p-0.5 bg-background border border-border rounded-spa">
                        {[{ key: 'therapist', label: staffLabel }, { key: 'room', label: locationLabel }].map((m) => (
                          <button key={m.key} type="button" aria-pressed={columnMode === m.key} onClick={() => (onGroupByChange || setColumnMode)(m.key)}
                            className={`flex-1 h-8 text-[13px] font-body font-body-medium rounded spa-transition-fast ${columnMode === m.key ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}>{m.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="my-1 border-t border-border" />
                  </>
                )}
                <div className={heading}>Tools</div>
                {menuItem('Printer', 'Print this calendar view', onPrint)}
                {roleManagerUp && onEditRoster && menuItem('Users', `Edit ${(staffLabel || 'staff').toLowerCase()} roster`, onEditRoster)}
                {!!onBlockWholeCalendar && menuItem('Ban', 'Block time (whole calendar)', onBlockWholeCalendar)}
                {userRole === 'admin' && menuItem('Settings', 'Calendar settings', onCalendarSettings)}
                {userRole === 'admin' && menuItem('Lock', 'Closed dates', onClosedDates)}
                <div className="my-1 border-t border-border" />
                <div className={heading}>Display</div>
                {viewMode !== 'month' && (
                  <div className="flex items-center justify-between gap-2 px-3 min-h-[40px]">
                    <span className="text-[13px] text-text-primary">Zoom</span>
                    <div className="flex items-center border border-border rounded-spa bg-background overflow-hidden">
                      <button type="button" onClick={() => onZoomChange(zoomScale - ZOOM_STEP)} disabled={zoomScale <= minZoom} title="Zoom out" aria-label="Zoom out" className="flex items-center justify-center w-8 h-8 text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed spa-transition-fast"><Icon name="ZoomOut" size={14} /></button>
                      <span className="px-2 h-8 flex items-center text-[11px] font-data text-text-secondary border-x border-border min-w-[44px] justify-center">{Math.round(zoomScale * 100)}%</span>
                      <button type="button" onClick={() => onZoomChange(zoomScale + ZOOM_STEP)} disabled={zoomScale >= maxZoom} title="Zoom in" aria-label="Zoom in" className="flex items-center justify-center w-8 h-8 text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed spa-transition-fast"><Icon name="ZoomIn" size={14} /></button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 px-3 min-h-[40px]">
                  <span className="text-[13px] text-text-primary">Time format</span>
                  {seg([{ key: '12h', label: '12h' }, { key: '24h', label: '24h' }], use24h ? '24h' : '12h', (v) => setUse24h(v === '24h'))}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 min-h-[40px]">
                  <span className="text-[13px] text-text-primary">Hide client names and prices</span>
                  <button type="button" role="switch" aria-checked={hideSensitive} aria-label="Hide client names and prices" onClick={() => setHideSensitive((v) => !v)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full spa-transition-fast ${hideSensitive ? 'bg-success' : 'bg-border'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white spa-transition-fast transform ${hideSensitive ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="my-1 border-t border-border" />
                {awayList.length > 0 && columnMode === 'therapist' && (
                  <>
                    <button type="button" onClick={() => setAwayExpanded((v) => !v)} aria-expanded={awayExpanded} className={item}>
                      <Icon name="UserX" size={15} className="text-text-secondary" />
                      <span>Away today</span>
                      <span className="ml-auto text-xs text-text-tertiary">{awayList.length}</span>
                      <Icon name="ChevronDown" size={13} className={`text-text-tertiary spa-transition-fast ${awayExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {awayExpanded && (
                      <div className="px-3 pb-2 space-y-1">
                        {awayList.map((a) => (
                          <div key={a.id} className="flex items-center gap-1.5 text-[13px] text-text-secondary pl-6">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.status === 'Absent' ? 'bg-error' : 'bg-warning'}`} />
                            <span className="truncate text-text-primary">{a.name}</span>
                            <span className="ml-auto text-text-tertiary">{a.status === 'Absent' ? 'Absent' : 'On leave'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <button type="button" onClick={() => { close(); setTipOpen(true); }} aria-keyshortcuts="?" className={item}>
                  <Icon name="Info" size={15} className="text-text-secondary" />
                  <span>Tips and shortcuts</span>
                  <kbd className="ml-auto px-1.5 py-0.5 rounded-[4px] border border-border bg-background font-data text-[11px] text-text-primary">?</kbd>
                </button>
              </div>
            )}
            {tipOpen && (
              <div role="dialog" aria-label="Keyboard shortcuts" className="absolute right-0 top-full mt-1 w-72 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-4 text-[13px] text-text-secondary leading-relaxed text-left">
                <p className="font-body font-medium text-xs uppercase tracking-wider text-text-tertiary mb-2">Keyboard shortcuts</p>
                <dl className="space-y-1.5">
                  {[
                    ['T', 'Today'],
                    ['J / ←', `Previous ${STEP_NOUN[viewMode] || 'day'}`],
                    ['K / →', `Next ${STEP_NOUN[viewMode] || 'day'}`],
                    ['D', 'Day view'],
                    ['F', '4-Day view'],
                    ['N', 'New booking'],
                    ['Esc', 'Close popover, menu or panel'],
                    ['?', 'Show / hide this list'],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt>{label}</dt>
                      <dd><kbd className="px-1.5 py-0.5 rounded-[4px] border border-border bg-background font-data text-[11px] text-text-primary">{key}</kbd></dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 pt-3 border-t border-border text-xs text-text-tertiary">
                  Drag a booking to reschedule it (Pending, or before its start time; not paid, in progress or closed). Drag on an empty column to start a new booking.
                </p>
              </div>
            )}
          </div>
        )}
        {onNewBooking && (
          <button type="button" onClick={onNewBooking} title="New booking (N)" aria-keyshortcuts="n" aria-label="New booking"
            className="h-9 min-[980px]:px-3.5 max-[979px]:w-9 flex items-center justify-center gap-1.5 text-[13px] font-body font-body-medium text-white bg-primary hover:bg-primary/90 rounded-spa spa-transition-fast whitespace-nowrap">
            <Icon name="Plus" size={14} />
            <span className="max-[979px]:hidden">New booking</span>
          </button>
        )}
      </div>
    </div>
    </>
  );
};

export default CalendarToolbar;
