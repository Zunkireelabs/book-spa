import React from 'react';

const OverviewSection = ({ about }) => (
  <div className="py-8">
    <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Overview</h2>
    <p className="text-base leading-relaxed text-[var(--zn-muted-foreground)] whitespace-pre-wrap max-w-prose">
      {about || 'No description added yet.'}
    </p>
  </div>
);

export default OverviewSection;
