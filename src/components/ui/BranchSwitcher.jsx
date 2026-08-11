import React, { useState, useRef, useEffect } from 'react';
import Icon from '../AppIcon';
import { useBranch, OVERALL_BRANCH_ID } from 'contexts/BranchContext';

const BranchSwitcher = () => {
  const { branchId, branchName, branches, isAdmin, isManager, isOverall, switchBranch } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedBranch = branches.find(b => b.id === branchId);
  const selectedName = isOverall ? 'Overall' : (selectedBranch?.name || 'Select Branch');

  // Close dropdown on click outside
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

  // Admin: show dropdown to switch branches
  if (isAdmin && branches.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-pink-100 text-pink-700 whitespace-nowrap">
          Platform Admin
        </span>
        <Icon name="Building2" size={16} className="hidden sm:inline text-text-secondary" />
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-spa hover:border-gray-300 transition-colors cursor-pointer"
          >
            <span className="font-body font-body-medium text-sm text-text-primary whitespace-nowrap">
              {selectedName}
            </span>
            <Icon name="ChevronDown" size={14} className={`text-text-secondary flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          {isOpen && (
            <div className="absolute left-0 top-full mt-1 min-w-full bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
              {/* Overall — org-wide aggregate (read-only, no booking creation) */}
              <button
                type="button"
                onClick={() => {
                  switchBranch(OVERALL_BRANCH_ID);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 whitespace-nowrap ${
                  isOverall ? 'text-primary font-medium bg-gray-50' : 'text-gray-700'
                }`}
              >
                <Icon name="Globe" size={14} className="flex-shrink-0" />
                Overall
              </button>
              <div className="my-1 h-px bg-gray-100" />
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    switchBranch(b.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 whitespace-nowrap ${
                    !isOverall && branchId === b.id ? 'text-primary font-medium bg-gray-50' : 'text-gray-700'
                  }`}
                >
                  {b.name}{!b.is_active ? ' (Inactive)' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Manager with 2+ accessible branches: plain switcher, no "Overall" sentinel
  if (isManager && branches.length > 1) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-spa hover:border-gray-300 transition-colors cursor-pointer"
        >
          <Icon name="Building2" size={16} className="text-text-secondary" />
          <span className="font-body font-body-medium text-sm text-text-primary whitespace-nowrap">
            {selectedName}
          </span>
          <Icon name="ChevronDown" size={14} className={`text-text-secondary flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="absolute left-0 top-full mt-1 min-w-full bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
            {branches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  switchBranch(b.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 whitespace-nowrap ${
                  branchId === b.id ? 'text-primary font-medium bg-gray-50' : 'text-gray-700'
                }`}
              >
                {b.name}{!b.is_active ? ' (Inactive)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Manager (single branch)/Staff: show static branch label (non-clickable)
  if (branchName) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-spa border border-border">
        <Icon name="Building2" size={16} className="text-text-secondary" />
        <span className="font-body font-body-medium text-sm text-text-primary">{branchName}</span>
      </div>
    );
  }

  return null;
};

export default BranchSwitcher;
