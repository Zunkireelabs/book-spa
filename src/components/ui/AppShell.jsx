import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import StaffSidebar from './StaffSidebar';
import AppHeader from './AppHeader';
import { CommandPaletteProvider } from '../CommandPalette/useCommandPalette';
import NotificationToasts from './NotificationToasts';

// The scroller of the content frame (desktop). Pages that need to scroll programmatically use this instead of `window`.
const ScrollerContext = createContext(null);
export const useAppScroller = () => useContext(ScrollerContext);

// One shell for every signed-in dashboard page: sidebar + 48px header + a rounded, bordered content frame.
//
// lg+: the shell is h-dvh and the frame is clipped, so its border and rounded corner stay put like a window frame while
//      only the inner `.content-scroll` scroller moves (variants "page" and "flush"). Variant "fill" (the calendar) has no
//      scroller of its own: the child fills the frame and manages its own scroll.
// <lg: plain document scroll, as before, so the browser chrome can collapse and the floating bottom nav behaves the same.
//
// Variants: "page" (padded scroller), "flush" (scroller without padding, for pages that bring their own), "fill".
// Props: sidebar (StaffSidebar props), header (AppHeader props), banner (between header and frame), floating (toasts etc.),
//        aside (e.g. the Assistant panel, stays fixed beside the frame), asideOpen (adds the gap while it is open).
const AppShell = ({ sidebar, header, banner = null, floating = null, aside = null, asideOpen = false, variant = 'page', children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const scrollerRef = useRef(null);
  const { pathname, search } = useLocation();
  const view = new URLSearchParams(search).get('view');

  // New page or dashboard view -> start at the top (the window scrolls on mobile, the frame's scroller on desktop).
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [pathname, view]);

  const fill = variant === 'fill';
  const padded = variant === 'page';

  return (
    <CommandPaletteProvider>
    <div className={`app-shell min-h-screen bg-surface-sidebar lg:h-dvh lg:overflow-hidden ${fill ? 'h-dvh overflow-hidden' : ''}`}>
      <StaffSidebar {...sidebar} onCollapseChange={setCollapsed} />

      <div className={`app-shell-main ${collapsed ? 'lg:ml-16' : 'lg:ml-60'} transition-all duration-200 flex flex-col lg:h-dvh ${fill ? 'h-dvh' : ''}`}>
        <AppHeader {...header} />
        {banner}
        {floating}

        <div className={`relative z-0 flex ${asideOpen ? 'gap-2 sm:gap-3' : ''} ${fill ? 'flex-1 min-h-0' : 'flex-1 min-h-[calc(100dvh-48px)] lg:min-h-0'}`}>
          <main className="app-shell-frame flex-1 min-w-0 min-h-0 overflow-clip rounded-tl-2xl border-l border-t border-border bg-surface-dim">
            <ScrollerContext.Provider value={scrollerRef}>
              <div
                ref={scrollerRef}
                className={fill
                  ? 'h-full overflow-hidden'
                  : `content-scroll h-full lg:overflow-y-auto ${padded ? 'px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4' : ''}`}
              >
                {children}
              </div>
            </ScrollerContext.Provider>
          </main>
          {aside}
        </div>
      </div>
    </div>
    <NotificationToasts />
    </CommandPaletteProvider>
  );
};

export default AppShell;
