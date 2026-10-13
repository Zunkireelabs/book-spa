import React, { useEffect, useRef } from 'react';
import Icon from '../../../../components/AppIcon';

// Small popover shown after clicking an empty calendar slot, letting staff pick what to create
// there. Anchored at the click position (slotInfo.clientX/clientY), clamped on-screen.
// Content-agnostic on purpose: add an option (e.g. 3c's "Transfer staff") by appending to the
// `options` array built in index.jsx — { key, label, icon, onSelect } — with no change here.
const MENU_WIDTH = 200;
const ITEM_HEIGHT = 36;

const EmptySlotChoiceMenu = ({ x, y, options, onClose }) => {
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const height = options.length * ITEM_HEIGHT + 8;
  // No click coordinates (e.g. opened from the "+N" badge): centre it rather than pinning to 0,0.
  const hasPoint = x != null && y != null && (x > 0 || y > 0);
  const baseX = hasPoint ? x : (window.innerWidth - MENU_WIDTH) / 2;
  const baseY = hasPoint ? y : (window.innerHeight - height) / 2;
  const left = Math.min(Math.max(baseX, 8), window.innerWidth - MENU_WIDTH - 8);
  const top = Math.max(Math.min(baseY, window.innerHeight - height - 8), 8);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-dropdown bg-surface rounded-spa-lg border border-border shadow-spa-elevated py-1"
      style={{ left, top, width: MENU_WIDTH }}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="menuitem"
          onClick={() => { onClose(); opt.onSelect(); }}
          className="w-full flex items-center gap-2 px-3 text-[13px] font-body text-text-primary hover:bg-background text-left"
          style={{ height: ITEM_HEIGHT }}
        >
          <Icon name={opt.icon} size={15} className="text-text-secondary flex-shrink-0" />
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
};

export default EmptySlotChoiceMenu;
