import React, { useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import BottomSheet, { SheetSection, SheetRow } from '../../../../components/ui/BottomSheet';
import ScrollRow from '../../../../components/ui/ScrollRow';
import MiniMonthCalendar from './MiniMonthCalendar';
import { addDays, addMonths } from './calendarDates';
import { horizontalSwipe } from '../../../../utils/gestures';

// Phone (< md) calendar header: ONE 52px row (date title, Today, Waitlist, Views, +) and the bottom sheets that hold every
// other control the desktop toolbar shows. Rendered by CalendarToolbar inside `md:hidden`; same props, same handlers.

const VIEW_TILES = [
  { key: 'day', label: 'Day', icon: 'Calendar' },
  { key: '4day', label: '4 day', icon: 'CalendarRange' },
  { key: 'week', label: 'Week', icon: 'CalendarDays' },
  { key: 'month', label: 'Month', icon: 'LayoutGrid' },
];
const STEP_DAYS = { day: 1, '4day': 4, week: 7 };
const JUMPS = [
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => ({ label: `-${n}w`, unit: 'week', amount: -n })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `+${n}w`, unit: 'week', amount: n })),
  { label: '+6 mo', unit: 'month', amount: 6 },
  { label: '+1 yr', unit: 'month', amount: 12 },
];

export function formatPhoneTitle(dateStr, viewMode) {
  const d = new Date(dateStr + 'T00:00:00');
  if (viewMode === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (viewMode === '4day' || viewMode === 'week') {
    const end = new Date(d);
    end.setDate(end.getDate() + (viewMode === 'week' ? 6 : 3));
    return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  }
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

// Never ellipsizes: day view is a two-line stack (weekday small above, "19 Nov" below); ranges wrap to two lines.
const PhoneTitle = ({ dateStr, viewMode }) => {
  const d = new Date(dateStr + 'T00:00:00');
  if (viewMode === 'day') {
    return (
      <span className="flex flex-col leading-tight whitespace-nowrap">
        <span className="text-[11px] font-body font-medium uppercase tracking-wide text-text-tertiary">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
        <span>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}</span>
      </span>
    );
  }
  return <span className="leading-tight text-[15px] whitespace-normal">{formatPhoneTitle(dateStr, viewMode)}</span>;
};

const Switch = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange}
    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full spa-transition-fast ${checked ? 'bg-success' : 'bg-border'}`}>
    <span className={`inline-block h-5 w-5 rounded-full bg-white spa-transition-fast transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
);

const Segmented = ({ options, value, onChange, full }) => (
  <div className={`flex items-center p-0.5 bg-background border border-border rounded-spa ${full ? 'w-full [&>button]:flex-1' : ''}`}>
    {options.map((o) => (
      <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
        className={`min-h-[40px] px-3 text-[13px] font-body font-body-medium rounded-[6px] spa-transition-fast ${value === o.key ? 'bg-surface text-primary shadow-spa-resting' : 'text-text-secondary'}`}>
        {o.label}
      </button>
    ))}
  </div>
);

const CalendarMobileHeader = ({
  staffLabel, locationLabel, enableRooms, columnMode, onGroupByChange, awayList,
  currentDate, setCurrentDate, viewMode, setViewMode, goToday, goPrev, goNext, setTipOpen,
  showServiceOnly, setShowServiceOnly, selectedPositions, setSelectedPositions, calendarPositionOptions,
  onNewBooking, onOpenWaitlist, waitlistCount = 0, branchId,
  userRole, onPrint, onEditRoster, onBlockWholeCalendar, onCalendarSettings, onClosedDates,
  zoomScale, onZoomChange, minZoom, maxZoom, use24h, setUse24h, hideSensitive, setHideSensitive,
}) => {
  const [sheet, setSheet] = useState(null); // 'views' | 'date' | null
  const [sub, setSub] = useState(null); // 'filters' | 'away' | 'tips' | null (nested over 'views')
  const ZOOM_STEP = 0.2;
  const filterCount = selectedPositions.length + (showServiceOnly ? 0 : 1);

  // Swipe on the date row changes the day (step follows the view).
  const swipe = useRef(null);
  const onDown = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    const s = swipe.current; swipe.current = null;
    if (!s) return;
    const dir = horizontalSwipe(e.clientX - s.x, e.clientY - s.y);
    if (dir === 'left') goNext(); else if (dir === 'right') goPrev();
  };

  const closeAll = () => { setSub(null); setSheet(null); };
  const tool = (fn) => () => { closeAll(); fn?.(); };
  const jump = (j) => setCurrentDate(j.unit === 'week' ? addDays(currentDate, j.amount * 7) : addMonths(currentDate, j.amount));
  const step = (sign) => setCurrentDate(viewMode === 'month' ? addMonths(currentDate, sign) : addDays(currentDate, sign * (STEP_DAYS[viewMode] || 1)));
  const hdrBtn = 'h-11 min-w-[44px] flex items-center justify-center border border-border rounded-spa bg-surface text-text-primary hover:bg-background spa-transition-fast relative';

  return (
    <div className="md:hidden flex items-center gap-1.5 h-[52px] px-3 border-b border-border bg-surface flex-shrink-0">
      <button
        type="button"
        onClick={() => setSheet('date')}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => { swipe.current = null; }}
        style={{ touchAction: 'none' }} /* header never scrolls; 'none' keeps every pointermove (pan-y got a pointercancel in headless touch) */
        aria-haspopup="dialog"
        aria-label={`${formatPhoneTitle(currentDate, viewMode)}, choose date`}
        className="flex-1 min-w-0 h-11 flex items-center gap-1 px-1 text-left font-heading font-heading-semibold text-[16px] text-text-primary"
      >
        <PhoneTitle dateStr={currentDate} viewMode={viewMode} />
        <Icon name="ChevronDown" size={14} className="text-text-secondary flex-shrink-0" />
      </button>
      <button type="button" onClick={goToday} className="h-11 px-3 text-[13px] font-body font-body-medium text-text-primary border border-border rounded-spa hover:bg-background spa-transition-fast">Today</button>
      {onOpenWaitlist && (
        <button type="button" onClick={onOpenWaitlist} aria-label={`Waitlist${waitlistCount ? `, ${waitlistCount}` : ''}`} className={hdrBtn}>
          <Icon name="ListOrdered" size={18} />
          {waitlistCount > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] flex items-center justify-center">{waitlistCount}</span>}
        </button>
      )}
      {setUse24h && (
        <button type="button" onClick={() => setSheet('views')} aria-label="Calendar views and options" aria-haspopup="dialog" className={hdrBtn}>
          <Icon name="SlidersHorizontal" size={18} />
        </button>
      )}
      {onNewBooking && (
        <button type="button" onClick={onNewBooking} aria-label="New booking" className="h-11 w-11 flex items-center justify-center text-white bg-primary hover:bg-primary/90 rounded-spa spa-transition-fast">
          <Icon name="Plus" size={20} />
        </button>
      )}

      {/* Date picker */}
      <BottomSheet isOpen={sheet === 'date'} title="Go to date" onClose={() => setSheet(null)}>
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <button type="button" onClick={() => step(-1)} aria-label="Previous" className={hdrBtn}><Icon name="ChevronLeft" size={18} /></button>
          <span className="text-[15px] font-body font-body-medium text-text-primary text-center">{formatPhoneTitle(currentDate, viewMode)}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next" className={hdrBtn}><Icon name="ChevronRight" size={18} /></button>
        </div>
        <div className="px-4 pb-3 flex justify-center">
          <MiniMonthCalendar selectedDate={currentDate} branchId={branchId} onDateSelect={(d) => { setCurrentDate(d); setSheet(null); }} />
        </div>
        <SheetSection title="Jump">
          <ScrollRow desktopWrap={false}>
            {JUMPS.map((j) => (
              <button key={j.label} type="button" onClick={() => jump(j)} className="px-3.5 text-[13px] font-body font-body-medium text-text-primary border border-border rounded-full hover:bg-background">{j.label}</button>
            ))}
          </ScrollRow>
        </SheetSection>
      </BottomSheet>

      {/* Calendar views */}
      <BottomSheet isOpen={sheet === 'views'} title="Calendar views" onClose={closeAll}>
        <SheetSection title="View">
          <div className="grid grid-cols-4 gap-2">
            {VIEW_TILES.map((v) => (
              <button key={v.key} type="button" onClick={() => setViewMode(v.key)} aria-pressed={viewMode === v.key}
                className={`min-h-[64px] flex flex-col items-center justify-center gap-1 rounded-spa border text-[13px] font-body font-body-medium spa-transition-fast ${viewMode === v.key ? 'bg-primary text-white border-primary' : 'bg-surface text-text-primary border-border'}`}>
                <Icon name={v.icon} size={18} />{v.label}
              </button>
            ))}
          </div>
        </SheetSection>
        <SheetSection title="Group by">
          {enableRooms ? (
            <Segmented full value={columnMode} onChange={onGroupByChange} options={[{ key: 'therapist', label: staffLabel }, { key: 'room', label: locationLabel }]} />
          ) : <SheetRow icon="User" label={staffLabel} />}
        </SheetSection>
        <SheetSection title="Show">
          {columnMode === 'therapist' && (
            <SheetRow icon="Filter" label="Filters" value={filterCount ? `${filterCount} active` : 'All'} onClick={() => setSub('filters')} />
          )}
          {onOpenWaitlist && <SheetRow icon="ListOrdered" label="Waitlist" value={waitlistCount || null} onClick={() => { closeAll(); onOpenWaitlist(); }} />}
          {awayList.length > 0 && columnMode === 'therapist' && <SheetRow icon="UserX" label="Away today" value={awayList.length} onClick={() => setSub('away')} />}
        </SheetSection>
        <SheetSection title="Display">
          {viewMode !== 'month' && (
            <SheetRow label="Zoom" trailing={(
              <div className="flex items-center border border-border rounded-spa bg-background overflow-hidden">
                <button type="button" onClick={() => onZoomChange(zoomScale - ZOOM_STEP)} disabled={zoomScale <= minZoom} aria-label="Zoom out" className="w-11 h-11 flex items-center justify-center text-text-secondary disabled:opacity-40"><Icon name="ZoomOut" size={16} /></button>
                <span className="px-2 min-w-[48px] text-center text-[13px] font-data text-text-secondary border-x border-border">{Math.round(zoomScale * 100)}%</span>
                <button type="button" onClick={() => onZoomChange(zoomScale + ZOOM_STEP)} disabled={zoomScale >= maxZoom} aria-label="Zoom in" className="w-11 h-11 flex items-center justify-center text-text-secondary disabled:opacity-40"><Icon name="ZoomIn" size={16} /></button>
              </div>
            )} />
          )}
          <SheetRow label="Time format" trailing={<Segmented value={use24h ? '24h' : '12h'} onChange={(v) => setUse24h(v === '24h')} options={[{ key: '12h', label: '12h' }, { key: '24h', label: '24h' }]} />} />
          <SheetRow label="Hide client names and prices" trailing={<Switch checked={hideSensitive} onChange={() => setHideSensitive((v) => !v)} label="Hide client names and prices" />} />
        </SheetSection>
        <SheetSection title="Tools">
          <SheetRow icon="Printer" label="Print this calendar view" onClick={tool(onPrint)} />
          {['manager', 'admin'].includes(userRole) && onEditRoster && <SheetRow icon="Users" label={`Edit ${(staffLabel || 'staff').toLowerCase()} roster`} onClick={tool(onEditRoster)} />}
          {!!onBlockWholeCalendar && <SheetRow icon="Ban" label="Block time (whole calendar)" onClick={tool(onBlockWholeCalendar)} />}
          {userRole === 'admin' && <SheetRow icon="Settings" label="Calendar settings" onClick={tool(onCalendarSettings)} />}
          {userRole === 'admin' && <SheetRow icon="Lock" label="Closed dates" onClick={tool(onClosedDates)} />}
        </SheetSection>
        <SheetSection>
          <SheetRow icon="Info" label="Tips and legend" onClick={() => setSub('tips')} />
        </SheetSection>
      </BottomSheet>

      {/* Nested: Filters */}
      <BottomSheet isOpen={sheet === 'views' && sub === 'filters'} title="Filters" onBack={() => setSub(null)} onClose={() => setSub(null)}
        footer={<button type="button" onClick={() => setSub(null)} className="w-full h-11 rounded-spa bg-primary text-white text-[15px] font-body font-body-medium">Done</button>}>
        <SheetSection>
          <SheetRow label="Service staff only" trailing={<Switch checked={showServiceOnly} onChange={() => setShowServiceOnly(!showServiceOnly)} label="Service staff only" />} />
        </SheetSection>
        {calendarPositionOptions.length > 0 && (
          <SheetSection title="Positions">
            <SheetRow label="Clear all" onClick={() => setSelectedPositions([])} disabled={selectedPositions.length === 0} trailing={<span />} className="text-primary" />
            {calendarPositionOptions.map((pos) => {
              const on = selectedPositions.includes(pos);
              return (
                <button key={pos} type="button" role="checkbox" aria-checked={on}
                  onClick={() => setSelectedPositions((prev) => (on ? prev.filter((p) => p !== pos) : [...prev, pos]))}
                  className="w-full min-h-[44px] flex items-center gap-3 py-1.5 hover:bg-background">
                  <span className={`w-5 h-5 rounded flex items-center justify-center border ${on ? 'bg-primary border-primary text-white' : 'border-border'}`}>{on && <Icon name="Check" size={14} />}</span>
                  <span className="text-[15px] text-text-primary">{pos}</span>
                </button>
              );
            })}
          </SheetSection>
        )}
      </BottomSheet>

      {/* Nested: Away today */}
      <BottomSheet isOpen={sheet === 'views' && sub === 'away'} title="Away today" onBack={() => setSub(null)} onClose={() => setSub(null)}>
        <SheetSection>
          {awayList.map((a) => (
            <div key={a.id} className="min-h-[44px] flex items-center gap-3 py-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.status === 'Absent' ? 'bg-error' : 'bg-warning'}`} />
              <span className="flex-1 text-[15px] text-text-primary truncate">{a.name}</span>
              <span className="text-[13px] text-text-tertiary">{a.status === 'Absent' ? 'Absent' : 'On leave'}</span>
            </div>
          ))}
        </SheetSection>
      </BottomSheet>

      {/* Nested: Tips and legend */}
      <BottomSheet isOpen={sheet === 'views' && sub === 'tips'} title="Tips and legend" onBack={() => setSub(null)} onClose={() => setSub(null)}>
        <SheetSection title="Gestures">
          <ul className="text-[14px] text-text-secondary leading-relaxed space-y-2">
            <li>Swipe left or right on the date at the top to change day (or 4 days, week, month).</li>
            <li>Pinch the grid to zoom the time scale.</li>
            <li>Scroll sideways to see more {(staffLabel || 'staff').toLowerCase()}; the Unassigned strip stays pinned on the left.</li>
            <li>Drag a booking to reschedule it (Pending, or before its start time; not paid, in progress or closed). Drag on an empty column to start a new booking.</li>
          </ul>
        </SheetSection>
      </BottomSheet>
    </div>
  );
};

export default CalendarMobileHeader;
