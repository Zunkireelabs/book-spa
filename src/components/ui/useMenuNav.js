import { useEffect } from 'react';

// Shared behaviour for small dropdown menus (role="menu" with role="menuitem" children):
// closes on outside pointerdown (mousedown is suppressed by the calendar's dnd-kit sensors) / Esc / Tab, moves focus with ↑ ↓ Home End, and focuses the
// selected (aria-checked="true") or first item on open. Esc returns focus to the trigger.
export function useMenuNav({ open, onClose, menuRef, triggerRef }) {
  useEffect(() => {
    if (!open) return undefined;
    const items = () => Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);

    const first = items();
    (first.find((el) => el.getAttribute('aria-checked') === 'true') || first[0])?.focus();

    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') { onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const list = items();
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement);
      let next;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      else if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % list.length;
      else next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, menuRef, triggerRef]);
}
