import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import CommandPalette from './CommandPalette';

const PaletteContext = createContext(null);

export const useCommandPalette = () => {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used within a CommandPaletteProvider');
  return ctx;
};

// For components that can also render outside the shell (e.g. the booking-details page's sidebar): null when there is no palette.
export const useOptionalCommandPalette = () => useContext(PaletteContext);

export const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
export const SHORTCUT_LABEL = isMac ? '⌘K' : 'Ctrl K';

// Owns the open / close state and the global ⌘K / Ctrl+K hotkey, and renders the palette (through a portal) once for the shell.
export const CommandPaletteProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [toggle]);

  const value = useMemo(() => ({ open, openPalette, closePalette, toggle }), [open, openPalette, closePalette, toggle]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {open && <CommandPalette onClose={closePalette} />}
    </PaletteContext.Provider>
  );
};
