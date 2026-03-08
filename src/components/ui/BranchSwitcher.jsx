import React from 'react';
import Icon from '../AppIcon';
import { useBranch } from '../../contexts/BranchContext';

const BranchSwitcher = () => {
  const { branchId, branchName, branches, isAdmin, switchBranch } = useBranch();

  // Admin: show dropdown to switch branches
  if (isAdmin && branches.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-pink-100 text-pink-700 whitespace-nowrap">
          Platform Admin
        </span>
        <Icon name="Building2" size={16} className="text-text-secondary" />
        <div className="relative">
          <select
            value={branchId || ''}
            onChange={(e) => switchBranch(e.target.value)}
            className="appearance-none bg-background border border-border rounded-spa px-3 py-1.5 pr-8 font-body font-body-medium text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast cursor-pointer"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{!b.is_active ? ' (Inactive)' : ''}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <Icon name="ChevronDown" size={14} className="text-text-secondary" />
          </div>
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
