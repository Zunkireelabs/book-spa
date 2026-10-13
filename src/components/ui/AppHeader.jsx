import React from 'react';
import Icon from '../AppIcon';
import BranchSwitcher from './BranchSwitcher';
import NotificationBell from './NotificationBell';
import ProfileMenu from './ProfileMenu';
import RealtimeStatus from './RealtimeStatus';

// Shared top bar for the manager and staff dashboards. Per-dashboard bits come in as props:
// `leftExtra` (e.g. the period filter), `onToggleAssistant` (omit to hide the Assistant button)
// and the notification props passed straight to NotificationBell.
const AppHeader = ({
  realtimeStatus,
  leftExtra = null,
  onToggleAssistant,
  assistantOpen = false,
  notifications,
  unreadCount,
  onMarkAllRead,
  onItemClick,
}) => (
  <header className="bg-surface-sidebar sticky top-0 z-header flex-shrink-0">
    <div className="h-12 px-3 sm:px-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <BranchSwitcher />
        {leftExtra}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <RealtimeStatus status={realtimeStatus} />
        {onToggleAssistant && (
          <button
            type="button"
            onClick={onToggleAssistant}
            aria-pressed={assistantOpen}
            aria-label="Assistant"
            className={`h-[var(--control-h)] flex items-center gap-2 px-2.5 sm:px-3 border rounded-spa-lg spa-transition-fast ${
              assistantOpen
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-transparent border-border text-text-primary hover:bg-black/[0.04]'
            }`}
          >
            <Icon name="Sparkles" size={16} className="text-primary" />
            <span className="hidden sm:inline text-sm font-body font-body-medium">Assistant</span>
          </button>
        )}
        <div className="[&>button]:h-[var(--control-h)] [&>button]:w-[var(--control-h)] [&>button]:p-0 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:rounded-spa-lg [&>button]:text-text-secondary [&>button:hover]:bg-black/[0.04]">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkAllRead={onMarkAllRead}
            onItemClick={onItemClick}
          />
        </div>
        <ProfileMenu />
      </div>
    </div>
  </header>
);

export default AppHeader;
