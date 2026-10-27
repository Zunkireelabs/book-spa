import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import CustomerHeader from '../../../components/ui/CustomerHeader';
import ProfileHero from './ProfileHero';
import { isRealAddress } from '../utils/address';
import { fetchClosedDateRanges } from '../../../services/api';
import { isDateInRanges, isBranchOpenNow, formatTime12, getNepalToday } from '../../customer-booking-flow/utils/availability';

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
// Browser Back is the only way to change branch afterwards (the popstate handler
// re-shows this gate) — there is no in-page switcher.
// Per-branch Open Now/Closed Today status — mirrors BranchSelection.jsx's (grid flow)
// closed-dates + open-hours computation exactly, reusing the same shared helpers so the
// two flows never disagree about what "open" means. Computed here (not in the parent)
// since BranchGate is the only consumer of this derived state.
function useBranchStatus(branches) {
  const [statusByBranchId, setStatusByBranchId] = useState({});

  useEffect(() => {
    if (!branches?.length) return;
    let cancelled = false;

    Promise.all(
      branches.map((b) => fetchClosedDateRanges(b.id).then(({ data: ranges }) => ranges || []))
    ).then((closedRangesByBranch) => {
      if (cancelled) return;
      const today = getNepalToday();
      const next = {};
      branches.forEach((b, i) => {
        const closedRanges = closedRangesByBranch[i];
        const closedToday = isDateInRanges(today, closedRanges);
        next[b.id] = {
          openNow: !closedToday && isBranchOpenNow(b.open_time, b.close_time),
          closedToday,
        };
      });
      setStatusByBranchId(next);
    });

    return () => { cancelled = true; };
  }, [branches]);

  return statusByBranchId;
}

const BranchGate = ({ orgName, heroImageUrl, logoUrl, branches, onSelect }) => {
  const statusByBranchId = useBranchStatus(branches);

  return (
  <div className="zn-scope min-h-screen bg-[var(--zn-background)]" style={{ paddingTop: 'var(--customer-header-h, 64px)' }}>
    <CustomerHeader containerClassName="relative max-w-7xl mx-auto px-4 sm:px-6" />
    <ProfileHero orgName={orgName} heroImageUrl={heroImageUrl} logoUrl={logoUrl} />

    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Choose a location</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((branch) => {
          const status = statusByBranchId[branch.id];
          return (
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon name="Clock" size={14} className="text-[var(--zn-primary)] shrink-0" />
                    <span className="text-sm text-[var(--zn-muted-foreground)]">
                      {branch.open_time ? formatTime12(branch.open_time) : '—'} - {branch.close_time ? formatTime12(branch.close_time) : '—'}
                    </span>
                  </div>
                  {status && (
                    <div className={`flex items-center gap-1 ${status.openNow ? 'text-success' : 'text-error'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${status.openNow ? 'bg-success animate-pulse' : 'bg-error'}`} />
                      <span className="text-[10px] font-bold uppercase">
                        {status.openNow ? 'Open Now' : status.closedToday ? 'Closed Today' : 'Closed Now'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  </div>
  );
};

export default BranchGate;
