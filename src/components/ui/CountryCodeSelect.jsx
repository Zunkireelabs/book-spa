import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import BottomSheet, { useMediaQuery } from './BottomSheet';
import { DIAL_CODES, countryFor, searchCountries, isoToFlag } from '../../utils/countries';

// Split a stored phone into { dial, national }. Nepal-centric heuristic:
// 10 or fewer digits is treated as a bare national number (default +977);
// longer values are matched against the longest known dial-code prefix.
export function parsePhone(raw, fallbackDial = '+977') {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return { dial: fallbackDial, national: '' };
  if (digits.length > 10) {
    for (const dial of DIAL_CODES) {
      const code = dial.slice(1);
      if (digits.startsWith(code) && digits.length - code.length >= 6) {
        return { dial, national: digits.slice(code.length) };
      }
    }
  }
  return { dial: fallbackDial, national: digits };
}

// Walk up from `el` to find the nearest ancestor that actually clips
// overflow — almost always the modal card itself (it sets overflow-y-auto
// directly on the card, not on some separate scroll wrapper). Used to keep
// the portaled panel visually confined to the card instead of spilling past
// its edge onto the backdrop behind it.
function getClippingAncestor(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

const CountryCodeSelect = ({ value = '+977', onChange, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [panelPos, setPanelPos] = useState(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const isPhone = useMediaQuery('(max-width: 767.98px)');
  const [pickedIso, setPickedIso] = useState(null); // remembers Canada vs US, Kazakhstan vs Russia (same dial)
  const selected = countryFor(value, pickedIso);

  const filtered = useMemo(() => searchCountries(search), [search]);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    if (isOpen && !isPhone) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isOpen, isPhone]);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      // desktop only: never pop the phone keyboard over the list (ZNLY-320 rule)
      if (!isPhone) setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const PANEL_WIDTH = 260;

  // Renders the panel via a portal to document.body (fixed-positioned from
  // the trigger's own coordinates) instead of as a CSS-absolute sibling, so
  // it's never clipped by a modal body's overflow-y-auto (which per the CSS
  // Overflow spec makes the browser compute overflow-x as auto too). left is
  // still clamped to the modal card's own bounds (not just the viewport, which
  // is usually much wider) so the panel stays visually confined to the card
  // instead of spilling out over the backdrop behind it.
  const toggle = () => {
    if (disabled) return;
    if (!isOpen && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      const openUpward = window.innerHeight - rect.bottom < 280;
      const clipper = getClippingAncestor(wrapRef.current);
      const bounds = clipper ? clipper.getBoundingClientRect() : { left: 0, right: window.innerWidth };
      const left = Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - PANEL_WIDTH - 8));
      setPanelPos({
        left,
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      });
    }
    setIsOpen((o) => !o);
  };

  const choose = (dial, iso) => {
    setPickedIso(iso);
    onChange?.(dial);
    setIsOpen(false);
  };

  const list = (
    <>
    {isPhone && (
      <div className="px-4 pt-4 pb-1 pr-14">
        <h3 className="font-heading font-heading-semibold text-[17px] leading-snug text-text-primary">Country</h3>
      </div>
    )}
    <div className={isPhone ? 'px-4 pt-2 pb-2 sticky top-0 bg-surface z-10' : 'p-2 border-b border-border'}>
      <div className="relative">
        <Icon name="Search" size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Country or code…"
          className={`w-full pl-7 pr-2 text-sm border border-border bg-surface ${isPhone ? 'h-10 rounded-spa' : 'py-1.5 rounded'} text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/30`}
        />
      </div>
    </div>
    <div className="overflow-y-auto flex-1 py-1">
      {filtered.length === 0 ? (
        <div className="px-3 py-3 text-sm text-text-secondary text-center">No results</div>
      ) : (
        filtered.map((c, i) => (
  <React.Fragment key={c.iso}>
    {i === 1 && filtered[0].iso === 'NP' && (
      <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-text-secondary">All countries</div>
    )}
          <button
            type="button"
            onClick={() => choose(c.dial, c.iso)}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${isPhone ? 'min-h-[48px]' : ''} spa-transition-fast ${
              c.iso === selected.iso ? 'bg-primary/5 text-primary font-body-medium' : 'text-text-primary hover:bg-background'
            }`}
          >
            <span className="text-base leading-none">{isoToFlag(c.iso)}</span>
            <span className="flex-1 truncate">{c.name}</span>
            <span className="text-text-secondary">{c.dial}</span>
            {c.iso === selected.iso && <Icon name="Check" size={16} className="flex-shrink-0 text-primary" />}
          </button>
  </React.Fragment>
        ))
      )}
    </div>
    </>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="field-text inline-flex flex-shrink-0 items-center justify-center gap-1 w-[88px] h-full px-2 py-2 text-sm border border-r-0 border-border rounded-l-spa bg-background text-text-primary hover:bg-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 spa-transition-fast"
      >
        <span className="text-base leading-none">{isoToFlag(selected.iso)}</span>
        <span className="font-body">{selected.dial}</span>
        <Icon
          name="ChevronDown"
          size={12}
          className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && !isPhone && panelPos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: panelPos.left, top: panelPos.top, bottom: panelPos.bottom, width: PANEL_WIDTH }}
          className="max-w-[calc(100vw-24px)] bg-surface border border-border rounded-spa shadow-spa-elevated z-popover flex flex-col max-h-[280px]"
        >
          {list}
        </div>,
        document.body
      )}
      {isPhone && (
        <BottomSheet isOpen={isOpen} title="Country" floatingClose onClose={() => setIsOpen(false)}>
          <div className="pb-4 flex flex-col max-h-[70vh]">{list}</div>
        </BottomSheet>
      )}
    </div>
  );
};

export default CountryCodeSelect;
