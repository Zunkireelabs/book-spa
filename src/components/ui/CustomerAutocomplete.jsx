import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Icon from '../AppIcon';
import { fetchCustomersLightweight } from 'services/api';

// Color tokens for the inline membership pill (mirrors MembershipsPanel).
const MEMBERSHIP_PILL_STYLES = {
  active:   'bg-success/10 text-success',
  lapsed:   'bg-warning/10 text-warning',
  pending:  'bg-amber-100 text-amber-800',
  depleted: 'bg-gray-100 text-gray-600',
};

const CustomerAutocomplete = ({
  value,
  onChange,
  onSelect,
  branchId,
  searchBy = 'name',
  placeholder = searchBy === 'phone' ? '98XXXXXXXX'
    : searchBy === 'email' ? 'Enter customer email'
    : searchBy === 'any' ? 'Search by name, phone or email…'
    : 'Enter customer name',
  inputClassName,
  inputRef: externalRef,
  onBlur,
  required = false,
}) => {
  const [customers, setCustomers] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;

  // Fetch customers once on mount / when branchId changes
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await fetchCustomersLightweight(branchId);
      if (error) {
        console.error('[CustomerAutocomplete] Failed to load customers:', error.message || error);
        return;
      }
      if (!cancelled && data) setCustomers(data);
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  // Filter suggestions client-side
  const suggestions = useMemo(() => {
    if (!value || value.trim().length < 2) return [];
    const term = value.toLowerCase();
    return customers
      .filter((c) => {
        if (searchBy === 'phone') return c.phone && c.phone.includes(term);
        if (searchBy === 'email') return c.email && c.email.toLowerCase().includes(term);
        if (searchBy === 'any') {
          // Phone is compared digits-only on both sides so a typed local number
          // still matches a stored international one — "9841221840" finds
          // "+977 9841221840", which a plain substring test would miss.
          const digits = term.replace(/\D/g, '');
          const phoneHit = digits.length >= 2
            && c.phone
            && c.phone.replace(/\D/g, '').includes(digits);
          return (
            (c.full_name && c.full_name.toLowerCase().includes(term))
            || (c.email && c.email.toLowerCase().includes(term))
            || phoneHit
          );
        }
        return c.full_name.toLowerCase().includes(term);
      })
      .slice(0, 8);
    // searchBy belongs in the deps: without it, switching mode kept the old
    // filter's results until the query changed.
  }, [value, customers, searchBy]);

  // Show/hide suggestions based on matches
  useEffect(() => {
    setShowSuggestions(suggestions.length > 0);
    setFocusedIndex(-1);
  }, [suggestions]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll focused item into view
  useEffect(() => {
    if (listRef.current && focusedIndex >= 0) {
      const items = listRef.current.children;
      if (items[focusedIndex]) {
        items[focusedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  const handleSelectCustomer = useCallback((customer) => {
    onSelect(customer);
    setShowSuggestions(false);
  }, [onSelect]);

  const handleKeyDown = (e) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        if (focusedIndex >= 0 && focusedIndex < suggestions.length) {
          e.preventDefault();
          handleSelectCustomer(suggestions[focusedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        onBlur={onBlur}
        required={required}
        placeholder={placeholder}
        className={inputClassName || "w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"}
      />

      {showSuggestions && (
        <div
          ref={listRef}
          className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg z-dropdown py-1 max-h-48 overflow-y-auto"
        >
          {suggestions.map((customer, index) => {
            const m = customer.primaryMembership;
            const pillClass = m ? (MEMBERSHIP_PILL_STYLES[m.status] || MEMBERSHIP_PILL_STYLES.pending) : '';
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => handleSelectCustomer(customer)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                  focusedIndex === index ? 'bg-gray-100' : ''
                } hover:bg-gray-50`}
              >
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-medium text-text-primary">{customer.full_name}</span>
                  {customer.phone && (
                    <span className="ml-2 text-text-secondary">{customer.phone}</span>
                  )}
                  {/* In 'any' mode the match may have been on email, so show it —
                      otherwise a row matched by email looks like a false hit. */}
                  {searchBy === 'any' && customer.email && (
                    <span className="ml-2 text-text-tertiary text-xs">{customer.email}</span>
                  )}
                </span>
                {m && (
                  <span
                    title={[m.tierName, m.membershipNumber, m.status !== 'active' ? m.status : null].filter(Boolean).join(' · ')}
                    className={`flex-shrink-0 max-w-[6.5rem] truncate inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium tracking-wide ${pillClass}`}
                  >
                    {m.tierName || m.membershipNumber}
                    {m.status !== 'active' && ` · ${m.status}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomerAutocomplete;
