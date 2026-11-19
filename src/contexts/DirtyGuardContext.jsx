import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ui/ConfirmDialog';

// A page with unsaved changes registers itself with useDirtyGuard(dirty, count). While it is dirty:
//  - the browser asks before a reload / tab close (beforeunload),
//  - every in-app link click (the sidebar, header, any <a href="/...">) is turned into one "Leave without saving?" dialog,
//  - code-driven navigation that goes through useGuardedNavigate() (profile menu, command palette, the page's own buttons) does too.
// react-router 6.0 has no navigation blocker, so this is a small context rather than a router upgrade.
const DirtyGuardContext = createContext(null);

export const DirtyGuardProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const guardRef = useRef({ dirty: false, count: 0 });
  const [pending, setPending] = useState(null); // { go: () => void, count }

  const setGuard = useCallback((dirty, count = 0) => { guardRef.current = { dirty: !!dirty, count }; }, []);

  /** Run `go` now, or after the person confirms leaving when a page is dirty. */
  const requestLeave = useCallback((go) => {
    if (guardRef.current.dirty) setPending({ go, count: guardRef.current.count });
    else go();
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e) => { if (guardRef.current.dirty) { e.preventDefault(); e.returnValue = ''; } };
    const onClick = (e) => {
      if (!guardRef.current.dirty || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
      const a = e.target.closest?.('a[href]');
      const href = a?.getAttribute('href');
      if (!a || !href || !href.startsWith('/') || a.target === '_blank') return;
      if (href.split('?')[0] === location.pathname && !href.includes('?')) return;
      e.preventDefault(); e.stopPropagation();
      requestLeave(() => navigate(href));
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); document.removeEventListener('click', onClick, true); };
  }, [location.pathname, navigate, requestLeave]);

  const value = useMemo(() => ({ setGuard, requestLeave }), [setGuard, requestLeave]);

  return (
    <DirtyGuardContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          title="Leave without saving?"
          message={`You have ${pending.count} unsaved change${pending.count === 1 ? '' : 's'}. They will be lost.`}
          confirmLabel="Leave"
          requireReason={false}
          onConfirm={() => { const go = pending.go; guardRef.current = { dirty: false, count: 0 }; setPending(null); go(); }}
          onClose={() => setPending(null)}
        />
      )}
    </DirtyGuardContext.Provider>
  );
};

/** Mark the current page dirty (or clean). Clears itself when the page unmounts. */
export function useDirtyGuard(dirty, count = 0) {
  const ctx = useContext(DirtyGuardContext);
  useEffect(() => {
    ctx?.setGuard(dirty, count);
    return () => ctx?.setGuard(false, 0);
  }, [ctx, dirty, count]);
}

/** navigate() that asks first when the page has unsaved changes. Same call shape as useNavigate()'s function. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  const ctx = useContext(DirtyGuardContext);
  return useCallback((to, opts) => {
    if (ctx) ctx.requestLeave(() => navigate(to, opts));
    else navigate(to, opts);
  }, [ctx, navigate]);
}
