import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useAuth } from './AuthContext';

// "Book anyway" (ZNLY-100): when a booking writer is refused by the staff-availability rule with an OVERRIDABLE code
// (off shift, break, blocked, other branch), a manager/admin is asked for a reason and the write is repeated with it.
// Staff, and the never-overridable codes (leave, overlap), get the original error back untouched.
const AvailabilityOverrideContext = createContext(null);

export const AvailabilityOverrideProvider = ({ children }) => {
  const { profile } = useAuth();
  const canOverride = profile?.role === 'manager' || profile?.role === 'admin';
  const [prompt, setPrompt] = useState(null);   // { message, resolve }
  const promptRef = useRef(null);

  const ask = useCallback((message) => new Promise((resolve) => {
    const next = { message, resolve };
    promptRef.current = next;
    setPrompt(next);
  }), []);

  const settle = useCallback((reason) => {
    const current = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    current?.resolve(reason);
  }, []);

  // run(overrideReason) must call the writer; returns the writer's { data, error }.
  const guard = useCallback(async (run) => {
    const first = await run(undefined);
    const err = first?.error;
    if (!err?.overridable || !canOverride) return first;
    const reason = await ask(err.message);
    if (!reason) return { data: null, error: { ...err, cancelled: true } };  // keeps the refusal message
    const second = await run(reason);
    return { ...second, overrideReason: reason };
  }, [ask, canOverride]);

  const value = useMemo(() => ({ guard, canOverride }), [guard, canOverride]);

  return (
    <AvailabilityOverrideContext.Provider value={value}>
      {children}
      {prompt && (
        <ConfirmDialog
          title="Book anyway?"
          message={`${prompt.message}. You can still go ahead; the reason is saved on the booking's history with your name.`}
          confirmLabel="Book anyway"
          confirmVariant="primary"
          tone="warning"
          reasonPlaceholder="e.g. Regular client asked for her; she agreed to take lunch later"
          onConfirm={(reason) => settle(reason)}
          onClose={() => settle(null)}
        />
      )}
    </AvailabilityOverrideContext.Provider>
  );
};

// Fallback keeps components that render outside the provider (tests, public pages) working: no override, plain result.
export const useAvailabilityGuard = () => useContext(AvailabilityOverrideContext) || { guard: (run) => run(undefined), canOverride: false };
