import React from 'react';
import Icon from '../../../components/AppIcon';

const AmenitiesList = ({ title, items, icon }) => (
  <div>
    <h3 className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--zn-muted-foreground)] mb-3">{title}</h3>
    {items.length === 0 ? (
      <p className="text-sm text-[var(--zn-muted-foreground)]">None listed.</p>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item, index) => (
          <div key={`${item}-${index}`} className="flex items-start gap-2.5">
            <Icon name={icon} size={18} className="text-[var(--zn-primary)] shrink-0 mt-px" />
            <span className="text-sm text-[var(--zn-foreground)]">{item}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const AmenitiesSection = ({ amenities, includedWithVisit, optionalExtras }) => (
  <div className="py-8 space-y-7">
    <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)]">Amenities</h2>
    <AmenitiesList title="Amenities" items={amenities} icon="Check" />
    <AmenitiesList title="Included With Every Visit" items={includedWithVisit} icon="Gift" />
    <AmenitiesList title="Optional Extras" items={optionalExtras} icon="Plus" />
  </div>
);

export default AmenitiesSection;
