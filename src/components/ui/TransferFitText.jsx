import React, { useRef, useState, useLayoutEffect } from 'react';

// Shows the longest of `candidates` (longest first) that fits, by measuring each in a hidden twin of the text, never by CSS
// truncation, so a time is never cut mid-way. Shows nothing when none fit. `getRoom` returns the pixels available; by default
// that is the width of this element's own slot. Re-measures when the slot resizes.
const TransferFitText = ({ candidates, getRoom, className = '' }) => {
  const slotRef = useRef(null);
  const meterRef = useRef(null);
  const [pick, setPick] = useState(0);
  const key = candidates.join('|');

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const meter = meterRef.current;
    if (!slot || !meter) return undefined;
    let alive = true;
    const fit = () => {
      if (!alive) return;
      const room = getRoom ? getRoom(slot) : slot.getBoundingClientRect().width;
      let chosen = candidates.length;
      for (let i = 0; i < candidates.length; i++) {
        meter.textContent = candidates[i];
        if (meter.getBoundingClientRect().width <= room + 0.5) { chosen = i; break; }
      }
      setPick(chosen);
    };
    fit();
    // text widths change once the web font arrives, so measure again then
    if (document.fonts?.ready) document.fonts.ready.then(fit);
    if (typeof ResizeObserver === 'undefined') return () => { alive = false; };
    const ro = new ResizeObserver(fit);
    ro.observe(slot);
    const cell = getRoom ? slot.closest('[data-col-header]') : null;
    if (cell) ro.observe(cell);
    return () => { alive = false; ro.disconnect(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={slotRef} className={`relative whitespace-nowrap ${className}`}>
      {pick < candidates.length ? candidates[pick] : null}
      <span ref={meterRef} aria-hidden="true" className="absolute left-0 top-0 invisible pointer-events-none whitespace-nowrap" />
    </span>
  );
};

export default TransferFitText;
