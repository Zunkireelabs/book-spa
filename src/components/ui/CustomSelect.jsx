import React, { useState, useRef, useEffect, useCallback } from 'react';
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef(null);
  const listRef = useRef(null);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

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

  // Reset focused index when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((opt) => String(opt.value) === String(value));
      setFocusedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, options, value]);

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
        case ' ':
          e.preventDefault();
          if (isOpen && focusedIndex >= 0) {
            handleSelect(options[focusedIndex].value);
          } else {
            setIsOpen(true);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            setFocusedIndex((prev) => Math.min(prev + 1, options.length - 1));
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
    [disabled, isOpen, focusedIndex, options, handleSelect]
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
          ref={listRef}
          className="absolute left-0 top-full mt-1 w-full min-w-[120px] bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1 max-h-60 overflow-y-auto"
          role="listbox"
        >
          {options.map((opt, index) => {
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
          })}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
