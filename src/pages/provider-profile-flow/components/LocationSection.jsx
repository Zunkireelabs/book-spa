import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import CustomSelect from '../../../components/ui/CustomSelect';

// Most orgs onboarded so far have exactly one branch, so no picker renders — but this
// is not a permanent property of the page: `branches` can carry more than one, and the
// selector below appears whenever it does.

// Hand-pasted admin URL with nothing validating it, so a dead link is a normal state —
// hides itself on error instead of showing a broken-image icon (same trick as
// SummaryCard's VenueThumb).
const StorefrontPhoto = ({ branchName, photoUrl }) => {
  const [failed, setFailed] = useState(false);
  if (!photoUrl || failed) return null;
  return (
    <img
      src={photoUrl}
      alt={`${branchName} storefront`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full aspect-[16/9] object-cover rounded-[var(--zn-radius-lg)] mb-4 max-w-prose"
    />
  );
};

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
      <>
      <StorefrontPhoto branchName={branch.name} photoUrl={branch.photo_url} />
      <div className="space-y-3 p-5 border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] bg-[var(--zn-card)] max-w-prose">
        <h3 className="font-normal text-base text-[var(--zn-foreground)]">{branch.name}</h3>
        <div className="flex items-start gap-2">
          <Icon name="MapPin" size={16} className="text-[var(--zn-primary)] shrink-0 mt-0.5" />
          <span className="text-sm text-[var(--zn-foreground)]">{branch.address || 'Address not set.'}</span>
        </div>
        {(() => {
          const mapsHref = branch.maps_url
            || (branch.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}` : null);
          if (!mapsHref) return null;
          return (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[var(--zn-primary)] hover:underline"
            >
              <Icon name="Navigation" size={16} className="shrink-0" />
              Get directions
            </a>
          );
        })()}
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
      </>
    )}
  </div>
);

export default LocationSection;
