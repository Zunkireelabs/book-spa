import { useEffect, useRef } from 'react';

// Keyboard shortcuts (calendar view only; ignored while typing or when a modal dialog is open).
// The handler is re-pointed every render so the single document listener always sees current state.
export function useCalendarShortcuts({ goToday, goPrev, goNext, setViewMode, handleNewBooking, setTipOpen }) {
  const shortcutRef = useRef(null);
  shortcutRef.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    // A modal dialog (add block, transfers, payment…) owns the keyboard; the docked side panel is aria-modal="false".
    if (document.querySelector('[aria-modal="true"]')) return;
    const k = e.key;
    const kl = k.length === 1 ? k.toLowerCase() : k;
    const act = (fn) => { e.preventDefault(); fn(); };
    switch (kl) {
      case 't': return act(goToday);
      case 'j': case 'ArrowLeft': return act(goPrev);
      case 'k': case 'ArrowRight': return act(goNext);
      case 'd': return act(() => setViewMode('day'));
      case 'f': return act(() => setViewMode('4day'));
      case 'n': return act(handleNewBooking);
      case '?': return act(() => setTipOpen((o) => !o));
      default:
    }
  };
  useEffect(() => {
    const onKey = (e) => shortcutRef.current?.(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
