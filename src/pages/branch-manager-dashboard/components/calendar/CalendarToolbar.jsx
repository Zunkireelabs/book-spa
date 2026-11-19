import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import MiniMonthCalendar from './MiniMonthCalendar';
import { addDays, addMonths } from './calendarDates';

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
  { key: 'day', label: 'Day' },
  { key: '4day', label: '4 Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

const JUMP_OPTIONS = [
  { label: '1 week', unit: 'week', amount: 1 },
  { label: '2 weeks', unit: 'week', amount: 2 },
  { label: '3 weeks', unit: 'week', amount: 3 },
  { label: '4 weeks', unit: 'week', amount: 4 },
  { label: '5 weeks', unit: 'week', amount: 5 },
  { label: '6 weeks', unit: 'week', amount: 6 },
  { label: '7 weeks', unit: 'week', amount: 7 },
  { label: '8 weeks', unit: 'week', amount: 8 },
  { label: '6 months', unit: 'month', amount: 6 },
  { label: '1 year', unit: 'year', amount: 1 },
];


// The calendar's top toolbar: Therapist/Room toggle, "N away", date navigation (jump menus, today, date popover),
// shortcuts tip, positions filter, Day/4 Day, and + New booking. Owns its popover open/close state; the shortcuts
// tip state lives in the caller because the "?" shortcut toggles it.
const CalendarToolbar = ({
  staffLabel, staffLabelPlural, locationLabel, enableRooms,
  columnMode, setColumnMode, awayList,
  currentDate, setCurrentDate, viewMode, setViewMode, goToday, goPrev, goNext,
  tipOpen, setTipOpen,
  showServiceOnly, setShowServiceOnly, selectedPositions, setSelectedPositions, calendarPositionOptions,
  onNewBooking, onOpenWaitlist, waitlistCount = 0, branchId,
  userRole, onPrint, onEditRoster, onBlockWholeCalendar, onCalendarSettings, onClosedDates,
  zoomScale, onZoomChange, minZoom, maxZoom, use24h, setUse24h, hideSensitive, setHideSensitive,
}) => {
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef(null);
  useEffect(() => {
    if (!settingsMenuOpen) return undefined;
    const handle = (e) => { if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) setSettingsMenuOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [settingsMenuOpen]);
  const ZOOM_STEP = 0.2;
  const menuItem = (icon, label, onClick) => (
    <button type="button" onClick={() => { setSettingsMenuOpen(false); onClick?.(); }}
      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-text-primary hover:bg-background spa-transition-fast">
      <Icon name={icon} size={14} className="text-text-secondary" />
      <span>{label}</span>
    </button>
  );
  const [positionDropdownOpen, setPositionDropdownOpen] = useState(false);
  const positionDropdownRef = useRef(null);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef(null);
  const tipRef = useRef(null);
  const [awayOpen, setAwayOpen] = useState(false);
  const awayRef = useRef(null);
  const [jumpMenuOpen, setJumpMenuOpen] = useState(null); // 'prev' | 'next' | null
  const prevJumpRef = useRef(null);
  const nextJumpRef = useRef(null);

  const applyJump = (sign, unit, amount) => {
    setCurrentDate(
      unit === 'week'
        ? addDays(currentDate, sign * amount * 7)
        : addMonths(currentDate, sign * amount * (unit === 'year' ? 12 : 1))
    );
  };

  // Close toolbar popovers on outside click / Esc
  useEffect(() => {
    if (!dateDropdownOpen && !tipOpen && !awayOpen && !jumpMenuOpen) return;
    const onDown = (e) => {
      const inside = (r) => r.current && r.current.contains(e.target);
      if (dateDropdownOpen && !inside(dateDropdownRef)) setDateDropdownOpen(false);
      if (tipOpen && !inside(tipRef)) setTipOpen(false);
      if (awayOpen && !inside(awayRef)) setAwayOpen(false);
      if (jumpMenuOpen && !inside(jumpMenuOpen === 'prev' ? prevJumpRef : nextJumpRef)) setJumpMenuOpen(null);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // claimed: the panel / rebook handlers must not also act on this Esc
      setDateDropdownOpen(false);
      setTipOpen(false);
      setAwayOpen(false);
      setJumpMenuOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dateDropdownOpen, tipOpen, awayOpen, jumpMenuOpen]);

  // Close position dropdown on outside click
  useEffect(() => {
    if (!positionDropdownOpen) return;
    const handle = (e) => {
      if (positionDropdownRef.current && !positionDropdownRef.current.contains(e.target)) setPositionDropdownOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setPositionDropdownOpen(false); } };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onKey);
    };
  }, [positionDropdownOpen]);


  // Wraps below sm (the date nav drops to its own full-width row on mobile). At lg+ the left and right groups share the
  // free space equally (flex-1 / basis-0, never narrower than their content), so the date-nav group sits exactly on the
  // toolbar's centre whenever there's room. When there isn't, the wider side keeps its content width and the centre
  // slides over; if even that doesn't fit, the right group wraps to a second row as before (never overlapping/overflowing).
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-b border-border bg-surface flex-shrink-0 overflow-x-clip">
      {/* Left: Therapist/Room toggle + away summary */}
      <div className="flex items-center gap-3 justify-self-start min-w-0 lg:flex-1 lg:basis-0 lg:min-w-max">
        {enableRooms ? (
          <div className="flex items-center border border-border rounded-spa bg-background p-0.5 gap-0.5 h-[var(--control-h)]">
            {[
              { key: 'therapist', icon: 'User', label: staffLabel },
              { key: 'room', icon: 'DoorOpen', label: locationLabel },
            ].map(m => (
              <button
                key={m.key}
                onClick={() => setColumnMode(m.key)}
                className={`flex items-center gap-1.5 px-2.5 h-full text-[13px] rounded-[4px] font-body font-body-medium spa-transition-fast ${
                  columnMode === m.key ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon name={m.icon} size={14} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[13px] text-text-primary font-body">
            <Icon name="User" size={14} className="text-text-secondary" />
            <span>{staffLabelPlural}</span>
          </div>
        )}
        {awayList.length > 0 && columnMode === 'therapist' && (
          <div className="relative hidden sm:block" ref={awayRef}>
            <button
              onClick={() => setAwayOpen(prev => !prev)}
              className="text-[13px] text-text-tertiary hover:text-text-secondary spa-transition-fast whitespace-nowrap"
              aria-label="Show staff who are away"
            >
              {awayList.length} away
            </button>
            {awayOpen && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-2 space-y-1">
                {awayList.map(a => (
                  <div key={a.id} className="flex items-center gap-1.5 text-[13px] text-text-secondary">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.status === 'Absent' ? 'bg-error' : 'bg-warning'}`} />
                    <span className="truncate text-text-primary">{a.name}</span>
                    <span className="ml-auto text-text-tertiary">{a.status === 'Absent' ? 'Absent' : 'On leave'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center: jump / prev / Today / date / next / jump */}
      <div className="flex items-center gap-1.5 justify-center justify-self-center order-last sm:order-none w-full sm:w-auto">
        <div className="relative" ref={prevJumpRef}>
          <button
            onClick={() => setJumpMenuOpen(prev => (prev === 'prev' ? null : 'prev'))}
            className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center border border-border rounded-spa hover:bg-background spa-transition-fast"
            aria-label="Jump back"
          >
            <Icon name="ChevronsLeft" size={16} className="text-text-secondary" />
          </button>
          {jumpMenuOpen === 'prev' && (
            <div className="absolute left-0 top-full mt-1 w-32 max-h-72 overflow-y-auto bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown py-1">
              {JUMP_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { applyJump(-1, opt.unit, opt.amount); setJumpMenuOpen(null); }}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-text-primary hover:bg-background"
                >
                  -{opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={goPrev}
          className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center border border-border rounded-spa hover:bg-background spa-transition-fast"
          aria-label="Previous"
          title={`Previous ${STEP_NOUN[viewMode] || 'day'} (J or ←)`}
          aria-keyshortcuts="j ArrowLeft"
        >
          <Icon name="ChevronLeft" size={16} className="text-text-secondary" />
        </button>
        <button
          onClick={goToday}
          title="Today (T)"
          aria-keyshortcuts="t"
          className="h-[var(--control-h)] px-3 text-[13px] font-body font-body-medium text-text-primary border border-border rounded-spa hover:bg-background spa-transition-fast"
        >
          Today
        </button>
        <div className="relative" ref={dateDropdownRef}>
          <button
            onClick={() => setDateDropdownOpen(prev => !prev)}
            className={`h-[var(--control-h)] flex items-center gap-1.5 px-3 text-[13px] font-body font-body-medium text-text-primary border rounded-spa hover:bg-background spa-transition-fast justify-between ${
              dateDropdownOpen ? 'border-text-primary' : 'border-border'
            }`}
            aria-haspopup="dialog"
            aria-expanded={dateDropdownOpen}
          >
            <span className="whitespace-nowrap">{formatDateTitle(currentDate, viewMode)}</span>
            <Icon name="ChevronDown" size={14} className={`text-text-secondary spa-transition-fast ${dateDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {dateDropdownOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full max-sm:fixed max-sm:top-auto mt-1 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-3 max-w-[calc(100vw-16px)]">
              <MiniMonthCalendar
                selectedDate={currentDate}
                branchId={branchId}
                onDateSelect={(d) => { setCurrentDate(d); setDateDropdownOpen(false); }}
              />
            </div>
          )}
        </div>
        <button
          onClick={goNext}
          className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center border border-border rounded-spa hover:bg-background spa-transition-fast"
          aria-label="Next"
          title={`Next ${STEP_NOUN[viewMode] || 'day'} (K or →)`}
          aria-keyshortcuts="k ArrowRight"
        >
          <Icon name="ChevronRight" size={16} className="text-text-secondary" />
        </button>
        <div className="relative" ref={nextJumpRef}>
          <button
            onClick={() => setJumpMenuOpen(prev => (prev === 'next' ? null : 'next'))}
            className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center border border-border rounded-spa hover:bg-background spa-transition-fast"
            aria-label="Jump forward"
          >
            <Icon name="ChevronsRight" size={16} className="text-text-secondary" />
          </button>
          {jumpMenuOpen === 'next' && (
            <div className="absolute right-0 top-full mt-1 w-32 max-h-72 overflow-y-auto bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown py-1">
              {JUMP_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { applyJump(1, opt.unit, opt.amount); setJumpMenuOpen(null); }}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-text-primary hover:bg-background"
                >
                  +{opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: tip + position filter + view toggle */}
      <div className="flex flex-wrap items-center gap-2 ml-auto max-w-full lg:flex-wrap lg:flex-1 lg:basis-0 lg:min-w-max lg:justify-end">
        <div className="relative" ref={tipRef}>
          <button
            type="button"
            onClick={() => setTipOpen(prev => !prev)}
            className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center border border-border rounded-spa hover:bg-background spa-transition-fast"
            aria-label="Shortcuts and drag-and-drop tips"
            title="Shortcuts (?)"
            aria-keyshortcuts="?"
          >
            <Icon name="Info" size={16} className="text-text-secondary" />
          </button>
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
        {columnMode === 'therapist' && (
          <div className="relative" ref={positionDropdownRef}>
            <button
              onClick={() => setPositionDropdownOpen(prev => !prev)}
              className={`h-[var(--control-h)] flex items-center gap-1.5 px-3 text-[13px] border rounded-spa spa-transition-fast ${
                selectedPositions.length > 0 ? 'border-text-primary bg-background text-text-primary' : 'border-border bg-surface text-text-primary'
              }`}
            >
              <Icon name="Filter" size={14} />
              <span className="hidden sm:inline">{selectedPositions.length === 0 ? 'All Positions' : `${selectedPositions.length} selected`}</span>
              <Icon name="ChevronDown" size={14} className={`spa-transition-fast ${positionDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {positionDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown">
                <label className="flex items-center gap-2 px-3 py-2 border-b border-border cursor-pointer hover:bg-background">
                  <input
                    type="checkbox"
                    checked={showServiceOnly}
                    onChange={(e) => setShowServiceOnly(e.target.checked)}
                    className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                  />
                  <span className="text-[13px] text-text-primary">Service staff only</span>
                </label>
                {calendarPositionOptions.length > 0 && (
                  <>
                    <div className="p-1.5 border-b border-border">
                      <button
                        onClick={() => setSelectedPositions([])}
                        className="w-full text-left px-2 py-1 text-xs text-primary hover:bg-primary/5 rounded"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="max-h-[200px] overflow-y-auto p-1.5 space-y-0.5">
                      {calendarPositionOptions.map(pos => (
                        <label key={pos} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-background ${selectedPositions.includes(pos) ? 'bg-background' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedPositions.includes(pos)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPositions(prev => [...prev, pos]);
                              } else {
                                setSelectedPositions(prev => prev.filter(p => p !== pos));
                              }
                            }}
                            className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                          />
                          <span className="text-[13px] text-text-primary">{pos}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center border border-border rounded-spa bg-background p-0.5 gap-0.5 h-[var(--control-h)]">
          {VIEW_MODE_OPTIONS.map(v => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key)}
              title={v.key === 'day' ? 'Day view (D)' : v.key === '4day' ? '4-Day view (F)' : `${v.label} view`}
              aria-keyshortcuts={v.key === 'day' ? 'd' : v.key === '4day' ? 'f' : undefined}
              className={`px-3 h-full text-[13px] rounded-[4px] font-body font-body-medium spa-transition-fast whitespace-nowrap ${
                viewMode === v.key
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {setUse24h && (
          <div className="relative" ref={settingsMenuRef}>
            <button
              type="button"
              onClick={() => setSettingsMenuOpen(o => !o)}
              title="Calendar options"
              aria-label="Calendar options"
              aria-expanded={settingsMenuOpen}
              className="h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center border border-border rounded-spa bg-surface text-text-secondary hover:bg-background hover:text-text-primary spa-transition-fast"
            >
              <Icon name="MoreVertical" size={16} />
            </button>
            {settingsMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-60 bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown py-1">
                {menuItem('Printer', 'Print this calendar view', onPrint)}
                {['manager', 'admin'].includes(userRole) && onEditRoster && menuItem('Users', `Edit ${(staffLabel || 'staff').toLowerCase()} roster`, onEditRoster)}
                {!!onBlockWholeCalendar && menuItem('Ban', 'Block time (whole calendar)', onBlockWholeCalendar)}
                {userRole === 'admin' && menuItem('Settings', 'Calendar settings', onCalendarSettings)}
                {userRole === 'admin' && menuItem('Lock', 'Closed dates', onClosedDates)}
                <div className="my-1 border-t border-border" />
                {viewMode !== 'month' && (
                  <div className="w-full flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm text-text-primary">Zoom</span>
                    <div className="flex items-center border border-border rounded-spa bg-background overflow-hidden">
                      <button type="button" onClick={() => onZoomChange(zoomScale - ZOOM_STEP)} disabled={zoomScale <= minZoom} title="Zoom out"
                        className="flex items-center justify-center w-7 h-7 text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed spa-transition-fast">
                        <Icon name="ZoomOut" size={13} />
                      </button>
                      <span className="px-1.5 h-7 flex items-center text-[11px] font-data text-text-secondary border-x border-border min-w-[38px] justify-center">{Math.round(zoomScale * 100)}%</span>
                      <button type="button" onClick={() => onZoomChange(zoomScale + ZOOM_STEP)} disabled={zoomScale >= maxZoom} title="Zoom in"
                        className="flex items-center justify-center w-7 h-7 text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed spa-transition-fast">
                        <Icon name="ZoomIn" size={13} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="w-full flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-text-primary">Time format</span>
                  <div className="flex items-center p-0.5 bg-background border border-border rounded-spa">
                    {['12h', '24h'].map(val => (
                      <button key={val} type="button" onClick={() => setUse24h(val === '24h')}
                        className={`px-2 py-0.5 text-xs font-body font-body-medium rounded spa-transition-fast ${(use24h ? '24h' : '12h') === val ? 'bg-surface text-primary shadow-spa-resting' : 'text-text-secondary hover:text-text-primary'}`}>
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="w-full flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-text-primary">Hide client names and prices</span>
                  <button type="button" role="switch" aria-checked={hideSensitive} onClick={() => setHideSensitive(v => !v)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full spa-transition-fast ${hideSensitive ? 'bg-success' : 'bg-border'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white spa-transition-fast transform ${hideSensitive ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {onOpenWaitlist && (
        <button
          type="button"
          onClick={onOpenWaitlist}
          className="lg:hidden h-[var(--control-h)] flex items-center gap-1.5 px-3 text-[13px] font-body font-body-medium text-text-primary bg-surface border border-border hover:bg-background rounded-spa whitespace-nowrap"
        >
          Waitlist
          {waitlistCount > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-xs flex items-center justify-center">{waitlistCount}</span>}
        </button>
        )}
        {onNewBooking && (
        <button
          type="button"
          onClick={onNewBooking}
          title="New booking (N)"
          aria-keyshortcuts="n"
          aria-label="New booking"
          className="h-[var(--control-h)] max-sm:w-[var(--control-h)] max-sm:justify-center max-sm:px-0 flex items-center gap-1.5 px-3.5 text-[13px] font-body font-body-medium text-white bg-primary hover:bg-primary/90 rounded-spa spa-transition-fast whitespace-nowrap"
        >
          <Icon name="Plus" size={14} />
          <span className="max-sm:hidden">New booking</span>
        </button>
        )}
      </div>
    </div>
  );
};

export default CalendarToolbar;
