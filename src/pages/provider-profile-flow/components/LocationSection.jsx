import React from 'react';
import Icon from '../../../components/AppIcon';
import CustomSelect from '../../../components/ui/CustomSelect';

// Most orgs onboarded so far have exactly one branch, so no picker renders — but this
// is not a permanent property of the page: `branches` can carry more than one, and the
// selector below appears whenever it does.
const LocationSection = ({ branch, branches = [], onSelectBranch }) => (
  <div className="py-8">
    <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Location</h2>
    {branches.length > 1 && (
      <div className="mb-4 max-w-prose">
        <CustomSelect
          value={branch?.id}
          onChange={(val) => onSelectBranch?.(branches.find((b) => String(b.id) === String(val)))}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Select a branch"
          size="md"
        />
      </div>
    )}
    {!branch ? (
      <p className="text-sm text-[var(--zn-muted-foreground)]">Location details unavailable.</p>
    ) : (
      <div className="space-y-3 p-5 border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] bg-[var(--zn-card)] max-w-prose">
        <h3 className="font-normal text-base text-[var(--zn-foreground)]">{branch.name}</h3>
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
