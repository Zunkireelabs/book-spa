import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import CustomerHeader from '../../../components/ui/CustomerHeader';
import ProfileHero from './ProfileHero';
import { isRealAddress } from '../utils/address';

// Same onError-hides-itself guard as StorefrontPhoto/VenueThumb — these are
// admin-pasted URLs with nothing validating them, so a dead link is a normal state.
// Falls back to an icon tile (not an empty box) so a photo-less branch still looks
// deliberate, matching VenueThumb's fallback.
const BranchPhoto = ({ branchName, photoUrl }) => {
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={`${branchName} storefront`}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-full aspect-[16/9] object-cover rounded-t-[var(--zn-radius-lg)]"
      />
    );
  }
  return (
    <div className="w-full aspect-[16/9] rounded-t-[var(--zn-radius-lg)] flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
      <Icon name="Sparkles" size={32} />
    </div>
  );
};

// First-entry branch chooser for multi-branch orgs — gates the services page so a
// customer can't silently browse/book the wrong location (today's data[0] pick).
// Single-branch orgs never see this; it only renders when branches.length > 1.
// Changing branch afterwards stays with LocationSection's CustomSelect — this is
// for first entry only, not "second thoughts".
const BranchGate = ({ orgName, heroImageUrl, logoUrl, branches, onSelect }) => (
  <div className="zn-scope min-h-screen bg-[var(--zn-background)]" style={{ paddingTop: 'var(--customer-header-h, 64px)' }}>
    <CustomerHeader containerClassName="relative max-w-7xl mx-auto px-4 sm:px-6" />
    <ProfileHero orgName={orgName} heroImageUrl={heroImageUrl} logoUrl={logoUrl} />

    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Choose a location</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((branch) => (
          <div
            key={branch.id}
            onClick={() => onSelect(branch)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(branch); }}
            className="cursor-pointer border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] bg-[var(--zn-card)] overflow-hidden hover:border-[var(--zn-primary-soft)] transition-colors"
          >
            <BranchPhoto branchName={branch.name} photoUrl={branch.photo_url} />
            <div className="p-4 space-y-2">
              <h3 className="font-medium text-base text-[var(--zn-foreground)]">{branch.name}</h3>
              {isRealAddress(branch.address) && (
                <div className="flex items-start gap-2">
                  <Icon name="MapPin" size={14} className="text-[var(--zn-primary)] shrink-0 mt-0.5" />
                  <span className="text-sm text-[var(--zn-muted-foreground)]">{branch.address}</span>
                </div>
              )}
              {(branch.open_time || branch.close_time) && (
                <div className="flex items-center gap-2">
                  <Icon name="Clock" size={14} className="text-[var(--zn-primary)] shrink-0" />
                  <span className="text-sm text-[var(--zn-muted-foreground)]">
                    {branch.open_time || '—'} - {branch.close_time || '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default BranchGate;
