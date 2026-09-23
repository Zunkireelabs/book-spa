import React, { useEffect, useRef } from 'react';
import Icon from '../../../../components/AppIcon';

// Small popover shown after clicking an empty calendar slot, letting staff pick what to
// create there. Anchored near the click position (slotInfo.clientX/clientY, captured by
// CalendarGrid's onEmptySlotClick call sites), clamped to stay on-screen. Content-agnostic
// on purpose — new options (e.g. a future 4th choice) can be added here without touching
// CalendarGrid.jsx again.
const EmptySlotChoiceMenu = ({ x, y, options, onClose }) => {
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const MENU_WIDTH = 200;
  const clampedX = Math.min(Math.max(x, 8), window.innerWidth - MENU_WIDTH - 8);
  const clampedY = Math.min(y, window.innerHeight - (options.length * 40 + 16) - 8);

  return (
    <div
      ref={ref}
      className="fixed z-dropdown bg-surface rounded-spa border border-border shadow-spa-elevated py-1"
      style={{ left: clampedX, top: Math.max(clampedY, 8), width: MENU_WIDTH }}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => { onClose(); opt.onSelect(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body font-body-normal text-text-primary hover:bg-background text-left"
        >
          <Icon name={opt.icon} size={15} className="text-text-secondary flex-shrink-0" />
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
};

export default EmptySlotChoiceMenu;
