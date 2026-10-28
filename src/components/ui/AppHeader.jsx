import React from 'react';
import Icon from '../AppIcon';
import BranchSwitcher from './BranchSwitcher';
import NotificationBell from './NotificationBell';
import ProfileMenu from './ProfileMenu';
import RealtimeStatus from './RealtimeStatus';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useCommandPalette } from '../CommandPalette/useCommandPalette';

// Shared top bar for the manager and staff dashboards. Per-dashboard bits come in as props:
// `leftExtra` (e.g. the period filter), `onToggleAssistant` (omit to hide the Assistant button)
// and the notification props passed straight to NotificationBell.
const MobileSearchButton = () => {
  const { openPalette } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Search"
      className="lg:hidden h-[var(--control-h)] w-[var(--control-h)] flex items-center justify-center rounded-spa-lg text-text-secondary hover:bg-black/[0.04]"
    >
      <Icon name="Search" size={18} />
    </button>
  );
};

// The bell reads the shared NotificationsProvider feed. A page may pass `notifications` to add its own rows on top
// (the manager dashboard merges its pending-discount rows); `unreadCount` then replaces the provider's count.
const AppHeader = ({
  realtimeStatus,
  leftExtra = null,
  onToggleAssistant,
  assistantOpen = false,
  notifications,
  unreadCount,
  onMarkAllRead,
  onItemClick,
}) => {
  const ctx = useNotifications();
  const feed = notifications || ctx.items;
  const unread = notifications ? unreadCount : ctx.unreadCount;
  return (
  <header className="bg-surface-sidebar sticky top-0 z-header flex-shrink-0">
    <div className="h-12 px-3 sm:px-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <BranchSwitcher />
        {leftExtra}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <RealtimeStatus status={realtimeStatus} />
        <MobileSearchButton />
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
        {(
          <div className="[&>button]:h-[var(--control-h)] [&>button]:w-[var(--control-h)] [&>button]:p-0 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:rounded-spa-lg [&>button]:text-text-secondary [&>button:hover]:bg-black/[0.04]">
            <NotificationBell
              notifications={feed}
              unreadCount={unread}
              totalUnread={notifications ? undefined : ctx.unreadCount}
              role={ctx.role}
              branches={ctx.branches}
              inboxPath={ctx.inboxPath}
              onMarkAllRead={onMarkAllRead || ctx.markAllRead}
              onItemClick={onItemClick || ctx.openItem}
            />
          </div>
        )}
        <ProfileMenu />
      </div>
    </div>
  </header>
  );
};

export default AppHeader;
