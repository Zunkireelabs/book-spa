import React, { useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import BottomSheet, { SheetRow } from '../../../../components/ui/BottomSheet';

// Menu opened from a staff column header (day view, manager/admin): change this day's hours, usual weekly hours, profile.
// Phone: a bottom sheet. Desktop: a small popover under the header.
const StaffDayMenu = ({ menu, phone, dayText, onClose, onChangeHours, onUsualHours, onProfile }) => {
  useEffect(() => {
    if (!menu || phone) return undefined;
    const onDown = (e) => { if (!e.target.closest?.('[data-staff-day-menu]')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu, phone, onClose]);
  if (!menu) return null;
  const go = (fn) => () => { onClose(); fn(menu.col); };
  const rows = [
    ['Clock', `Change hours for ${dayText}`, onChangeHours],
    ['CalendarDays', 'Usual weekly hours', onUsualHours],
    ['User', 'View profile', onProfile],
  ];
  if (phone) {
    return (
      <BottomSheet isOpen title={menu.col.name} onClose={onClose}>
        {menu.subtitle && <p className="px-4 pb-2 text-[13px] text-text-tertiary">{dayText} · {menu.subtitle}</p>}
        {rows.map(([icon, label, fn]) => <SheetRow key={label} icon={icon} label={label} onClick={go(fn)} />)}
      </BottomSheet>
    );
  }
  return (
    <div
      data-staff-day-menu
      role="menu"
      className="fixed z-dropdown min-w-[220px] bg-surface border border-border rounded-spa shadow-spa-elevated py-1"
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 236)), top: menu.y }}
    >
      {rows.map(([icon, label, fn]) => (
        <button key={label} type="button" role="menuitem" onClick={go(fn)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-body text-text-primary hover:bg-background">
          <Icon name={icon} size={15} className="text-text-secondary" />{label}
        </button>
      ))}
    </div>
  );
};

export default StaffDayMenu;
