import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Icon from '../AppIcon';
import { fetchCustomersLightweight } from '../../services/api';

const CustomerAutocomplete = ({
  value,
  onChange,
  onSelect,
  branchId,
  searchBy = 'name',
  placeholder = searchBy === 'phone' ? '98XXXXXXXX' : 'Enter customer name',
  inputClassName,
  inputRef: externalRef,
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
      const { data } = await fetchCustomersLightweight(branchId);
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
        return c.full_name.toLowerCase().includes(term);
      })
      .slice(0, 8);
  }, [value, customers]);

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
        required
        placeholder={placeholder}
        className={inputClassName || "w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"}
      />

      {showSuggestions && (
        <div
          ref={listRef}
          className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1 max-h-48 overflow-y-auto"
        >
          {suggestions.map((customer, index) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => handleSelectCustomer(customer)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={`w-full text-left px-3 py-2 text-sm ${
                focusedIndex === index ? 'bg-gray-100' : ''
              } hover:bg-gray-50`}
            >
              <span className="font-medium text-text-primary">{customer.full_name}</span>
              {customer.phone && (
                <span className="ml-2 text-text-secondary">{customer.phone}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerAutocomplete;
