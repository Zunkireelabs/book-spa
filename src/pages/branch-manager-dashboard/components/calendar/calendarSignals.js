import { useEffect, useRef } from 'react';

// "Go to today" signal for the calendar (used by the ⌘K palette). An explicit CustomEvent rather than a faked keypress; if the calendar
// isn't mounted yet (the palette is navigating to it from another page) the request is remembered briefly and handled on mount.
const EVENT = 'calendar:go-today';
const PENDING_MS = 5000;
let pendingUntil = 0;

export const requestGoToday = () => {
  pendingUntil = Date.now() + PENDING_MS;
  window.dispatchEvent(new CustomEvent(EVENT));
};

export const useGoTodaySignal = (goToday) => {
  const ref = useRef(goToday);
  ref.current = goToday;
  useEffect(() => {
    const run = () => { pendingUntil = 0; ref.current(); };
    if (Date.now() < pendingUntil) run(); // requested just before this calendar mounted
    window.addEventListener(EVENT, run);
    return () => window.removeEventListener(EVENT, run);
  }, []);
};
