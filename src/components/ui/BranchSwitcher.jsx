import React, { useState, useRef, useCallback } from 'react';
import Icon from '../AppIcon';
import { useBranch, OVERALL_BRANCH_ID } from 'contexts/BranchContext';
import { useMenuNav } from './useMenuNav';

const TRIGGER_BASE = 'h-[var(--control-h)] flex items-center gap-2 px-2 -ml-2 rounded-spa-lg min-w-0';

// Workspace-style branch switcher. Admins get "Overall" + every branch, multi-branch managers
// get their accessible branches, single-branch managers and staff see the name as plain text.
const BranchSwitcher = () => {
  const { branchId, branchName, branches, isAdmin, isManager, isOverall, switchBranch } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const close = useCallback(() => setIsOpen(false), []);
  useMenuNav({ open: isOpen, onClose: close, menuRef, triggerRef });

  const withOverall = isAdmin && branches.length > 0;
  const switchable = withOverall || (isManager && branches.length > 1);
  const selectedName = isOverall ? 'Overall' : (branches.find((b) => b.id === branchId)?.name || branchName || 'Select branch');

  if (!switchable) {
    if (!branchName) return null;
    return (
      <div className={`${TRIGGER_BASE} cursor-default`}>
        <Icon name="Building2" size={16} className="hidden sm:block text-text-tertiary flex-shrink-0" />
        <span className="font-body font-body-medium text-sm text-text-primary truncate">{branchName}</span>
      </div>
    );
  }

  const choose = (id) => {
    switchBranch(id);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const rowBase = 'w-full h-9 flex items-center gap-2 px-2.5 rounded-spa text-left text-sm font-body text-text-primary hover:bg-black/[0.04] focus:bg-black/[0.04] focus:outline-none';

  return (
    <div className="relative min-w-0 flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`${TRIGGER_BASE} hover:bg-black/[0.04] ${isOpen ? 'bg-black/[0.04]' : ''} spa-transition-fast cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
      >
        <Icon name={isOverall ? 'Globe' : 'Building2'} size={16} className="hidden sm:block text-text-tertiary flex-shrink-0" />
        <span className="font-body font-body-medium text-sm text-text-primary truncate">{selectedName}</span>
        <Icon name="ChevronDown" size={14} className="text-text-tertiary flex-shrink-0" />
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Switch branch"
          className="absolute left-0 top-[calc(50%+32px)] min-w-[240px] bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-1.5"
        >
          {withOverall && (
            <>
              <button
                type="button"
                role="menuitem"
                aria-checked={isOverall}
                onClick={() => choose(OVERALL_BRANCH_ID)}
                className={`${rowBase} !h-auto py-2`}
              >
                <Icon name="Globe" size={16} className="text-text-tertiary flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm leading-tight">Overall</span>
                  <span className="block text-xs text-text-tertiary leading-tight mt-0.5">All branches · read-only</span>
                </span>
                {isOverall && <Icon name="Check" size={16} className="text-text-primary flex-shrink-0" />}
              </button>
              <div className="my-1.5 h-px bg-border" />
            </>
          )}
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-body font-body-medium uppercase tracking-wider text-text-tertiary">Branches</p>
          <div className="max-h-72 overflow-y-auto">
            {branches.map((b) => {
              const selected = !isOverall && branchId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="menuitem"
                  aria-checked={selected}
                  onClick={() => choose(b.id)}
                  className={`${rowBase} ${b.is_active ? '' : 'text-text-tertiary'}`}
                >
                  <span className="flex-1 min-w-0 truncate">{b.name}</span>
                  {!b.is_active && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-black/[0.05] text-text-tertiary flex-shrink-0">Inactive</span>
                  )}
                  {selected && <Icon name="Check" size={16} className="text-text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchSwitcher;
