import React, { useState, useRef, useEffect } from 'react';
import Icon from '../AppIcon';
import { useBranch } from '../../contexts/BranchContext';

const BranchSwitcher = () => {
  const { branchId, branchName, branches, isAdmin, switchBranch } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedBranch = branches.find(b => b.id === branchId);
  const selectedName = selectedBranch?.name || 'Select Branch';

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
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-pink-100 text-pink-700 whitespace-nowrap">
          Platform Admin
        </span>
        <Icon name="Building2" size={16} className="text-text-secondary" />
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
      </div>
    );
  }

  // Manager/Staff: show static branch label (non-clickable)
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
