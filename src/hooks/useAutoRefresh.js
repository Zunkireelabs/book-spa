import { useEffect, useRef } from 'react';

/**
 * Polls `refetchFn` on a fixed interval, skipping ticks while the tab is
 * backgrounded (`document.hidden`) so we don't burn requests on an
 * unattended tab. Resumes polling on the next tick after the tab regains
 * focus — it does not force an immediate refetch on focus.
 */
export function useAutoRefresh(refetchFn, { intervalMs, enabled = true } = {}) {
  const refetchRef = useRef(refetchFn);
  refetchRef.current = refetchFn;

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    const tick = () => {
      if (document.hidden) return;
      refetchRef.current();
    };
    const interval = setInterval(tick, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs, enabled]);
}
