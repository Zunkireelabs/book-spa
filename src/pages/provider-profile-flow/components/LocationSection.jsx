import React from 'react';
import Icon from '../../../components/AppIcon';

// sbal has exactly one branch — no branch-picker, no map, just the static details.
const LocationSection = ({ branch }) => (
  <div className="py-8">
    <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Location</h2>
    {!branch ? (
      <p className="text-sm text-[var(--zn-muted-foreground)]">Location details unavailable.</p>
    ) : (
      <div className="space-y-3 p-5 border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] bg-[var(--zn-card)] max-w-prose">
        <div className="flex items-start gap-2">
          <Icon name="MapPin" size={16} className="text-[var(--zn-primary)] shrink-0 mt-0.5" />
          <span className="text-sm text-[var(--zn-foreground)]">{branch.address || 'Address not set.'}</span>
        </div>
        {branch.phone && (
          <div className="flex items-center gap-2">
            <Icon name="Phone" size={16} className="text-[var(--zn-primary)] shrink-0" />
            <span className="text-sm text-[var(--zn-foreground)]">{branch.phone}</span>
          </div>
        )}
        {(branch.open_time || branch.close_time) && (
          <div className="flex items-center gap-2">
            <Icon name="Clock" size={16} className="text-[var(--zn-primary)] shrink-0" />
            <span className="text-sm text-[var(--zn-foreground)]">
              {branch.open_time || '—'} - {branch.close_time || '—'}
            </span>
          </div>
        )}
      </div>
    )}
  </div>
);

export default LocationSection;
