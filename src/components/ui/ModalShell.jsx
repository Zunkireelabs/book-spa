import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// The one full-screen popup frame: portalled to <body> so the dim + blur cover the sidebar, header and any side panel
// (a plain `fixed` overlay inside the page only covers its own stacking context). Same frosted backdrop and z token as
// Checkout. Esc calls onClose (unless an open CustomSelect list owns the key); focus moves in on open and returns on close.
export const MODAL_BACKDROP_CLASS = 'fixed inset-0 z-modal-overlay modal-backdrop-frost flex items-center justify-center p-4';

const ModalShell = ({ onClose, closeOnEscape = true, className = 'max-w-md', children, ...rest }) => {
  const frameRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement;
    const frame = frameRef.current;
    if (frame && !frame.contains(document.activeElement)) frame.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape' || !closeOnEscape) return;
      if (frame?.querySelector('[role="listbox"]')) return;
      e.stopPropagation();
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
    };
  }, [closeOnEscape]);

  return createPortal(
    <div className={MODAL_BACKDROP_CLASS} role="dialog" aria-modal="true" tabIndex={-1} ref={frameRef} {...rest}>
      <div className={`bg-surface rounded-spa-lg spa-shadow-modal w-full animate-fade-in outline-none ${className}`}>
        {children}
      </div>
    </div>,
    document.body
  );
};

export default ModalShell;
