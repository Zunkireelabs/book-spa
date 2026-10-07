import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Guards the booking view's X button — a mis-tap on the Professional/Time/Confirm step
// otherwise drops the customer straight back to the profile page. Every selection
// (services, professional, date/time, customer info) lives on ProviderProfileFlow, not
// here, so closing never loses it — only the step position resets. Copy says that.
const DiscardDialog = ({ onCancel, onConfirm }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="zn-scope fixed inset-0 z-modal-overlay flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--zn-overlay)]" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Leave booking?"
        className="relative w-full max-w-sm bg-[var(--zn-card)] rounded-[var(--zn-radius-lg)] shadow-[0_4px_24px_rgba(35,33,29,0.18)] p-6"
      >
        <h2 className="font-medium text-lg text-[var(--zn-foreground)]">Leave booking?</h2>
        <p className="mt-2 text-sm text-[var(--zn-muted-foreground)]">
          Your selected services and professional are kept — you'll return to the services page.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-[var(--zn-radius-md)] px-4 py-2 text-sm font-medium bg-[var(--zn-primary)] hover:bg-[var(--zn-primary-hover)] text-[var(--zn-primary-foreground)]"
          >
            Keep booking
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-[var(--zn-radius-md)] px-4 py-2 text-sm font-medium border border-[var(--zn-border)] text-[var(--zn-foreground)] hover:bg-[var(--zn-muted)]"
          >
            Leave
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DiscardDialog;
