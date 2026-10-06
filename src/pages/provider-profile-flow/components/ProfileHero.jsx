import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const DEFAULT_HERO = 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&h=400&fit=crop';

// hero_image_url/logo_url are admin-pasted with nothing validating them, so a dead link
// is a normal state rather than an edge case — fall back on load failure instead of
// rendering a broken-image icon across the top of the page.
const ProfileHero = ({ orgName, heroImageUrl, logoUrl }) => {
  const [heroFailed, setHeroFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const heroSrc = (heroImageUrl && !heroFailed) ? heroImageUrl : DEFAULT_HERO;

  return (
  <div className="relative h-56 sm:h-80 w-full overflow-hidden bg-[var(--zn-muted)]">
    <img
      src={heroSrc}
      alt={orgName}
      onError={() => setHeroFailed(true)}
      className="w-full h-full object-cover"
    />
    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
    <div className="absolute bottom-0 left-0 px-4 sm:px-6 pb-5 sm:pb-6 flex items-center gap-4 max-w-7xl mx-auto right-0">
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-white bg-[var(--zn-card)] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(35,33,29,0.15)]">
        {logoUrl && !logoFailed ? (
          <img src={logoUrl} alt={orgName} onError={() => setLogoFailed(true)} className="w-full h-full object-cover" />
        ) : (
          <Icon name="Sparkles" size={28} className="text-[var(--zn-primary)]" />
        )}
      </div>
      <h1 className="font-normal text-2xl sm:text-4xl text-white drop-shadow-md tracking-tight">
        {orgName}
      </h1>
    </div>
  </div>
  );
};

export default ProfileHero;
