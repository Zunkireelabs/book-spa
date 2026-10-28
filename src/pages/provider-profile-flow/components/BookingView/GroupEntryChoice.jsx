import React from 'react';
import Icon from '../../../../components/AppIcon';

const OptionCard = ({ icon, title, subtitle, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-4 p-5 border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] text-left transition-colors hover:border-[var(--zn-primary-soft)] hover:bg-[var(--zn-primary-tint)]"
  >
    <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
      <Icon name={icon} size={22} />
    </div>
    <div className="min-w-0">
      <p className="font-medium text-base text-[var(--zn-foreground)]">{title}</p>
      <p className="text-sm text-[var(--zn-muted-foreground)]">{subtitle}</p>
    </div>
  </button>
);

// Fresha-style entry fork, shown only when GROUP_BOOKING_ENABLED is on — solo
// booking stays the one-tap default everywhere else; this screen only exists
// to offer the second path without touching the solo flow's own entry point.
const GroupEntryChoice = ({ onChooseSolo, onChooseGroup, onClose }) => (
  <div className="zn-scope min-h-screen bg-[var(--zn-background)] flex items-center justify-center px-4">
    <div className="w-full max-w-md">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-normal text-2xl text-[var(--zn-foreground)]">Select an option</h1>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-10 h-10 rounded-full border border-[var(--zn-border)] bg-[var(--zn-card)] flex items-center justify-center hover:border-[var(--zn-foreground)]/40"
        >
          <Icon name="X" size={18} className="text-[var(--zn-foreground)]" />
        </button>
      </div>

      <div className="space-y-3">
        <OptionCard
          icon="User"
          title="Book an appointment"
          subtitle="Just for you"
          onClick={onChooseSolo}
        />
        <OptionCard
          icon="Users"
          title="Book group appointment"
          subtitle="For yourself and others"
          onClick={onChooseGroup}
        />
      </div>
    </div>
  </div>
);

export default GroupEntryChoice;
