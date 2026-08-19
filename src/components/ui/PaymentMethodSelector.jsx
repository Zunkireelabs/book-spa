import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import { buildPaymentMethodTree } from '../../services/paymentMethods';

const SIZE_CLASSES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-3 text-sm',
};

// Hierarchical payment-method picker: top-level methods first, click a group (e.g.
// Card) to open a flyout submenu to its right showing the sub-options (Mastercard,
// Visa) — pick one and everything closes with the leaf value active. Replaces a
// flat CustomSelect so grouped methods don't get flattened into one long list.
//
// The flyout is rendered via a portal to document.body and positioned from the
// triggering row's own bounding rect — it must NOT be a normal descendant of the
// scrollable dropdown box, since that box's overflow-y-auto clips any content
// (like a right-side flyout) that extends past its edges, per the CSS rule that
// forces overflow-x to clip once overflow-y isn't `visible`.
const PaymentMethodSelector = ({
  value,
  onChange,
  paymentMethods,
  extraLeaf = null,
  placeholder = 'Select...',
  size = 'md',
  className = '',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [submenuPos, setSubmenuPos] = useState(null); // { top, left }
  const containerRef = useRef(null);
  const flyoutRef = useRef(null);

  const tree = useMemo(() => {
    const base = buildPaymentMethodTree(paymentMethods);
    const extras = Array.isArray(extraLeaf) ? extraLeaf.filter(Boolean) : (extraLeaf ? [extraLeaf] : []);
    return extras.length > 0 ? [...base, ...extras] : base;
  }, [paymentMethods, extraLeaf]);

  const selectedLabel = useMemo(() => {
    for (const item of tree) {
      if (String(item.value) === String(value)) return item.label;
      const sub = (item.subMethods || []).find((s) => String(s.value) === String(value));
      if (sub) return sub.label;
    }
    return null;
  }, [tree, value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      const insideMain = containerRef.current && containerRef.current.contains(e.target);
      const insideFlyout = flyoutRef.current && flyoutRef.current.contains(e.target);
      if (!insideMain && !insideFlyout) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      // Always re-enter with no submenu open next time it opens.
      const t = setTimeout(() => setOpenSubmenu(null), 200);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const toggleOpen = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const selectValue = (v) => {
    onChange(v);
    setIsOpen(false);
    setOpenSubmenu(null);
  };

  const toggleSubmenu = (item, e) => {
    if (openSubmenu === item.value) {
      setOpenSubmenu(null);
      return;
    }
    const rowRect = e.currentTarget.getBoundingClientRect();
    setSubmenuPos({ top: rowRect.top, left: rowRect.right + 4 });
    setOpenSubmenu(item.value);
  };

  const activeGroupItem = tree.find((item) => item.value === openSubmenu);

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={`
          flex items-center justify-between gap-2 w-full
          border border-border rounded-spa bg-surface
          font-body font-body-normal
          focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
          disabled:opacity-50 disabled:cursor-not-allowed
          spa-transition-fast cursor-pointer
          ${SIZE_CLASSES[size] || SIZE_CLASSES.md}
          ${className}
        `}
      >
        <span className={`truncate ${selectedLabel ? 'text-text-primary' : 'text-text-secondary'}`}>
          {selectedLabel || placeholder}
        </span>
        <Icon
          name="ChevronDown"
          size={14}
          className={`text-text-secondary flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 w-48 max-w-[80vw] bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown max-h-72 overflow-y-auto p-1"
        >
          {tree.map((item) => {
            const hasSub = (item.subMethods || []).length > 0;
            const isSubmenuOpen = openSubmenu === item.value;
            const isSelected = !hasSub && String(value) === String(item.value);
            const activeSub = hasSub && (item.subMethods || []).some((s) => String(s.value) === String(value));
            return (
              <button
                key={item.value}
                type="button"
                onClick={(e) => (hasSub ? toggleSubmenu(item, e) : selectValue(item.value))}
                className={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-spa text-sm text-left spa-transition-fast hover:bg-background ${
                  isSelected || activeSub || isSubmenuOpen ? 'text-primary font-body-medium bg-primary/5' : 'text-text-primary'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {hasSub ? (
                  <Icon name="ChevronRight" size={13} className="text-text-secondary flex-shrink-0" />
                ) : isSelected ? (
                  <Icon name="Check" size={13} className="text-primary flex-shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {isOpen && openSubmenu && activeGroupItem && submenuPos &&
        createPortal(
          <div
            ref={flyoutRef}
            className="fixed z-notification w-32 max-w-[60vw] bg-surface border border-border rounded-spa shadow-spa-elevated p-1 animate-fade-in"
            style={{ top: submenuPos.top, left: submenuPos.left }}
          >
            {activeGroupItem.subMethods.map((sub) => {
              const isSubSelected = String(value) === String(sub.value);
              return (
                <button
                  key={sub.value}
                  type="button"
                  onClick={() => selectValue(sub.value)}
                  className={`w-full flex items-center justify-between gap-1 px-2 py-1 rounded-spa text-sm text-left spa-transition-fast hover:bg-background ${
                    isSubSelected ? 'text-primary font-body-medium bg-primary/5' : 'text-text-primary'
                  }`}
                >
                  <span className="truncate">{sub.label}</span>
                  {isSubSelected && <Icon name="Check" size={12} className="text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};

export default PaymentMethodSelector;
