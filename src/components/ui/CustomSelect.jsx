import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Icon from '../AppIcon';

const SIZE_CLASSES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-3 text-sm',
};

const CustomSelect = ({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  disabled = false,
  className = '',
  size = 'md',
  error = false,
  valueClassName = '',
  searchable = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const listRef = useRef(null);
  const searchInputRef = useRef(null);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  // Filter options when searchable
  const filteredOptions = useMemo(() => {
    if (!searchable || !searchTerm.trim()) return options;
    const term = searchTerm.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(term));
  }, [options, searchTerm, searchable]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Reset search term and focused index when opening/closing
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      const idx = filteredOptions.findIndex((opt) => String(opt.value) === String(value));
      setFocusedIndex(idx >= 0 ? idx : 0);
      // Auto-focus search input when searchable
      if (searchable) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, value, searchable]);

  // Reset focused index when filtered options change
  useEffect(() => {
    if (isOpen && searchable) {
      setFocusedIndex(filteredOptions.length > 0 ? 0 : -1);
    }
  }, [filteredOptions, isOpen, searchable]);

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && listRef.current && focusedIndex >= 0) {
      const items = listRef.current.children;
      if (items[focusedIndex]) {
        items[focusedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex, isOpen]);

  const handleSelect = useCallback(
    (optionValue) => {
      onChange(optionValue);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (disabled) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
        case 'Enter':
          e.preventDefault();
          if (isOpen && focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
            handleSelect(filteredOptions[focusedIndex].value);
          } else if (!isOpen) {
            setIsOpen(true);
          }
          break;
        case ' ':
          if (!searchable || !isOpen) {
            e.preventDefault();
            if (isOpen && focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
              handleSelect(filteredOptions[focusedIndex].value);
            } else {
              setIsOpen(true);
            }
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            setFocusedIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (isOpen) {
            setFocusedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        default:
          break;
      }
    },
    [disabled, isOpen, focusedIndex, filteredOptions, handleSelect, searchable]
  );

  const toggleOpen = () => {
    if (!disabled) setIsOpen(!isOpen);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`
          flex items-center justify-between gap-2 w-full
          border ${error ? 'border-error' : 'border-border'} rounded-spa bg-surface
          font-body font-body-normal
          focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
          disabled:opacity-50 disabled:cursor-not-allowed
          spa-transition-fast cursor-pointer
          ${SIZE_CLASSES[size] || SIZE_CLASSES.md}
          ${className}
        `}
      >
        <span
          className={`truncate ${
            !selectedOption
              ? 'text-text-secondary'
              : valueClassName || 'text-text-primary'
          }`}
        >
          {displayLabel}
        </span>
        <Icon
          name="ChevronDown"
          size={14}
          className={`text-text-secondary flex-shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 w-full min-w-[120px] bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1 max-h-60 overflow-hidden flex flex-col"
          role="listbox"
        >
          {/* Search input */}
          {searchable && (
            <div className="px-2 py-1.5 border-b border-gray-100 flex-shrink-0">
              <div className="relative">
                <Icon name="Search" size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search..."
                  className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <div ref={listRef} className="overflow-y-auto flex-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-text-secondary text-center">
                No results found
              </div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = String(value) === String(opt.value);
                const isFocused = focusedIndex === index;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={`w-full text-left px-3 py-2 text-sm ${
                      isFocused
                        ? 'bg-gray-100'
                        : isSelected
                          ? 'bg-gray-50'
                          : ''
                    } ${
                      isSelected ? 'text-primary font-medium' : 'text-gray-700'
                    } hover:bg-gray-50`}
                  >
                    {opt.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
